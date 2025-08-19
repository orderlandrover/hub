import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

const BASE = process.env.BRITPART_API_BASE || "";      // ex: https://www.britpart.com/api/v1/part/getall
const API_KEY = process.env.BRITPART_API_KEY || "";    // om nyckel krävs

function headers() {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) {
    // testa det som funkar hos er – ofta Bearer, ibland x-api-key
    h.Authorization = `Bearer ${API_KEY}`;
    h["x-api-key"] = API_KEY;
  }
  return h;
}

app.http("britpart-products", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      if (!BASE) return { status: 500, jsonBody: { error: "Missing BRITPART_API_BASE" } };

      const res = await fetch(BASE, { headers: headers() });
      if (!res.ok) {
        return { status: res.status, jsonBody: { error: await res.text() } };
      }

      const all = await res.json(); // antas vara en lista med delar/produkter
      const url = new URL(req.url);
      const subId = url.searchParams.get("subcategoryId");

      // robust extraktion av fält
      const norm = (Array.isArray(all) ? all : []).map((p: any) => ({
        // försök olika vanliga fältnamn
        partNumber: p.partNumber ?? p.sku ?? p.code ?? p.part_code ?? "",
        description: p.description ?? p.name ?? p.title ?? "",
        price: p.price ?? p.retailPrice ?? p.listPrice ?? null,
        stockQty: p.stockQty ?? p.stock ?? p.quantity ?? null,
        image: (p.imageUrls?.[0]) ?? p.image ?? p.image_url ?? null,
        subcategoryIds: p.subcategoryIds ?? p.subCategories ?? p.categoryIds ?? [],
        raw: p,
      }));

      let items = norm;
      if (subId) {
        const idNum = Number(subId);
        items = norm.filter(p =>
          Array.isArray(p.subcategoryIds) &&
          p.subcategoryIds.some((x: any) => Number(x) === idNum)
        );
      }

      // begränsa storleken i svaret
      return { jsonBody: { count: items.length, items: items.slice(0, 200) } };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});