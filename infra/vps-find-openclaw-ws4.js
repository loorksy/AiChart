const fs = require("fs");
const t = fs.readFileSync(
  "/usr/lib/node_modules/openclaw/dist/server.impl-Btmg89EG.js",
  "utf8",
);
const n = "parseGatewayRequestPath";
let pos = 0;
let c = 0;
while (c < 5) {
  const i = t.indexOf(n, pos);
  if (i < 0) break;
  console.log(t.slice(i, i + 800).replace(/\s+/g, " "));
  console.log("---");
  pos = i + n.length;
  c++;
}
