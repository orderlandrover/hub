// api/tools/write-dist-package.js
const fs = require("fs");
const path = require("path");

const apiPkg = require(path.join(__dirname, "..", "package.json"));

const out = {
  name: (apiPkg.name || "hub-api") + "-dist",
  version: apiPkg.version || "1.0.0",
  private: true,
  type: "commonjs",
  main: "index.js",
  engines: apiPkg.engines || { node: ">=20.19.0" },
  // TA MED ALLA RUNTIME-DEPS (csv-parse inkluderat)
  dependencies: { ...(apiPkg.dependencies || {}) }
};

const dst = path.join(__dirname, "..", "dist", "package.json");
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.writeFileSync(dst, JSON.stringify(out, null, 2));
console.log("[write-dist-package] wrote", dst);
