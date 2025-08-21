import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { britpartGetCategories } from "../shared/britpart";

async function getAllPartCodes(categoryId: string, limit: number, ctx: InvocationContext): Promise<string[]> {
  const r = await britpartGetCategories({ categoryId }, ctx);
  const j = await r.json();
  let codes: string[] = j.partCodes || [];
  const subs = j.subcategoryIds || [];
  for (const subId of subs) {
    if (codes.length >= limit) break;
    const subCodes = await getAllPartCodes(String(subId), limit - codes.length, ctx);
    codes = [...codes, ...subCodes];
  }
  return codes.slice(0, limit);
}

app.http("import-dry-run", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv();
      const body = (await req.json()) as { subcategoryIds: string[]; limitPerSub?: number };
      const { subcategoryIds = [], limitPerSub = 3 } = body || {};
      if (!subcategoryIds.length) return { status: 400, jsonBody: { error: "subcategoryIds required" } };
      let create = 0, update = 0, skip = 0;
      const perSub: Array<{ subcategory: string; count: number }> = [];
      for (const sub of subcategoryIds) {
        const codes = await getAllPartCodes(sub, limitPerSub, ctx);
        const count = codes.length;
        perSub.push({ subcategory: String(sub), count });
        create += count;  // Senare: diff mot WooCommerce
      }
      return { jsonBody: { summary: { create, update, skip }, perSub } };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});