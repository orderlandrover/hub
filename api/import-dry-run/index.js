"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const functions_1 = require("@azure/functions");
const env_1 = require("../shared/env");
// import { britpart } from "../shared/britpart";
// import { wcRequest } from "../shared/wc";
// import { toWCProduct } from "../shared/map";
functions_1.app.http("import-dry-run", {
    methods: ["POST"],
    authLevel: "anonymous",
    handler: async (req, ctx) => {
        try {
            (0, env_1.assertEnv)();
            const body = (await req.json());
            const { subcategoryIds = [] } = body || {};
            if (!Array.isArray(subcategoryIds) || subcategoryIds.length === 0) {
                return { status: 400, jsonBody: { error: "subcategoryIds required" } };
            }
            // TODO: hämta produkter från Britpart per subcategoryId, mappa till WC, jämför mot befintliga i WC (via SKU)
            // Returnera lista över create / update / skip.
            return {
                jsonBody: {
                    create: [],
                    update: [],
                    skip: [],
                    summary: { create: 0, update: 0, skip: 0 }
                },
            };
        }
        catch (e) {
            ctx.error(e);
            return { status: 500, jsonBody: { error: e.message } };
        }
    },
});
//# sourceMappingURL=index.js.map