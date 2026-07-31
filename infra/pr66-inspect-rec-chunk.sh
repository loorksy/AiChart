#!/usr/bin/env bash
set -uo pipefail
python3 - <<'PY'
from pathlib import Path
import re
root = Path("/opt/aichart-rc-pr66-0171398/web/.next/server")
# Find chunk mentioning agent recommendation schema markers
for f in root.rglob("*.js"):
    txt = f.read_text(errors="ignore")
    if "X-Aichart-User-Email" in txt or "hostModelPlanSchema" in txt or ("agent_recommendation" in txt and "model_plan" in txt):
        print("FILE", f, "size", f.stat().st_size)
        for needle in ["model_plan", "hostModelPlanSchema", "validateModelTradePlan", "rationale or model_plan", "poiScoreCompat", "min(0).max(100)", "factors"]:
            print(" ", needle, needle in txt)
        # Extract nearby Zod required patterns for recommendation
        for m in re.finditer(r'.{0,80}model_plan.{0,80}', txt):
            s=m.group(0)
            if "symbol" in s or "decision" in s or "optional" in s:
                print(" CTX", s[:200])
                break
        # Look for required array including rationale
        if "rationale" in txt and "factors" in txt and "confidence" in txt:
            idx = txt.find("rationale")
            print(" RATIONALE CTX", txt[max(0,idx-120):idx+200].replace("\n"," ")[:300])
        print("---")

# Process info
import os, subprocess
out=subprocess.check_output(["ps","-eo","pid,cmd"], text=True)
for line in out.splitlines():
    if "3019" in line or "aichart-rc-pr66-0171398" in line and "next" in line:
        print("PROC", line[:240])
PY

# Check if production route differs
python3 - <<'PY'
from pathlib import Path
prod = Path("/opt/aichart/web/src/app/api/agent/recommendation/route.ts")
rc = Path("/opt/aichart-rc-pr66-0171398/web/src/app/api/agent/recommendation/route.ts")
print("prod_exists", prod.exists())
if prod.exists():
    pt, rt = prod.read_text(), rc.read_text()
    print("prod_model_plan", "model_plan" in pt)
    print("same_file", pt == rt)
    # show prod schema required-ness around action
    for label,t in [("prod",pt),("rc",rt)]:
        start=t.find("const schema")
        print(label, "schema_snip", t[start:start+500].replace("\n"," ")[:500])
PY
