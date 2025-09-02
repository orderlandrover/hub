// api/price-upload-from-blob/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { BlobServiceClient, StorageSharedKeyCredential, BlobClient, RestError } from "@azure/storage-blob";
import { parse } from "csv-parse/sync";
import { wcFetch, readJsonSafe } from "../shared/wc";
import { calcSEK, RoundMode } from "../shared/pricing";

/* ------------------------------------------------------------- */
/*                         Helpers (CSV)                          */
/* ------------------------------------------------------------- */
function normHdr(s: string) {
  return s.replace(/\uFEFF/g, "").replace(/\s+/g, " ").trim();
}
function getCI(obj: Record<string, any>, key: string) {
  const found = Object.keys(obj).find((k) => k.toLowerCase() === key.toLowerCase());
  return found ? obj[found] : undefined;
}
const SKU_KEYS = ["Part No", "PartNo", "Part_No", "SKU", "Code", "Part Number", "Article", "Art Nr", "Art.Nr"];
const PRICE_KEYS_SEK = ["SEK", "Price SEK", "Pris (SEK)", "Pris SEK"];

function pickNumberLike(v: any) {
  const s = String(v ?? "").replace(/\s/g, "").replace(/,/g, ".").trim();
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}
function pickSku(row: Record<string, any>) {
  for (const k of SKU_KEYS) {
    const v = getCI(row, k);
    if (v !== undefined && String(v).trim()) return String(v).trim();
  }
  return "";
}
function pickGbp(row: Record<string, any>) {
  const PRICE_KEYS = ["Price", "GBP", "RRP", "Price GBP", "GBP Price", "Unit Price", "Net Price", "List Price", "Pris (GBP)", "Pris GBP", "RRP GBP"];
  for (const k of PRICE_KEYS) {
    const v = getCI(row, k);
    if (v !== undefined) {
      const n = pickNumberLike(v);
      if (Number.isFinite(n)) return n;
    }
  }
  // fallback: leta efter första rimliga talet i raden (exkl. UoI = 1)
  for (const key of Object.keys(row)) {
    const n = pickNumberLike(row[key]);
    if (Number.isFinite(n) && n >= 0.01 && n <= 100000) {
      if (key.toLowerCase() !== "uoi" || n > 1.0) return n;
    }
  }
  return NaN;
}
function pickSek(row: Record<string, any>) {
  for (const k of PRICE_KEYS_SEK) {
    const raw = getCI(row, k);
    if (raw !== undefined) {
      const n = pickNumberLike(raw);
      if (Number.isFinite(n)) return n;
    }
  }
  return NaN;
}
function detectDelimiter(sample: string): string {
  const lines = sample.split(/\r?\n/).slice(0, 3);
  const comma = lines.map((l) => (l.match(/,/g) || []).length).reduce((a, b) => a + b, 0);
  const semi = lines.map((l) => (l.match(/;/g) || []).length).reduce((a, b) => a + b, 0);
  return semi > comma ? ";" : ",";
}
function looksLikeXlsx(buf: string): boolean {
  // XLSX filer börjar ofta med PK\x03\x04 (ZIP)
  return buf.startsWith("PK\u0003\u0004") || buf.includes("application/vnd.openxmlformats-officedocument");
}

/* ------------------------------------------------------------- */
/*                         Request types                          */
/* ------------------------------------------------------------- */
type Body = {
  container?: string;     // föredras (privat container)
  blobName?: string;      // föredras
  blobUrl?: string;       // funkar om SAS/Offentlig
  fx?: number;
  markupPct?: number;
  roundMode?: RoundMode;  // "near" | "up" | "down"
  step?: number;
  publish?: boolean;
  dryRun?: boolean;
  batchSize?: number;
};

