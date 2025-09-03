import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { BlobServiceClient } from "@azure/storage-blob";
import { parse } from "csv-parse/sync";

/* ───────────────────────── helpers ───────────────────────── */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseNum(input: any, fallback = 0): number {
  if (typeof input === "number") return Number.isFinite(input) ? input : fallback;
  if (typeof input !== "string") return fallback;
  const s = input.replace(/\s/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

type RoundMode = "near" | "up" | "down";
function roundToStep(value: number, step: number, mode: RoundMode): number {
  if (!step || step <= 0) return Math.round(value);
  const q = value / step;
  if (mode === "up") return Math.ceil(q) * step;
  if (mode === "down") return Math.floor(q) * step;
  return Math.round(q) * step; // near
}

function fail(status: number, error: string, details?: any): HttpResponseInit {
  return { status, jsonBody: { ok: false, error, details } };
}

function detectDelimiter(sample: string): "," | ";" | "\t" {
  const comma = (sample.match(/,/g) || []).length;
  const semicolon = (sample.match(/;/g) || []).length;
  const tab = (sample.match(/\t/g) || []).length;
  if (semicolon > comma && semicolon > tab) return ";";
  if (tab > comma && tab > semicolon) return "\t";
  return ",";
}

type CsvRow = Record<string, string>;
type UpdateItem = { sku: string; price: string };

function computePrice(gbp: number, fx: number, markupPct: number, mode: RoundMode, step: number): number {
  const raw = gbp * fx * (1 + (markupPct || 0) / 100);
  return step ? roundToStep(raw, step, mode) : Math.round(raw);
}

/* ── streams: NodeJS.ReadableStream → Uint8Array ── */
async function streamToBuffer(readable: NodeJS.ReadableStream): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Buffer[] = [];
    readable.on("data", (c: any) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    readable.once("end", () => resolve(Buffer.concat(chunks)));
    readable.once("error", reject);
  });
}

