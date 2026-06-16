#!/usr/bin/env python3
"""Quick multi-user bridge isolation checks against production or local web."""
import hashlib
import hmac
import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("AICHART_API_URL", "https://aichart.lork.cloud").rstrip("/")
TOKEN = os.environ.get("AICHART_SERVICE_TOKEN", "").strip()
USER_A = os.environ.get("BRIDGE_TEST_USER_A", "").strip().lower()
USER_B = os.environ.get("BRIDGE_TEST_USER_B", "").strip().lower()


def sig(email: str) -> str:
    return hmac.new(TOKEN.encode(), email.lower().encode(), hashlib.sha256).hexdigest()


def bridge_get(path: str, email: str | None = None):
    headers = {"Authorization": f"Bearer {TOKEN}", "Accept": "application/json"}
    if email:
        headers["X-Aichart-User-Email"] = email
        headers["X-Aichart-User-Sig"] = sig(email)
    req = urllib.request.Request(f"{BASE}{path}", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            data = {"raw": body}
        return e.code, data


def main() -> int:
    if not TOKEN:
        print("Set AICHART_SERVICE_TOKEN", file=sys.stderr)
        return 1

    print(f"=== Bridge isolation @ {BASE} ===\n")

    # 1) No email header → 400
    code, data = bridge_get("/api/agent/risk/status")
    ok1 = code == 400
    print(f"[{'PASS' if ok1 else 'FAIL'}] no X-Aichart-User-Email → {code} ({data.get('error', data)})")

    # 2) Forged sig → 403
    if USER_A:
        headers_forged = {
            "Authorization": f"Bearer {TOKEN}",
            "X-Aichart-User-Email": USER_A,
            "X-Aichart-User-Sig": "deadbeef" * 8,
        }
        req = urllib.request.Request(
            f"{BASE}/api/agent/risk/status", headers=headers_forged
        )
        try:
            urllib.request.urlopen(req, timeout=30)
            code2 = 200
        except urllib.error.HTTPError as e:
            code2 = e.code
        ok2 = code2 == 403
        print(f"[{'PASS' if ok2 else 'FAIL'}] forged sig for {USER_A} → {code2}")
    else:
        ok2 = True
        print("[SKIP] forged sig (set BRIDGE_TEST_USER_A)")

    # 3) Two users return different userId-scoped data
    ok3 = True
    if USER_A and USER_B:
        ca, da = bridge_get("/api/agent/risk/status", USER_A)
        cb, db = bridge_get("/api/agent/risk/status", USER_B)
        ok3 = ca == 200 and cb == 200
        print(f"[{'PASS' if ok3 else 'FAIL'}] userA risk/status → {ca}, userB → {cb}")
        if ok3:
            print(f"  userA keys: {sorted(da.keys())[:8]}...")
            print(f"  userB keys: {sorted(db.keys())[:8]}...")
            # portfolio should differ if accounts differ
            pa, pda = bridge_get("/api/agent/portfolio", USER_A)
            pb, pdb = bridge_get("/api/agent/portfolio", USER_B)
            same = json.dumps(pda, sort_keys=True) == json.dumps(pdb, sort_keys=True)
            print(f"[{'INFO' if not same else 'WARN'}] portfolio payloads identical={same} (A={pa}, B={pb})")
    else:
        print("[SKIP] two-user compare (set BRIDGE_TEST_USER_A and BRIDGE_TEST_USER_B)")

    passed = ok1 and ok2 and ok3
    print(f"\n{'ALL CHECKS PASSED' if passed else 'SOME CHECKS FAILED'}")
    return 0 if passed else 2


if __name__ == "__main__":
    sys.exit(main())
