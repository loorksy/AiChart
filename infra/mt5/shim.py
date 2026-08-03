"""
AiChart MT5 bridge shim — a tiny REST API in front of the MetaTrader5
Python package (runs on Windows Python inside Wine).

Endpoints (JSON):
  GET  /health                          liveness + init state
  POST /connect {login,password,server} login to the broker account
  GET  /status                          account info (balance/equity/...)
  GET  /price?symbol=EURUSD             live bid/ask
  GET  /spec?symbol=EURUSD              contract spec (EaSymbolSpec shape)
  GET  /rates?symbol=&timeframe=&count= OHLC bars
  GET  /positions                       open positions
  POST /order {symbol,side,lots,sl,tp,comment}
  POST /close {ticket} | {all:true}

Auth: X-Bridge-Token header must match MT5_BRIDGE_TOKEN env when set.

MULTI-TENANT SAFETY
-------------------
A single MetaTrader 5 terminal can only be logged into one account at a time.
To serve multiple users from one bridge WITHOUT ever executing one user's order
on another user's account, every authenticated call carries a `login` (account
key). The bridge keeps a pool of known account credentials (registered on
/connect, persisted to credentials.json) and, under a global lock, ensures the
requested account is the ACTIVE login before performing the operation. Trade
endpoints additionally assert the active login equals the requested login.

This serializes operations (correct, leak-free) on one terminal. For throughput
at scale, run multiple bridge instances and shard users across them (each user's
MT5_BRIDGE_URL points to one shard).
"""

import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

def _load_mt5():
    import MetaTrader5 as m

    return m


class _Mt5Lazy:
    def __getattr__(self, name: str):
        return getattr(_load_mt5(), name)


mt5 = _Mt5Lazy()

PORT = int(os.environ.get("MT5_BRIDGE_PORT", "18812"))
TOKEN_FILE = os.environ.get("MT5_TOKEN_FILE", r"Z:\data\bridge_token")


def _bridge_token():
    tok = os.environ.get("MT5_BRIDGE_TOKEN", "").strip()
    if tok:
        return tok
    try:
        with open(TOKEN_FILE, "r", encoding="utf-8") as f:
            return f.read().strip()
    except Exception:
        return ""
TERMINAL_PATH = os.environ.get(
    "MT5_TERMINAL_PATH",
    r"C:\Program Files\MetaTrader 5\terminal64.exe",
)
CREDS_FILE = os.environ.get("MT5_CREDS_FILE", r"Z:\data\credentials.json")
# Wine on Linux cannot complete MT5 IPC — set MT5_CONNECT_CAPABLE=0 in compose.
CONNECT_CAPABLE = os.environ.get("MT5_CONNECT_CAPABLE", "1").strip() != "0"
# Fail fast on Wine IPC hangs; keep below nginx proxy_read_timeout (180s).
INIT_TIMEOUT_MS = int(os.environ.get("MT5_INIT_TIMEOUT_MS", "25000"))

def _timeframe_map():
    m = _load_mt5()
    return {
        "1m": m.TIMEFRAME_M1,
        "5m": m.TIMEFRAME_M5,
        "15m": m.TIMEFRAME_M15,
        "30m": m.TIMEFRAME_M30,
        "1h": m.TIMEFRAME_H1,
        "4h": m.TIMEFRAME_H4,
        "1d": m.TIMEFRAME_D1,
        "1w": m.TIMEFRAME_W1,
    }

# Re-entrant: ensure_active() (called inside a held lock) may itself switch the
# active account via do_connect(), which must not deadlock.
_lock = threading.RLock()
# Active terminal session + pool of known account credentials keyed by login.
_state = {"initialized": False, "login": None, "server": None}
_accounts = {}  # login(str) -> {"password": str, "server": str}


def _last_error():
    try:
        code, message = mt5.last_error()
        return f"{message} (code {code})"
    except Exception:
        return "unknown MT5 error"


def _save_creds():
    """Persist the whole account pool so the bridge can switch after a restart."""
    try:
        os.makedirs(os.path.dirname(CREDS_FILE), exist_ok=True)
        with open(CREDS_FILE, "w", encoding="utf-8") as f:
            json.dump({"accounts": _accounts}, f)
    except Exception as e:
        print(f"[shim] could not persist credentials: {e}", flush=True)


