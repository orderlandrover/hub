import { app, HttpResponseInit } from "@azure/functions";
app.http("ping", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (): Promise<HttpResponseInit> =>
    ({ jsonBody: { ok: true, t: Date.now() } }),
});