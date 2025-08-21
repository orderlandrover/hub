import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartGetCategories, britpartGetAll } from "../shared/britpart";
import { wcFetch } from "../shared/wc";

type Body = { subcategoryIds?: string[] };

app.http("import-run", {
  route: "import-run",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (req.method === "OPTIONS") return { status: 200, headers: cors };

    try {
      const body = (await req.json()) as Body;
      const ids = Array.isArray(body?.subcategoryIds) ? body!.subcategoryIds! : [];
      if (!ids.length) return { status: 400, jsonBody: { error: "subcategoryIds required" }, headers: cors };

      let seen = 0, created = 0, updated = 0, notFound = 0, failed = 0;
      const sample: any = { created: [] as any[], updated: [] as any[], errors: [] as any[] };

      for (const sid of ids) {
        const cat = await britpartGetCategories(Number(sid));
        const codes: string[] = Array.isArray(cat?.partCodes) ? cat.partCodes : [];
        for (const code of codes) {
          seen++;
          try {
            // Hämta del från getall med code
            const res = await britpartGetAll({ code, page: 1 });
            const part = (res.parts || []).find(p => p.code === code) || res.parts?.[0];

            // Bygg Woo payload
            const name = part?.title || code;
            const img = Array.isArray(part?.imageUrls) && part.imageUrls.length ? [{ src: part.imageUrls[0] }] : undefined;

            // Finns redan?
            const existRes = await wcFetch(`/products?sku=${encodeURIComponent(code)}`);
            const exist = await existRes.json();

            if (Array.isArray(exist) && exist.length) {
              const id = exist[0].id;
              const put = await wcFetch(`/products/${id}`, {
                method: "PUT",
                body: JSON.stringify({
                  name,
                  description: part?.content,
                  images: img,
                  status: "publish",
                })
              });
              if (put.ok) {
                updated++;
                if (sample.updated.length < 5) sample.updated.push({ id, sku: code });
              } else {
                failed++;
                if (sample.errors.length < 5) sample.errors.push({ sku: code, err: await put.text() });
              }
            } else {
              const post = await wcFetch(`/products`, {
                method: "POST",
                body: JSON.stringify({
                  sku: code,
                  name,
                  description: part?.content,
                  images: img,
                  status: "publish",
                })
              });
              if (post.ok) {
                created++;
                const payload = await post.json();
                if (sample.created.length < 5) sample.created.push({ id: payload.id, sku: code });
              } else {
                failed++;
                if (sample.errors.length < 5) sample.errors.push({ sku: code, err: await post.text() });
              }
            }
          } catch (err: any) {
            failed++;
            if (sample.errors.length < 5) sample.errors.push({ sku: code, err: err?.message || String(err) });
          }
        }
      }

      return {
        status: 200,
        jsonBody: { ok: true, seen, created, updated, notFound, failed, sample },
        headers: cors
      };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message || "import-run failed" }, headers: cors };
    }
  }
});