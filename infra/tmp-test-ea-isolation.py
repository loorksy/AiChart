#!/usr/bin/env python3
"""EA bridge isolation — user A (EA) vs user B (no/other EA)."""
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


def bridge_get(path: str, email: str):
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/json",
        "X-Aichart-User-Email": email,
        "X-Aichart-User-Sig": sig(email),
    }
    req = urllib.request.Request(f"{BASE}{path}", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            data = {"raw": body}
        return e.code, data


def unwrap(body: dict) -> dict:
    if isinstance(body, dict) and "data" in body and "ok" in body:
        inner = body.get("data")
        return inner if isinstance(inner, dict) else body
    return body


def login_of(payload: dict) -> str | None:
    for key in ("login", "account_login"):
        v = payload.get(key)
        if v is not None and str(v).strip():
            return str(v).strip()
    return None


def main() -> int:
    if not TOKEN:
        print("Set AICHART_SERVICE_TOKEN", file=sys.stderr)
        return 1
    if not USER_A or not USER_B:
        print("Set BRIDGE_TEST_USER_A and BRIDGE_TEST_USER_B", file=sys.stderr)
        return 1

    print(f"=== EA isolation @ {BASE} ===")
    print(f"  A (EA expected): {USER_A}")
    print(f"  B (isolated):    {USER_B}\n")

    results: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        results.append((name, ok, detail))
        tag = "PASS" if ok else "FAIL"
        line = f"[{tag}] {name}"
        if detail:
            line += f" — {detail}"
        print(line)

    # 1) A: mt/status backend ea
    _, raw_a_mt = bridge_get("/api/agent/mt/status", USER_A)
    a_mt = unwrap(raw_a_mt) if isinstance(raw_a_mt, dict) else {}
    check(
        "A mt/status backend=ea",
        a_mt.get("backend") == "ea",
        f"backend={a_mt.get('backend')!r} online={a_mt.get('online')}",
    )

    # 2) B: mt/status not sharing A online state
    _, raw_b_mt = bridge_get("/api/agent/mt/status", USER_B)
    b_mt = unwrap(raw_b_mt) if isinstance(raw_b_mt, dict) else {}
    b_online = bool(b_mt.get("online"))
    a_login = login_of(a_mt)
    b_login = login_of(b_mt)
    check(
        "B mt/status online=false OR login != A",
        (not b_online) or (a_login and b_login and b_login != a_login) or (not b_login),
        f"online={b_mt.get('online')} login={b_login!r} (A login={a_login!r})",
    )

    # Fetch diagnostics early (used in tests 3 and 6)
    _, raw_a_d = bridge_get("/api/agent/ea/diagnostics?symbol=EURUSD", USER_A)
    _, raw_b_d = bridge_get("/api/agent/ea/diagnostics?symbol=EURUSD", USER_B)
    a_d = raw_a_d if isinstance(raw_a_d, dict) else {}
    b_d = raw_b_d if isinstance(raw_b_d, dict) else {}

    # 3) A: live-quotes (symbol + full summary)
    _, raw_a_q = bridge_get("/api/agent/ea/live-quotes?symbol=EURUSD", USER_A)
    _, raw_a_q_all = bridge_get("/api/agent/ea/live-quotes", USER_A)
    a_q = unwrap(raw_a_q) if isinstance(raw_a_q, dict) else {}
    a_q_all = unwrap(raw_a_q_all) if isinstance(raw_a_q_all, dict) else {}
    a_count = a_q_all.get("count")
    if a_count is None:
        a_count = len(a_q_all.get("quotes") or [])
    a_has_quote = (
        bool(a_q.get("quote"))
        or (isinstance(a_count, int) and a_count > 0)
        or len(a_d.get("symbols") or []) > 0
    )
    check(
        "A live-quotes has data or heartbeat fallback",
        a_has_quote or bool(a_mt.get("online")),
        f"count={a_count} quote={bool(a_q.get('quote'))} symbols={len(a_d.get('symbols') or [])}",
    )

    # 4) B: live-quotes must not expose A login via diagnostics
    _, raw_b_q = bridge_get("/api/agent/ea/live-quotes", USER_B)
    b_q = unwrap(raw_b_q) if isinstance(raw_b_q, dict) else {}
    b_count = b_q.get("count", len(b_q.get("quotes") or []))
    check(
        "B live-quotes count=0 or no fresh quotes",
        b_count == 0 or b_q.get("freshCount", 0) == 0 or not b_online,
        f"count={b_count} fresh={b_q.get('freshCount')}",
    )

    # 5) trade/readiness differs
    path = "/api/agent/trade/readiness?market=forex&symbol=EURUSD&confidence=85"
    _, raw_a_r = bridge_get(path, USER_A)
    _, raw_b_r = bridge_get(path, USER_B)
    a_r = unwrap(raw_a_r) if isinstance(raw_a_r, dict) else {}
    b_r = unwrap(raw_b_r) if isinstance(raw_b_r, dict) else {}
    a_ready = a_r.get("ready")
    b_ready = b_r.get("ready")
    a_blockers = {b.get("code") for b in (a_r.get("blockers") or []) if isinstance(b, dict)}
    b_blockers = {b.get("code") for b in (b_r.get("blockers") or []) if isinstance(b, dict)}
    readiness_ok = (a_ready != b_ready) or (a_blockers != b_blockers) or (not b_online)
    check(
        "A vs B trade/readiness differ or B EA offline",
        readiness_ok,
        f"A ready={a_ready} blockers={sorted(a_blockers)} | B ready={b_ready} blockers={sorted(b_blockers)}",
    )

    # 6) diagnostics — B must not see A account_login
    a_d_login = login_of(a_d) or (
        a_d.get("account", {}).get("login")
        if isinstance(a_d.get("account"), dict)
        else None
    )
    if not a_d_login:
        a_d_login = a_login
    b_d_login = login_of(b_d)
    leak = (
        a_d_login
        and b_d_login
        and str(b_d_login) == str(a_d_login)
        and USER_A != USER_B
    )
    check(
        "B diagnostics login != A login",
        not leak,
        f"A login={a_d_login!r} B login={b_d_login!r}",
    )

    passed = all(r[1] for r in results)
    print(f"\n{'ALL CHECKS PASSED' if passed else 'SOME CHECKS FAILED'}")
    return 0 if passed else 2


if __name__ == "__main__":
    sys.exit(main())
