import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartFetch } from "../shared/britpart";

type BpCategory = {
  id: number;
  title: string;
  subcategories?: BpCategory[];
};

app.http("britpart-subcategories", {
  route: "britpart-subcategories",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    try {
      const url = new URL(req.url);
      const categoryId = Number(url.searchParams.get("categoryId") || 3);
      const tokenOverride = url.searchParams.get("token") || undefined;

      const res = await britpartFetch("/part/getcategories", { categoryId }, tokenOverride);
      const text = await res.text();

      if (!res.ok) {
        // Britpart har förmodligen svarat med HTML-sida → gör det tydligt för frontend
        throw new Error(`Britpart getcategories ${res.status}: ${text?.slice(0, 200)}`);
      }

      let data: BpCategory;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Invalid JSON from Britpart (len=${text.length}). First bytes: ${text.slice(0, 50)}`);
      }

      const subs = Array.isArray(data?.subcategories) ? data.subcategories : [];
      const items = subs.map((s) => ({ id: String(s.id), name: s.title }));

      return { status: 200, jsonBody: { items }, headers: cors };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message || "britpart-subcategories failed" }, headers: cors };
    }
  }
});