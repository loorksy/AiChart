#!/usr/bin/env python3
import json
import urllib.request
from pathlib import Path

ENV = {}
for line in Path("/opt/aichart/web/.env").read_text().splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, _, v = line.partition("=")
        ENV[k.strip()] = v.strip().strip('"').strip("'")

URL = ENV["RESEARCH_SERVICE_URL"].rstrip("/")
TOKEN = ENV["RESEARCH_SERVICE_INTERNAL_TOKEN"]
job = "rj_34ffac8bab1e411182c1fb104c82313c"
headers = {
    "Authorization": f"Bearer {TOKEN}",
    "X-AiChart-Caller": "aichart-web",
    "X-AiChart-User-Id": "1",
}
j = json.load(
    urllib.request.urlopen(urllib.request.Request(f"{URL}/internal/research/jobs/{job}", headers=headers))
)
refs = j.get("artifact_refs") or []
print("refs", [(r.get("name"), r.get("artifact_id")) for r in refs])
sid = next(r["artifact_id"] for r in refs if r.get("name") == "strategy_spec.json")
spec = json.load(
    urllib.request.urlopen(
        urllib.request.Request(
            f"{URL}/internal/research/jobs/{job}/artifacts/{sid}/content",
            headers=headers,
        )
    )
)
print(json.dumps(spec.get("long_entry_conditions"), indent=2))
print("allow_reentry", spec.get("entry", {}).get("allow_reentry"))
print("risk", json.dumps(spec.get("risk_controls"), indent=2))
