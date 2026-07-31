#!/usr/bin/env bash
# Inject OPENAI_API_KEY from production platform_config into RC .env. Never prints value.
set -euo pipefail
RC_ENV=/opt/aichart-rc-pr66-4a817d0/web/.env
INJECT_DIR=/opt/aichart-rc-pr66-2a06170/web
test -f "$RC_ENV"
test -d "$INJECT_DIR/node_modules"

cd "$INJECT_DIR"
set -a
# shellcheck disable=SC1091
source <(grep -E '^(DATABASE_URL|ENCRYPTION_KEY)=' /opt/aichart/web/.env | sed 's/\r$//')
set +a

npx --yes tsx -e '
import { getPlatformValueAsync } from "./src/lib/platformConfig.ts";
import fs from "fs";
(async () => {
  const v = (await getPlatformValueAsync("OPENAI_API_KEY"))?.trim();
  if (!v) {
    console.log("OPENAI_INJECT=missing");
    process.exit(2);
  }
  const envPath = "/opt/aichart-rc-pr66-4a817d0/web/.env";
  let text = fs.readFileSync(envPath, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => !l.startsWith("OPENAI_API_KEY="));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  lines.push("OPENAI_API_KEY=" + v);
  fs.writeFileSync(envPath, lines.join("\n") + "\n", { mode: 0o600 });
  console.log("OPENAI_INJECT=configured");
  console.log("OPENAI_INJECT_LEN=" + String(v.length));
})().catch((e) => {
  console.log("OPENAI_INJECT=failed");
  console.log(String(e && e.message ? e.message : e).slice(0, 200));
  process.exit(1);
});
'

python3 - <<'PY'
from pathlib import Path
t=Path('/opt/aichart-rc-pr66-4a817d0/web/.env').read_text()
ok=any(l.startswith('OPENAI_API_KEY=') and l.split('=',1)[1].strip() for l in t.splitlines())
print('rc_env_OPENAI_API_KEY=' + ('configured' if ok else 'missing'))
PY

# Confirm charting library present
test -f /opt/aichart-rc-pr66-4a817d0/web/public/charting_library/charting_library.js && echo TV_OK || echo TV_MISSING
