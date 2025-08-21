import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { parse } from "csv-parse/sync";
import { wcFetch } from "../shared/wc"; // <-- WooCommerce helper

// Beskriv hur en rad i CSV-filen ser ut
type PriceRow = {
  "Part No": string;
  "Description": string;
  "Price": string;
  "Per": string;
  "UOI": string;
  "Brand": string;
  "LR Retail": string;
  "Weight": string;
  "Length": string;
  "Width": string;
  "Thickness": string;
  "C of O": string;
  "EEC Commodity Code": string;
};

app.http("price-upload", {
  route: "price-upload",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (req.method === "OPTIONS") {
      return { status: 200, headers: cors };
    }

    try {
      const buffer = await req.arrayBuffer();
      const text = Buffer.from(buffer).toString("utf-8");

      // Läs CSV och tvinga typen till PriceRow[]
      const records = parse(text, {
        columns: true,
        skip_empty_lines: true,
      }) as PriceRow[];

      const exchangeRate = 13.2; // GBP → SEK
      let updated = 0;
      const errors: any[] = [];

      for (const row of records) {
        try {
          const sku = row["Part No"]?.trim();
          const priceGBP = parseFloat(row["Price"] ?? "0");
          if (!sku || !priceGBP) continue;

          const priceSEK = (priceGBP * exchangeRate).toFixed(2);

          // Hitta WooCommerce-produkt med SKU
          const res = await wcFetch(`/products?sku=${encodeURIComponent(sku)}`);
          const list = await res.json();
          if (!Array.isArray(list) || list.length === 0) {
            ctx.log(`No product found for SKU ${sku}`);
            continue;
          }

          const product = list[0];
          const id = product.id;

          // Uppdatera pris
          const upd = await wcFetch(`/products/${id}`, {
            method: "PUT",
            body: JSON.stringify({
              regular_price: priceSEK,
            }),
          });

          if (upd.ok) {
            updated++;
          } else {
            const msg = await upd.text();
            errors.push({ sku, error: msg });
          }
        } catch (err: any) {
          errors.push({ error: err.message });
        }
      }

      return {
        status: 200,
        jsonBody: {
          ok: true,
          updated,
          errors,
        },
        headers: cors,
      };
    } catch (e: any) {
      ctx.error("price-upload failed", e);
      return { status: 500, jsonBody: { error: e.message }, headers: cors };
    }
  },
});