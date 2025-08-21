import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { env } from "../shared/env";

type BpCategory = { id: number; title: string; subcategories?: BpCategory[] };

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
      // Läs env + query override
      const base = (env("BRITPART_BASE") || "https://www.britpart.com").replace(/\/$/, "");
      const token = (new URL(req.url).searchParams.get("token")) || env("BRITPART_TOKEN", false) || "";
      const categoryId = Number(new URL(req.url).searchParams.get("categoryId") || 3);

      const url = new URL(`${base}/api/v1/part/getcategories`);
      url.searchParams.set("categoryId", String(categoryId));
      if (token) url.searchParams.set("token", token);

      const headers = new Headers({ Accept: "application/json" });
      if (token) headers.set("Token", token);

      const res = await fetch(url.toString(), { headers });
      const text = await res.text();

      if (!res.ok) {
        // Skicka tillbaka status + ett kort utdrag (hjälper felsökning i UI)
        return {
          status: 502,
          jsonBody: {
            error: `Britpart getcategories ${res.status}`,
            url: `${url.origin}${url.pathname}?categoryId=${categoryId}&token=${token ? "***" : ""}`,
            snippet: text.slice(0, 200),
          },
          headers: cors,
        };
      }

      let data: BpCategory;
      try {
        data = JSON.parse(text);
      } catch {
        return { status: 502, jsonBody: { error: "Invalid JSON from Britpart", snippet: text.slice(0, 200) }, headers: cors };
      }

      const subs = Array.isArray(data?.subcategories) ? data.subcategories : [];
      const items = subs.map((s) => ({ id: String(s.id), name: s.title }));

      return { status: 200, jsonBody: { items }, headers: cors };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message || "britpart-subcategories failed" }, headers: cors };
    }
  },
});