"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const functions_1 = require("@azure/functions");
const env_1 = require("../shared/env");
// import { britpart } from "../shared/britpart";
functions_1.app.http("britpart-subcategories", {
    methods: ["GET"],
    authLevel: "anonymous",
    handler: async (req, ctx) => {
        try {
            (0, env_1.assertEnv)();
            // TODO: Riktigt anrop mot Britpart när endpoint är känd
            // const res = await britpart("/subcategories");
            // const data = await res.json();
            // Mock tills vidare
            const items = Array.from({ length: 25 }).map((_, i) => ({ id: String(1000 + i), name: `Subcategory #${i + 1}` }));
            return { jsonBody: { items } };
        }
        catch (e) {
            ctx.error(e);
            return { status: 500, jsonBody: { error: e.message } };
        }
    },
});
//# sourceMappingURL=index.js.map