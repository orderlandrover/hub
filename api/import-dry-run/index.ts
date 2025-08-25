// api/import-dry-run/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartGetByCategories, BritpartImportItem } from "../shared/britpart";
import { wcFindProductBySku } from "../shared/wc";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

type DryRunBody = { categoryIds: number[] };

app.http("import-dry-run", {
  route: "import-dry-run",
  methods: ["POST", "OPTIONS", "GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 200, headers: CORS };
    if (req.method === "GET") return { status: 200, jsonBody: { ok: true, name: "import-dry-run" }, headers: CORS };

    try {
      const body = (await req.json()) as DryRunBody;
      if (!body?.categoryIds?.length) throw new Error("categoryIds required");

      const items: BritpartImportItem[] = await britpartGetByCategories(body.categoryIds);

      let create = 0, update = 0, skip = 0;
      const sample: any[] = [];

      for (const it of items) {
        const sku = it.sku?.trim();
        if (!sku) { skip++; continue; }

        const existing = await wcFindProductBySku(sku);
        if (!existing) {
          create++;
          if (sample.length < 5) sample.push({ action: "create", sku, name: it.name });
        } else {
          // Uppdatering sker i import-run, här räknar vi bara
          update++;
          if (sample.length < 5) sample.push({ action: "update", sku, id: existing.id });
        }
      }

      return {
        status: 200,
        jsonBody: { ok: true, total: items.length, create, update, skip, sample },
        headers: CORS,
      };
    } catch (e: any) {
      return { status: 400, jsonBody: { error: e.message }, headers: CORS };
    }
  },
});