#!/usr/bin/env python3
"""Poll trade/readiness quote freshness — baseline or post-EA-fix verification."""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request

DEFAULT_ENV = "/opt/aichart/web/.env"


def load_env(path: str) -> dict[str, str]:
    env: dict[str, str] = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k] = v.strip()
    return env


def user_sig(token: str, email: str) -> str:
    return hmac.new(
        token.encode(),
        email.lower().encode(),
        hashlib.sha256,
    ).hexdigest()


def get(base: str, token: str, email: str, path: str) -> tuple[int, object]:
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "X-Aichart-User-Email": email.lower(),
        "X-Aichart-User-Sig": user_sig(token, email),
    }
    req = urllib.request.Request(base + path, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read().decode()
            return r.status, json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, {"raw": raw}


def percentile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    s = sorted(values)
    k = (len(s) - 1) * (p / 100.0)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return s[int(k)]
    return s[f] * (c - k) + s[c] * (k - f)


def main() -> int:
    parser = argparse.ArgumentParser(description="Quote freshness poll for EURUSDm")
    parser.add_argument("--env", default=DEFAULT_ENV, help="Path to web .env")
    parser.add_argument("--symbol", default="EURUSDm", help="Symbol query param")
    parser.add_argument("--interval", type=float, default=5.0, help="Seconds between polls")
    parser.add_argument("--duration", type=float, default=120.0, help="Total seconds")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Post-EA-fix mode: p95<=3000ms, no >5000ms for 3+ consecutive polls",
    )
    args = parser.parse_args()

    env = load_env(args.env)
    token = env.get("AICHART_SERVICE_TOKEN", "")
    email = env.get("ADMIN_EMAIL", "") or env.get("AICHART_AGENT_USER_ID", "")
    if not token:
        print("FAIL: AICHART_SERVICE_TOKEN missing in", args.env)
        return 1
    if not email or "@" not in email:
        print("FAIL: ADMIN_EMAIL missing in", args.env)
        return 1

    port = env.get("PORT", "3010")
    base = os.environ.get("AICHART_TEST_BASE", f"http://127.0.0.1:{port}")
    path = (
        f"/api/agent/trade/readiness?symbol={args.symbol}"
        f"&market=forex&confidence=85"
    )
    metrics_path = (
        f"/api/agent/ea/live-quotes?symbol={args.symbol.upper()}&metrics=1"
    )

    print(f"Polling {base}{path} every {args.interval}s for {args.duration}s")
    samples: list[dict] = []
    ages: list[float] = []
    stale_streak = 0
    max_stale_streak = 0
    t_end = time.time() + args.duration

    while time.time() < t_end:
        t0 = time.time()
        status, data = get(base, token, email, path)
        payload = data.get("data", data) if isinstance(data, dict) else {}
        quote = (payload.get("checks") or {}).get("quote") or {}
        age = quote.get("quoteAgeMs")
        fresh = quote.get("fresh")
        source = quote.get("source")
        hb = (payload.get("checks") or {}).get("heartbeat") or {}
        row = {
            "t": round(t0, 1),
            "status": status,
            "quoteAgeMs": age,
            "fresh": fresh,
            "source": source,
            "heartbeatFresh": hb.get("fresh"),
        }
        samples.append(row)
        print(json.dumps(row, ensure_ascii=False))

        if isinstance(age, (int, float)):
            ages.append(float(age))
            if age > 5000:
                stale_streak += 1
                max_stale_streak = max(max_stale_streak, stale_streak)
            else:
                stale_streak = 0

        sleep_for = args.interval - (time.time() - t0)
        if sleep_for > 0:
            time.sleep(min(sleep_for, max(0, t_end - time.time())))

    _, metrics_data = get(base, token, email, metrics_path)
    tick_metrics = metrics_data.get("tickMetrics") if isinstance(metrics_data, dict) else None

    p50 = percentile(ages, 50)
    p95 = percentile(ages, 95)
    print("\n=== SUMMARY ===")
    print(f"polls={len(samples)} ages_recorded={len(ages)}")
    print(f"p50_quoteAgeMs={p50} p95_quoteAgeMs={p95} max_stale_streak(>5000ms)={max_stale_streak}")
    if tick_metrics:
        print("tickMetrics:", json.dumps(tick_metrics, ensure_ascii=False, indent=2)[:2000])

    ok = True
    if args.strict:
        if p95 is None or p95 > 3000:
            print(f"FAIL strict: p95 {p95} > 3000ms")
            ok = False
        if max_stale_streak >= 3:
            print(f"FAIL strict: stale streak {max_stale_streak} >= 3 polls")
            ok = False
    else:
        # Baseline: no regression on HTTP + structure
        for s in samples:
            if s["status"] != 200:
                print(f"FAIL baseline: HTTP {s['status']} at t={s['t']}")
                ok = False
                break

    print("\nRESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
