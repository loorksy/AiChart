"""Level ladders for all four bot types — grid, DCA, martingale, layered
martingale — and the payload normalization that guards them.

Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger), Copyright
Open Byte Inc., licensed under the Apache License, Version 2.0
(http://www.apache.org/licenses/LICENSE-2.0). Source:
`backend_api_python/app/services/strategy_runtime/executors.py` — `_ratio`,
`_bool`, `_ratio_list`, `_side`, `_market_type`, `_timeframe_minutes`,
`_basket_take_profit_price`, `ExecutorLevel`, `ExecutorPreview`,
`_martingale_hard_stop_diagnostics`, `_trailing_take_profit_config`,
`_equity_risk_config`, `normalize_executor_payload` and all four `_preview_*`
functions.

Changed on port: `build_executor_strategy_payload` and `_executor_code` are NOT
ported. The first mints exchange credentials and a live deployment row; the
second generates Python source for a trading runtime that does not exist here.
What remains is the pure half — a config dict in, a ladder of levels and a list
of warnings out — which is exactly the half a simulation and a preview UI need.
Two live-only gates travel with it because they are config validation rather
than execution: `MAX_GRID_CELLS` and `BLOCKING_PREVIEW_WARNINGS`.

`trend` is absent on purpose. Upstream lists it in `KNOWN_BOT_TYPES` and in the
recommender's prompt, but no code anywhere consumes `maPeriod`/`maType`/
`confirmBars`/`positionPct` — it is a parameter schema with no engine. Offering
it here would be offering a bot that cannot run.

Note the two percent conventions, which are NOT interchangeable and are both
reproduced:

  * `config.pct` (grid `bot_params`) clamps negatives to 0.
  * `ratio` here does not clamp; every caller wraps it in `max(0.0, ...)`
    individually, and one upstream caller deliberately does not.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.engine.bots.config import to_float, to_int
from app.engine.bots.levels import grid_points

EXECUTOR_TYPES = ("grid", "dca", "martingale", "layered_martingale")
MAX_GRID_CELLS = 200
MIN_INITIAL_CAPITAL = 10.0
MAX_INITIAL_CAPITAL = 1_000_000.0

#: A preview warning in this set means the config cannot be deployed at all.
BLOCKING_PREVIEW_WARNINGS = frozenset(
    {
        "invalid_price_bounds",
        "neutral_grid_anchor_outside_bounds",
        "missing_dca_budget",
        "missing_entry_price",
        "missing_base_order_size",
        "invalid_trailing_take_profit",
        "invalid_equity_trailing_take_profit",
    }
)


def to_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return bool(default)
    if isinstance(value, bool):
        return value
    if isinstance(value, int | float):
        return bool(value)
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def ratio(value: Any, default: float = 0.0) -> float:
    """`> 1 → /100`. Unlike `config.pct`, negatives are NOT clamped here."""
    out = to_float(value, default)
    if abs(out) > 1:
        out = out / 100.0
    return out


def ratio_list(value: Any, defaults: list[float], *, expected: int = 0) -> list[float]:
    """A list of ratios, padded by repeating the last element and truncated to
    `expected`. Accepts a list, a tuple, or a comma-separated string."""
    raw_values: list[Any]
    if isinstance(value, list | tuple):
        raw_values = list(value)
    elif isinstance(value, str) and value.strip():
        raw_values = [part.strip() for part in value.split(",") if part.strip()]
    else:
        raw_values = []
    out = [ratio(item, 0.0) for item in raw_values]
    if not out:
        out = list(defaults)
    target = max(0, int(expected or 0))
    if target > 0:
        if not out:
            out = [0.0]
        while len(out) < target:
            out.append(out[-1])
        out = out[:target]
    return [max(0.0, float(item or 0.0)) for item in out]


def normalize_side(value: Any, *, allow_neutral: bool = False) -> str:
    out = str(value or "long").strip().lower()
    if allow_neutral and out == "neutral":
        return "neutral"
    return "short" if out == "short" else "long"


def normalize_market_type(value: Any) -> str:
    out = str(value or "swap").strip().lower()
    if out in ("future", "futures", "perp", "perpetual"):
        return "swap"
    return "spot" if out == "spot" else "swap"


def timeframe_minutes(value: Any) -> int:
    text = str(value or "1m").strip().lower()
    units = {"m": 1, "h": 60, "d": 1440, "w": 10080}
    try:
        amount = int(text[:-1])
    except (TypeError, ValueError):
        return 1
    return max(1, amount * units.get(text[-1:], 1))


def basket_take_profit_price(
    *, total_quote: float, total_quantity: float, side: str, take_profit: float
) -> float:
    """The price at which the WHOLE accumulated basket clears `take_profit`."""
    if total_quote <= 0 or total_quantity <= 0:
        return 0.0
    average_price = total_quote / total_quantity
    if side == "short":
        return average_price * (1.0 - take_profit)
    return average_price * (1.0 + take_profit)


def trailing_take_profit_config(
    cfg: dict[str, Any], *, default_activation: float
) -> dict[str, Any]:
    activation_raw = (
        cfg.get("trailing_activation_pct")
        if "trailing_activation_pct" in cfg
        else cfg.get("trailingActivationPct")
    )
    callback_raw = (
        cfg.get("trailing_callback_pct")
        if "trailing_callback_pct" in cfg
        else cfg.get("trailingCallbackPct")
    )
    enabled = to_bool(
        cfg.get("trailing_take_profit_enabled")
        if "trailing_take_profit_enabled" in cfg
        else cfg.get("trailingTakeProfitEnabled"),
        True,
    )
    return {
        "trailing_take_profit_enabled": enabled,
        "trailing_activation_pct": max(0.0, ratio(activation_raw, default_activation)),
        "trailing_callback_pct": max(0.0, ratio(callback_raw, 0.002)),
    }


def equity_risk_config(cfg: dict[str, Any], *, legacy_grid_fields: bool = False) -> dict[str, Any]:
    """Strategy-wide limits measured against STARTING EQUITY, so they include
    realized PnL, unrealized PnL and fees — not just one open cycle."""
    take_profit_raw = (
        cfg.get("equity_take_profit_pct")
        if "equity_take_profit_pct" in cfg
        else cfg.get("equityTakeProfitPct")
    )
    stop_loss_raw = (
        cfg.get("equity_stop_loss_pct")
        if "equity_stop_loss_pct" in cfg
        else cfg.get("equityStopLossPct")
    )
    if legacy_grid_fields and take_profit_raw is None:
        take_profit_raw = (
            cfg.get("take_profit_pct") if "take_profit_pct" in cfg else cfg.get("takeProfitPct")
        )
    if legacy_grid_fields and stop_loss_raw is None:
        stop_loss_raw = (
            cfg.get("hard_stop_pct") if "hard_stop_pct" in cfg else cfg.get("hardStopPct")
        )
    enabled = to_bool(
        cfg.get("equity_trailing_enabled")
        if "equity_trailing_enabled" in cfg
        else cfg.get("equityTrailingEnabled"),
        True,
    )
    activation = max(
        0.0,
        ratio(
            cfg.get("equity_trailing_activation_pct")
            if "equity_trailing_activation_pct" in cfg
            else cfg.get("equityTrailingActivationPct"),
            0.05,
        ),
    )
    callback = max(
        0.0,
        ratio(
            cfg.get("equity_trailing_callback_pct")
            if "equity_trailing_callback_pct" in cfg
            else cfg.get("equityTrailingCallbackPct"),
            0.03,
        ),
    )
    return {
        "equity_take_profit_pct": max(0.0, ratio(take_profit_raw, 0.10)),
        "equity_stop_loss_pct": max(0.0, ratio(stop_loss_raw, 0.06)),
        "equity_trailing_enabled": enabled,
        "equity_trailing_activation_pct": activation,
        "equity_trailing_callback_pct": callback,
    }


def _trailing_invalid(trailing: dict[str, Any]) -> bool:
    return bool(trailing["trailing_take_profit_enabled"]) and (
        trailing["trailing_activation_pct"] <= 0
        or trailing["trailing_callback_pct"] <= 0
        or trailing["trailing_callback_pct"] >= trailing["trailing_activation_pct"]
    )


def _equity_trailing_invalid(equity: dict[str, Any]) -> bool:
    return bool(equity["equity_trailing_enabled"]) and (
        equity["equity_trailing_activation_pct"] <= 0
        or equity["equity_trailing_callback_pct"] <= 0
        or equity["equity_trailing_callback_pct"] >= equity["equity_trailing_activation_pct"]
    )


@dataclass
class ExecutorLevel:
    level: int
    action: str
    side: str
    price: float
    amount_quote: float
    take_profit_price: float = 0.0
    trigger_pct: float = 0.0
    state: str = "not_active"
    layer_index: int = 0
    order_index: int = 0
    scheduled_offset_minutes: int = 0
    cumulative_amount_quote: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "level": self.level,
            "layer_index": self.layer_index or self.level,
            "order_index": self.order_index or 1,
            "action": self.action,
            "side": self.side,
            "price": round(float(self.price or 0.0), 8),
            "amount_quote": round(float(self.amount_quote or 0.0), 8),
            "take_profit_price": round(float(self.take_profit_price or 0.0), 8),
            "trigger_pct": round(float(self.trigger_pct or 0.0), 8),
            "state": self.state,
        }
        if self.scheduled_offset_minutes:
            payload["scheduled_offset_minutes"] = int(self.scheduled_offset_minutes)
        if self.cumulative_amount_quote:
            payload["cumulative_amount_quote"] = round(float(self.cumulative_amount_quote), 8)
        return payload


@dataclass
class ExecutorPreview:
    executor_type: str
    config: dict[str, Any]
    levels: list[ExecutorLevel] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    risk_diagnostics: list[dict[str, Any]] = field(default_factory=list)

    @property
    def blocking_warning(self) -> str:
        for item in self.warnings:
            if str(item) in BLOCKING_PREVIEW_WARNINGS:
                return str(item)
        return ""

    def to_dict(self) -> dict[str, Any]:
        long_levels = [level for level in self.levels if level.side == "long"]
        short_levels = [level for level in self.levels if level.side == "short"]
        return {
            "executor_type": self.executor_type,
            "config": dict(self.config),
            "levels": [level.to_dict() for level in self.levels],
            "warnings": list(self.warnings),
            "risk_diagnostics": [dict(item) for item in self.risk_diagnostics],
            "summary": {
                "level_count": len(self.levels),
                "total_amount_quote": round(
                    sum(level.amount_quote for level in self.levels), 8
                ),
                "long_level_count": len(long_levels),
                "short_level_count": len(short_levels),
                "long_amount_quote": round(
                    sum(level.amount_quote for level in long_levels), 8
                ),
                "short_amount_quote": round(
                    sum(level.amount_quote for level in short_levels), 8
                ),
                "first_price": round(self.levels[0].price, 8) if self.levels else 0.0,
                "last_price": round(self.levels[-1].price, 8) if self.levels else 0.0,
            },
        }


def martingale_hard_stop_diagnostics(
    levels: list[ExecutorLevel], *, hard_stop_pct: float, side: str
) -> list[dict[str, Any]]:
    """Name every level that the basket's own hard stop would close before the
    level could ever fill — the single most useful thing a martingale preview
    can tell a user."""
    stop = max(0.0, float(hard_stop_pct or 0.0))
    if stop <= 0 or len(levels) < 2:
        return []
    cumulative_quote = 0.0
    cumulative_quantity = 0.0
    diagnostics: list[dict[str, Any]] = []
    direction = -1.0 if str(side or "").lower() == "short" else 1.0
    for index, level in enumerate(levels[:-1]):
        price = max(0.0, float(level.price or 0.0))
        quote = max(0.0, float(level.amount_quote or 0.0))
        cumulative_quote += quote
        if price > 0:
            cumulative_quantity += quote / price
        if cumulative_quote <= 0 or cumulative_quantity <= 0:
            continue
        average = cumulative_quote / cumulative_quantity
        next_level = levels[index + 1]
        next_price = max(0.0, float(next_level.price or 0.0))
        stop_price = average * (1.0 - stop if direction > 0 else 1.0 + stop)
        conflicts = next_price <= stop_price if direction > 0 else next_price >= stop_price
        if not conflicts:
            continue
        required = abs(next_price / average - 1.0) if average > 0 else 0.0
        diagnostics.append(
            {
                "code": "hard_stop_blocks_level",
                "before_level": int(next_level.level),
                "basket_average": round(average, 8),
                "hard_stop_price": round(stop_price, 8),
                "next_level_price": round(next_price, 8),
                "configured_stop_pct": round(stop, 8),
                "required_stop_pct": round(required, 8),
                # A display suggestion with 0.5% room for fees and slippage.
                "suggested_stop_pct": round(min(1.0, required + 0.005), 8),
            }
        )
    return diagnostics


def normalize_executor_payload(payload: dict[str, Any]) -> dict[str, Any]:
    raw = dict(payload) if isinstance(payload, dict) else {}
    executor_type = str(raw.get("executor_type") or raw.get("type") or "grid").strip().lower()
    if executor_type not in EXECUTOR_TYPES:
        raise ValueError(f"unsupported_executor_type:{executor_type}")
    symbol = str(raw.get("symbol") or "BTC/USDT").strip() or "BTC/USDT"
    market_type = normalize_market_type(raw.get("market_type") or raw.get("marketType"))
    side = normalize_side(raw.get("side"), allow_neutral=executor_type == "grid")
    if executor_type == "dca":
        market_type = "spot"
        side = "long"
        raw["timeframe"] = "1H"
    if side == "neutral" and market_type == "spot":
        raise ValueError("NEUTRAL_GRID_REQUIRES_SWAP")
    leverage = 1 if executor_type == "dca" else max(1, to_int(raw.get("leverage"), 1))
    # `execution_mode` is coerced, never raised on — and in this service it can
    # only ever be "signal": there is no live path to select. The field is kept
    # so a config round-trips unchanged, not because it selects anything.
    execution_mode = str(
        raw.get("execution_mode") or raw.get("executionMode") or "signal"
    ).strip().lower()
    if execution_mode != "signal":
        execution_mode = "signal"
    return {
        **raw,
        "executor_type": executor_type,
        "symbol": symbol,
        "side": side,
        "market_type": market_type,
        "leverage": leverage,
        "execution_mode": execution_mode,
    }


def preview_grid(cfg: dict[str, Any]) -> ExecutorPreview:
    start = to_float(cfg.get("start_price") or cfg.get("startPrice"), 0.0)
    end = to_float(cfg.get("end_price") or cfg.get("endPrice"), 0.0)
    count = max(2, to_int(cfg.get("grid_count") or cfg.get("gridCount"), 2))
    if count > MAX_GRID_CELLS:
        raise ValueError("GRID_COUNT_EXCEEDS_SAFE_LIMIT")
    total = max(
        0.0, to_float(cfg.get("total_amount_quote") or cfg.get("totalAmountQuote"), float(count))
    )
    side = cfg["side"]
    mode = str(cfg.get("grid_mode") or cfg.get("gridMode") or "arithmetic").strip().lower()
    equity_risk = equity_risk_config(cfg, legacy_grid_fields=True)
    warnings: list[str] = []
    if start <= 0 or end <= 0 or start == end:
        warnings.append("invalid_price_bounds")
    low, high = sorted([start, end])
    dynamic_anchor = bool(cfg.get("dynamic_anchor"))
    reference = 1.0 if dynamic_anchor and low < 1.0 < high else (low + high) / 2.0
    levels: list[ExecutorLevel] = []

    if side == "neutral":
        # Both legs must get the same cell count and the same budget; an odd
        # count cannot satisfy that, so it is rounded up.
        if count % 2:
            count += 1
            warnings.append("neutral_grid_count_adjusted_even")
        if not low < reference < high:
            warnings.append("neutral_grid_anchor_outside_bounds")
            reference = (low + high) / 2.0
        leg_count = count // 2
        long_points = grid_points(low, reference, leg_count, mode)
        short_points = grid_points(reference, high, leg_count, mode)
        long_amount = total * 0.5 / max(1, leg_count)
        short_amount = total * 0.5 / max(1, leg_count)

        # Nearest cells first — the order a resting engine arms them in.
        long_cells = list(zip(long_points[:-1], long_points[1:], strict=True))
        for entry, exit_price in reversed(long_cells):
            levels.append(
                ExecutorLevel(
                    len(levels) + 1,
                    "open",
                    "long",
                    entry,
                    long_amount,
                    exit_price,
                    abs(entry / reference - 1.0),
                )
            )
        for exit_price, entry in zip(short_points[:-1], short_points[1:], strict=True):
            levels.append(
                ExecutorLevel(
                    len(levels) + 1,
                    "open",
                    "short",
                    entry,
                    short_amount,
                    exit_price,
                    abs(entry / reference - 1.0),
                )
            )
    else:
        points = grid_points(low, high, count, mode)
        cells = list(zip(points[:-1], points[1:], strict=True))
        if side == "long":
            rows = [
                (lower, upper)
                for lower, upper in cells
                if not dynamic_anchor or lower < reference
            ]
            rows.reverse()
        else:
            rows = [
                (upper, lower)
                for lower, upper in cells
                if not dynamic_anchor or upper > reference
            ]
        amount = total / max(1, len(rows))
        for entry, exit_price in rows:
            levels.append(
                ExecutorLevel(
                    len(levels) + 1,
                    "open",
                    side,
                    entry,
                    amount,
                    exit_price,
                    abs(entry / reference - 1.0) if reference > 0 else 0.0,
                )
            )

    initial_position_raw = (
        cfg.get("initial_position_pct")
        if "initial_position_pct" in cfg
        else cfg.get("initialPositionPct", 0.6)
    )
    initial_position_pct = min(1.0, max(0.0, ratio(initial_position_raw, 0.6)))
    if side == "neutral":
        initial_position_pct = 0.0
    requested_max_open_orders = max(
        1, to_int(cfg.get("max_open_orders") or cfg.get("maxOpenOrders"), 4)
    )
    max_open_orders = min(count, requested_max_open_orders)
    if requested_max_open_orders > count:
        warnings.append("max_open_orders_adjusted_to_grid_count")
    if count >= 60 or max_open_orders >= 40:
        warnings.append("high_frequency_grid_backtest_workload")
    if _equity_trailing_invalid(equity_risk):
        warnings.append("invalid_equity_trailing_take_profit")
    config = {
        "side": side,
        "market_type": cfg["market_type"],
        "start_price": low,
        "end_price": high,
        "limit_price": to_float(
            cfg.get("limit_price") or cfg.get("limitPrice"), low if side == "long" else high
        ),
        # grid_count counts tradable CELLS here; a live engine materializes
        # grid_count + 1 boundary lines from it.
        "grid_count": count,
        "grid_mode": mode if mode in ("arithmetic", "geometric") else "arithmetic",
        "total_amount_quote": total,
        "initial_position_pct": initial_position_pct,
        "grid_take_profit_mode": "adjacent_level",
        **equity_risk,
        "portfolio_take_profit_pct": equity_risk["equity_take_profit_pct"],
        "take_profit_pct": equity_risk["equity_take_profit_pct"],
        "hard_stop_pct": equity_risk["equity_stop_loss_pct"],
        "max_open_orders": max_open_orders,
        "min_spread_between_orders": max(
            0.0,
            ratio(
                cfg.get("min_spread_between_orders") or cfg.get("minSpreadBetweenOrders"), 0.0005
            ),
        ),
        "order_frequency": max(
            0, to_int(cfg.get("order_frequency") or cfg.get("orderFrequency"), 0)
        ),
    }
    return ExecutorPreview("grid", config, levels, warnings)


def preview_dca(cfg: dict[str, Any]) -> ExecutorPreview:
    entry = to_float(cfg.get("entry_price") or cfg.get("entryPrice"), 1.0)
    legacy_interval_bars = max(
        1,
        to_int(
            cfg.get("dca_interval_bars")
            or cfg.get("dcaIntervalBars")
            or cfg.get("interval_bars")
            or cfg.get("intervalBars"),
            60,
        ),
    )
    interval_minutes = max(
        1,
        to_int(
            cfg.get("dca_interval_minutes") or cfg.get("dcaIntervalMinutes"),
            legacy_interval_bars * timeframe_minutes(cfg.get("timeframe")),
        ),
    )
    max_orders = max(
        1,
        to_int(
            cfg.get("dca_max_orders")
            or cfg.get("dcaMaxOrders")
            or cfg.get("max_orders")
            or cfg.get("maxOrders")
            or cfg.get("max_layers")
            or cfg.get("maxLayers"),
            5,
        ),
    )
    total_budget_pct = min(
        1.0,
        max(
            0.0,
            ratio(
                cfg.get("dca_total_budget_pct")
                if "dca_total_budget_pct" in cfg
                else cfg.get("dcaTotalBudgetPct"),
                1.0,
            ),
        ),
    )
    price_filter_enabled = to_bool(
        cfg.get("dca_price_filter_enabled")
        if "dca_price_filter_enabled" in cfg
        else cfg.get("dcaPriceFilterEnabled"),
        False,
    )
    max_adverse_price_pct = max(
        0.0,
        ratio(
            cfg.get("dca_max_adverse_price_pct")
            if "dca_max_adverse_price_pct" in cfg
            else cfg.get("dcaMaxAdversePricePct"),
            0.05,
        ),
    )
    take_profit = max(0.0, ratio(cfg.get("take_profit_pct") or cfg.get("takeProfitPct"), 0.006))
    trailing = trailing_take_profit_config(cfg, default_activation=take_profit)
    equity_risk = equity_risk_config(cfg)
    hard_stop = max(0.0, ratio(cfg.get("hard_stop_pct") or cfg.get("hardStopPct"), 0.0))
    order_pct = total_budget_pct / max_orders
    warnings: list[str] = []
    if total_budget_pct <= 0:
        warnings.append("missing_dca_budget")
    if price_filter_enabled and entry <= 0 and not bool(cfg.get("dynamic_anchor")):
        warnings.append("missing_entry_price")
    if _trailing_invalid(trailing):
        warnings.append("invalid_trailing_take_profit")
    if _equity_trailing_invalid(equity_risk):
        warnings.append("invalid_equity_trailing_take_profit")

    levels: list[ExecutorLevel] = []
    cumulative = 0.0
    for order_index in range(1, max_orders + 1):
        cumulative += order_pct
        levels.append(
            ExecutorLevel(
                order_index,
                "open" if order_index == 1 else "add",
                cfg["side"],
                entry,
                order_pct,
                0.0,
                0.0,
                layer_index=order_index,
                order_index=order_index,
                scheduled_offset_minutes=(order_index - 1) * interval_minutes,
                cumulative_amount_quote=cumulative,
            )
        )
    config = {
        "side": cfg["side"],
        "market_type": cfg["market_type"],
        "entry_price": entry,
        "dca_interval_minutes": interval_minutes,
        "dca_max_orders": max_orders,
        "dca_total_budget_pct": total_budget_pct,
        "dca_order_pct": order_pct,
        "dca_price_filter_enabled": price_filter_enabled,
        "dca_max_adverse_price_pct": max_adverse_price_pct,
        "take_profit_pct": take_profit,
        **trailing,
        "hard_stop_pct": hard_stop,
        **equity_risk,
    }
    return ExecutorPreview("dca", config, levels, warnings)


def preview_layered_dca(cfg: dict[str, Any], kind: str) -> ExecutorPreview:
    """The martingale ladder.

    The deviation is CUMULATIVE and each step's INCREMENT is geometric in
    `step_multiplier`, while each order's SIZE is geometric in
    `volume_multiplier`. Two different multipliers on two different axes.
    """
    entry = to_float(cfg.get("entry_price") or cfg.get("entryPrice"), 0.0)
    base = max(0.0, to_float(cfg.get("base_order_size") or cfg.get("baseOrderSize"), 0.0))
    safety = max(0.0, to_float(cfg.get("safety_order_size") or cfg.get("safetyOrderSize"), base))
    max_layers = max(1, to_int(cfg.get("max_layers") or cfg.get("maxLayers"), 1))
    deviation = max(
        0.0, ratio(cfg.get("price_deviation_pct") or cfg.get("priceDeviationPct"), 0.01)
    )
    step_mult = max(1.0, to_float(cfg.get("step_multiplier") or cfg.get("stepMultiplier"), 1.0))
    volume_mult = max(
        1.0, to_float(cfg.get("volume_multiplier") or cfg.get("volumeMultiplier"), 1.0)
    )
    take_profit = max(0.0, ratio(cfg.get("take_profit_pct") or cfg.get("takeProfitPct"), 0.005))
    trailing = trailing_take_profit_config(cfg, default_activation=take_profit)
    equity_risk = equity_risk_config(cfg)
    max_entry_drift = max(
        0.0, ratio(cfg.get("max_entry_drift_pct") or cfg.get("maxEntryDriftPct"), 0.03)
    )
    side = cfg["side"]
    warnings: list[str] = []
    if entry <= 0:
        warnings.append("missing_entry_price")
    if base <= 0:
        warnings.append("missing_base_order_size")
    if _trailing_invalid(trailing):
        warnings.append("invalid_trailing_take_profit")
    if _equity_trailing_invalid(equity_risk):
        warnings.append("invalid_equity_trailing_take_profit")

    levels: list[ExecutorLevel] = []
    cumulative_deviation = 0.0
    cumulative_quote = 0.0
    cumulative_quantity = 0.0
    for layer in range(1, max_layers + 1):
        if layer == 1:
            amount = base
            price = entry
            trigger = 0.0
        else:
            trigger = deviation * (step_mult ** (layer - 2))
            cumulative_deviation += trigger
            price = (
                entry * (1.0 - cumulative_deviation)
                if side == "long"
                else entry * (1.0 + cumulative_deviation)
            )
            amount = safety * (volume_mult ** (layer - 2))
        cumulative_quote += amount
        if price > 0:
            cumulative_quantity += amount / price
        exit_reference = (
            trailing["trailing_activation_pct"]
            if trailing["trailing_take_profit_enabled"]
            else take_profit
        )
        tp = basket_take_profit_price(
            total_quote=cumulative_quote,
            total_quantity=cumulative_quantity,
            side=side,
            take_profit=exit_reference,
        )
        levels.append(
            ExecutorLevel(layer, "open" if layer == 1 else "add", side, price, amount, tp, trigger)
        )
    config = {
        "side": side,
        "market_type": cfg["market_type"],
        "entry_price": entry,
        "base_order_size": base,
        "safety_order_size": safety,
        "max_layers": max_layers,
        "price_deviation_pct": deviation,
        "step_multiplier": step_mult,
        "volume_multiplier": volume_mult,
        "take_profit_pct": take_profit,
        **trailing,
        "hard_stop_pct": max(0.0, ratio(cfg.get("hard_stop_pct") or cfg.get("hardStopPct"), 0.0)),
        **equity_risk,
        "max_entry_drift_pct": max_entry_drift,
        "restart_after_stop": to_bool(
            cfg.get("restart_after_stop")
            if "restart_after_stop" in cfg
            else cfg.get("restartAfterStop"),
            False,
        ),
        "final_level_uses_remaining_budget": True,
        "cycle_capital_fraction": 1.0,
    }
    diagnostics = martingale_hard_stop_diagnostics(
        levels, hard_stop_pct=float(config["hard_stop_pct"]), side=side
    )
    if diagnostics:
        warnings.append("hard_stop_blocks_level")
    return ExecutorPreview(kind, config, levels, warnings, diagnostics)


def preview_martingale(cfg: dict[str, Any]) -> ExecutorPreview:
    return preview_layered_dca(cfg, "martingale")


def preview_layered_martingale(cfg: dict[str, Any]) -> ExecutorPreview:
    """The layered ladder.

    READ THE SIZING LINE CAREFULLY: `amount = base * volume_mult ** (order_idx
    - 1)` depends on `order_idx` ONLY, so the volume multiplier RESTARTS at
    every layer — layer 3's first order is the same size as layer 1's first
    order. Prices, by contrast, compound continuously ACROSS layers, because
    `price` is carried over from the previous iteration and multiplied again.
    Getting these two backwards is the easiest mistake in this file.
    """
    entry = to_float(cfg.get("entry_price") or cfg.get("entryPrice"), 0.0)
    layer_count = max(1, to_int(cfg.get("layer_count") or cfg.get("layerCount"), 5))
    orders_per_layer = max(
        1, to_int(cfg.get("orders_per_layer") or cfg.get("ordersPerLayer"), 3)
    )
    base = max(0.0, to_float(cfg.get("base_order_size") or cfg.get("baseOrderSize"), 0.0))
    volume_mult = max(
        1.0, to_float(cfg.get("volume_multiplier") or cfg.get("volumeMultiplier"), 1.8)
    )
    take_profit = max(0.0, ratio(cfg.get("take_profit_pct") or cfg.get("takeProfitPct"), 0.006))
    trailing = trailing_take_profit_config(cfg, default_activation=take_profit)
    equity_risk = equity_risk_config(cfg)
    hard_stop = max(0.0, ratio(cfg.get("hard_stop_pct") or cfg.get("hardStopPct"), 0.0))
    max_entry_drift = max(
        0.0, ratio(cfg.get("max_entry_drift_pct") or cfg.get("maxEntryDriftPct"), 0.03)
    )
    side = cfg["side"]
    intra_defaults = [
        ratio(cfg.get("intra_spacing_1_pct") or cfg.get("intraSpacing1Pct"), 0.005),
        ratio(cfg.get("intra_spacing_2_pct") or cfg.get("intraSpacing2Pct"), 0.008),
    ]
    inter_defaults = [
        ratio(cfg.get("inter_spacing_1_pct") or cfg.get("interSpacing1Pct"), 0.012),
        ratio(cfg.get("inter_spacing_2_pct") or cfg.get("interSpacing2Pct"), 0.015),
        ratio(cfg.get("inter_spacing_3_pct") or cfg.get("interSpacing3Pct"), 0.018),
        ratio(cfg.get("inter_spacing_4_pct") or cfg.get("interSpacing4Pct"), 0.022),
    ]
    intra_spacings = ratio_list(
        cfg.get("intra_spacings") or cfg.get("intraSpacings"),
        intra_defaults,
        expected=max(0, orders_per_layer - 1),
    )
    inter_spacings = ratio_list(
        cfg.get("inter_spacings") or cfg.get("interSpacings"),
        inter_defaults,
        expected=max(0, layer_count - 1),
    )
    warnings: list[str] = []
    if entry <= 0:
        warnings.append("missing_entry_price")
    if base <= 0:
        warnings.append("missing_base_order_size")
    if _trailing_invalid(trailing):
        warnings.append("invalid_trailing_take_profit")
    if _equity_trailing_invalid(equity_risk):
        warnings.append("invalid_equity_trailing_take_profit")

    levels: list[ExecutorLevel] = []
    price = entry
    seq = 1
    cumulative_quote = 0.0
    cumulative_quantity = 0.0
    for layer_idx in range(1, layer_count + 1):
        for order_idx in range(1, orders_per_layer + 1):
            if seq == 1:
                price = entry
                trigger = 0.0
            elif order_idx == 1:
                spacing = (
                    inter_spacings[layer_idx - 2] if layer_idx >= 2 and inter_spacings else 0.0
                )
                price = price * (1.0 - spacing) if side == "long" else price * (1.0 + spacing)
                trigger = spacing
            else:
                spacing = intra_spacings[order_idx - 2] if intra_spacings else 0.0
                price = price * (1.0 - spacing) if side == "long" else price * (1.0 + spacing)
                trigger = spacing
            amount = base * (volume_mult ** (order_idx - 1))
            cumulative_quote += amount
            if price > 0:
                cumulative_quantity += amount / price
            exit_reference = (
                trailing["trailing_activation_pct"]
                if trailing["trailing_take_profit_enabled"]
                else take_profit
            )
            tp = basket_take_profit_price(
                total_quote=cumulative_quote,
                total_quantity=cumulative_quantity,
                side=side,
                take_profit=exit_reference,
            )
            levels.append(
                ExecutorLevel(
                    seq,
                    "open" if seq == 1 else "add",
                    side,
                    price,
                    amount,
                    tp,
                    trigger,
                    layer_index=layer_idx,
                    order_index=order_idx,
                )
            )
            seq += 1
    config = {
        "side": side,
        "market_type": cfg["market_type"],
        "entry_price": entry,
        "layer_count": layer_count,
        "orders_per_layer": orders_per_layer,
        "base_order_size": base,
        "volume_multiplier": volume_mult,
        "intra_spacings": intra_spacings,
        "inter_spacings": inter_spacings,
        "take_profit_pct": take_profit,
        **trailing,
        "hard_stop_pct": hard_stop,
        **equity_risk,
        "max_entry_drift_pct": max_entry_drift,
        "restart_after_stop": to_bool(
            cfg.get("restart_after_stop")
            if "restart_after_stop" in cfg
            else cfg.get("restartAfterStop"),
            False,
        ),
        "final_level_uses_remaining_budget": True,
        "cycle_capital_fraction": 1.0,
    }
    diagnostics = martingale_hard_stop_diagnostics(levels, hard_stop_pct=hard_stop, side=side)
    if diagnostics:
        warnings.append("hard_stop_blocks_level")
    return ExecutorPreview("layered_martingale", config, levels, warnings, diagnostics)


_PREVIEWS = {
    "grid": preview_grid,
    "dca": preview_dca,
    "martingale": preview_martingale,
    "layered_martingale": preview_layered_martingale,
}


def preview_executor(payload: dict[str, Any]) -> ExecutorPreview:
    """Normalize then preview. Raises `ValueError` with upstream's own codes."""
    cfg = normalize_executor_payload(payload)
    return _PREVIEWS[cfg["executor_type"]](cfg)