/* ------------------------------------------------------------- */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/* ============================================================= */
/*                         HTTP Function                          */
/* ============================================================= */
app.http("price-upload-from-blob", {
  route: "price-upload-from-blob",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 200, headers: CORS };

    try {
      const body = (await req.json()) as Body;
      ctx.log?.("price-upload-from-blob body", {
        hasContainer: !!body.container,
        hasBlobName: !!body.blobName,
        hasBlobUrl: !!body.blobUrl,
      });

      const text = await downloadBlobText(body, ctx); // kan kasta

      if (!text || text.length < 5) {
        return { status: 400, headers: CORS, jsonBody: { ok: false, error: "empty_or_too_small_file" } };
      }
      if (looksLikeXlsx(text)) {
        return {
          status: 400,
          headers: CORS,
          jsonBody: {
            ok: false,
            error: "xlsx_not_supported",
            hint: "Ladda upp som CSV, inte XLSX. Exportera i Excel som CSV (UTF-8).",
          },
        };
      }

      // Robust CSV-parse med auto-delimiter
      const delimiter = detectDelimiter(text);
      let rows: Record<string, any>[];
      try {
        rows = parse(text, {
          columns: (h: string[]) => h.map(normHdr),
          delimiter,
          bom: true,
          skip_empty_lines: true,
          relax_quotes: true,
          relax_column_count: true,
          trim: true,
        }) as Record<string, any>[];
      } catch (err: any) {
        return {
          status: 500,
          headers: CORS,
          jsonBody: {
            ok: false,
            error: "csv_parse_error",
            details: { message: err?.message || String(err), delimiterTried: delimiter },
            hint: "Kontrollera att filen är CSV och att skiljetecknet stämmer (',' eller ';').",
          },
        };
      }

      if (!Array.isArray(rows) || rows.length === 0) {
        return { status: 400, headers: CORS, jsonBody: { ok: false, error: "no_rows_parsed" } };
      }

      // Parametrar
      const fx = Number(body.fx ?? 13.0);
      const markupPct = Number(body.markupPct ?? 0);
      const step = Number(body.step ?? 1);
      const roundMode = (body.roundMode ?? "near") as RoundMode;
      const publish = !!body.publish;
      const dryRun = !!body.dryRun;
      const batchSize = Math.max(1000, Math.min(20000, Number(body.batchSize ?? 5000)));

      const total = rows.length;
      let updated = 0, skipped = 0, notFound = 0, badRows = 0, processed = 0;
      const sample = {
        updates: [] as any[],
        errors: [] as any[],
        skipped: [] as any[],
        detect: { headers: Object.keys(rows[0] || {}), delimiter },
      };

      // Kör i block för minne/tidsgränser
      for (let off = 0; off < total; off += batchSize) {
        const slice = rows.slice(off, Math.min(off + batchSize, total));
        for (const raw of slice) {
          try {
            const sku = pickSku(raw);
            const gbp = pickGbp(raw);
            let targetSEK: string;

            if (Number.isFinite(gbp)) {
              targetSEK = calcSEK(gbp, fx, markupPct, step, roundMode).toFixed(2);
            } else {
              const sek = pickSek(raw);
              if (!Number.isFinite(sek)) {
                skipped++;
                if (sample.skipped.length < 5) sample.skipped.push({ reason: "invalid price", raw });
                continue;
              }
              targetSEK = Number(sek).toFixed(2);
            }

            if (!sku) {
              skipped++;
              if (sample.skipped.length < 5) sample.skipped.push({ reason: "missing sku", raw });
              continue;
            }

            const find = await wcFetch(`/products?sku=${encodeURIComponent(sku)}`);
            const { json: list, text: tFind } = await readJsonSafe(find);
            if (!find.ok || !Array.isArray(list)) throw new Error(`Woo /products?sku ${find.status}: ${tFind.slice(0, 180)}`);
            if (list.length === 0) {
              notFound++;
              if (sample.errors.length < 5) sample.errors.push({ sku, reason: "not found" });
              continue;
            }

            const { id, regular_price } = list[0] || {};
            if (dryRun) {
              updated++;
              if (sample.updates.length < 5) sample.updates.push({ id, sku, from: regular_price, to: targetSEK, dryRun: true });
              continue;
            }

            const payload: any = { regular_price: targetSEK };
            if (publish) payload.status = "publish";
            const upd = await wcFetch(`/products/${id}`, { method: "PUT", body: JSON.stringify(payload) });

            if (upd.ok) {
              updated++;
              if (sample.updates.length < 5) sample.updates.push({ id, sku, from: regular_price, to: targetSEK });
            } else {
              const msg = await upd.text();
              badRows++;
              if (sample.errors.length < 5) sample.errors.push({ sku, error: msg || "update failed" });
            }
          } catch (e: any) {
            badRows++;
            if (sample.errors.length < 5) sample.errors.push({ error: e?.message || String(e) });
          }
        }
        processed = Math.min(off + batchSize, total);
        ctx.log?.(`[PRICE-BLOB] progress ${processed}/${total} updated=${updated} skipped=${skipped} notFound=${notFound} bad=${badRows}`);
      }

      return {
        status: 200,
        headers: CORS,
        jsonBody: {
          ok: true,
          source: body.container && body.blobName ? "private-blob" : body.blobUrl ? "sas-url" : "unknown",
          total,
          processed,
          updated,
          skipped,
          notFound,
          badRows,
          sample,
          dryRun,
          publish,
          fx,
          markupPct,
          step,
          roundMode,
        },
      };
    } catch (e: any) {
      const rest = e as RestError;
      const details = {
        name: e?.name,
        message: e?.message,
        statusCode: (rest as any)?.statusCode,
        code: (rest as any)?.code,
      };
      return { status: 500, headers: CORS, jsonBody: { ok: false, error: e?.message || "price-upload-from-blob failed", details } };
    }
  },
});

/* ============================================================= */
/*                     Blob download helper                       */
/* ============================================================= */
async function downloadBlobText(body: Body, ctx: InvocationContext): Promise<string> {
  if (body.container && body.blobName) {
    const accountName = process.env.STORAGE_ACCOUNT_NAME!;
    const accountKey = process.env.STORAGE_ACCOUNT_KEY!;
    if (!accountName || !accountKey) throw new Error("Missing STORAGE_ACCOUNT_NAME/KEY");

    const cred = new StorageSharedKeyCredential(accountName, accountKey);
    const svc = new BlobServiceClient(`https://${accountName}.blob.core.windows.net`, cred);
    const blob = svc.getContainerClient(body.container).getBlobClient(body.blobName);

    const exists = await blob.exists();
    if (!exists) throw new Error(`Blob not found: ${body.container}/${body.blobName}`);

    const dl = await blob.download();
    return await streamToString(dl.readableStreamBody);
  }

  if (body.blobUrl) {
    const blob = new BlobClient(body.blobUrl);
    const dl = await blob.download();
    return await streamToString(dl.readableStreamBody);
  }

  throw new Error("blob reference missing (container+blobName eller blobUrl krävs)");
}

/* ============================================================= */
async function streamToString(
  body: NodeJS.ReadableStream | ReadableStream<Uint8Array> | null | undefined
): Promise<string> {
  if (!body) return "";
  // Web ReadableStream
  if (typeof (body as any).getReader === "function") {
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  // Node stream
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as any) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
