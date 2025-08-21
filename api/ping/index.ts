// api/ping/index.ts
import { app } from "@azure/functions";

app.http("ping", {
  route: "ping",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async () => ({ status: 200, jsonBody: { ok: true, ts: Date.now() } }),
});