import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { collectPartCodesFrom } from "../shared/britpart";
import { wcFetch, wcFindProductBySku } from "../shared/wc";

type ImportBody = {
  subcategoryIds: Array<string | number>;
  publish?: boolean; // om true → publish, annars draft
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

app.http("import-run", {
  route: "import-run",
  methods: ["POST", "OPTIONS", "GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 200, headers: CORS };
    if (req.method === "GET")
      return { status: 200, jsonBody: { ok: true, name: "import-run" }, headers: CORS };

    const t0 = Date.now();

    try {
      const body = (await req.json()) as ImportBody;
      const ids = (body?.subcategoryIds || []).map((x) => Number(x)).filter(Boolean);
      const publish = !!body?.publish;

      if (!ids.length) {
        return { status: 400, jsonBody: { error: "missing subcategoryIds" }, headers: CORS };
      }

      // 1) Hämta alla part codes från valda underkategorier
      const allCodes = new Set<string>();
      const visited = new Set<number>();

      for (const id of ids) {
        const { partCodes, visited: v } = await collectPartCodesFrom(id);
        partCodes.forEach((c) => allCodes.add(c));
        v.forEach((n) => visited.add(n));
      }

      // 2) Gå igenom SKU:er och skapa/uppdatera i Woo
      let created = 0;
      let updated = 0;
      let skipped = 0;
      let errors = 0;

      const sample = {
        created: [] as Array<{ id: number; sku: string }>,
        updated: [] as Array<{ id: number; sku: string }>,
        skipped: [] as Array<{ sku: string; reason: string }>,
        errors: [] as Array<{ sku?: string; error: string }>,
      };

      // Låg takt för att vara snäll mot Woo (öka vid behov)
      for (const code of allCodes) {
        const sku = code.trim();
        if (!sku) continue;

        try {
          const existing = await wcFindProductBySku(sku);

          if (existing) {
            // Uppdatera status om publish=true och inte redan publish
            if (publish && existing.status !== "publish") {
              const resUpd = await wcFetch(`/products/${existing.id}`, {
                method: "PUT",
                body: JSON.stringify({ status: "publish" }),
              });
              if (!resUpd.ok) {
                const msg = await resUpd.text();
                errors++;
                if (sample.errors.length < 5) sample.errors.push({ sku, error: msg.slice(0, 200) });
              } else {
                updated++;
                if (sample.updated.length < 5) sample.updated.push({ id: existing.id, sku });
              }
            } else {
              skipped++;
              if (sample.skipped.length < 5)
                sample.skipped.push({ sku, reason: publish ? "already publish" : "exists" });
            }
          } else {
            // Skapa enkel produkt
            const payload = {
              name: sku, // tills vi ev. enrichar med namn – pris sätts senare via prisimporten
              sku,
              status: publish ? "publish" : "draft",
              type: "simple",
              // Woo tillåter utan pris, men sätter gärna 0 så den är giltig
              regular_price: "0",
              stock_status: "instock",
            };

            const resNew = await wcFetch(`/products`, {
              method: "POST",
              body: JSON.stringify(payload),
            });
            const txt = await resNew.text();

            if (!resNew.ok) {
              errors++;
              if (sample.errors.length < 5) sample.errors.push({ sku, error: txt.slice(0, 200) });
            } else {
              created++;
              try {
                const j = JSON.parse(txt);
                if (sample.created.length < 5) sample.created.push({ id: j?.id, sku });
              } catch {
                if (sample.created.length < 5) sample.created.push({ id: 0, sku });
              }
            }
          }
        } catch (e: any) {
          errors++;
          if (sample.errors.length < 5) sample.errors.push({ sku, error: e?.message || String(e) });
        }

        // Lite paus för att undvika throttling (justera vid behov)
        await sleep(80);
      }

      const elapsedMs = Date.now() - t0;

      return {
        status: 200,
        jsonBody: {
          ok: true,
          summary: { create: created, update: updated, skip: skipped, errors },
          counts: {
            inputSubcategories: ids.length,
            discoveredSubcategories: visited.size,
            uniquePartCodes: allCodes.size,
          },
          sample,
          elapsedMs,
        },
        headers: CORS,
      };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e?.message || String(e) }, headers: CORS };
    }
  },
});