import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartFetch } from "../shared/britpart";
import { wcFetch } from "../shared/wc";

type RunBody = {
  subcategoryIds?: (string | number)[];
  publish?: boolean;  // default true
};

type BPPart = {
  code: string;
  title?: string;
  content?: string;        // HTML
  subText?: string;        // HTML
  url?: string;
  imageUrls?: string[];
  datePublished?: string;
  similarParts?: string[];
  categoryIds?: number[];
  filterCategories?: any[];
};

type BPList = {
  total: number;
  totalPages: number;
  page: number;
  parts: BPPart[];
};

async function readJsonSafe(res: Response): Promise<{ json: any; text: string }> {
  const text = await res.text();
  try { return { json: text ? JSON.parse(text) : null, text }; }
  catch { return { json: null, text }; }
}

/** Hämta ALLA sidor från Britpart /part/getall (med valfri page-start) */
async function* iterBritpartAll(ctx: InvocationContext): AsyncGenerator<BPPart[], void, unknown> {
  let page = 1;
  for (;;) {
    const res = await britpartFetch("/part/getall", { page });
    const { json, text } = await readJsonSafe(res);
    if (!res.ok || !json || !Array.isArray(json.parts)) {
      ctx.warn(`britpart getall page=${page} HTTP ${res.status} ${text.slice(0,180)}`);
      return;
    }
    yield json.parts as BPPart[];
    if (page >= Number(json.totalPages || 1)) return;
    page++;
  }
}

async function upsertWoo(ctx: InvocationContext, p: BPPart, publish: boolean) {
  // 1) Finns produkt med samma SKU?
  const sku = p.code;
  const f = await wcFetch(`/products?sku=${encodeURIComponent(sku)}`);
  const { json: findJson } = await readJsonSafe(f);
  const exists = Array.isArray(findJson) && findJson[0];

  // 2) Bygg Woo payload (minimal men tillräcklig)
  const name = p.title || p.code;
  const description = [p.subText || "", p.content || ""].filter(Boolean).join("<hr/>");
  const images = (p.imageUrls || []).slice(0, 4).map((src) => ({ src }));

  const payload: any = {
    name,
    sku,
    description,
    regular_price: undefined,        // sätts via price-upload senare
    status: publish ? "publish" : "draft",
    images,
    // valfritt: sätt standardkategori om du vill mappa BP->WC här
    // categories: [{ id: 97 }],
  };

  if (!exists) {
    // CREATE
    const c = await wcFetch(`/products`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const { text } = await readJsonSafe(c);
    if (!c.ok) throw new Error(`Woo create ${sku} failed ${c.status}: ${text.slice(0,180)}`);
    return { created: true, id: (JSON.parse(text) as any).id };
  } else {
    // UPDATE (lägg bara till data – skriv inte över allt)
    const id = findJson[0].id;
    const u = await wcFetch(`/products/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    const { text } = await readJsonSafe(u);
    if (!u.ok) throw new Error(`Woo update ${sku} failed ${u.status}: ${text.slice(0,180)}`);
    return { updated: true, id };
  }
}

app.http("import-run", {
  route: "import-run",
  methods: ["POST", "OPTIONS", "GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (req.method === "OPTIONS") return { status: 200, headers: cors };
    if (req.method === "GET") return { status: 200, jsonBody: { ok: true, name: "import-run" }, headers: cors };

    try {
      const { subcategoryIds = [], publish = true } = (await req.json()) as RunBody;

      if (!Array.isArray(subcategoryIds) || subcategoryIds.length === 0) {
        return { status: 400, jsonBody: { error: "subcategoryIds required" }, headers: cors };
      }
      // Gör en snabb set med siffer-ID:n
      const wanted = new Set(
        subcategoryIds.map((v) => Number(String(v).trim())).filter((n) => Number.isFinite(n))
      );

      let scanned = 0;
      let matched = 0;
      let created = 0;
      let updated = 0;
      const sample: { created: any[]; updated: any[]; skipped: any[]; errors: any[] } = {
        created: [],
        updated: [],
        skipped: [],
        errors: [],
      };

      for await (const parts of iterBritpartAll(ctx)) {
        for (const p of parts) {
          scanned++;
          const cats = (p.categoryIds || []).map(Number);
          const hit = cats.some((c) => wanted.has(c));
          if (!hit) { 
            if (sample.skipped.length < 5) sample.skipped.push(p.code);
            continue; 
          }
          matched++;

          try {
            const res = await upsertWoo(ctx, p, publish);
            if (res.created) {
              created++;
              if (sample.created.length < 5) sample.created.push({ sku: p.code, id: res.id });
            } else if (res.updated) {
              updated++;
              if (sample.updated.length < 5) sample.updated.push({ sku: p.code, id: res.id });
            }
          } catch (e: any) {
            if (sample.errors.length < 5) sample.errors.push({ sku: p.code, error: e?.message || String(e) });
          }
        }
      }

      return {
        status: 200,
        jsonBody: {
          ok: true,
          scanned,
          matched,
          created,
          updated,
          sample,
        },
        headers: cors,
      };
    } catch (e: any) {
      ctx.error("import-run failed", e);
      return { status: 500, jsonBody: { error: e?.message || "import-run failed" }, headers: cors };
    }
  },
});