def grid_bot_params_from_executor_config(
    executor_config: dict[str, Any], *, trade_direction: str
) -> dict[str, Any]:
    """The bridge from the executor vocabulary (snake_case, cell counts) to the
    grid engine's `bot_params` vocabulary (camelCase, line counts).

    Reproduced from `build_executor_strategy_payload` exactly, including
    `gridCountUnit: "cells"` — which is the whole reason the bridge exists.
    """
    grid_count = max(2, to_int(executor_config.get("grid_count"), 2))
    total_amount = max(0.0, to_float(executor_config.get("total_amount_quote"), 0.0))
    return {
        "upperPrice": to_float(executor_config.get("end_price"), 0.0),
        "lowerPrice": to_float(executor_config.get("start_price"), 0.0),
        "gridCount": grid_count,
        "gridCountUnit": "cells",
        "amountPerGrid": total_amount / grid_count if grid_count else 0.0,
        "amountPerGridPct": 1.0 / grid_count if grid_count else 0.0,
        "gridMode": str(executor_config.get("grid_mode") or "arithmetic"),
        "gridDirection": trade_direction,
        "initialPositionPct": (
            0.0
            if trade_direction == "neutral"
            else to_float(executor_config.get("initial_position_pct"), 0.0)
        ),
        "orderMode": "maker",
        "boundaryAction": "pause",
        "maxOpenOrders": to_int(executor_config.get("max_open_orders"), 4),
        "minSpreadBetweenOrders": to_float(
            executor_config.get("min_spread_between_orders"), 0.0
        ),
        "orderFrequency": to_int(executor_config.get("order_frequency"), 0),
        "dynamicAnchor": bool(executor_config.get("dynamic_anchor")),
    }
