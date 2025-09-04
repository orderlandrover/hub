import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { BlobServiceClient } from "@azure/storage-blob";
import { parse } from "csv-parse/sync";

type Body = {
  container: string;
  blobName: string;
  fx: number;
  markupPct: number;
  roundMode: "near" | "up" | "down";
  step: number; // 0 = ingen avrundning
  publish: boolean;
  dryRun: boolean;
  batchSize: number;
  offset: number;     // 0-baserad rad (exkl header)
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

app.http("price-upload-from-blob", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const b = (await req.json()) as Partial<Body>;
      const {
        container, blobName, fx = 0, markupPct = 0, roundMode = "near", step = 0,
        offset = 0, limitRows = 500, csvDelimiter = ",",
      } = b as Body;

      if (!container || !blobName) {
        return { status: 400, jsonBody: { ok: false, error: "container/blobName saknas" } };
      }

      const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
      if (!conn) {
        return { status: 500, jsonBody: { ok: false, error: "AZURE_STORAGE_CONNECTION_STRING saknas" } };
      }

      const svc = BlobServiceClient.fromConnectionString(conn);
      const cont = svc.getContainerClient(container);
      const blob = cont.getBlobClient(blobName);

      const dl = await blob.download();
      const buf = await streamToBuffer(dl.readableStreamBody as NodeJS.ReadableStream);
      const text = buf.toString("utf8");

      // CSV → records
      const records: string[][] = parse(text, {
        bom: true,
        delimiter: csvDelimiter,
        relax_column_count: true,
        skip_empty_lines: true,
      });

      if (!records.length) {
        return { status: 400, jsonBody: { ok: false, error: "Tom CSV" } };
      }

      const header = records[0].map((h) => String(h).trim());
      const rows = records.slice(1);

      // Din header-layout:
      // Part No,Description,Price,Per,UOI,Brand,LR Retail,Weight,Length,Width,Thickness,C of O,EEC Commodity Code
      const colPartNo = header.findIndex((h) => /^part\s*no$/i.test(h));
      const colPrice  = header.findIndex((h) => /^price$/i.test(h));
      if (colPartNo < 0 || colPrice < 0) {
        return {
          status: 400,
          jsonBody: {
            ok: false,
            error: `CSV header saknar 'Part No' eller 'Price'`,
            header,
          },
        };
      }

      const total = rows.length;
      const start = Math.max(0, offset);
      const end = Math.min(total, start + limitRows);
      const slice = rows.slice(start, end);

      let updated = 0;
      let skipped = 0;
      let notFound = 0; // för framtida SKU-koll i Woo
      let badRows = 0;

      const sample: any[] = [];

      for (const r of slice) {
        try {
          const sku = String(r[colPartNo] ?? "").trim();
          const gbp = Number(String(r[colPrice] ?? "0").replace(",", "."));
          if (!sku || !isFinite(gbp)) { badRows++; continue; }

          const sekRaw = gbp * Number(fx) * (1 + Number(markupPct) / 100);
          const sek = roundValue(sekRaw, Number(step || 0), roundMode || "near");

          // TODO: hookup mot Woo. Nu räknar vi bara.
          updated++;
          if (sample.length < 10) sample.push({ sku, gbp, sek });
        } catch {
          badRows++;
        }
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
        },
      };
    } catch (e: any) {
      return { status: 500, jsonBody: { ok: false, error: e?.message || String(e) } };
    }
  },
});
