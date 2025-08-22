// api/britpart-categories/index.ts
import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { britpartFetch } from "../shared/britpart";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

type BpCategory = {
  id: number;
  title?: string;
  description?: string;
  url?: string;
  partCodes?: string[];
  subcategoryIds?: number[];
  subcategories?: BpCategory[];
};

app.http("britpart-categories", {
  route: "britpart-categories",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 200, headers: CORS };

    try {
      // ✅ RÄTT env‑nycklar (inte BRITPART_API_BASE)
      assertEnv("BRITPART_BASE", "BRITPART_TOKEN");

      const url = new URL(req.url);
      const categoryId = Number(url.searchParams.get("categoryId") ?? 3);

      // ✅ britpartFetch tar (path, query) – INTE tre argument
      const res = await britpartFetch("/part/getcategories", { categoryId });
      const text = await res.text();

      if (!res.ok) {
        return {
          status: 502,
          jsonBody: {
            error: `Britpart getcategories ${res.status}`,
            snippet: text.slice(0, 200),
          },
          headers: CORS,
        };
      }

      const data = JSON.parse(text) as BpCategory;
      const subs = Array.isArray(data.subcategories) ? data.subcategories : [];
      const items = subs.map((s) => ({ id: String(s.id), name: s.title ?? `#${s.id}` }));

      return { status: 200, jsonBody: { items }, headers: CORS };
    } catch (e: any) {
      return {
        status: 500,
        jsonBody: { error: e?.message || "britpart-categories failed" },
        headers: CORS,
      };
    }
  },
});