def _load_creds():
    try:
        with open(CREDS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _register_account(login, password, server):
    _accounts[str(login)] = {"password": str(password), "server": str(server)}
    _save_creds()


def do_connect(login, password, server):
    """Switch the terminal to `login`. Caller MUST hold _lock."""
    mt5.shutdown()
    ok = mt5.initialize(
        path=TERMINAL_PATH,
        login=int(login),
        password=str(password),
        server=str(server),
        timeout=INIT_TIMEOUT_MS,
        portable=True,
    )
    if not ok:
        _state["initialized"] = False
        err = _last_error()
        print(f"[shim] connect failed for {login}: {err}", flush=True)
        return False, err
    info = mt5.account_info()
    if info is None:
        _state["initialized"] = False
        return False, _last_error()
    _state.update(initialized=True, login=int(login), server=str(server))
    return True, account_dict(info)


def ensure_active(login):
    """
    Guarantee the requested account is the active terminal login. Caller MUST
    hold _lock. Returns (ok, error). If already active, no-op. Otherwise switches
    using pooled credentials; fails closed if the account was never registered.
    """
    if login is None:
        # No account specified: only valid if a session is already active.
        if _state["initialized"]:
            return True, None
        return False, "no account specified and none active"
    key = str(login)
    if _state["initialized"] and str(_state["login"]) == key:
        return True, None
    creds = _accounts.get(key)
    if not creds:
        return False, f"account {key} not connected — POST /connect first"
    ok, result = do_connect(key, creds["password"], creds["server"])
    return (True, None) if ok else (False, result)


def account_dict(info):
    return {
        "login": info.login,
        "server": info.server,
        "balance": info.balance,
        "equity": info.equity,
        "margin": info.margin,
        "margin_free": info.margin_free,
        "currency": info.currency,
        "leverage": info.leverage,
        "name": info.name,
    }


def ensure_symbol(symbol):
    si = mt5.symbol_info(symbol)
    if si is None:
        return None
    if not si.visible:
        mt5.symbol_select(symbol, True)
        time.sleep(0.2)
        si = mt5.symbol_info(symbol)
    return si


def spec_dict(symbol):
    si = ensure_symbol(symbol)
    if si is None:
        return None
    tick = mt5.symbol_info_tick(symbol)
    return {
        "symbol": symbol,
        "bid": (tick.bid if tick else si.bid) or 0,
        "ask": (tick.ask if tick else si.ask) or 0,
        "digits": si.digits,
        "point": si.point,
        "contract_size": si.trade_contract_size,
        "tick_value": si.trade_tick_value,
        "tick_size": si.trade_tick_size,
        "min_lot": si.volume_min,
        "max_lot": si.volume_max,
        "lot_step": si.volume_step,
    }


def _fillings():
    m = _load_mt5()
    return [m.ORDER_FILLING_IOC, m.ORDER_FILLING_FOK, m.ORDER_FILLING_RETURN]


def place_order(body):
    symbol = str(body["symbol"]).upper()
    side = str(body["side"]).lower()
    lots = float(body["lots"])
    si = ensure_symbol(symbol)
    if si is None:
        return {"ok": False, "reason": f"symbol {symbol} not found"}
    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        return {"ok": False, "reason": "no quote available"}
    price = tick.ask if side == "buy" else tick.bid

    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": symbol,
        "volume": lots,
        "type": mt5.ORDER_TYPE_BUY if side == "buy" else mt5.ORDER_TYPE_SELL,
        "price": price,
        "deviation": 20,
        "magic": 777001,
        "comment": str(body.get("comment") or "AiChart")[:31],
        "type_time": mt5.ORDER_TIME_GTC,
    }
    if body.get("sl"):
        request["sl"] = float(body["sl"])
    if body.get("tp"):
        request["tp"] = float(body["tp"])

    last = None
    for filling in _fillings():
        request["type_filling"] = filling
        result = mt5.order_send(request)
        if result is None:
            last = _last_error()
            continue
        if result.retcode == mt5.TRADE_RETCODE_DONE:
            return {
                "ok": True,
                "ticket": result.order,
                "position": getattr(result, "deal", None),
                "price": result.price or price,
                "lots": result.volume or lots,
            }
        last = f"{result.comment} (retcode {result.retcode})"
        # Only retry on unsupported-filling errors.
        if result.retcode != mt5.TRADE_RETCODE_INVALID_FILL:
            break
    return {"ok": False, "reason": last or "order rejected"}


