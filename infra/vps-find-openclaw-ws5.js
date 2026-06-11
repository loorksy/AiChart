const fs = require("fs");
const t = fs.readFileSync(
  "/usr/lib/node_modules/openclaw/dist/server.impl-Btmg89EG.js",
  "utf8",
);
const start = t.indexOf("function attachGatewayUpgradeHandler");
console.log(t.slice(start, start + 3500).replace(/\s+/g, " "));
