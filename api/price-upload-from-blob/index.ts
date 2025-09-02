import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  BlobClient,
  RestError,
} from "@azure/storage-blob";
import { parse } from "csv-parse/sync";
import { wcFetch, readJsonSafe } from "../shared/wc";
import { calcSEK, RoundMode } from "../shared/pricing";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type Body = {
  container?: string;
  blobName?: string;
  blobUrl?: string;    // kan vara med SAS
  sasUrl?: string;     // alternativt explicit SAS-URL
  fx?: number;
  markupPct?: number;
  roundMode?: RoundMode; // "near" | "up" | "down"
  step?: number;
  publish?: boolean;
  dryRun?: boolean;
  batchSize?: number;
};

// ---------------- CSV helpers ----------------
function normHdr(s: string) { return s.replace(/\uFEFF/g,"").replace(/\s+/g," ").trim(); }
function getCI(obj: Record<string, any>, key: string) {
  const found = Object.keys(obj).find(k => k.toLowerCase() === key.toLowerCase());
  return found ? obj[found] : undefined;
}
const SKU_KEYS = ["Part No","PartNo","Part_No","SKU","Code","Part Number","Article","Art Nr","Art.Nr"];
const PRICE_KEYS_SEK = ["SEK","Price SEK","Pris (SEK)","Pris SEK"];
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
  const PRICE_KEYS = ["Price","GBP","RRP","Price GBP","GBP Price","Unit Price","Net Price","List Price","Pris (GBP)","Pris GBP","RRP GBP"];
  for (const k of PRICE_KEYS) {
    const v = getCI(row, k);
    if (v !== undefined) {
      const n = pickNumberLike(v);
      if (Number.isFinite(n)) return n;
    }
  }
  const priceRaw = getCI(row, "Price");
  const priceNum = pickNumberLike(priceRaw);
  const descRaw  = getCI(row, "Description");
  const descNum  = pickNumberLike(descRaw);
  if (!Number.isFinite(priceNum) && Number.isFinite(descNum)) return descNum;
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

app.http("price-upload-from-blob", {
  route: "price-upload-from-blob",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };

    try {
      const body = (await req.json().catch(() => ({}))) as Body;
      ctx.log?.("price-upload-from-blob body", {
        hasC: !!body.container, hasB: !!body.blobName, hasBlobUrl: !!body.blobUrl, hasSasUrl: !!body.sasUrl,
      });

      // ---- 1) Läs CSV-innehåll från blob (konto-nyckel ELLER SAS) ----
      const csvText = await downloadBlobText(body, ctx);

      // ---- 2) Parse CSV ----
      const rows = parse(csvText, {
        columns: (h: string[]) => h.map(normHdr),
        delimiter: ",",
        bom: true,
        skip_empty_lines: true,
        relax_quotes: true,
        relax_column_count: true,
        trim: true
      }) as Record<string, any>[];

      // ---- 3) Parametrar ----
      const fx = Number(body.fx ?? 13.0);
      const markupPct = Number(body.markupPct ?? 0);
      const step = Number(body.step ?? 1);
      const roundMode = (body.roundMode ?? "near") as RoundMode;
      const publish = !!body.publish;
      const dryRun = !!body.dryRun;
      const batchSize = Math.max(1000, Math.min(20000, Number(body.batchSize ?? 5000)));

      // ---- 4) Loop & uppdatera ----
      const total = rows.length;
      let updated = 0, skipped = 0, notFound = 0, badRows = 0, processed = 0;
      const sample = { updates: [] as any[], errors: [] as any[], skipped: [] as any[], detect: { headers: Object.keys(rows[0] || {}) } };

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
              if (!Number.isFinite(sek)) { skipped++; if (sample.skipped.length < 5) sample.skipped.push({ reason: "invalid price", raw }); continue; }
              targetSEK = Number(sek).toFixed(2);
            }

            if (!sku) { skipped++; if (sample.skipped.length < 5) sample.skipped.push({ reason: "missing sku", raw }); continue; }

            const find = await wcFetch(`/products?sku=${encodeURIComponent(sku)}`);
            const { json: list, text: tFind } = await readJsonSafe(find);
            if (!find.ok || !Array.isArray(list)) throw new Error(`Woo /products?sku ${find.status}: ${tFind.slice(0,180)}`);
            if (list.length === 0) { notFound++; if (sample.errors.length < 5) sample.errors.push({ sku, reason: "not found" }); continue; }

            const { id, regular_price } = list[0] || {};
            if (dryRun) { updated++; if (sample.updates.length < 5) sample.updates.push({ id, sku, from: regular_price, to: targetSEK, dryRun: true }); continue; }

            const payload: any = { regular_price: targetSEK };
            if (publish) payload.status = "publish";
            const upd = await wcFetch(`/products/${id}`, { method: "PUT", body: JSON.stringify(payload) });

            if (upd.ok) { updated++; if (sample.updates.length < 5) sample.updates.push({ id, sku, from: regular_price, to: targetSEK }); }
            else { const msg = await upd.text(); badRows++; if (sample.errors.length < 5) sample.errors.push({ sku, error: msg || "update failed" }); }
          } catch (e: any) {
            badRows++; if (sample.errors.length < 5) sample.errors.push({ error: e?.message || String(e) });
          }
        }
        processed = Math.min(off + batchSize, total);
        ctx.log?.(`[PRICE-BLOB] progress ${processed}/${total} updated=${updated} skipped=${skipped} notFound=${notFound} bad=${badRows}`);
      }

      return { status: 200, headers: CORS, jsonBody: { ok: true, total, processed, updated, skipped, notFound, badRows, sample, dryRun, publish, fx, markupPct, step, roundMode } };
    } catch (e: any) {
      const rest = e as RestError;
      ctx.error?.("price-upload-from-blob FAILED", e);
      return {
        status: 500,
        headers: CORS,
        jsonBody: {
          ok: false,
          error: e?.message || "price-upload-from-blob failed",
          details: { statusCode: (rest as any)?.statusCode, code: (rest as any)?.code, name: e?.name }
        }
      };
    }
  },
});

// ------- helpers -------
async function downloadBlobText(body: Body, ctx: InvocationContext): Promise<string> {
  // Prioritet: container+blobName (konto-nyckel) -> sasUrl -> blobUrl
  if (body.container && body.blobName) {
    const accountName = process.env.STORAGE_ACCOUNT_NAME!;
    const accountKey  = process.env.STORAGE_ACCOUNT_KEY!;
    if (!accountName || !accountKey) throw new Error("Missing STORAGE_ACCOUNT_NAME/KEY");
    const cred = new StorageSharedKeyCredential(accountName, accountKey);
    const svc  = new BlobServiceClient(`https://${accountName}.blob.core.windows.net`, cred);
    const blob = svc.getContainerClient(body.container).getBlobClient(body.blobName);
    const exists = await blob.exists();
    if (!exists) throw new Error(`Blob not found: ${body.container}/${body.blobName}`);
    const dl = await blob.download();
    return await streamToString(dl.readableStreamBody);
  }

  const direct = body.sasUrl || body.blobUrl;
  if (direct) {
    const blob = new BlobClient(direct);
    const dl = await blob.download();
    return await streamToString(dl.readableStreamBody);
  }

  throw new Error("blob reference missing (container+blobName eller sasUrl/blobUrl krävs)");
}

async function streamToString(
  body: NodeJS.ReadableStream | ReadableStream<Uint8Array> | null | undefined
): Promise<string> {
  if (!body) return "";
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
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as any) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
