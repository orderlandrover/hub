"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.britpart = britpart;
const env_1 = require("./env");
async function britpart(path, init = {}) {
    const url = `${env_1.env.BRITPART_API_BASE.replace(/\/$/, "")}${path}`;
    const res = await fetch(url, {
        ...init,
        headers: {
            Authorization: `Bearer ${env_1.env.BRITPART_API_KEY}`,
            "Content-Type": "application/json",
            ...(init.headers || {}),
        },
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Britpart ${res.status} ${res.statusText}: ${text}`);
    }
    return res;
}
//# sourceMappingURL=britpart.js.map