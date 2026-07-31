#!/usr/bin/env python3
"""Acceptance: ema_trend_follow_v1 ~1y XAUUSD/1h via web agent backtest API."""
from __future__ import annotations

import hashlib
import hmac
import json
import sqlite3
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

REAL = Path("/opt/aichart")
ENV: dict[str, str] = {}
for line in (REAL / "web" / ".env").read_text(encoding="utf-8", errors="ignore").splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, _, v = line.partition("=")
        ENV[k.strip()] = v.strip().strip('"').strip("'")

URL = ENV["RESEARCH_SERVICE_URL"].rstrip("/")
TOKEN = ENV["RESEARCH_SERVICE_INTERNAL_TOKEN"]
WEB = f"http://127.0.0.1:{ENV.get('PORT', '3010')}"
AGENT = ENV["AICHART_SERVICE_TOKEN"]


def resolve_email() -> tuple[str, str]:
    if ENV.get("DATABASE_URL", "").startswith("postgres"):
        out = subprocess.check_output(
            [
                "psql",
                ENV["DATABASE_URL"],
                "-tAc",
                "SELECT id||'|'||email FROM users WHERE role='admin' ORDER BY id ASC LIMIT 1",
            ],
            text=True,
        ).strip()
        uid, email = out.split("|", 1)
        return uid, email.strip().lower()
    db = ENV.get("DATABASE_PATH") or str(REAL / "web" / "data" / "aichart.sqlite")
    con = sqlite3.connect(db)
    row = con.execute(
        "SELECT id, email FROM users WHERE role='admin' ORDER BY id ASC LIMIT 1"
    ).fetchone()
    if not row:
        row = con.execute("SELECT id, email FROM users ORDER BY id ASC LIMIT 1").fetchone()
    con.close()
    if not row:
        raise RuntimeError("no users")
    return str(row[0]), str(row[1]).lower()


def bridge_headers(email: str) -> dict[str, str]:
    sig = hmac.new(AGENT.encode(), email.encode(), hashlib.sha256).hexdigest()
    return {
        "Authorization": f"Bearer {AGENT}",
        "Content-Type": "application/json",
        "X-Aichart-User-Email": email,
        "X-Aichart-User-Sig": sig,
        "X-Request-Id": f"accept-ema-{int(time.time()*1000)}",
    }


def http_json(method: str, url: str, headers: dict[str, str], body: dict | None = None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise RuntimeError(f"{method} {url} -> {exc.code}: {detail[:2000]}") from exc


def poll_research(job_id: str, user_id: str) -> dict:
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "X-AiChart-Caller": "aichart-web",
        "X-AiChart-User-Id": user_id,
        "X-AiChart-Request-Id": "accept-poll",
    }
    last: dict = {}
    for _ in range(150):
        _, last = http_json("GET", f"{URL}/internal/research/jobs/{job_id}", headers)
        st = last.get("status")
        print("poll", st, last.get("progress_percent"), last.get("stage"), flush=True)
        if st in ("succeeded", "failed", "cancelled"):
            break
        time.sleep(2)
    return last


def metrics_from_job(job: dict, user_id: str) -> dict:
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "X-AiChart-Caller": "aichart-web",
        "X-AiChart-User-Id": user_id,
        "X-AiChart-Request-Id": "accept-metrics",
    }
    refs = job.get("artifact_refs") or []
    metrics_id = next(r.get("artifact_id") for r in refs if r.get("name") == "metrics.json")
    job_id = job["job_id"]
    _, metrics = http_json(
        "GET",
        f"{URL}/internal/research/jobs/{job_id}/artifacts/{metrics_id}/content",
        headers,
    )
    return metrics


def run_once(email: str, user_id: str, label: str) -> dict:
    body = {
        "strategy_id": "ema_trend_follow_v1",
        "symbol": "XAUUSD",
        "timeframe": "1h",
        "date_range": {
            "from": "2025-06-01T00:00:00.000Z",
            "to": "2026-07-06T00:00:00.000Z",
        },
        "notional_capital": 10000,
    }
    status, payload = http_json(
        "POST", f"{WEB}/api/agent/backtest", bridge_headers(email), body
    )
    print(label, "HTTP", status, flush=True)
    job_id = (payload.get("research_job") or {}).get("job_id")
    if not job_id:
        raise RuntimeError(f"no job: {payload}")
    job = poll_research(job_id, user_id)
    if job.get("status") != "succeeded":
        raise RuntimeError(f"{label} failed: {json.dumps(job)[:2000]}")
    metrics = metrics_from_job(job, user_id)
    summary = {
        "trade_count": metrics.get("trade_count"),
        "bars_in_dataset": metrics.get("bars_in_dataset"),
        "bars_evaluated": metrics.get("bars_evaluated"),
        "win_rate": metrics.get("win_rate"),
        "job_id": job_id,
    }
    print(label, summary, flush=True)
    return summary


def main() -> None:
    print(
        "AT",
        subprocess.check_output(
            ["git", "-C", str(REAL), "rev-parse", "--short", "HEAD"], text=True
        ).strip(),
        flush=True,
    )
    user_id, email = resolve_email()
    print("user", user_id, email, flush=True)
    m1 = run_once(email, user_id, "RUN1")
    # Determinism: re-read the same succeeded job artifacts.
    job_again = poll_research(m1["job_id"], user_id)
    m1b = metrics_from_job(job_again, user_id)
    tc1 = int(m1["trade_count"] or 0)
    tc1b = int(m1b.get("trade_count") or 0)
    bars = int(m1.get("bars_evaluated") or m1.get("bars_in_dataset") or 0)
    ok_count = tc1 >= 100
    ok_det = tc1 == tc1b and m1.get("win_rate") == m1b.get("win_rate")
    print(
        json.dumps(
            {
                "accept_trade_count_ge_100": ok_count,
                "accept_deterministic_refetch": ok_det,
                "trade_count": tc1,
                "bars_evaluated": bars,
                "job_id": m1["job_id"],
            },
            indent=2,
        ),
        flush=True,
    )
    if not (ok_count and ok_det):
        raise SystemExit(3)
    print("ACCEPT_OK", flush=True)


if __name__ == "__main__":
    main()
