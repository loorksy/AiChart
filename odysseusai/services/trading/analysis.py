"""Deterministic market analysis → a verdict card the UI and agent share.

This is the cheap, in-code "monitoring layer" verdict: regime → momentum →
structure → levels → R:R, built from OHLC + indicators (never from a chart
image — Vision is report-only per the product spec). The LLM agent can layer
richer reasoning on top in a later phase; this gives an honest, reproducible
baseline card with concrete entry/SL/TP so the semi-auto flow has something to
propose.
"""

from __future__ import annotations

from typing import Any

from . import market as mk


def _confluences(snap: dict[str, Any]) -> tuple[str, list[str]]:
    """Derive a direction and the list of supporting confluences."""
    trend = snap.get("trend")
    rsi = snap.get("rsi14")
    macd = snap.get("macd") or {}
    price = snap.get("price") or 0
    ema20 = snap.get("ema20")
    reasons: list[str] = []
    bull = 0
    bear = 0

    if trend == "uptrend":
        bull += 1
        reasons.append("الاتجاه العام صاعد (السعر فوق EMA20 وSMA50)")
    elif trend == "downtrend":
        bear += 1
        reasons.append("الاتجاه العام هابط (السعر تحت EMA20 وSMA50)")

    if isinstance(rsi, (int, float)):
        if rsi >= 55:
            bull += 1
            reasons.append(f"الزخم إيجابي (RSI {rsi:.0f})")
        elif rsi <= 45:
            bear += 1
            reasons.append(f"الزخم سلبي (RSI {rsi:.0f})")
        if rsi >= 70:
            reasons.append("تحذير: RSI في منطقة تشبّع شرائي")
        elif rsi <= 30:
            reasons.append("تحذير: RSI في منطقة تشبّع بيعي")

    hist = macd.get("histogram")
    if isinstance(hist, (int, float)):
        if hist > 0:
            bull += 1
            reasons.append("MACD فوق خط الإشارة (زخم صاعد)")
        elif hist < 0:
            bear += 1
            reasons.append("MACD تحت خط الإشارة (زخم هابط)")

    if isinstance(ema20, (int, float)) and price:
        if price > ema20:
            reasons.append("السعر يتداول فوق EMA20")
        else:
            reasons.append("السعر يتداول تحت EMA20")

    if bull > bear:
        return "buy", reasons
    if bear > bull:
        return "sell", reasons
    return "neutral", reasons


async def build_analysis(owner: str, symbol: str, interval: str = "15m") -> dict[str, Any]:
    """Return a structured verdict card for ``symbol``/``interval``."""
    snap = await mk.market_snapshot(owner, symbol, interval)
    price = snap.get("price") or 0
    atr = snap.get("atr14")
    direction, reasons = _confluences(snap)

    entry: float | None = None
    stop_loss: float | None = None
    take_profit: float | None = None
    reward_risk: float | None = None
    cancellation: float | None = None

    # Concrete ATR-based levels (1.5R stop, 3R target -> R:R 2). Only produced
    # for a directional verdict with real price + volatility.
    if direction in ("buy", "sell") and price and isinstance(atr, (int, float)) and atr > 0:
        entry = price
        risk = 1.5 * atr
        reward = 3.0 * atr
        if direction == "buy":
            stop_loss = entry - risk
            take_profit = entry + reward
        else:
            stop_loss = entry + risk
            take_profit = entry - reward
        cancellation = stop_loss
        reward_risk = round(reward / risk, 2) if risk else None

    # Confidence heuristic: number of aligned confluences, capped. Never a
    # hard execution gate — the Risk Guard is the only execution authority.
    aligned = sum(
        1 for r in reasons
        if ("صاعد" in r or "إيجابي" in r) == (direction == "buy")
        and "تحذير" not in r
    )
    confidence = min(90, 45 + aligned * 12) if direction != "neutral" else 0

    verdict = {
        "buy": "شراء", "sell": "بيع", "neutral": "حياد — ننتظر فرصة أوضح",
    }[direction]

    return {
        "symbol": snap.get("symbol", symbol.upper()),
        "interval": snap.get("interval", interval),
        "direction": direction,
        "verdict": verdict,
        "price": price,
        "entry": entry,
        "stop_loss": stop_loss,
        "take_profit": take_profit,
        "reward_risk": reward_risk,
        "confidence": confidence,
        "cancellation": cancellation,
        "reasons": reasons,
        "snapshot": snap,
        "note": "تحليل حتمي مبني على OHLC والمؤشرات (البصر للتقارير فقط، ليس لقرار التنفيذ).",
    }
