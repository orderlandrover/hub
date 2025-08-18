"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const functions_1 = require("@azure/functions");
const env_1 = require("../shared/env");
const wc_1 = require("../shared/wc");
functions_1.app.http("products-update", {
    methods: ["POST"],
    authLevel: "anonymous",
    handler: async (req, ctx) => {
        try {
            (0, env_1.assertEnv)();
            const body = (await req.json());
            if (!Array.isArray(body.ids) || body.ids.length === 0) {
                return { status: 400, jsonBody: { error: "ids required" } };
            }
            const patch = {};
            if (body.status)
                patch.status = body.status;
            if (body.price != null)
                patch.regular_price = String(body.price);
            if (body.stock_quantity != null) {
                patch.manage_stock = true;
                patch.stock_quantity = body.stock_quantity;
                patch.stock_status = body.stock_quantity > 0 ? "instock" : "outofstock";
            }
            const results = [];
            for (const id of body.ids) {
                const res = await (0, wc_1.wcRequest)(`/products/${id}`, {
                    method: "PUT",
                    body: JSON.stringify(patch),
                });
                results.push(await res.json());
            }
            return { jsonBody: { ok: true, count: results.length } };
        }
        catch (e) {
            ctx.error(e);
            return { status: 500, jsonBody: { error: e.message } };
        }
    },
});
//# sourceMappingURL=index.js.map