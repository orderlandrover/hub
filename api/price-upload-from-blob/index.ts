// api/price-upload-from-blob/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { BlobServiceClient } from "@azure/storage-blob";
import { parse } from "csv-parse/sync";
import { wcFindProductIdBySku, wcBatchUpdateProducts, WooUpdate, WooStatus } from "../shared/wc";

type Body = {
  container: string;
  blobName: string;
  fx: number;
  markupPct: number;
  roundMode: "near" | "up" | "down";
  step: number; // 0 = ingen avrundning
  publish: boolean;
  dryRun: boolean;
  batchSize: number;  // ej använd här, vi batchar Woo i 100 ändå
  offset: number;     // 0-baserad (exkl header)
  limitRows: number;  // max rader att processa
  csvDelimiter?: "," | ";" | "\t";
};

function roundValue(n: number, step: number, mode: "near" | "up" | "down") {
  if (!step || step <= 0) return n;
  const k = n / step;
  if (mode === "up") return Math.ceil(k) * step;
  if (mode === "down") return Math.floor(k) * step;
  return Math.round(k) * step;
}

async function streamToBuffer(readableStream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return await new Promise((resolve, reject) => {
    readableStream.on("data", (d) => chunks.push(Buffer.from(d)));
    readableStream.on("end", () => resolve(Buffer.concat(chunks)));
    readableStream.on("error", reject);
  });
}

// Hjälpare: hitta första matchande kolumnindex utifrån lista av regexar
function findCol(header: string[], patterns: RegExp[]): number {
  for (const rx of patterns) {
    const idx = header.findIndex((h) => rx.test(h));
    if (idx >= 0) return idx;
  }
  return -1;
}

app.http("price-upload-from-blob", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const b = (await req.json()) as Partial<Body>;
      const {
        container, blobName, fx = 0, markupPct = 0, roundMode = "near", step = 0,
        offset = 0, limitRows = 500, csvDelimiter = ",", publish = false, dryRun = true,
      } = b as Body;

      if (!container || !blobName) {
        return { status: 400, jsonBody: { ok: false, error: "container/blobName saknas" } };
      }
      const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
      if (!conn) {
        return { status: 500, jsonBody: { ok: false, error: "AZURE_STORAGE_CONNECTION_STRING saknas" } };
      }

      // --- Läs CSV från Azure Blob ---
      const svc = BlobServiceClient.fromConnectionString(conn);
      const cont = svc.getContainerClient(container);
      const blob = cont.getBlobClient(blobName);
      const dl = await blob.download();
      const buf = await streamToBuffer(dl.readableStreamBody as NodeJS.ReadableStream);
      const text = buf.toString("utf8");

      const records: string[][] = parse(text, {
        bom: true,
        delimiter: csvDelimiter,
        relax_column_count: true,
        skip_empty_lines: true,
      });
      if (!records.length) return { status: 400, jsonBody: { ok: false, error: "Tom CSV" } };

      const header = records[0].map((h) => String(h).trim());
      const rows = records.slice(1);

      // Din header-layout (minst dessa två):
      // Part No, Description, Price, ...
      const colSKU   = findCol(header, [/^part\s*no$/i, /^sku$/i]);
      const colPrice = findCol(header, [/^price$/i]);

      if (colSKU < 0 || colPrice < 0) {
        return { status: 400, jsonBody: { ok: false, error: "CSV saknar 'Part No' eller 'Price'", header } };
      }

      // Valfria lagerkolumner om din CSV har dem (din nuvarande har det inte)
      const colQty   = findCol(header, [/^qty$/i, /^quantity$/i, /^stock$/i]);
      const colStat  = findCol(header, [/^stock\s*status$/i, /^status$/i]);

      const total = rows.length;
      const start = Math.max(0, offset);
      const end = Math.min(total, start + limitRows);
      const slice = rows.slice(start, end);

      let updated = 0, skipped = 0, notFound = 0, badRows = 0;
      const sample: any[] = [];

      type RowCalc = { sku: string; sek: number; qty?: number | null; stock_status?: "instock" | "outofstock" | "onbackorder" };
      const toApply: RowCalc[] = [];

      for (const r of slice) {
        try {
          const sku = String(r[colSKU] ?? "").trim();
          const gbp = Number(String(r[colPrice] ?? "0").replace(",", "."));
          if (!sku || !isFinite(gbp)) { badRows++; continue; }

          const sekRaw = gbp * Number(fx) * (1 + Number(markupPct) / 100);
          const sek = roundValue(sekRaw, Number(step || 0), roundMode || "near");

          // Valfria lagerfält (om kolumner finns)
          let qty: number | null | undefined = undefined;
          let stock_status: "instock" | "outofstock" | "onbackorder" | undefined = undefined;

          if (colQty >= 0) {
            const q = Number(String(r[colQty] ?? "").replace(",", "."));
            if (Number.isFinite(q)) qty = q;
          }
          if (colStat >= 0) {
            const raw = String(r[colStat] ?? "").toLowerCase().trim();
            if (raw === "instock" || raw === "in stock" || raw === "in_stock") stock_status = "instock";
            else if (raw === "outofstock" || raw === "out of stock" || raw === "out_stock") stock_status = "outofstock";
            else if (raw === "onbackorder" || raw === "backorder") stock_status = "onbackorder";
          }

          updated++;
          if (sample.length < 10) sample.push({ sku, gbp, sek, qty, stock_status });

          if (!dryRun) toApply.push({ sku, sek, qty: qty ?? undefined, stock_status });
        } catch {
          badRows++;
        }
      }

      // --- Uppdatera Woo när dryRun=false ---
      let applied = 0;
      if (!dryRun && toApply.length) {
        // 1) Slå upp ID för varje SKU (10 samtidiga "workers")
        const maxConc = 10;
        const ids: Array<{ id: number; sek: number; qty?: number | null; stock_status?: "instock" | "outofstock" | "onbackorder" }> = [];
        let i = 0;

        async function worker() {
          while (i < toApply.length) {
            const idx = i++;
            const { sku, sek, qty, stock_status } = toApply[idx];
            try {
              const pid = await wcFindProductIdBySku(sku);
              if (!pid) { notFound++; continue; }
              ids.push({ id: pid, sek, qty: qty ?? null, stock_status });
            } catch {
              skipped++;
            }
            if (i % 50 === 0) await new Promise((r) => setTimeout(r, 10));
          }
        }
        await Promise.all(Array.from({ length: maxConc }, () => worker()));

        // 2) Bygg updates (pris alltid; lager om vi har data)
        const status: WooStatus = publish ? "publish" : "draft";
        const updates: WooUpdate[] = ids.map((x) => {
          const u: WooUpdate = {
            id: x.id,
            regular_price: String(Math.round(x.sek)), // Använd x.sek.toFixed(2) om du vill ha ören
            status,
          };
          if (typeof x.qty === "number") {
            u.manage_stock = true;
            u.stock_quantity = x.qty;
            if (x.qty > 0 && !x.stock_status) u.stock_status = "instock";
          }
          if (x.stock_status) {
            u.stock_status = x.stock_status;
          }
          return u;
        });

        // 3) Skicka i batch om 100
        applied = await wcBatchUpdateProducts(updates);
      }

      const nextOffset = end < total ? end : null;
      return {
        status: 200,
        jsonBody: {
          ok: true,
          total,
          range: { offset: start, end },
          nextOffset,
          updated,
          skipped,
          notFound,
          badRows,
          sample,
          applied,
        },
      };
    } catch (e: any) {
      return { status: 500, jsonBody: { ok: false, error: e?.message || String(e) } };
    }
  },
});
