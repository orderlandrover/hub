import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

app.http("ping", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (_req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> => {
    return { jsonBody: { ok: true, ts: Date.now() } };
  }
});
