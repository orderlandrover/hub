// Britpart.Subcategories/index.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { getCategory } from "../shared/britpart";

app.http("Britpart-subcategories", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "britpart-subcategories",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const parentId = Number(req.query.get("parentId") ?? "3");
      const node = await getCategory(parentId);

      const ids = Array.isArray(node.subcategoryIds) ? node.subcategoryIds : [];
      const embed = Array.isArray(node.subcategories) ? node.subcategories : [];

      const map = new Map<number, { id: number; title: string; hasChildren: boolean }>();
      for (const sc of embed) {
        map.set(sc.id, {
          id: sc.id,
          title: sc.title ?? `Category ${sc.id}`,
          hasChildren: Array.isArray(sc.subcategoryIds) ? sc.subcategoryIds.length > 0 : true,
        });
      }
      for (const id of ids) {
        if (!map.has(id)) map.set(id, { id, title: `Category ${id}`, hasChildren: true });
      }

      const children = Array.from(map.values()).sort((a, b) =>
        a.title.localeCompare(b.title, "sv")
      );

      return { status: 200, jsonBody: { ok: true, parentId, count: children.length, children } };
    } catch (e: any) {
      ctx.error("Britpart.Subcategories error", e);
      return { status: 500, jsonBody: { ok: false, error: String(e?.message ?? e) } };
    }
  },
});