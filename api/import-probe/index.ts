import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartGetBasicForSkus } from "../shared/britpart";
import { wcFindProductIdBySku, wcPostJSON, wcPutJSON, wcGetJSON } from "../shared/wc";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

const emsg = (e: any) => (e?.message ? String(e.message) : String(e));
const isHttpUrl = (s?: string) => typeof s === "string" && /^https?:\/\//i.test(s || "");
const looksLikeImage = (s?: string) => !!s && /\.(jpe?g|png|gif|webp|bmp|tiff?)($|\?)/i.test(s);
const validImage = (u?: string) => isHttpUrl(u) && looksLikeImage(u);

app.http("import-probe", {
  route: "import-probe",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };

    try {
      const { sku, imageUrl: overrideUrl } = (await req.json()) as { sku: string; imageUrl?: string };
      if (!sku) return { status: 400, headers: CORS, jsonBody: { ok: false, error: "Missing sku" } };

      const basics = await britpartGetBasicForSkus([sku]);
      const b = basics[sku] || {};
      const img = overrideUrl || b.imageUrl;

      const result: any = { sku, chosenImage: img, validImage: validImage(img), title: b.title };

      // 1) hitta / skapa produkt
      let id = await wcFindProductIdBySku(sku);
      if (!id) {
        const r = await wcPostJSON<{ id: number }>(`/products`, {
          name: b.title || sku,
          sku,
          status: "draft",
        });
        id = r.id;
        result.created = true;
      } else {
        result.created = false;
      }

      // 2) sätt bild + namn/beskrivning
      const payload: any = { name: b.title || sku };
      if (b.description) {
        payload.description = b.description;
        payload.short_description = b.description;
      }
      if (validImage(img)) {
        payload.images = [{ src: img, position: 0 }]; // position 0 = "Produktbild"
      }

      await wcPutJSON(`/products/${id}`, payload);
      const fresh = await wcGetJSON<any>(`/products/${id}?_fields=id,name,images,description,short_description`);

      result.productId = id;
      result.after = fresh;
      result.imageCount = Array.isArray(fresh.images) ? fresh.images.length : 0;
      result.firstImage = fresh.images?.[0]?.src || null;

      return { status: 200, headers: CORS, jsonBody: { ok: true, ...result } };
    } catch (e: any) {
      return { status: 500, headers: CORS, jsonBody: { ok: false, error: emsg(e) } };
    }
  },
});
