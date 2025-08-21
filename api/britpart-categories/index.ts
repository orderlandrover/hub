// api/britpart-categories/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartFetch } from "../shared/britpart";
import { assertEnv } from "../shared/env";

type Category = {
  id: number;
  title: string;
  description?: string;
  url?: string;
  partCodes?: string[];
  subcategoryIds?: number[];
  subcategories?: Category[];
};

app.http("britpart-categories", {
  route: "britpart-categories",  // => /api/britpart-categories
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv("BRITPART_API_BASE");
      const url = new URL(req.url);
      const categoryId = url.searchParams.get("categoryId") || undefined; // default 3 om den utelämnas
      const tokenOverride = url.searchParams.get("token") || undefined;

      const res = await britpartFetch("/part/getcategories", { categoryId }, tokenOverride);
      const text = await res.text();
      if (!res.ok) throw new Error(`Britpart getcategories ${res.status}: ${text}`);

      const data = JSON.parse(text) as Category | { error?: string };
      return { status: 200, jsonBody: data };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message ?? "britpart-categories failed" } };
    }
  },
});