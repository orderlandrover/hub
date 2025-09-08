import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { britpartGetBasicForSkus } from "../shared/britpart";
import { wcFindProductIdBySku, wcGetJSON, wcPostJSON, wcPutJSON } from "../shared/wc";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

const emsg = (e: any) => (e?.message ? String(e.message) : String(e));
const isHttpUrl = (s?: string) => typeof s === "string" && /^https?:\/\//i.test(s || "");

app.http("import-probe", {
  route: "import-probe",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };

    try {
      const body = (await req.json().catch(() => ({}))) as { sku?: string; imageUrl?: string };
      const sku = (body.sku || "").trim();
      const overrideUrl = body.imageUrl?.trim();

      if (!sku) {
        return { status: 400, headers: CORS, jsonBody: { ok: false, error: "Missing sku" } };
      }

      const basics = await britpartGetBasicForSkus([sku]);
      const b = basics[sku] || {};
      const chosenImage = overrideUrl || b.imageUrl;
      const validImage = isHttpUrl(chosenImage);

      let productId = await wcFindProductIdBySku(sku);
      let created = false;
      if (!productId) {
        const r = await wcPostJSON<{ id: number }>(`/products`, {
          name: b.title || sku,
          sku,
          status: "draft",
          type: "simple",
        });
        productId = r.id;
        created = true;
      }

      const payload: any = { name: b.title || sku };
      if (b.description) {
        payload.description = b.description;
        payload.short_description = b.description;
      }
      if (validImage) {
        payload.images = [{ src: chosenImage, position: 0 }];
      }

      await wcPutJSON(`/products/${productId}`, payload);
      const after = await wcGetJSON<any>(
        `/products/${productId}?_fields=id,name,images,description,short_description`
      );

      return {
        status: 200,
        headers: CORS,
        jsonBody: {
          ok: true,
          sku,
          created,
          productId,
          chosenImage,
          validImage,
          imageCount: Array.isArray(after.images) ? after.images.length : 0,
          firstImage: after.images?.[0]?.src || null,
          after,
        },
      };
    } catch (e: any) {
      return { status: 500, headers: CORS, jsonBody: { ok: false, error: emsg(e) } };
    }
  },
});
