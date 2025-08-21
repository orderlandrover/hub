import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartGetAll } from "../shared/britpart";

app.http("import-dry-run", {
  route: "import-dry-run",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (_req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const subcategoryId = 40; // exempel, kan styras via query
      const res = await britpartGetAll({ subcategoryId, page: 1 });
      const data = await res.json();
      return { status: 200, jsonBody: data };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message ?? "import-dry-run failed" } };
    }
  }
});