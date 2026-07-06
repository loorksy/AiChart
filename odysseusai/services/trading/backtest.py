"""Internal backtesting — validate the deterministic strategy (and any agent
tweak to it) on historical OANDA candles before it touches live money.

The strategy is the same ``_confluences`` verdict used live: at each bar we
build indicators on the window up to that bar, take a directional signal, enter
at the close with ATR-based SL/TP, then walk forward bar-by-bar to see whether
the target or the stop is hit first (worst-case: if a single bar spans both, the
stop is assumed first). Positions are sequential (no overlap).

Metrics: trades, win rate, profit factor, average R:R, max drawdown (in R),
and the best symbol/timeframe when scanning multiple.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Sequence

from . import indicators as ind
from .analysis import _confluences


@dataclass
class BacktestResult:
    symbol: str
    interval: str
    trades: int
    wins: int
    losses: int
    win_rate: float
    profit_factor: float
    avg_rr: float
    max_drawdown: float  # in R units
    net_r: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol, "interval": self.interval,
            "trades": self.trades, "wins": self.wins, "losses": self.losses,
            "win_rate": round(self.win_rate, 4), "profit_factor": round(self.profit_factor, 3),
            "avg_rr": round(self.avg_rr, 3), "max_drawdown": round(self.max_drawdown, 3),
            "net_r": round(self.net_r, 3),
        }


def _snapshot(window: Sequence[Any]) -> dict[str, Any]:
    closes = [c.close for c in window]
    price = closes[-1]
    ema20 = ind.ema(closes, 20)
    sma50 = ind.sma(closes, 50)
    trend = "sideways"
    if ema20 is not None and sma50 is not None and price:
        if price > ema20 > sma50:
            trend = "uptrend"
        elif price < ema20 < sma50:
            trend = "downtrend"
    macd = ind.macd(closes)
    return {
        "trend": trend,
        "rsi14": ind.rsi(closes, 14),
        "macd": {"histogram": macd.histogram} if macd else {},
        "price": price,
        "ema20": ema20,
    }


def backtest(
    candles: Sequence[Any],
    symbol: str = "",
    interval: str = "",
    *,
    warmup: int = 60,
    atr_period: int = 14,
    risk_mult: float = 1.5,
    reward_mult: float = 3.0,
) -> BacktestResult:
    """Run the strategy over ``candles`` (each needs .open/.high/.low/.close)."""
    n = len(candles)
    r_multiples: list[float] = []
    wins = losses = 0
    i = warmup
    while i < n - 1:
        window = candles[: i + 1]
        atr = ind.atr(window, atr_period)
        if atr is None or atr <= 0:
            i += 1
            continue
        direction, _ = _confluences(_snapshot(window))
        if direction not in ("buy", "sell"):
            i += 1
            continue
        entry = candles[i].close
        risk = risk_mult * atr
        reward = reward_mult * atr
        if direction == "buy":
            sl, tp = entry - risk, entry + reward
        else:
            sl, tp = entry + risk, entry - reward
        # Walk forward until SL or TP is hit.
        outcome = None
        j = i + 1
        while j < n:
            hi, lo = candles[j].high, candles[j].low
            if direction == "buy":
                hit_sl, hit_tp = lo <= sl, hi >= tp
            else:
                hit_sl, hit_tp = hi >= sl, lo <= tp
            if hit_sl and hit_tp:
                outcome = -1.0  # worst-case: stop first
                break
            if hit_sl:
                outcome = -1.0
                break
            if hit_tp:
                outcome = reward / risk  # R multiple won
                break
            j += 1
        if outcome is None:
            break  # ran out of data with an open position
        r_multiples.append(outcome)
        if outcome > 0:
            wins += 1
        else:
            losses += 1
        i = j + 1  # sequential: next signal after this trade closes

    trades = len(r_multiples)
    win_rate = wins / trades if trades else 0.0
    gross_win = sum(r for r in r_multiples if r > 0)
    gross_loss = -sum(r for r in r_multiples if r < 0)
    profit_factor = (gross_win / gross_loss) if gross_loss > 0 else (gross_win if gross_win else 0.0)
    avg_rr = (sum(r_multiples) / trades) if trades else 0.0

    # Max drawdown on the cumulative-R equity curve.
    equity = 0.0
    peak = 0.0
    max_dd = 0.0
    for r in r_multiples:
        equity += r
        peak = max(peak, equity)
        max_dd = max(max_dd, peak - equity)

    return BacktestResult(
        symbol=symbol, interval=interval, trades=trades, wins=wins, losses=losses,
        win_rate=win_rate, profit_factor=profit_factor, avg_rr=avg_rr,
        max_drawdown=max_dd, net_r=sum(r_multiples),
    )


async def backtest_symbol(owner: str, symbol: str, interval: str = "15m", count: int = 500) -> dict[str, Any]:
    """Fetch OANDA candles and backtest the strategy on them."""
    from .market import OandaClient

    client = OandaClient.for_user(owner)
    if not client.configured:
        return {"error": "OANDA غير مُهيّأ — لا يمكن التحقّق التاريخي بدون بيانات."}
    candles = await client.fetch_candles(symbol, interval, count)
    if len(candles) < 80:
        return {"error": "بيانات تاريخية غير كافية للاختبار."}
    return backtest(candles, symbol.upper(), interval).to_dict()
