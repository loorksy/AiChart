#!/usr/bin/env bash
set -uo pipefail
RC=/opt/aichart-rc-pr66-0171398
echo "== git =="
git -C "$RC" rev-parse HEAD
echo "== source markers =="
python3 - <<'PY'
from pathlib import Path
import os
t = Path("/opt/aichart-rc-pr66-0171398/web/src/app/api/agent/recommendation/route.ts").read_text()
print("source_model_plan", "model_plan" in t)
print("source_hostModelPlanSchema", "hostModelPlanSchema" in t)
print("source_validateModelTradePlan", "validateModelTradePlan" in t)
p = "/opt/aichart-rc-pr66-0171398/web/.next/server/app/api/agent/recommendation/route.js"
b = Path(p).read_text(errors="ignore")
print("bundle_size", os.path.getsize(p))
print("bundle_mtime", os.path.getmtime(p))
for needle in ["model_plan", "hostModelPlan", "validateModelTradePlan", "rationale", "poiScoreCompat"]:
    print("bundle", needle, needle in b)
# Also scan all recommendation-related server chunks
root = Path("/opt/aichart-rc-pr66-0171398/web/.next/server")
hits = []
for f in root.rglob("*.js"):
    try:
        txt = f.read_text(errors="ignore")
    except Exception:
        continue
    if "validateModelTradePlan" in txt or "hostModelPlanSchema" in txt:
        hits.append(str(f))
print("chunks_with_validateModelTradePlan", len(hits))
for h in hits[:10]:
    print(" ", h)
PY

echo "== POST flat wait =="
python3 - <<'PY'
import json, urllib.request
from pathlib import Path
env = {}
for line in Path("/opt/aichart-rc-pr66-0171398/mcp/.env").read_text().splitlines():
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        env[k] = v
token = env.get("AICHART_SERVICE_TOKEN", "")
payload = {
    "symbol": "EURUSD",
    "action": "wait",
    "confidence": 40,
    "rationale": "probe wait rationale for schema check",
    "factors": ["range"],
    "timeframe": "5m",
}
req = urllib.request.Request(
    "http://127.0.0.1:3019/api/agent/recommendation",
    data=json.dumps(payload).encode(),
    headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
        "X-AiChart-Service-Token": token,
    },
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        print("status", r.status, r.read().decode()[:600])
except Exception as e:
    body = e.read().decode()[:800] if hasattr(e, "read") else str(e)
    print("status", getattr(e, "code", None), body)
PY

echo "== POST model_plan wait =="
python3 - <<'PY'
import json, urllib.request
from pathlib import Path
from datetime import datetime, timezone
env = {}
for line in Path("/opt/aichart-rc-pr66-0171398/mcp/.env").read_text().splitlines():
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        env[k] = v
token = env.get("AICHART_SERVICE_TOKEN", "")
payload = {
    "symbol": "EURUSD",
    "timeframe": "5m",
    "model_id": "direct-probe",
    "quote_age_ms": 400,
    "current_price": 1.085,
    "tick_size": 0.00001,
    "model_plan": {
        "decision": "wait",
        "activation": "none",
        "marketRegime": "range",
        "marketThesis": "No clean scalp edge; wait for a clearer impulse.",
        "primaryTimeframe": "5m",
        "contextTimeframes": ["15m"],
        "timeframeAnalysis": [
            {"timeframe": "5m", "bias": "neutral", "evidence": "Tight range."}
        ],
        "entryZone": {"low": None, "high": None, "preferred": None},
        "invalidation": None,
        "stopLoss": None,
        "targets": [],
        "requiredConfirmation": "Break and hold outside the range.",
        "pathToEntry": None,
        "alternativeScenario": "If momentum expands, re-evaluate.",
        "confidence": 0.42,
        "summary": "WAIT — range compression without a directional trigger.",
        "keyReasons": ["Range compression", "No clean invalidation"],
        "warnings": [],
        "dataTimestamp": datetime.now(timezone.utc).isoformat(),
    },
}
req = urllib.request.Request(
    "http://127.0.0.1:3019/api/agent/recommendation",
    data=json.dumps(payload).encode(),
    headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
        "X-AiChart-Service-Token": token,
    },
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        print("status", r.status, r.read().decode()[:800])
except Exception as e:
    body = e.read().decode()[:1200] if hasattr(e, "read") else str(e)
    print("status", getattr(e, "code", None), body)
PY
