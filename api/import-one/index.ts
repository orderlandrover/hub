import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartGetAll } from "../shared/britpart";

app.http("import-one", {
  route: "import-one",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const code = new URL(req.url).searchParams.get("code");
      if (!code) return { status: 400, jsonBody: { error: "Missing code" } };

      const res = await britpartGetAll({ code });
      const data = await res.json();
      return { status: 200, jsonBody: data };
    } catch (e: any) {
      ctx.error(e);
      return { status: 500, jsonBody: { error: e.message ?? "import-one failed" } };
    }
  }
});