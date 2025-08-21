import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartFetch } from "../shared/britpart";
import { wcFetch, readJsonSafe } from "../shared/wc";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

type Body = {
  subcategoryIds?: (string | number)[];
  publish?: boolean;
  pageStart?: number;
  maxPagesPerCall?: number; // hur många Britpart-sidor per körning
};

async function upsertWoo(p: any, publish: boolean) {
  const sku: string | undefined = p?.code;
  if (!sku) return { created: 0, updated: 0, skipped: 1 };

  const f = await wcFetch(`/products?sku=${encodeURIComponent(sku)}`);
  const { json: list } = await readJsonSafe(f);

  const name = p.title || sku;
  const description = [p.subText || "", p.content || ""].filter(Boolean).join("<hr/>");
  const images = (p.imageUrls || []).slice(0, 4).map((src: string) => ({ src }));
  const payload: any = { name, sku, description, status: publish ? "publish" : "draft", images };

  if (Array.isArray(list) && list.length > 0) {
    const id = list[0].id;
    const u = await wcFetch(`/products/${id}`, { method: "PUT", body: JSON.stringify(payload) });
    return { created: 0, updated: u.ok ? 1 : 0, skipped: u.ok ? 0 : 1 };
  } else {
    const c = await wcFetch(`/products`, { method: "POST", body: JSON.stringify(payload) });
    return { created: c.ok ? 1 : 0, updated: 0, skipped: c.ok ? 0 : 1 };
  }
}

app.http("import-run", {
  route: "api/import-run",
  methods: ["GET", "POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 200, headers: CORS };
    if (req.method === "GET") return { status: 200, jsonBody: { ok: true, name: "import-run" }, headers: CORS };

    try {
      const b = (await req.json()) as Body;
      const ids: number[] = (b?.subcategoryIds || [])
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n));
      if (!ids.length) return { status: 400, jsonBody: { error: "subcategoryIds required" }, headers: CORS };

      const publish = !!b.publish;
      let page = Math.max(1, Number(b?.pageStart ?? 1));
      const maxPages = Math.max(1, Math.min(5, Number(b?.maxPagesPerCall ?? 2)));

      let scanned = 0, matched = 0, created = 0, updated = 0, skipped = 0, processedPages = 0;
      let reachedEnd = false;
      let lastTotalPages = 1;

      const sample = { created: [] as any[], updated: [] as any[], skipped: [] as any[], errors: [] as any[] };

      for (let i = 0; i < maxPages; i++) {
        const res = await britpartFetch("/part/getall", { page });
        const text = await res.text();
        if (!res.ok) throw new Error(`Britpart getall ${res.status}: ${text.slice(0, 180)}`);

        const j = JSON.parse(text);
        const parts: any[] = Array.isArray(j.parts) ? j.parts : [];
        const totalPages = Number(j.totalPages || 1);
        lastTotalPages = totalPages;

        for (const p of parts) {
          scanned++;
          const cats: number[] = (p.categoryIds || []).map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n));
          if (!cats.some((c: number) => ids.includes(c))) { if (sample.skipped.length < 5) sample.skipped.push(p.code); continue; }
          matched++;

          try {
            const r = await upsertWoo(p, publish);
            created += r.created; updated += r.updated; skipped += r.skipped;
            if (r.created && sample.created.length < 5) sample.created.push({ sku: p.code });
            if (r.updated && sample.updated.length < 5) sample.updated.push({ sku: p.code });
          } catch (e: any) {
            if (sample.errors.length < 5) sample.errors.push({ sku: p.code, error: e?.message || String(e) });
          }
        }

        processedPages++;
        if (page >= totalPages) { reachedEnd = true; break; }
        page++; // förbered nästa loop‑sida
      }

      // page pekar nu på NÄSTA sida att hämta om vi inte nått slutet
      const nextPage: number | null = !reachedEnd && processedPages > 0 && page <= lastTotalPages ? page : null;

      return {
        status: 200,
        jsonBody: { ok: true, processedPages, scanned, matched, created, updated, skipped, nextPage, sample },
        headers: CORS
      };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message || "import-run failed" }, headers: CORS };
    }
  }
});