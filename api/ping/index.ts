import { app, HttpRequest, HttpResponseInit } from "@azure/functions";

app.http("ping", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (_req: HttpRequest): Promise<HttpResponseInit> => {
    return { jsonBody: { ok: true, ts: Date.now() } };
  },
});