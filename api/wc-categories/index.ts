import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { wcFetch } from "../shared/wc";

const CORS = { "Access-Control-Allow-Origin": "*" };

app.http("wc-categories", {
  route: "api/wc-categories",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (_req: HttpRequest): Promise<HttpResponseInit> => {
    const per_page = _req.query.get("per_page") || "100";
    const page = _req.query.get("page") || "1";
    const search = _req.query.get("search") || "";

    const qs = new URLSearchParams({ per_page, page, hide_empty: "false" });
    if (search) qs.set("search", search);

    const res = await wcFetch(`/products/categories?${qs.toString()}`);
    const items = await res.json();
    const total = Number(res.headers.get("x-wp-total") || items.length);
    const pages = Number(res.headers.get("x-wp-totalpages") || 1);

    return { status: 200, jsonBody: { items, total, pages }, headers: CORS };
  }
});