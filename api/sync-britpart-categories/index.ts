import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { getCategory } from "../shared/britpart";
import { wcGetJSON, wcPostJSON, wcPutJSON } from "../shared/wc";

/** CORS */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

type Node = { id: number; title?: string; parentId: number | null };
type SyncBody = {
  /** Valfritt: begränsa till dessa rötter. Lämna tomt = hela subträdet från rötterna du skickar. */
  roots?: number[];
  /** Kör på riktigt. false = torrkörning (default). */
  apply?: boolean;
};

const emsg = (e: any) => (e?.message ? String(e.message) : String(e));

/** Bygg en platt lista (BFS) över noder med parentId. */
async function collectTree(roots: number[], ctx: InvocationContext): Promise<Node[]> {
  const out: Node[] = [];
  const seen = new Set<number>();

  async function walk(id: number, parentId: number | null) {
    if (seen.has(id)) return;
    seen.add(id);
    const cat = await getCategory(id); // har: id, title, subcategories[], subcategoryIds[]
    out.push({ id: cat.id, title: cat.title, parentId });

    const kids =
      [
        ...(cat.subcategories?.map((s) => Number(s.id)) ?? []),
        ...(cat.subcategoryIds ?? []),
      ]
        .map(Number)
        .filter((n) => Number.isFinite(n));

    for (const k of kids) await walk(k, cat.id);
  }

  for (const r of roots) await walk(Number(r), null);
  return out;
}

/** Slug vi använder för att hitta/matcha samma term i Woo. */
const slugFor = (bpId: number) => `bp-${bpId}`;

/** Slå upp en kategori i Woo på slug. */
async function wcFindCategoryIdBySlug(slug: string): Promise<number | null> {
  const rows = await wcGetJSON<any[]>(`/products/categories?slug=${encodeURIComponent(slug)}&per_page=100`);
  if (Array.isArray(rows) && rows[0]?.id) return Number(rows[0].id);
  return null;
}

app.http("sync-britpart-categories", {
  route: "sync-britpart-categories",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };

    let where = "start";
    try {
      const body = (await req.json()) as SyncBody;
      const roots = (body?.roots ?? []).map(Number).filter((n) => Number.isFinite(n));
      if (!roots.length) {
        return { status: 400, headers: CORS, jsonBody: { ok: false, error: "roots[] saknas" } };
      }
      const apply = !!body?.apply;

      where = "collect-tree";
      const nodes = await collectTree(roots, ctx); // BFS med parentId

      // Säkerställ i rätt ordning (parent före child)
      const wcIdByBpId = new Map<number, number>();
      const plan: Array<{
        bpId: number;
        name: string;
        slug: string;
        parentBpId: number | null;
        parentWcId: number | null;
        action: "create" | "update" | "noop";
        wcId?: number;
      }> = [];

      where = "plan";
      for (const n of nodes) {
        const slug = slugFor(n.id);
        const existingId = await wcFindCategoryIdBySlug(slug);
        const parentWcId = n.parentId != null ? wcIdByBpId.get(n.parentId) ?? null : null;
        if (!existingId) {
          plan.push({
            bpId: n.id, name: n.title ?? String(n.id), slug,
            parentBpId: n.parentId, parentWcId, action: "create"
          });
        } else {
          // Hämta befintlig för att kunna uppdatera namn eller parent om det skiljer sig.
          const term = await wcGetJSON<any>(`/products/categories/${existingId}`);
          const needName = (n.title ?? String(n.id)) !== (term?.name ?? "");
          const needParent = (parentWcId ?? 0) !== Number(term?.parent ?? 0);
          plan.push({
            bpId: n.id, name: n.title ?? String(n.id), slug,
            parentBpId: n.parentId, parentWcId,
            action: needName || needParent ? "update" : "noop",
            wcId: existingId,
          });
        }
      }

      where = "apply";
      if (apply) {
        for (const item of plan) {
          if (item.action === "noop") {
            // plocka wcId om den saknas
            if (!item.wcId) item.wcId = await wcFindCategoryIdBySlug(item.slug) ?? undefined;
            if (item.wcId) wcIdByBpId.set(item.bpId, item.wcId);
            continue;
          }
          if (item.action === "create") {
            const created = await wcPostJSON<any>(`/products/categories`, {
              name: item.name,
              slug: item.slug,
              parent: item.parentWcId ?? 0,
              description: `Britpart kategori #${item.bpId}`,
            });
            const wcId = Number(created?.id);
            if (wcId) wcIdByBpId.set(item.bpId, wcId);
            item.wcId = wcId;
          } else {
            // update
            if (!item.wcId) item.wcId = await wcFindCategoryIdBySlug(item.slug) ?? undefined;
            if (item.wcId) {
              await wcPutJSON(`/products/categories/${item.wcId}`, {
                name: item.name,
                parent: item.parentWcId ?? 0,
              });
              wcIdByBpId.set(item.bpId, item.wcId);
            }
          }
        }
      } else {
        // vid torrkörning: hämta wcId där det finns
        for (const item of plan) {
          if (!item.wcId) item.wcId = await wcFindCategoryIdBySlug(item.slug) ?? undefined;
          if (item.wcId) wcIdByBpId.set(item.bpId, item.wcId);
        }
      }

      return {
        status: 200,
        headers: CORS,
        jsonBody: {
          ok: true,
          where: "done",
          applied: apply,
          counts: {
            create: plan.filter((p) => p.action === "create").length,
            update: plan.filter((p) => p.action === "update").length,
            noop:   plan.filter((p) => p.action === "noop").length,
          },
          plan,
        },
      };
    } catch (e: any) {
      return { status: 500, headers: CORS, jsonBody: { ok: false, where, error: emsg(e) } };
    }
  },
});
