import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

app.http("logs", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    return {
      status: 200,
      jsonBody: { items: [], total: 0, pages: 1, page: 1 },
    };
  },
});
