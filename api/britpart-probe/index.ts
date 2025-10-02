// api/britpart-probe/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartGet } from "../shared/britpart";

app.http("britpart-probe", {
  route: "britpart-probe",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (_req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const j = await britpartGet<any>("/part/getall", { page: 1 });
      return { status: 200, jsonBody: j };
    } catch (e: any) {
      ctx.error?.(e);
      return { status: 500, jsonBody: { error: e?.message ?? "britpart-probe failed" } };
    }
  },
});
