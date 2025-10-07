import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

app.http("auth-diag", {
  route: "auth-diag",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (_req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> => {
    // Avsiktligt inga beroenden – bara returnera lite miljöinfo
    return {
      status: 200,
      jsonBody: {
        ok: true,
        node: process.version,
        env: {
          AUTH_USER: process.env.AUTH_USER || null,
          AUTH_PASS: process.env.AUTH_PASS || null,
          AUTH_SECRET_len: (process.env.AUTH_SECRET || "").length, // bara längden, inte värdet
          AUTH_TTL_HOURS: process.env.AUTH_TTL_HOURS || null
        }
      }
    };
  }
});
