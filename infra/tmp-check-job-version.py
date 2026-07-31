#!/usr/bin/env python3
import json
import urllib.request
from pathlib import Path

ENV = {}
for line in Path("/opt/aichart/web/.env").read_text(encoding="utf-8", errors="ignore").splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, _, v = line.partition("=")
        ENV[k.strip()] = v.strip().strip('"').strip("'")

url = ENV["RESEARCH_SERVICE_URL"].rstrip("/")
token = ENV["RESEARCH_SERVICE_INTERNAL_TOKEN"]
job_id = "rj_5978293227ca4378972e27e50395e096"
headers = {
    "Authorization": f"Bearer {token}",
    "X-AiChart-Caller": "aichart-web",
    "X-AiChart-User-Id": "1",
    "X-AiChart-Request-Id": "check-job-version",
}


def get(path: str):
    req = urllib.request.Request(url + path, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


job = get(f"/internal/research/jobs/{job_id}")
refs = job.get("artifact_refs") or []
spec_id = next(r["artifact_id"] for r in refs if r.get("name") == "strategy_spec.json")
spec = get(f"/internal/research/jobs/{job_id}/artifacts/{spec_id}/content")
print(
    json.dumps(
        {
            "version_id": spec.get("version_id"),
            "allow_reentry": (spec.get("entry") or {}).get("allow_reentry"),
            "maximum_holding_bars": (spec.get("management") or {}).get("maximum_holding_bars"),
            "has_rsi": "rsi_threshold" in json.dumps(spec),
            "trade_count_job_status": job.get("status"),
        },
        indent=2,
    )
)
