"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const functions_1 = require("@azure/functions");
const env_1 = require("../shared/env");
const britpart_1 = require("../shared/britpart");
const wc_1 = require("../shared/wc");
const map_1 = require("../shared/map");
functions_1.app.http("import-run", {
    methods: ["POST"],
    authLevel: "anonymous",
    handler: async (req, ctx) => {
        try {
            (0, env_1.assertEnv)();
            const body = await req.json();
            const { subcategoryIds = [], categoryMap = {} } = body || {};
            if (!subcategoryIds.length)
                return { status: 400, jsonBody: { error: "subcategoryIds required" } };
            const created = [], updated = [], skipped = [];
            for (const subId of subcategoryIds) {
                // OBS: byt endpoint mot Britparts riktiga (exempel)
                const r = await (0, britpart_1.britpart)(`/products?subcategory=${encodeURIComponent(subId)}&page=1&size=200`);
                const { items = [] } = await r.json();
                for (const bp of items) {
                    const payload = (0, map_1.toWCProduct)(bp, categoryMap);
                    if (!payload.sku) {
                        skipped.push({ reason: "no-sku", bp });
                        continue;
                    }
                    // Finns SKU i WC?
                    const check = await (0, wc_1.wcRequest)(`/products?sku=${encodeURIComponent(payload.sku)}`);
                    const existing = await check.json();
                    if (Array.isArray(existing) && existing.length > 0) {
                        const id = existing[0].id;
                        const res = await (0, wc_1.wcRequest)(`/products/${id}`, { method: "PUT", body: JSON.stringify(payload) });
                        updated.push(await res.json());
                    }
                    else {
                        const res = await (0, wc_1.wcRequest)(`/products`, { method: "POST", body: JSON.stringify(payload) });
                        created.push(await res.json());
                    }
                }
            }
            return { jsonBody: { ok: true, created: created.length, updated: updated.length, skipped: skipped.length } };
        }
        catch (e) {
            ctx.error(e);
            return { status: 500, jsonBody: { error: e.message } };
        }
    },
});
//# sourceMappingURL=index.js.map