const fs = require("fs");
const p = "/usr/lib/node_modules/openclaw/dist";
for (const f of fs.readdirSync(p)) {
  if (!f.endsWith(".js")) continue;
  const t = fs.readFileSync(`${p}/${f}`, "utf8");
  if (!t.includes("handleUpgrade")) continue;
  const idx = t.indexOf("basePath");
  if (idx >= 0) {
    console.log("FILE:", f);
    console.log(t.slice(Math.max(0, idx - 100), idx + 200).replace(/\s+/g, " "));
    console.log("---");
  }
}
