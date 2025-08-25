// api/britpart-subcategories/index.ts
import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { britpartJson } from "../shared/britpart";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface BritpartSubcategory {
  id: number | string;
  title?: string;
  name?: string;
}

app.http("britpart-subcategories", {
  route: "britpart-subcategories",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (
    req: HttpRequest,
    _ctx: InvocationContext
  ): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") {
      return { status: 200, headers: CORS };
    }

    try {
      // 3 = "All Parts" på Britpart – innehåller subcategories
      const root = await britpartJson("part/getcategories?categoryId=3");

      const subs: BritpartSubcategory[] = Array.isArray(root?.subcategories)
        ? root.subcategories
        : [];

      const items: { id: string; name: string }[] = subs
        .map((s) => ({
          id: String(s?.id ?? ""),
          name: String(s?.title ?? s?.name ?? ""),
        }))
        .filter((x: { id: string; name: string }) => x.id && x.name);

      return {
        status: 200,
        jsonBody: { items },
        headers: CORS,
      };
    } catch (e: any) {
      return {
        status: 500,
        jsonBody: { error: e?.message ?? String(e) },
        headers: CORS,
      };
    }
  },
});