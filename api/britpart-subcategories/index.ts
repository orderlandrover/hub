// api/britpart-subcategories/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { getCategory } from "../shared/britpart";

type Subcategory = { id: number; title?: string; parentId?: number };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function ok(body: any): HttpResponseInit {
  return { status: 200, headers: CORS, jsonBody: body };
}
function err(message: string): HttpResponseInit {
  return { status: 200, headers: CORS, jsonBody: { ok: false, error: message } };
}

app.http("britpart-subcategories", {
  route: "britpart-subcategories",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };

    // snabb ping-diagnostik
    if (req.query.get("ping") === "1") return ok({ ok: true, name: "britpart-subcategories" });

    try {
      const parentId = Number(req.query.get("parentId") ?? 3); // 3 = “All Parts”
      const parent = await getCategory(parentId);

      const items: Subcategory[] = [];

      // 1) om API redan gav inbäddade barn → använd dem direkt
      if (Array.isArray(parent.subcategories) && parent.subcategories.length) {
        for (const sc of parent.subcategories) {
          items.push({ id: Number(sc.id), title: sc.title, parentId });
        }
      } else if (Array.isArray(parent.subcategoryIds) && parent.subcategoryIds.length) {
        // 2) annars hämta namn för varje ID
        const ids = parent.subcategoryIds.map((n) => Number(n));
        // liten samtidighet för att vara snäll mot API:t
        const queue = [...ids];
        const workers = Array.from({ length: Math.min(6, ids.length) }, async () => {
          while (queue.length) {
            const id = queue.shift()!;
            try {
              const child = await getCategory(id);
              items.push({ id: child.id, title: child.title, parentId });
            } catch {
              // hoppa över enstaka fel
            }
          }
        });
        await Promise.all(workers);
      }

      // UI:n accepterar både { items: [...] } och bara [...]
      return ok({ items });
    } catch (e: any) {
      return err(e?.message || "Failed to load subcategories");
    }
  },
});
