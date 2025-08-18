"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wcRequest = wcRequest;
const env_1 = require("./env");
function authHeader() {
    const token = Buffer.from(`${env_1.env.WC_KEY}:${env_1.env.WC_SECRET}`).toString("base64");
    return `Basic ${token}`;
}
async function wcRequest(path, init = {}) {
    const url = `${env_1.env.WP_URL.replace(/\/$/, "")}/wp-json/wc/v3${path}`;
    const res = await fetch(url, {
        ...init,
        headers: {
            "Content-Type": "application/json",
            Authorization: authHeader(),
            ...(init.headers || {}),
        },
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`WC ${res.status} ${res.statusText}: ${text}`);
    }
    return res;
}
//# sourceMappingURL=wc.js.map