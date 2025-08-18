// api/ping/index.ts
import { app } from "@azure/functions";

app.http("ping", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async () => ({ jsonBody: { ok: true, pong: true } })
});
