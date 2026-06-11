const fs = require("fs");
const files = [
  "/usr/lib/node_modules/openclaw/dist/server.impl-Btmg89EG.js",
  "/usr/lib/node_modules/openclaw/dist/http-route-ZpPh3JWn.js",
];
const terms = ["handleUpgrade", "controlUiBasePath", "normalizeBasePath", "wss://", "gatewayUrl"];
for (const file of files) {
  const t = fs.readFileSync(file, "utf8");
  console.log("\n===", file.split("/").pop(), "===");
  for (const term of terms) {
    let pos = 0;
    let n = 0;
    while (n < 3) {
      const i = t.indexOf(term, pos);
      if (i < 0) break;
      console.log(`[${term}]`, t.slice(Math.max(0, i - 60), i + 120).replace(/\s+/g, " "));
      pos = i + term.length;
      n++;
    }
  }
}
