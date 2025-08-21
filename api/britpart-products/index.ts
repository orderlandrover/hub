// api/britpart-products/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartFetch } from "../shared/britpart";
import { assertEnv } from "../shared/env";

type PartsResponse = {
  total: number;
  totalPages: number;
  page: number;
  parts: any[];
};

app.http("britpart-products", {
  route: "britpart-products",   // => /api/britpart-products
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv("BRITPART_API_BASE"); // token får vara tom om du skickar via query
      const url = new URL(req.url);

      const page = Number(url.searchParams.get("page") || 1);
      const code = url.searchParams.get("code") || undefined;
      const modifiedSince = url.searchParams.get("modifiedSince") || undefined;
      const tokenOverride = url.searchParams.get("token") || undefined;

      const res = await britpartFetch("/part/getall", { page, code, modifiedSince }, tokenOverride);
      const text = await res.text();
      if (!res.ok) throw new Error(`Britpart getall ${res.status}: ${text}`);

      const data = JSON.parse(text) as Partial<PartsResponse>;

      const out: PartsResponse = {
        total: Number(data.total ?? (Array.isArray(data.parts) ? data.parts.length : 0)),
        totalPages: Number(data.totalPages ?? 1),
        page: Number(data.page ?? page),
        parts: Array.isArray(data.parts) ? data.parts : [],
      };

      return { status: 200, jsonBody: out };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message ?? "britpart-products failed" } };
    }
  },
});