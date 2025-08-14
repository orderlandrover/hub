import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
// import { britpart } from "../shared/britpart";

app.http("britpart-subcategories", {
  methods: ["GET"],
  authLevel: "function",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      assertEnv();
      // TODO: Riktigt anrop mot Britpart när endpoint är känd
      // const res = await britpart("/subcategories");
      // const data = await res.json();

      // Mock tills vidare
      const items = Array.from({ length: 25 }).map((_, i) => ({ id: String(1000 + i), name: `Subcategory #${i + 1}` }));
      return { jsonBody: { items } };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  },
});