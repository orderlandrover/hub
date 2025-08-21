import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartGetCategories } from "../shared/britpart";  // Använd helper från shared

type BPSubcat = {
  id: number;
  title: string;
};

app.http("britpart-subcategories", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (_req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> => {
    const data = await britpartGetCategories();  // Hämtar som i POSTMAN (token från env)
    const items = (data.subcategories || [])
      .map((sc: BPSubcat) => ({ id: String(sc.id), name: sc.title }))
      .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
    return { jsonBody: { items } };
  },
});