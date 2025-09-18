import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { getCategory } from "../shared/britpart";
import {
  wcGetJSON,
  wcPostJSON,
  wcPutJSON,
} from "../shared/wc";

/** CORS */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

const emsg = (e: any) => (e?.message ? String(e.message) : String(e));

/** ----- Woo category helpers (inline) ---------------------------------- */

type WCCat = { id: number; name: string; parent?: number; meta_data?: Array<{key:string; value:any}> };

async function wcGetAllCategories(): Promise<WCCat[]> {
  const out: WCCat[] = [];
  for (let page = 1; page < 999; page++) {
    const arr = await wcGetJSON<any[]>(`/products/categories?per_page=100&page=${page}`);
    const list = Array.isArray(arr) ? arr : [];
    out.push(
      ...list.map((x) => ({
        id: Number(x.id),
        name: String(x.name || ""),
        parent: Number(x.parent || 0) || 0,
        meta_data: Array.isArray(x.meta_data) ? x.meta_data : [],
      }))
    );
    if (list.length < 100) break;
  }
  return out;
}

async function wcCreateCategory(payload: {
  name: string;
  parent?: number;
  slug?: string;
  description?: string;
  meta_data?: Array<{ key: string; value: any }>;
}): Promise<WCCat> {
  const res = await wcPostJSON<any>(`/products/categories`, payload);
  return { id: Number(res.id), name: String(res.name || payload.name), parent: Number(res.parent || 0) || 0, meta_data: res.meta_data || [] };
}

async function wcUpdateCategory(id: number, payload: {
  name?: string;
  parent?: number;
  description?: string;
  meta_data?: Array<{ key: string; value: any }>;
}): Promise<void> {
  await wcPutJSON(`/products/categories/${id}`, payload);
}

function findMeta(cat: WCCat, key: string) {
  return (cat.meta_data || []).find((m) => m?.key === key)?.value;
}

/** Exakt namn + samma parent */
function findByNameAndParent(all: WCCat[], name: string, parent: number) {
  const n = name.trim().toLowerCase();
  return all.find((c) => c.name.trim().toLowerCase() === n && Number(c.parent || 0) === Number(parent || 0));
}

/** ----- Britpart traversal -------------------------------------------- */

type BpNode = {
  id: number;
  title: string;
  parentId: number | 0;
  children: number[];
};

async function buildTreeFromRoots(rootIds: number[]): Promise<Map<number, BpNode>> {
  const seen = new Set<number>();
  const out = new Map<number, BpNode>();

  async function walk(id: number, parentId: number | 0) {
    if (seen.has(id)) return;
    seen.add(id);

    const raw = await getCategory(id);
    const title = String(raw?.title ?? id);
    const children = [
      ...(raw.subcategories?.map((s) => Number(s.id)) ?? []),
      ...(Array.isArray(raw.subcategoryIds) ? raw.subcategoryIds.map((n) => Number(n)) : []),
    ].filter((n) => Number.isFinite(n));

    out.set(id, { id, title, parentId, children });

    for (const kid of children) {
      await walk(Number(kid), id);
    }
  }

  for (const r of rootIds) await walk(Number(r), 0);
  return out;
}

/** Topologisk ordning (föräldrar före barn) */
function topologicalOrder(nodes: Map<number, BpNode>): BpNode[] {
  const indeg = new Map<number, number>();
  for (const node of nodes.values()) indeg.set(node.id, indeg.get(node.id) ?? 0);
  for (const node of nodes.values()) {
    for (const c of node.children) indeg.set(c, (indeg.get(c) ?? 0) + 1);
  }
  const q: number[] = [];
  for (const [id, d] of indeg) if (d === 0) q.push(id);

  const out: BpNode[] = [];
  while (q.length) {
    const id = q.shift()!;
    const n = nodes.get(id);
    if (n) out.push(n);
    for (const c of (n?.children || [])) {
      indeg.set(c, (indeg.get(c) ?? 1) - 1);
      if ((indeg.get(c) ?? 0) === 0) q.push(c);
    }
  }
  return out;
}

/** ----- Azure Function: POST /api/britpart-sync-categories ------------- */

type Body = {
  rootIds: number[];
  dryRun?: boolean; // om true: skapa inte, visa bara vad som skulle göras
  parentWooId?: number; // valfritt: lägg alla under given Woo-parent
};

app.http("britpart-sync-categories", {
  route: "britpart-sync-categories",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };
    let where = "start";

    try {
      const body = (await req.json()) as Body;
      const rootIds = Array.isArray(body?.rootIds) ? body.rootIds.map(Number).filter(Boolean) : [];
      const dryRun = !!body?.dryRun;
      const topParent = Number(body?.parentWooId || 0) || 0;

      if (!rootIds.length) {
        return { status: 400, headers: CORS, jsonBody: { ok: false, error: "rootIds required" } };
      }

      where = "build-tree";
      const bpTree = await buildTreeFromRoots(rootIds);
      const ordered = topologicalOrder(bpTree); // föräldrar först

      where = "load-woo";
      let wooAll = await wcGetAllCategories();

      const bpToWoo = new Map<number, number>();
      let created = 0, matched = 0, updatedMeta = 0;

      where = "ensure";
      for (const node of ordered) {
        const parentWoo = node.parentId ? (bpToWoo.get(node.parentId) || 0) : topParent;

        // 1) försök matcha via meta `_lr_britpart_id`
        let existing = wooAll.find((c) => String(findMeta(c, "_lr_britpart_id") ?? "") === String(node.id));

        // 2) annars exakt namn + parent
        if (!existing) {
          existing = findByNameAndParent(wooAll, node.title, parentWoo);
        }

        if (existing) {
          bpToWoo.set(node.id, Number(existing.id));
          matched++;

          // se till att meta är satt (om inte, lägg till)
          const hasMeta = String(findMeta(existing, "_lr_britpart_id") ?? "") === String(node.id);
          if (!hasMeta && !dryRun) {
            await wcUpdateCategory(existing.id, {
              meta_data: [{ key: "_lr_britpart_id", value: String(node.id) }],
            });
            updatedMeta++;
            // uppdatera lokala listan
            wooAll = await wcGetAllCategories();
          }
          continue;
        }

        if (dryRun) {
          // markera planerad skapelse
          bpToWoo.set(node.id, -1);
          continue;
        }

        // 3) skapa
        const createdCat = await wcCreateCategory({
          name: node.title,
          parent: parentWoo,
          meta_data: [{ key: "_lr_britpart_id", value: String(node.id) }],
        });
        created++;
        bpToWoo.set(node.id, Number(createdCat.id));

        // uppdatera lista så att barn hittar rätt parent samma körning
        wooAll.push(createdCat);
      }

      return {
        status: 200,
        headers: CORS,
        jsonBody: {
          ok: true,
          where: "done",
          dryRun,
          roots: rootIds,
          created,
          matched,
          updatedMeta,
          totalNodes: bpTree.size,
          mapping: Array.from(bpToWoo.entries()).map(([bp, wc]) => ({ britpartId: bp, wooCategoryId: wc })),
        },
      };
    } catch (e: any) {
      return { status: 500, headers: CORS, jsonBody: { ok: false, where, error: emsg(e) } };
    }
  },
});
