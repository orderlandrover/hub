import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import * as XLSX from 'xlsx';  // Antag import, lägg till "types": ["xlsx"] i tsconfig.json eller package.json "devDependencies": {"@types/xlsx": "^0.0.36"}

app.http("price-upload", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      // Logik för upload av CSV/Excel från email-prislista, pars med XLSX.parse, beräkna SEK = GBP * kurs * (1 + påslag/100), PATCH WooCommerce /products via wcRequest
      return { jsonBody: { success: true } };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});