def close_positions(body):
    if body.get("all"):
        positions = mt5.positions_get() or []
    elif body.get("ticket"):
        positions = mt5.positions_get(ticket=int(body["ticket"])) or []
    else:
        return {"ok": False, "reason": "ticket or all required"}

    if not positions:
        return {"ok": False, "reason": "position not found"}

    closed, errors = [], []
    for pos in positions:
        tick = mt5.symbol_info_tick(pos.symbol)
        if tick is None:
            errors.append(f"{pos.ticket}: no quote")
            continue
        is_buy = pos.type == mt5.POSITION_TYPE_BUY
        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": pos.symbol,
            "volume": pos.volume,
            "type": mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY,
            "position": pos.ticket,
            "price": tick.bid if is_buy else tick.ask,
            "deviation": 20,
            "magic": 777001,
            "comment": "AiChart close",
            "type_time": mt5.ORDER_TIME_GTC,
        }
        done = False
        for filling in _fillings():
            request["type_filling"] = filling
            result = mt5.order_send(request)
            if result is not None and result.retcode == mt5.TRADE_RETCODE_DONE:
                closed.append(
                    {
                        "ticket": pos.ticket,
                        "symbol": pos.symbol,
                        "lots": pos.volume,
                        "profit": pos.profit,
                        "price": result.price,
                    }
                )
                done = True
                break
            if result is not None and result.retcode != mt5.TRADE_RETCODE_INVALID_FILL:
                errors.append(f"{pos.ticket}: {result.comment} (retcode {result.retcode})")
                break
        if not done and not errors:
            errors.append(f"{pos.ticket}: {_last_error()}")
    return {"ok": len(closed) > 0 and not errors, "closed": closed, "errors": errors}


