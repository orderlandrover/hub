"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
exports.assertEnv = assertEnv;
exports.env = {
    BRITPART_API_BASE: process.env.BRITPART_API_BASE,
    BRITPART_API_KEY: process.env.BRITPART_API_KEY,
    WP_URL: process.env.WP_URL,
    WC_KEY: process.env.WC_KEY,
    WC_SECRET: process.env.WC_SECRET,
};
function assertEnv() {
    for (const [k, v] of Object.entries(exports.env)) {
        if (!v)
            throw new Error(`Missing App Setting: ${k}`);
    }
}
//# sourceMappingURL=env.js.map