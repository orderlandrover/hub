// api/tools/write-dist-package.js
const fs = require("fs");
const path = require("path");

const out = {
  name: "hub-api",
  version: "1.0.0",
  private: true,
  // SWA/Functions på Linux kör node ~18 i runtime, detta räcker för språkdetektion
  engines: { node: "~18" },
  dependencies: {
    "@azure/functions": "^4.4.0"
  }
};

const dist = path.join(__dirname, "..", "dist");
if (!fs.existsSync(dist)) fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, "package.json"), JSON.stringify(out, null, 2));
console.log("Wrote api/dist/package.json");