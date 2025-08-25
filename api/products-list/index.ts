import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { wcFetch, readJsonSafe } from "../shared/wc";

const CORS = { "Access-Control-Allow-Origin": "*" };

app.http("products-list", {
  route: "products-list",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    const url = new URL(req.url);
    const q = new URLSearchParams({
      page: url.searchParams.get("page") || "1",
      per_page: url.searchParams.get("per_page") || "100",
      orderby: url.searchParams.get("orderby") || "title",
      order: url.searchParams.get("order") || "asc"
    });
    const status = url.searchParams.get("status");
    const search = url.searchParams.get("search");
    const category = url.searchParams.get("category");
    if (status && status !== "any") q.set("status", status);
    if (search) q.set("search", search);
    if (category) q.set("category", category);

    const res = await wcFetch(`/products?${q.toString()}`);
    const { json, text } = await readJsonSafe(res);
    if (!res.ok || !Array.isArray(json)) return { status: 500, jsonBody: { error: text || "Woo error" }, headers: CORS };

    const total = Number(res.headers.get("x-wp-total") || json.length);
    const pages = Number(res.headers.get("x-wp-totalpages") || 1);
    return { status: 200, jsonBody: { items: json, total, pages, page: Number(q.get("page") || "1") }, headers: CORS };
  }
});