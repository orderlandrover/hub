import { app } from "@azure/functions";
app.http("ping", { methods: ["GET"], authLevel: "anonymous", handler: async () => ({ body: "pong" }) });
