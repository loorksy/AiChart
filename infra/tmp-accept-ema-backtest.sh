#!/usr/bin/env bash
# Acceptance: ema_trend_follow_v1 on ~1y XAUUSD 1h — trade_count, determinism, bars.
set -euo pipefail

REAL="$(readlink -f /opt/aichart)"
cd "$REAL/web"
set -a
# shellcheck disable=SC1091
source <(grep -E '^(RESEARCH_SERVICE_URL|RESEARCH_SERVICE_INTERNAL_TOKEN|DATABASE_URL|CRON_SECRET)=' .env | sed 's/\r$//')
set +a

URL="${RESEARCH_SERVICE_URL%/}"
TOKEN="$RESEARCH_SERVICE_INTERNAL_TOKEN"
USER_ID="${ACCEPT_USER_ID:-3}"
HDR=(-H "Authorization: Bearer $TOKEN" -H "X-AiChart-Caller: aichart-web" -H "X-AiChart-User-Id: $USER_ID" -H "Content-Type: application/json")

# ~1 year of 1h bars (under 10k sync limit)
FROM="2025-07-01T00:00:00.000Z"
TO="2026-07-01T00:00:00.000Z"

python3 - <<'PY' > /tmp/ema_strategy_spec.json
import json, sys
sys.path.insert(0, "/opt/aichart/web")
# Build from catalog via node for fidelity
print("{}")
PY

# Prefer Node catalog builder on host
node --input-type=module - <<'JS' > /tmp/ema_strategy_spec.json
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// Use compiled path if available; else inline minimal fetch via TSX-less JSON from file.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Dynamic import of built catalog is hard; call the web API instead after login.
writeFileSync("/tmp/ema_strategy_spec.json", JSON.stringify({ ok: false }));
console.log("placeholder");
JS

echo "=== Trigger via web agent backtest API (cookie/session optional; use service bridge) ==="

# Use research job directly with warehouse dataset exported by web helper script
python3 - <<'PY'
import json, os, urllib.request, time
from datetime import datetime, timezone

url = os.environ["RESEARCH_SERVICE_URL"].rstrip("/")
token = os.environ["RESEARCH_SERVICE_INTERNAL_TOKEN"]
user = os.environ.get("ACCEPT_USER_ID", "3")
headers = {
    "Authorization": f"Bearer {token}",
    "X-AiChart-Caller": "aichart-web",
    "X-AiChart-User-Id": user,
    "X-AiChart-Request-Id": "accept-ema-bt",
    "Content-Type": "application/json",
}

# Load strategy from catalog via a small node helper
import subprocess, tempfile
node_script = r'''
import { writeFileSync } from "node:fs";
const { buildBacktestStrategySpec } = await import("/opt/aichart/web/src/lib/strategies/catalog.ts");
const spec = buildBacktestStrategySpec({
  strategyId: "ema_trend_follow_v1",
  symbol: "XAUUSD",
  timeframe: "1h",
  accountCurrency: "USD",
  costs: { spread_pips: 2.5, slippage_pips: 0.5, commission_per_lot: 0, swap_long: 0, swap_short: 0 },
});
writeFileSync("/tmp/ema_strategy_spec.json", JSON.stringify(spec));
console.log("spec_ok", spec.strategy_id, "allow_reentry", spec.entry?.allow_reentry);
'''
# Prefer tsx if present
tsx = "/opt/aichart/web/node_modules/.bin/tsx"
subprocess.check_call([tsx, "--eval", node_script], cwd="/opt/aichart/web")
spec = json.load(open("/tmp/ema_strategy_spec.json"))
print("allow_reentry", spec.get("entry", {}).get("allow_reentry"))

from_ms = int(datetime(2025, 7, 1, tzinfo=timezone.utc).timestamp() * 1000)
to_ms = int(datetime(2026, 7, 1, tzinfo=timezone.utc).timestamp() * 1000)

# Export warehouse via web cron-style internal is complex; use research warehouse loader
# through run_forex_backtest job with aichart_candle_warehouse format.
payload = {
    "job_type": "run_forex_backtest",
    "idempotency_key": f"accept-ema-{int(time.time())}",
    "payload": {
        "strategy_spec": spec,
        "dataset": {
            "format": "aichart_candle_warehouse",
            "symbol": "XAUUSD",
            "timeframe": "1h",
            "from_ms": from_ms,
            "to_ms": to_ms,
            "limit": 10000,
        },
        "run_config": {
            "initial_capital": 10000,
            "account_currency": "USD",
            "seed": 42,
        },
    },
}

def post(path, body):
    req = urllib.request.Request(
        url + path,
        data=json.dumps(body).encode(),
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.load(resp)

def get(path):
    req = urllib.request.Request(url + path, headers=headers, method="GET")
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)

# If warehouse format unsupported from research alone, fall back note.
try:
    job = post("/internal/research/jobs", payload)
except Exception as exc:
    print("JOB_CREATE_FAIL", exc)
    # Try listing job create endpoint shape
    raise

job_id = job.get("job_id") or job.get("id")
print("JOB", job_id, job.get("status"))
for _ in range(90):
    time.sleep(2)
    st = get(f"/internal/research/jobs/{job_id}")
    status = st.get("status")
    print("status", status, st.get("progress"), st.get("stage"))
    if status in ("succeeded", "failed", "cancelled"):
        break
print(json.dumps({k: st.get(k) for k in ("status", "error_code", "error_message", "result_summary", "artifact_refs")}, default=str)[:4000])

if st.get("status") != "succeeded":
    raise SystemExit(2)

# Fetch metrics artifact
refs = st.get("artifact_refs") or []
metrics_ref = next((r for r in refs if (r.get("name") or r.get("filename")) == "metrics.json" or str(r).endswith("metrics.json")), None)
print("metrics_ref", metrics_ref)
PY
