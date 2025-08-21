import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { britpart } from "../shared/britpart";  // Använd export från britpart.ts

app.http("britpart-probe", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv();
      const url = new URL(req.url);
      const path = url.searchParams.get("path") || "/part/getall";  // justera vid behov
      const fullUrl = new URL(`https://www.britpart.com/api/v1${path}`);  // Fix: Skapa URL-objekt
      const res = await britpart(fullUrl);
      const text = await res.text();
      return { jsonBody: { ok: true, path, length: text.length, preview: text.slice(0, 500) } };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});