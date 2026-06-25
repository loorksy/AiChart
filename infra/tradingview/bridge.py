#!/usr/bin/env python3
"""TradingView TA bridge — JSON CLI for AiChart runMarketAnalyze."""
from __future__ import annotations

import json
import re
import sys
import time
from typing import Any

_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_TTL_SEC = 60


def _cache_key(exchange: str, symbol: str, interval: str) -> str:
    return f"{exchange}:{symbol}:{interval}"


def _get_cached(key: str) -> dict[str, Any] | None:
    entry = _CACHE.get(key)
    if not entry:
        return None
    ts, data = entry
    if time.time() - ts > _TTL_SEC:
        del _CACHE[key]
        return None
    return data


def _set_cache(key: str, data: dict[str, Any]) -> None:
    _CACHE[key] = (time.time(), data)


# Precious-metal ISO bases — quoted in USD and routed to OANDA on TradingView.
# (The only special case: metals aren't currencies and need a different exchange.)
_METAL_BASES = {"XAU", "XAG", "XPT", "XPD"}
# Broker word-aliases some platforms use instead of the ISO pair.
_METAL_WORDS = {"GOLD": "XAUUSD", "SILVER": "XAGUSD", "SILV": "XAGUSD"}


def _clean(sym: str) -> str:
    """Uppercase and drop broker separators/suffix punctuation (. _ - space)."""
    return re.sub(r"[^A-Z0-9]", "", sym.upper())


def _map_forex(sym: str) -> tuple[str, str]:
    s = _clean(sym)
    # Broker word-aliases for metals (GOLD, SILVER) before the ISO-pair rule.
    for word, tv in _METAL_WORDS.items():
        if s.startswith(word):
            return "OANDA", tv
    # Universal convention: every forex/metal symbol begins with a 6-char ISO pair
    # (3-letter BASE + 3-letter QUOTE); any trailing chars are a broker suffix.
    # No currency whitelist — this resolves ALL pairs: majors, minors and exotics
    # (EURTRY, USDMXN, EURPLN, USDZAR, ...).
    if len(s) >= 6 and s[:6].isalpha():
        pair = s[:6]
        base, quote = pair[:3], pair[3:]
        if base in _METAL_BASES:
            return "OANDA", pair
        # USD-quoted majors resolve best on OANDA; route the rest to FX (broad coverage).
        return ("OANDA" if quote == "USD" else "FX"), pair
    return "FX", s


def _map_crypto(sym: str) -> tuple[str, str]:
    s = _clean(sym)
    if s.endswith("USDT"):
        return "BINANCE", s
    base = s.replace("USDT", "").replace("USD", "") or s
    return "BINANCE", f"{base}USDT"


def map_symbol(market: str, symbol: str) -> tuple[str, str]:
    """Normalize an account/broker symbol to a TradingView (exchange, ticker) pair.

    Works for every market and pair: strips broker suffixes (XAUUSDm, EURUSD.r,
    GBPJPY_i) so the symbol resolves on TradingView regardless of the broker.
    """
    if market == "forex":
        return _map_forex(symbol)
    return _map_crypto(symbol)


def map_interval(interval: str) -> str:
    mapping = {
        "1m": "1m",
        "5m": "5m",
        "15m": "15m",
        "30m": "30m",
        "1h": "1h",
        "2h": "2h",
        "4h": "4h",
        "1d": "1d",
        "1w": "1W",
    }
    return mapping.get(interval, "1h")


