// api/products-delete/index.ts
import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { assertEnv } from "../shared/env";
import { wcRequest } from "../shared/wc";

app.http("products-delete", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (
    req: HttpRequest,
    ctx: InvocationContext
  ): Promise<HttpResponseInit> => {
    try {
      assertEnv();

      // Tål tom body / felaktigt JSON
      const bodyText = await req.text();
      const body = bodyText ? (JSON.parse(bodyText) as any) : {};
      const ids: number[] = Array.isArray(body?.ids)
        ? body.ids.map((n: any) => Number(n)).filter(Boolean)
        : [];

      if (ids.length === 0) {
        return { status: 400, jsonBody: { error: "ids required" } };
      }

      const deleted: any[] = [];
      const errors: { id: number; error: string }[] = [];

      // Kör en-och-en med force=true (annars blir det trash i WP)
      for (const id of ids) {
        try {
          const res = await wcRequest(`/products/${id}?force=true`, {
            method: "DELETE",
          });

          // WP kan svara 200 med JSON, eller 204 utan body. Tål båda.
          let payload: any = null;
          const text = await res.text();
          if (text) {
            try {
              payload = JSON.parse(text);
            } catch {
              payload = { raw: text };
            }
          }
          deleted.push({ id, payload });
        } catch (e: any) {
          errors.push({ id, error: e?.message || String(e) });
          ctx.error(`Delete ${id} failed: ${e?.message || e}`);
        }
      }

      return { jsonBody: { ok: true, deleted, errors } };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e?.message || String(e) } };
    }
  },
});