// api/tools/write-dist-package.js
const fs = require("fs");
const path = require("path");

const out = path.join(__dirname, "..", "dist", "package.json");
const pkg = {
  name: "hub-api-dist",
  version: "1.0.0",
  private: true,
  type: "commonjs",
  dependencies: {
    "@azure/functions": "^4.4.0"
  }
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(pkg, null, 2));
console.log("Wrote", out);