def positions_list():
    out = []
    for pos in mt5.positions_get() or []:
        out.append(
            {
                "ticket": pos.ticket,
                "symbol": pos.symbol,
                "side": "buy" if pos.type == mt5.POSITION_TYPE_BUY else "sell",
                "lots": pos.volume,
                "open_price": pos.price_open,
                "current_price": pos.price_current,
                "sl": pos.sl,
                "tp": pos.tp,
                "profit": pos.profit,
                "comment": pos.comment,
                "time": pos.time * 1000,
            }
        )
    return out


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # quieter logs
        print(f"[shim] {self.address_string()} {fmt % args}", flush=True)

    def _send(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authed(self):
        tok = _bridge_token()
        if not tok:
            return True
        return self.headers.get("X-Bridge-Token", "").strip() == tok

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            return {}

    def do_GET(self):
        url = urlparse(self.path)
        qs = {k: v[0] for k, v in parse_qs(url.query).items()}

        if url.path == "/health":
            return self._send(
                200,
                {
                    "ok": True,
                    "initialized": _state["initialized"],
                    "connect_capable": CONNECT_CAPABLE,
                },
            )

        if not self._authed():
            return self._send(401, {"error": "invalid bridge token"})

        login = qs.get("login")

        try:
            with _lock:
                # /status without a login reports whatever (if anything) is active;
                # with a login it ensures and reports THAT account.
                if url.path == "/status":
                    if login is not None:
                        ok, err = ensure_active(login)
                        if not ok:
                            return self._send(200, {"connected": False, "error": err})
                    if not _state["initialized"]:
                        return self._send(200, {"connected": False})
                    info = mt5.account_info()
                    if info is None:
                        return self._send(200, {"connected": False, "error": _last_error()})
                    return self._send(200, {"connected": True, "account": account_dict(info)})

                # All data endpoints must name their account: never serve one
                # user's quotes/specs/positions from another user's session.
                if login is None:
                    return self._send(400, {"error": "login required"})
                ok, err = ensure_active(login)
                if not ok:
                    return self._send(503, {"error": err})

                if url.path == "/price":
                    symbol = qs.get("symbol", "").upper()
                    si = ensure_symbol(symbol)
                    tick = mt5.symbol_info_tick(symbol) if si else None
                    if tick is None:
                        return self._send(404, {"error": f"no quote for {symbol}"})
                    return self._send(
                        200,
                        {"symbol": symbol, "bid": tick.bid, "ask": tick.ask, "time": tick.time * 1000},
                    )

                if url.path == "/spec":
                    spec = spec_dict(qs.get("symbol", "").upper())
                    if spec is None:
                        return self._send(404, {"error": "symbol not found"})
                    return self._send(200, spec)

                if url.path == "/rates":
                    symbol = qs.get("symbol", "").upper()
                    tf = _timeframe_map().get(qs.get("timeframe", "1h"))
                    count = min(int(qs.get("count", "120")), 1000)
                    if tf is None:
                        return self._send(400, {"error": "bad timeframe"})
                    if ensure_symbol(symbol) is None:
                        return self._send(404, {"error": "symbol not found"})
                    rates = mt5.copy_rates_from_pos(symbol, tf, 0, count)
                    if rates is None:
                        return self._send(404, {"error": _last_error()})
                    bars = [
                        {
                            "time": int(r["time"]) * 1000,
                            "open": float(r["open"]),
                            "high": float(r["high"]),
                            "low": float(r["low"]),
                            "close": float(r["close"]),
                        }
                        for r in rates
                    ]
                    return self._send(200, {"symbol": symbol, "bars": bars})

                if url.path == "/positions":
                    return self._send(200, {"positions": positions_list()})

                return self._send(404, {"error": "not found"})
        except Exception as e:
            return self._send(500, {"error": str(e)})

    def do_POST(self):
        url = urlparse(self.path)
        if not self._authed():
            return self._send(401, {"error": "invalid bridge token"})
        body = self._body()

        try:
            if url.path == "/connect":
                if not CONNECT_CAPABLE:
                    return self._send(
                        503,
                        {
                            "error": (
                                "MT5 IPC unavailable on this host (Wine/Linux). "
                                "Use MetaApi instead."
                            )
                        },
                    )
                for field in ("login", "password", "server"):
                    if not body.get(field):
                        return self._send(400, {"error": f"{field} required"})
                with _lock:
                    ok, result = do_connect(
                        body["login"], body["password"], body["server"]
                    )
                    if not ok:
                        return self._send(502, {"error": result})
                    _register_account(
                        body["login"], body["password"], body["server"]
                    )
                return self._send(200, {"ok": True, "account": result})

            login = body.get("login")

            # Trade endpoints MUST name their account — refuse to execute against
            # "whatever is currently active", which would cross tenants.
            if url.path in ("/order", "/close"):
                if login is None:
                    return self._send(400, {"ok": False, "reason": "login required"})
                with _lock:
                    ok, err = ensure_active(login)
                    if not ok:
                        return self._send(503, {"error": err})
                    # Belt-and-suspenders: never trade if the active account is
                    # not exactly the one the caller asked for.
                    if str(_state["login"]) != str(login):
                        return self._send(
                            409,
                            {"ok": False, "reason": "account mismatch — refused"},
                        )
                    if url.path == "/order":
                        return self._send(200, place_order(body))
                    return self._send(200, close_positions(body))

            return self._send(404, {"error": "not found"})
        except Exception as e:
            return self._send(500, {"error": str(e)})


def auto_reconnect():
    """Load the persisted account pool; reconnect the most recent for warm reads."""
    data = _load_creds()
    if not data:
        print("[shim] no stored credentials — waiting for /connect", flush=True)
        return
    # Back-compat: migrate the old single-account file shape into the pool.
    if "accounts" in data:
        _accounts.update(data["accounts"])
    elif data.get("login"):
        _accounts[str(data["login"])] = {
            "password": data["password"],
            "server": data["server"],
        }
        _save_creds()
    if not _accounts:
        print("[shim] empty account pool — waiting for /connect", flush=True)
        return
    last_login = next(reversed(_accounts))
    creds = _accounts[last_login]
    print(
        f"[shim] account pool loaded ({len(_accounts)}); warming {last_login}...",
        flush=True,
    )
    with _lock:
        ok, result = do_connect(last_login, creds["password"], creds["server"])
    print(f"[shim] warm connect: {'ok' if ok else result}", flush=True)


if __name__ == "__main__":
    if not _bridge_token():
        print(
            "[shim] WARNING: MT5_BRIDGE_TOKEN is not set — the bridge is "
            "UNAUTHENTICATED. Set it in production; anyone who can reach this "
            "port could trade pooled accounts.",
            flush=True,
        )
    try:
        auto_reconnect()
    except Exception as e:  # never block startup on a warm-connect failure
        print(f"[shim] auto_reconnect error: {e}", flush=True)
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"[shim] listening on :{PORT}", flush=True)
    server.serve_forever()
