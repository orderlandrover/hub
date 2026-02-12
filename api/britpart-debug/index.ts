// api/britpart-debug/index.ts
import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { env } from "../shared/env";

app.http("britpart-debug", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "britpart-debug",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    const id = req.query.get("id") ?? "55";
    const url = `https://www.britpart.com/api/v1/part/getcategories?id=${encodeURIComponent(id)}`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        Token: env.BRITPART_TOKEN,
        Accept: "application/json",
        "User-Agent": "landroverdelar-hub/1.0",
      },
    });

    const ct = res.headers.get("content-type") ?? "";
    const cf = res.headers.get("cf-ray") ?? "";
    const body = (await res.text()).slice(0, 250);

    return {
      status: 200,
      jsonBody: {
        ok: res.ok,
        upstreamStatus: res.status,
        contentType: ct,
        cfRay: cf,
        bodySnippet: body,
      },
    };
  },
});
