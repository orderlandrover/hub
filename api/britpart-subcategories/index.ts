// api/britpart-subcategories/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { britpartGetCategories } from "../shared/britpart";

app.http("britpart-subcategories", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (_req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv("BRITPART_BASE", "BRITPART_TOKEN");

      const raw = await britpartGetCategories();
      // Försök hitta listan oavsett nyckelkapitalisering
      const cats: any[] =
        raw?.categories || raw?.Categories || raw?.data || raw || [];

      const items: Array<{ id: string; name: string; categoryName?: string }> = [];

      for (const c of cats as any[]) {
        const cname = c?.name ?? c?.category ?? c?.title ?? "";
        const subs: any[] =
          c?.subcategories || c?.Subcategories || c?.SubCategories || [];
        for (const s of subs) {
          const id =
            s?.id ?? s?.code ?? s?.subCategoryId ?? s?.subcategoryId ?? s?.name;
          const name = s?.name ?? s?.title ?? String(id);
          items.push({ id: String(id), name, categoryName: cname });
        }
      }

      return { jsonBody: { items } };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});