/* ── blob readers ── */
async function readBlobBytesViaSas(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`Blob GET ${res.status}: ${(await res.text().catch(() => ""))}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function readBlobBytesViaKey(conn: string, container: string, blobName: string): Promise<Uint8Array> {
  const svc = BlobServiceClient.fromConnectionString(conn);
  const blob = svc.getContainerClient(container).getBlobClient(blobName);
  const dl = await blob.download();
  if (!dl.readableStreamBody) return new Uint8Array();
  const buf = await streamToBuffer(dl.readableStreamBody);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/* ── WooCommerce ── */

async function wcFetch(path: string, method = "GET", body?: any) {
  const base = process.env.WC_URL || "";
  const key = process.env.WC_KEY || "";
  const sec = process.env.WC_SECRET || "";
  if (!base || !key || !sec) throw new Error("WC_URL / WC_KEY / WC_SECRET saknas i App Settings");

  const url = new URL(path, base);
  url.searchParams.set("consumer_key", key);
  url.searchParams.set("consumer_secret", sec);

  const res = await fetch(url.toString(), {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok) throw new Error(json?.message || text || `HTTP ${res.status}`);
  return json;
}

async function updateWooBySkuBatch(updates: UpdateItem[], publish: boolean, ctx: InvocationContext) {
  let updated = 0, notFound = 0, errors = 0;
  const CONCURRENCY = 3;

  async function workOne(u: UpdateItem) {
    try {
      const list = await wcFetch(`/products?sku=${encodeURIComponent(u.sku)}&per_page=1`, "GET");
      const prod = Array.isArray(list) ? list[0] : null;
      if (!prod?.id) { notFound++; return; }
      const payload: any = { regular_price: String(u.price) };
      if (publish && prod.status !== "publish") payload.status = "publish";
      await wcFetch(`/products/${prod.id}`, "PUT", payload);
      updated++;
    } catch (e: any) {
      errors++;
      ctx.warn?.(`WC error for ${u.sku}: ${e?.message || e}`);
    }
  }

  let i = 0;
  while (i < updates.length) {
    const slice = updates.slice(i, i + CONCURRENCY);
    await Promise.all(slice.map(workOne));
    i += CONCURRENCY;
    await sleep(120);
  }

  return { updated, notFound, errors };
}

/* ── body typing ── */
interface InputBody {
  sasUrl?: string;
  container?: string;
  blobName?: string;
  fx?: any;
  markupPct?: any;
  roundMode?: any;
  step?: any;
  publish?: any;
  dryRun?: any;
  offset?: any;
  limitRows?: any;
  batchSize?: any;
}

/* ───────────────────────── handler ───────────────────────── */

app.http("price-upload-from-blob", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "price-upload-from-blob",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const url = new URL(req.url);
      const diag = url.searchParams.get("diag") || "";

      if (diag === "ping") {
        return { status: 200, jsonBody: { ok: true, ts: Date.now() } };
      }

      const body = (await req.json().catch(() => ({}))) as InputBody;

      // quick peek
      if (diag === "peek") {
        if (!body.sasUrl && !(body.container && body.blobName)) {
          return fail(400, "blob reference missing (container+blobName eller sasUrl/blobUrl krävs)");
        }
        const bytes = body.sasUrl
          ? await readBlobBytesViaSas(body.sasUrl)
          : await readBlobBytesViaKey(
              process.env.PRICEUPLOAD_CONN || process.env.AzureWebJobsStorage || "",
              body.container!, body.blobName!
            );
        const head = new TextDecoder().decode(bytes.slice(0, 512));
        return { status: 200, jsonBody: { ok: true, length: bytes.length, head } };
      }

      // read blob
      if (!body.sasUrl && !(body.container && body.blobName)) {
        return fail(400, "blob reference missing (container+blobName eller sasUrl/blobUrl krävs)");
      }

      const bytes = body.sasUrl
        ? await readBlobBytesViaSas(body.sasUrl)
        : await readBlobBytesViaKey(
            process.env.PRICEUPLOAD_CONN || process.env.AzureWebJobsStorage || "",
            body.container!, body.blobName!
          );

      const text = new TextDecoder().decode(bytes);
      const delim = detectDelimiter(text.slice(0, 2048));

      const records = parse(text, {
        delimiter: delim,
        columns: true,
        skip_empty_lines: true,
        relax_quotes: true,
        bom: true,
        trim: true,
      }) as CsvRow[];

      const total = records.length;
      const headers = Object.keys(records[0] || {});
      if (diag === "parse") {
        return {
          status: 200,
          jsonBody: { ok: true, delimiter: delim, headers, sample: records.slice(0, 10), total },
        };
      }

      const fx = parseNum(body.fx, 0);
      const markupPct = parseNum(body.markupPct, 0);
      const step = parseNum(body.step, 1);
      const roundMode: RoundMode = ["near", "up", "down"].includes(String(body.roundMode))
        ? String(body.roundMode) as RoundMode
        : "near";
      const publish = !!body.publish;
      const dryRun = !!body.dryRun;

      const offset = Math.max(0, parseNum(body.offset, 0));
      const limitRows = Math.max(1, parseNum(body.limitRows, total || 1));
      const end = Math.min(total, offset + limitRows);
      const selected = records.slice(offset, end);

      const updates: UpdateItem[] = [];
      let badRows = 0;
      for (const row of selected) {
        const sku = (row["Part No"] || row["SKU"] || row["Sku"] || "").toString().trim();
        const gbp = parseNum(row["Price"], NaN);
        if (!sku || !Number.isFinite(gbp)) { badRows++; continue; }
        const priceNumber = computePrice(gbp, fx, markupPct, roundMode, step);
        updates.push({ sku, price: String(priceNumber) });
      }

      if (dryRun) {
        return {
          status: 200,
          jsonBody: {
            ok: true,
            total,
            processed: selected.length,
            updated: updates.length,
            skipped: 0,
            notFound: 0,
            badRows,
            range: { offset, end },
            nextOffset: end < total ? end : null,
            limitRows,
            dryRun: true,
            publish,
            fx,
            markupPct,
            step,
            roundMode,
            sample: {
              updates: updates.slice(0, 5).map(u => ({ ...u, dryRun: true })),
              errors: [],
              skipped: [],
              detect: { headers },
            },
          },
        };
      }

      const BATCH = Math.max(1, parseNum(body.batchSize, 250));
      let done = 0;
      let wcUpdated = 0, wcNF = 0, wcErr = 0;

      while (done < updates.length) {
        const slice = updates.slice(done, done + BATCH);
        const r = await updateWooBySkuBatch(slice, publish, ctx);
        wcUpdated += r.updated;
        wcNF      += r.notFound;
        wcErr     += r.errors;
        done += BATCH;
        await sleep(200);
      }

      return {
        status: 200,
        jsonBody: {
          ok: true,
          total,
          processed: selected.length,
          updated: wcUpdated,
          skipped: 0,
          notFound: wcNF,
          badRows,
          errors: wcErr,
          range: { offset, end },
          nextOffset: end < total ? end : null,
          limitRows,
          dryRun: false,
          publish,
          fx,
          markupPct,
          step,
          roundMode,
        },
      };

    } catch (err: any) {
      const url = new URL(req.url);
      const diag = url.searchParams.get("diag") || "";
      if (diag === "trace") {
        return fail(500, err?.message || "Unhandled error", { stack: err?.stack || null });
      }
      return fail(500, "Backend call failure");
    }
  },
});
