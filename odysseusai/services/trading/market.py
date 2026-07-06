"""OANDA v20 market-data adapter — the forex data source for Odysseus.

Python port of the former AiChart ``lib/markets/oanda.ts`` +
``forexSnapshot.ts``. Candles, prices, and the instrument universe come from
OANDA; trade execution stays on the user's MT5/EA broker.

Credentials resolve per-user from the encrypted ``BrokerCredential`` store
(provider ``oanda``), falling back to the ``OANDA_*`` environment variables
so a single-tenant deployment can configure one account globally.
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Any

import httpx

from . import indicators as ind
from . import store

logger = logging.getLogger(__name__)

HTTP_TIMEOUT = 15.0

# AiChart interval -> native OANDA granularity.
_GRANULARITY: dict[str, str] = {
    "1m": "M1", "3m": "M3", "5m": "M5", "15m": "M15", "30m": "M30",
    "1h": "H1", "2h": "H2", "4h": "H4", "6h": "H6", "8h": "H8",
    "12h": "H12", "1d": "D", "1w": "W", "1M": "M",
}

_PAIR_RE = re.compile(r"^[A-Z]{3}_[A-Z]{3}$")
_SIX_RE = re.compile(r"^[A-Z]{6}$")


@dataclass
class Candle:
    time: int  # epoch ms
    open: float
    high: float
    low: float
    close: float
    volume: float | None = None


@dataclass
class Quote:
    symbol: str
    bid: float | None
    ask: float | None
    mid: float | None
    tradeable: bool


def to_oanda_instrument(symbol: str) -> str | None:
    """EURUSD -> EUR_USD, XAUUSD -> XAU_USD, EUR_USD -> EUR_USD."""
    up = symbol.upper()
    if "_" in symbol and _PAIR_RE.match(up):
        return up
    s = re.sub(r"[^A-Z0-9]", "", up)
    if _SIX_RE.match(s):
        return f"{s[:3]}_{s[3:]}"
    return None


def from_oanda_instrument(instrument: str) -> str:
    return instrument.replace("_", "").upper()


def to_oanda_granularity(interval: str) -> str | None:
    return _GRANULARITY.get(interval)


class OandaClient:
    """Thin OANDA v20 REST client resolved from a user's credentials."""

    def __init__(self, token: str | None, account_id: str | None, env: str = "practice"):
        self.token = token
        self.account_id = account_id
        self.env = (env or "practice").lower()

    @classmethod
    def for_user(cls, owner: str) -> "OandaClient":
        cred = store.get_broker_credential(owner, "oanda") if owner else None
        if cred and cred.get("api_key"):
            env = "live" if cred.get("env") == "live" else "practice"
            return cls(cred.get("api_key"), cred.get("account_id"), env)
        # Fallback to environment (single-tenant / shared account).
        return cls(
            os.getenv("OANDA_API_TOKEN") or None,
            os.getenv("OANDA_ACCOUNT_ID") or None,
            (os.getenv("OANDA_ENV") or "practice").lower(),
        )

    @property
    def configured(self) -> bool:
        return bool(self.token)

    @property
    def base_url(self) -> str:
        return (
            "https://api-fxtrade.oanda.com"
            if self.env == "live"
            else "https://api-fxpractice.oanda.com"
        )

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token or ''}",
            "Content-Type": "application/json",
        }

    async def fetch_candles(self, symbol: str, interval: str, count: int = 200) -> list[Candle]:
        if not self.configured:
            return []
        instrument = to_oanda_instrument(symbol)
        granularity = to_oanda_granularity(interval)
        if not instrument or not granularity:
            return []
        n = min(max(1, count), 5000)
        url = f"{self.base_url}/v3/instruments/{instrument}/candles"
        params = {"granularity": granularity, "count": str(n), "price": "M"}
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            res = await client.get(url, headers=self._headers(), params=params)
        if res.status_code != 200:
            raise RuntimeError(f"OANDA candles HTTP {res.status_code}")
        rows = (res.json() or {}).get("candles", []) or []
        out: list[Candle] = []
        for r in rows:
            mid = r.get("mid")
            if not mid:
                continue
            try:
                t = int(datetime.fromisoformat(r["time"].replace("Z", "+00:00")).timestamp() * 1000)
                o, h, l, c = (float(mid["o"]), float(mid["h"]), float(mid["l"]), float(mid["c"]))
            except (KeyError, ValueError, TypeError):
                continue
            out.append(Candle(time=t, open=o, high=h, low=l, close=c, volume=r.get("volume")))
        out.sort(key=lambda x: x.time)
        return out

    async def fetch_pricing(self, symbols: list[str]) -> list[Quote]:
        if not self.configured or not self.account_id:
            return []
        instruments = [i for i in (to_oanda_instrument(s) for s in symbols) if i]
        if not instruments:
            return []
        url = f"{self.base_url}/v3/accounts/{self.account_id}/pricing"
        params = {"instruments": ",".join(instruments)}
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            res = await client.get(url, headers=self._headers(), params=params)
        if res.status_code != 200:
            raise RuntimeError(f"OANDA pricing HTTP {res.status_code}")
        out: list[Quote] = []
        for p in (res.json() or {}).get("prices", []) or []:
            bids = p.get("bids") or []
            asks = p.get("asks") or []
            bid = float(bids[0]["price"]) if bids else None
            ask = float(asks[0]["price"]) if asks else None
            if bid is not None and ask is not None:
                mid = (bid + ask) / 2
            else:
                mid = bid if bid is not None else ask
            out.append(Quote(
                symbol=from_oanda_instrument(p.get("instrument", "")),
                bid=bid, ask=ask, mid=mid,
                tradeable=p.get("tradeable", True) is not False,
            ))
        return out

    async def fetch_instruments(self) -> list[dict[str, str]]:
        if not self.configured or not self.account_id:
            return []
        url = f"{self.base_url}/v3/accounts/{self.account_id}/instruments"
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            res = await client.get(url, headers=self._headers())
        if res.status_code != 200:
            raise RuntimeError(f"OANDA instruments HTTP {res.status_code}")
        rows = (res.json() or {}).get("instruments", []) or []
        return [
            {
                "symbol": from_oanda_instrument(i.get("name", "")),
                "displayName": i.get("displayName") or i.get("name", ""),
                "type": i.get("type", "CURRENCY"),
            }
            for i in rows
        ]


