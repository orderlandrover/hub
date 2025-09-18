import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { getCategory } from "../shared/britpart";
import { wcGetJSON, wcPostJSON, wcPutJSON } from "../shared/wc";

/* --------------------------------------------------------------- */
/* CORS                                                            */
/* --------------------------------------------------------------- */
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

/* --------------------------------------------------------------- */
/* Hjälpare                                                        */
/* --------------------------------------------------------------- */

/** Bygg en platt lista (BFS) över noder med parentId. */
async function collectTree(roots: number[], ctx: InvocationContext): Promise<Node[]> {
  const out: Node[] = [];
  const seen = new Set<number>();

  async function walk(id: number, parentId: number | null) {
    if (seen.has(id)) return;
    seen.add(id);
    const cat = await getCategory(id); // har: id, title, subcategories[], subcategoryIds[]
    out.push({ id: cat.id, title: cat.title, parentId });

    const kids = [
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
  const rows = await wcGetJSON<any[]>(
    `/products/categories?slug=${encodeURIComponent(slug)}&per_page=100`
  );
  if (Array.isArray(rows) && rows[0]?.id) return Number(rows[0].id);
  return null;
}

/* --------------------------------------------------------------- */
/* Azure Function                                                  */
/* --------------------------------------------------------------- */

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
        return {
          status: 400,
          headers: CORS,
          jsonBody: { ok: false, error: "roots[] saknas", fel: "roots[] saknas", where },
        };
      }
      const apply = !!body?.apply;

      where = "collect-tree";
      const nodes = await collectTree(roots, ctx); // BFS med parentId

      // Planera åtgärder i ordning (parent före child)
      const wcIdByBpId = new Map<number, number>();
      const plan: Array<{
        bpId: number;
        name: string;
        slug: string;
        parentBpId: number | null;
        parentWcId: number | null;
        action: "create" | "update" | "noop";
        actionSv: "skapa" | "uppdatera" | "oförändrad";
        wcId?: number;
      }> = [];
      const logg: string[] = [];

      where = "plan";
      for (const n of nodes) {
        const slug = slugFor(n.id);
        const existingId = await wcFindCategoryIdBySlug(slug);
        const parentWcId = n.parentId != null ? wcIdByBpId.get(n.parentId) ?? null : null;

        if (!existingId) {
          plan.push({
            bpId: n.id,
            name: n.title ?? String(n.id),
            slug,
            parentBpId: n.parentId,
            parentWcId,
            action: "create",
            actionSv: "skapa",
          });
          logg.push(
            `Skapas: "${n.title ?? String(n.id)}" (BP ${n.id}) → parent WC ${parentWcId ?? 0}`
          );
        } else {
          // Hämta befintlig för att kunna uppdatera namn eller parent om det skiljer sig.
          const term = await wcGetJSON<any>(`/products/categories/${existingId}`);
          const needName = (n.title ?? String(n.id)) !== (term?.name ?? "");
          const needParent = (parentWcId ?? 0) !== Number(term?.parent ?? 0);
          const action: "create" | "update" | "noop" = needName || needParent ? "update" : "noop";
          plan.push({
            bpId: n.id,
            name: n.title ?? String(n.id),
            slug,
            parentBpId: n.parentId,
            parentWcId,
            action,
            actionSv: action === "update" ? "uppdatera" : "oförändrad",
            wcId: existingId,
          });
          logg.push(
            action === "update"
              ? `Uppdateras: "${n.title ?? String(n.id)}" (WC ${existingId}) → parent ${parentWcId ?? 0}`
              : `Oförändrad: "${n.title ?? String(n.id)}" (WC ${existingId})`
          );
        }
      }

      where = "apply";
      if (apply) {
        for (const item of plan) {
          if (item.action === "noop") {
            // plocka wcId om den saknas
            if (!item.wcId) item.wcId = (await wcFindCategoryIdBySlug(item.slug)) ?? undefined;
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
            if (!item.wcId) item.wcId = (await wcFindCategoryIdBySlug(item.slug)) ?? undefined;
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
          if (!item.wcId) item.wcId = (await wcFindCategoryIdBySlug(item.slug)) ?? undefined;
          if (item.wcId) wcIdByBpId.set(item.bpId, item.wcId);
        }
      }

      // Svenska alias + lättläst lista
      const counts = {
        create: plan.filter((p) => p.action === "create").length,
        update: plan.filter((p) => p.action === "update").length,
        noop: plan.filter((p) => p.action === "noop").length,
      };
      const sammanfattning = {
        skapas: counts.create,
        uppdateras: counts.update,
        oförändrade: counts.noop,
      };

      const planSvenska = plan.map((p) => ({
        "åtgärd": p.actionSv,
        "britpart-id": p.bpId,
        "namn": p.name,
        "slug": p.slug,
        "woo-id": p.wcId ?? null,
        "förälder (woo-id)": p.parentWcId ?? 0,
      }));

      return {
        status: 200,
        headers: CORS,
        jsonBody: {
          ok: true,
          where: "done",
          var: "klart", // svensk etikett
          applied: apply,
          utfört: apply, // svensk alias
          counts, // behåll engelska nycklar för kompatibilitet
          sammanfattning, // svensk version
          plan, // teknisk plan (eng-nycklar)
          planSvenska, // lättläst svensk lista
          logg, // korta rader på svenska
        },
      };
    } catch (e: any) {
      return {
        status: 500,
        headers: CORS,
        jsonBody: { ok: false, where, var: where, error: emsg(e), fel: emsg(e) },
      };
    }
  },
});