def fetch_ta(exchange: str, symbol: str, interval: str) -> dict[str, Any]:
    key = _cache_key(exchange, symbol, interval)
    cached = _get_cached(key)
    if cached:
        return cached

    try:
        from tradingview_ta import TA_Handler, Interval
    except ImportError:
        return {"ok": False, "error": "tradingview_ta not installed"}

    interval_map = {
        "1m": Interval.INTERVAL_1_MINUTE,
        "5m": Interval.INTERVAL_5_MINUTES,
        "15m": Interval.INTERVAL_15_MINUTES,
        "30m": Interval.INTERVAL_30_MINUTES,
        "1h": Interval.INTERVAL_1_HOUR,
        "2h": Interval.INTERVAL_2_HOURS,
        "4h": Interval.INTERVAL_4_HOURS,
        "1d": Interval.INTERVAL_1_DAY,
        "1w": Interval.INTERVAL_1_WEEK,
    }
    tv_interval = interval_map.get(interval, Interval.INTERVAL_1_HOUR)
    screener = "crypto" if exchange == "BINANCE" else "forex"

    try:
        handler = TA_Handler(
            symbol=symbol,
            exchange=exchange,
            screener=screener,
            interval=tv_interval,
            timeout=10,
        )
        analysis = handler.get_analysis()
        summary = analysis.summary if analysis else {}
        indicators = analysis.indicators if analysis else {}
        payload = {
            "ok": True,
            "exchange": exchange,
            "symbol": symbol,
            "interval": interval,
            "recommendation": summary.get("RECOMMENDATION"),
            "buy": summary.get("BUY"),
            "sell": summary.get("SELL"),
            "neutral": summary.get("NEUTRAL"),
            "rsi": indicators.get("RSI"),
            "macd": indicators.get("MACD.macd"),
            "macd_signal": indicators.get("MACD.signal"),
            "ema20": indicators.get("EMA20"),
            "ema50": indicators.get("EMA50"),
            "sma20": indicators.get("SMA20"),
            "sma50": indicators.get("SMA50"),
            "close": indicators.get("close"),
            "bb_upper": indicators.get("BB.upper"),
            "bb_lower": indicators.get("BB.lower"),
        }
        _set_cache(key, payload)
        return payload
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc), "exchange": exchange, "symbol": symbol}


def multi_timeframe(market: str, symbol: str, base_interval: str) -> dict[str, Any]:
    exchange, tv_symbol = map_symbol(market, symbol)
    frames = ["15m", "1h", "4h", "1d"]
    if base_interval not in frames:
        frames.insert(0, base_interval)
    seen: set[str] = set()
    order: list[str] = []
    for f in frames:
        if f not in seen:
            seen.add(f)
            order.append(f)

    results: dict[str, Any] = {}
    for fr in order:
        results[fr] = fetch_ta(exchange, tv_symbol, fr)

    recs = [
        results[f]["recommendation"]
        for f in order
        if results.get(f, {}).get("ok") and results[f].get("recommendation")
    ]
    bullish = sum(1 for r in recs if r in ("BUY", "STRONG_BUY"))
    bearish = sum(1 for r in recs if r in ("SELL", "STRONG_SELL"))

    alignment = "mixed"
    if bullish >= 3 and bearish == 0:
        alignment = "bullish"
    elif bearish >= 3 and bullish == 0:
        alignment = "bearish"
    elif bullish > bearish:
        alignment = "lean_bullish"
    elif bearish > bullish:
        alignment = "lean_bearish"

    return {
        "ok": True,
        "symbol": tv_symbol,
        "exchange": exchange,
        "alignment": alignment,
        "frames": results,
    }


def main() -> None:
    if len(sys.argv) < 4:
        print(
            json.dumps(
                {"ok": False, "error": "usage: bridge.py <market> <symbol> <interval>"}
            )
        )
        sys.exit(1)

    market = sys.argv[1].lower()
    symbol = sys.argv[2].upper()
    interval = sys.argv[3]

    exchange, tv_symbol = map_symbol(market, symbol)
    iv = map_interval(interval)

    primary = fetch_ta(exchange, tv_symbol, iv)
    mtf = multi_timeframe(market, symbol, iv)

    out = {
        "ok": primary.get("ok", False) or any(
            f.get("ok") for f in mtf.get("frames", {}).values()
        ),
        "market": market,
        "symbol": symbol,
        "interval": interval,
        "primary": primary,
        "multiTimeframe": mtf,
    }
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
