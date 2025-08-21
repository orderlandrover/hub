import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { britpartFetch } from "../shared/britpart";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

type Body = {
  subcategoryIds?: (string | number)[];
  pageStart?: number;
  maxPagesPerCall?: number;
};

app.http("import-dry-run", {
  route: "api/import-dry-run",
  methods: ["GET", "POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 200, headers: CORS };
    if (req.method === "GET") return { status: 200, jsonBody: { ok: true, name: "import-dry-run" }, headers: CORS };

    const b = (await req.json()) as Body;
    const ids: number[] = (b?.subcategoryIds || [])
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n));

    if (!ids.length) {
      return { status: 400, jsonBody: { error: "subcategoryIds required" }, headers: CORS };
    }

    let page = Math.max(1, Number(b?.pageStart ?? 1));
    const maxPages = Math.max(1, Math.min(5, Number(b?.maxPagesPerCall ?? 2)));

    let scanned = 0;
    let matched = 0;
    const example: string[] = [];

    for (let i = 0; i < maxPages; i++) {
      const res = await britpartFetch("/part/getall", { page });
      const text = await res.text();
      if (!res.ok) {
        return { status: 500, jsonBody: { error: `Britpart getall ${res.status}: ${text.slice(0, 180)}` }, headers: CORS };
      }

      const j = JSON.parse(text);
      const parts: any[] = Array.isArray(j.parts) ? j.parts : [];
      const totalPages = Number(j.totalPages || 1);

      for (const p of parts) {
        scanned++;
        const cats: number[] = (p.categoryIds || []).map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n));
        if (cats.some((c: number) => ids.includes(c))) {
          matched++;
          if (example.length < 10) example.push(String(p.code));
        }
      }

      if (page >= totalPages) break;
      page++;
    }

    return { status: 200, jsonBody: { ok: true, summary: { scanned, matched }, example }, headers: CORS };
  }
});