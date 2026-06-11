const fs = require("fs");
const t = fs.readFileSync(
  "/usr/lib/node_modules/openclaw/dist/server.impl-Btmg89EG.js",
  "utf8",
);
const needles = ["/ws", "pathname", "upgrade", "controlUiBasePath", "createGatewayHttpServer"];
for (const n of needles) {
  let pos = 0;
  let c = 0;
  while (c < 8) {
    const i = t.indexOf(n, pos);
    if (i < 0) break;
    console.log(`\n[${n}@${i}]`, t.slice(Math.max(0, i - 80), i + 160).replace(/\s+/g, " "));
    pos = i + n.length;
    c++;
  }
}
