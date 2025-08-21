import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { britpartFetch } from "../shared/britpart";

type DryBody = { subcategoryIds?: (string | number)[] };

type BPPart = { code: string; categoryIds?: number[] };
type BPList = { total: number; totalPages: number; page: number; parts: BPPart[] };

async function readJsonSafe(res: Response): Promise<{ json: any; text: string }> {
  const text = await res.text();
  try { return { json: text ? JSON.parse(text) : null, text }; }
  catch { return { json: null, text }; }
}

async function* iterBritpartAll(): AsyncGenerator<BPPart[], void, unknown> {
  let page = 1;
  for (;;) {
    const res = await britpartFetch("/part/getall", { page });
    const { json } = await readJsonSafe(res);
    if (!res.ok || !json || !Array.isArray(json.parts)) return;
    yield json.parts as BPPart[];
    if (page >= Number(json.totalPages || 1)) return;
    page++;
  }
}

app.http("import-dry-run", {
  route: "import-dry-run",
  methods: ["POST", "GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> => {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (req.method === "OPTIONS") return { status: 200, headers: cors };
    if (req.method === "GET") return { status: 200, jsonBody: { ok: true, name: "import-dry-run" }, headers: cors };

    try {
      const { subcategoryIds = [] } = (await req.json()) as DryBody;
      if (!Array.isArray(subcategoryIds) || subcategoryIds.length === 0) {
        return { status: 400, jsonBody: { error: "subcategoryIds required" }, headers: cors };
      }
      const wanted = new Set(
        subcategoryIds.map((v) => Number(String(v).trim())).filter((n) => Number.isFinite(n))
      );

      let scanned = 0, matched = 0;
      const example: string[] = [];

      for await (const parts of iterBritpartAll()) {
        for (const p of parts) {
          scanned++;
          const cats = (p.categoryIds || []).map(Number);
          const hit = cats.some((c) => wanted.has(c));
          if (hit) {
            matched++;
            if (example.length < 10) example.push(p.code);
          }
        }
      }

      return {
        status: 200,
        jsonBody: { ok: true, summary: { scanned, matched }, example },
        headers: cors,
      };
    } catch (e: any) {
      return { status: 500, jsonBody: { error: e?.message || "import-dry-run failed" }, headers: cors };
    }
  },
});