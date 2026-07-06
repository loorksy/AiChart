"""Trade journal + performance analytics — the learning surface.

Derives per-user performance from closed trades so the agent (and the user)
can see what's actually working: win rate, profit factor, average R:R, best
symbols/timeframes. This is the deterministic foundation the agent reasons
over for post-trade review; heavier ML can layer on later.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from . import store
from .risk import compute_reward_risk


def performance_stats(owner: str) -> dict[str, Any]:
    """Aggregate performance metrics from the user's closed trades."""
    trades = [t for t in store.list_trades(owner, status="closed", limit=1000) if t.get("pnl") is not None]
    if not trades:
        return {"trades": 0, "message": "لا صفقات مغلقة بعد."}

    wins = [t for t in trades if (t["pnl"] or 0) > 0]
    losses = [t for t in trades if (t["pnl"] or 0) < 0]
    gross_win = sum(t["pnl"] for t in wins)
    gross_loss = -sum(t["pnl"] for t in losses)
    total_pnl = sum(t["pnl"] or 0 for t in trades)

    by_symbol: dict[str, dict[str, float]] = defaultdict(lambda: {"trades": 0, "pnl": 0.0, "wins": 0})
    planned_rr: list[float] = []
    for t in trades:
        s = by_symbol[t["symbol"]]
        s["trades"] += 1
        s["pnl"] += t["pnl"] or 0
        if (t["pnl"] or 0) > 0:
            s["wins"] += 1
        rr = compute_reward_risk(t.get("entry"), t.get("stop_loss"), t.get("take_profit"))
        if rr is not None:
            planned_rr.append(rr)

    best_symbol = max(by_symbol.items(), key=lambda kv: kv[1]["pnl"])[0] if by_symbol else None

    return {
        "trades": len(trades),
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": round(len(wins) / len(trades), 4),
        "profit_factor": round((gross_win / gross_loss) if gross_loss > 0 else (gross_win or 0.0), 3),
        "total_pnl": round(total_pnl, 2),
        "avg_pnl": round(total_pnl / len(trades), 2),
        "avg_planned_rr": round(sum(planned_rr) / len(planned_rr), 3) if planned_rr else None,
        "best_symbol": best_symbol,
        "by_symbol": {k: {"trades": v["trades"], "pnl": round(v["pnl"], 2),
                          "win_rate": round(v["wins"] / v["trades"], 3) if v["trades"] else 0}
                      for k, v in by_symbol.items()},
    }


def post_trade_review(owner: str, trade: dict[str, Any]) -> dict[str, Any]:
    """A short, deterministic review line for a just-closed trade."""
    pnl = trade.get("pnl") or 0
    rr = compute_reward_risk(trade.get("entry"), trade.get("stop_loss"), trade.get("take_profit"))
    verdict = "ربح" if pnl > 0 else ("خسارة" if pnl < 0 else "تعادل")
    lesson = (
        "الصفقة احترمت الخطة." if pnl > 0
        else "أصابنا الوقف — راجع جودة الدخول والتوقيت." if pnl < 0
        else "خرجت عند التعادل."
    )
    return {
        "symbol": trade.get("symbol"),
        "outcome": verdict,
        "pnl": round(pnl, 2),
        "planned_rr": rr,
        "lesson": lesson,
    }