def _trend(ema20: float | None, sma50: float | None, price: float) -> str:
    if ema20 is None or sma50 is None or price <= 0:
        return "sideways"
    if price > ema20 and ema20 > sma50:
        return "uptrend"
    if price < ema20 and ema20 < sma50:
        return "downtrend"
    return "sideways"


async def get_price(owner: str, symbol: str) -> float | None:
    """Live mid for a symbol; falls back to last candle close."""
    client = OandaClient.for_user(owner)
    if not client.configured:
        return None
    try:
        quotes = await client.fetch_pricing([symbol])
        if quotes and quotes[0].mid:
            return quotes[0].mid
    except Exception as exc:
        logger.info("OANDA pricing failed for %s: %s", symbol, exc)
    try:
        candles = await client.fetch_candles(symbol, "1m", 2)
        if candles:
            return candles[-1].close
    except Exception:
        pass
    return None


async def market_snapshot(owner: str, symbol: str, interval: str = "15m") -> dict[str, Any]:
    """Fetch candles + compute indicators + trend + summary (verdict inputs).

    Mirrors ``buildForexSnapshot``: price, 24h change, RSI/SMA/EMA/MACD/ATR,
    trend classification, and a short Arabic summary line.
    """
    from .constants import normalize_interval

    tf = normalize_interval(interval)
    sym = symbol.strip().upper()
    client = OandaClient.for_user(owner)

    empty = {
        "symbol": sym, "interval": tf, "price": 0.0, "change24hPct": 0.0,
        "high24h": 0.0, "low24h": 0.0, "rsi14": None, "sma20": None,
        "sma50": None, "ema20": None, "macd": None, "atr14": None,
        "trend": "sideways", "summary": "", "candleCount": 0,
    }
    if not client.configured:
        empty["summary"] = "OANDA غير مُهيّأ — أضف مفتاح OANDA في الإعدادات."
        return empty

    try:
        candles = await client.fetch_candles(sym, tf, 200)
    except Exception as exc:
        logger.info("OANDA candles failed for %s %s: %s", sym, tf, exc)
        empty["summary"] = "تعذّر جلب شموع OANDA لهذا الرمز."
        return empty

    if not candles:
        empty["summary"] = "لا تتوفر بيانات شموع من OANDA لهذا الرمز."
        return empty

    closes = [c.close for c in candles]
    price = closes[-1]
    rsi14 = ind.rsi(closes, 14)
    sma20 = ind.sma(closes, 20)
    sma50 = ind.sma(closes, 50)
    ema20 = ind.ema(closes, 20)
    macd = ind.macd(closes)
    atr14 = ind.atr([ind.Candle(high=c.high, low=c.low, close=c.close) for c in candles], 14)

    # 24h high/low + change from candles within the trailing 24h window.
    now_ms = candles[-1].time
    day_ago = now_ms - 24 * 60 * 60 * 1000
    window = [c for c in candles if c.time >= day_ago] or candles
    high24 = max(c.high for c in window)
    low24 = min(c.low for c in window)
    ref = window[0].open or window[0].close
    change_pct = ((price - ref) / ref * 100) if ref else 0.0
    trend = _trend(ema20, sma50, price)

    parts = [f"السعر الحالي {price:g}"]
    if change_pct:
        parts.append(f"تغيّر 24س {'+' if change_pct >= 0 else ''}{change_pct:.2f}%")
    if rsi14 is not None:
        parts.append(f"RSI {rsi14:.0f}")
    parts.append({"uptrend": "اتجاه صاعد", "downtrend": "اتجاه هابط", "sideways": "عرضي"}[trend])

    return {
        "symbol": sym, "interval": tf, "price": price,
        "change24hPct": round(change_pct, 4),
        "high24h": high24, "low24h": low24,
        "rsi14": rsi14, "sma20": sma20, "sma50": sma50, "ema20": ema20,
        "macd": asdict(macd) if macd else None,
        "atr14": atr14, "trend": trend,
        "summary": " · ".join(parts), "candleCount": len(candles),
    }
