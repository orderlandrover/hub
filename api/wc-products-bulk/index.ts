import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { wcGetJSON, wcPostJSON, wcPutJSON } from "../shared/wc";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

type Body = {
  productIds: number[];
  addCatId?: number | null;
  removeCatId?: number | null;
  status?: "publish" | "draft";
  price?: number | null;
  stock?: number | null;
};

function uniq<T>(xs: T[]) { return Array.from(new Set(xs)); }

app.http("wc-products-bulk", {
  route: "wc-products-bulk",
  methods: ["POST","OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };

    let where = "start";
    try {
      const body = (await req.json()) as Body;
      const ids = Array.isArray(body?.productIds) ? uniq(body.productIds.map(Number).filter(n=>n>0)) : [];
      if (!ids.length) return { status: 400, headers: CORS, jsonBody: { ok:false, error:"productIds[] required" } };

      const addCatId = body?.addCatId ?? null;
      const removeCatId = body?.removeCatId ?? null;
      const status = body?.status;
      const price = typeof body?.price === "number" ? Number(body.price) : null;
      const stock = typeof body?.stock === "number" ? Number(body.stock) : null;

      let updated = 0, failed: number[] = [];

      // Hämta kategori-listor för varje produkt (behövs om vi ska add/remove)
      where = "fetch-products";
      const prods: Array<{ id:number, categories: Array<{id:number}> }> = [];
      for (let i=0;i<ids.length;i++) {
        const pid = ids[i];
        try {
          const p = await wcGetJSON<any>(`/products/${pid}?_fields=id,categories`);
          prods.push({ id: Number(p.id), categories: Array.isArray(p.categories) ? p.categories.map((c:any)=>({id:Number(c.id)})) : [] });
        } catch (e:any) {
          ctx.warn?.(`fetch product ${pid} failed: ${e?.message||e}`);
        }
      }

      where = "apply";
      for (const p of prods) {
        const update: any = { id: p.id };

        // Kategorier
        let cats: number[] | null = null;
        if (Array.isArray(p.categories)) cats = p.categories.map(c => Number(c.id));
        else cats = [];

        if (addCatId && addCatId > 0) {
          if (!cats.includes(addCatId)) cats.push(addCatId);
        }
        if (removeCatId && removeCatId > 0) {
          cats = cats.filter(id => id !== removeCatId);
        }
        if (cats) update.categories = cats.map(id => ({ id }));

        // Status
        if (status === "publish" || status === "draft") update.status = status;

        // Pris
        if (price !== null) update.regular_price = String(price);

        // Lager
        if (stock !== null) {
          update.manage_stock = true;
          update.stock_quantity = Number.isFinite(stock) ? Number(stock) : 0;
          update.stock_status = (update.stock_quantity > 0) ? "instock" : "outofstock";
        }

        try {
          await wcPutJSON(`/products/${p.id}`, update);
          updated++;
        } catch (e:any) {
          failed.push(p.id);
          ctx.warn?.(`bulk update fail id=${p.id}: ${e?.message||e}`);
        }
      }

      return { status: 200, headers: CORS, jsonBody: { ok:true, where:"done", count: prods.length, updated, failed } };
    } catch (e:any) {
      return { status: 500, headers: CORS, jsonBody: { ok:false, where, error: e?.message || String(e) } };
    }
  }
});
