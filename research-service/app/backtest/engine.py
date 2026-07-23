from __future__ import annotations

import asyncio
import random
from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from app.core.ids import opaque_id
from app.jobs.cancellation import JobCancelled

from .accounting import Account
from .attribution import build_attribution
from .compiler import CompiledStrategy, compile_strategy
from .conditions import ConditionContext
from .execution import ExecutionCosts, commission, executable_fill, pnl_for_move
from .metrics import calculate_metrics
from .models import (
    BacktestResult,
    EquityPoint,
    Order,
    OrderStatus,
    OrderType,
    Position,
    PositionStatus,
    RunConfig,
    Side,
    Target,
    Trade,
)
from .orders import expire_order, order_trigger_reference
from .policies import (
    ENGINE_VERSION,
    INDICATOR_VERSION,
    TIMEFRAME_MINUTES,
    SymbolMetadata,
    forex_market_open,
    forex_session,
    normalize_symbol,
    round_lot,
    symbol_metadata,
)
from .positions import apply_pending_stop, resolve_entry_bar, resolve_intrabar, tighten_stop
from .signals import signals_at


def _enum(value: Any) -> str:
    return str(getattr(value, "value", value))


def _number(data: dict[str, Any], *names: str, default: float = 0.0) -> float:
    for name in names:
        if name in data and data[name] is not None:
            return float(data[name])
    return default


class BacktestEngine:
    def __init__(self, strategy: Any, dataset: Any, run_config: RunConfig) -> None:
        self.strategy: CompiledStrategy = compile_strategy(strategy)
        self.dataset = dataset
        self.config = run_config
        slippage_seed = int(self.strategy.costs.get("slippage", {}).get("seed", run_config.seed))
        combined_seed = (run_config.seed << 32) ^ slippage_seed
        self.rng = random.Random(combined_seed)  # noqa: S311 - deterministic simulation only
        self.orders: list[Order] = []
        self.positions: list[Position] = []
        self.closed_trades: list[Trade] = []
        self.events: list[dict[str, Any]] = []
        self.metadata: dict[str, SymbolMetadata] = {
            symbol: symbol_metadata(symbol) for symbol in self.strategy.symbols
        }
        for meta in self.metadata.values():
            if meta.quote_currency != run_config.account_currency:
                raise ValueError(
                    f"{meta.symbol} requires explicit {meta.quote_currency}/"
                    f"{run_config.account_currency} conversion data"
                )
        self.account = Account.create(
            run_config.account_currency, run_config.leverage, run_config.initial_capital
        )
        self.equity: list[EquityPoint] = []
        self._condition_cache: dict[tuple[Any, ...], list[Any]] = {}
        self._daily_realized: dict[str, float] = defaultdict(float)
        self._daily_trades: dict[str, int] = defaultdict(int)
        self._consecutive_losses = 0
        self._cooldown_until_index: dict[str, int] = defaultdict(lambda: -1)
        # Symbols with an *open* fill when allow_reentry is false (cleared on full close).
        self._entered_symbols: set[str] = set()

    async def run(self, cancelled: asyncio.Event | None = None) -> BacktestResult:
        grouped = self._group_bars()
        entry_events: list[tuple[Any, str, int, Any]] = []
        for symbol, frames in grouped.items():
            for index, bar in enumerate(frames.get(self.strategy.entry_timeframe, [])):
                entry_events.append((bar.timestamp, symbol, index, bar))
        entry_events.sort(key=lambda item: (item[0], item[1]))
        last_prices: dict[str, float] = {}
        bars_in_dataset = len(entry_events)
        bars_evaluated = 0
        for sequence, (_, symbol, index, bar) in enumerate(entry_events):
            if cancelled and cancelled.is_set():
                raise JobCancelled
            if sequence % 128 == 0:
                await asyncio.sleep(0)
            if self.config.start_time and bar.timestamp < self.config.start_time:
                continue
            if self.config.end_time and bar.timestamp > self.config.end_time:
                break
            bars_evaluated += 1
            last_prices[symbol] = float(bar.close)
            self._activate_pending_stops(symbol)
            self._execute_pending_exits(symbol, index, bar)
            self._process_orders(symbol, index, bar)
            self._process_positions(symbol, index, bar)
            decision_time = bar.timestamp + timedelta(
                minutes=TIMEFRAME_MINUTES[self.strategy.entry_timeframe]
            )
            context = ConditionContext(
                grouped[symbol],
                decision_time,
                self.strategy.entry_timeframe,
                self._condition_cache,
            )
            signal_sides = signals_at(self.strategy, context)
            self._schedule_management_exits(symbol, index, bar, signal_sides)
            for side in signal_sides:
                if self._can_create_order(symbol, side, index, decision_time):
                    order = self._create_order(symbol, side, index, bar, grouped[symbol])
                    if order:
                        self.orders.append(order)
                        self.events.append(
                            {
                                "type": "order_created",
                                "order_id": order.order_id,
                                "symbol": symbol,
                                "signal_time": decision_time.isoformat(),
                                "activation_index": index + 1,
                            }
                        )
            open_positions = [
                position for position in self.positions if position.remaining_size > 0
            ]
            if all(position.symbol in last_prices for position in open_positions):
                self.account.mark(open_positions, last_prices, self.metadata)
                if self.account.free_margin < -1e-9:
                    raise ValueError(
                        "margin call or liquidation would be required; this engine fails closed"
                    )
            point = EquityPoint(
                timestamp=decision_time,
                balance=self.account.balance,
                equity=self.account.equity,
                drawdown=self.account.drawdown,
                exposure=self.account.used_margin,
            )
            if self.equity and self.equity[-1].timestamp == decision_time:
                self.equity[-1] = point
            else:
                self.equity.append(point)
        self._close_end_of_run(grouped)
        self.account.mark([], {}, self.metadata)
        final_timestamp = max(
            (
                bars[-1].timestamp
                + timedelta(minutes=TIMEFRAME_MINUTES[self.strategy.entry_timeframe])
                for frames in grouped.values()
                if (bars := frames.get(self.strategy.entry_timeframe))
            ),
            default=None,
        )
        if final_timestamp is not None:
            final_point = EquityPoint(
                timestamp=final_timestamp,
                balance=self.account.balance,
                equity=self.account.equity,
                drawdown=self.account.drawdown,
                exposure=0.0,
            )
            if self.equity and self.equity[-1].timestamp == final_timestamp:
                self.equity[-1] = final_point
            else:
                self.equity.append(final_point)
        metrics = calculate_metrics(
            self.closed_trades,
            self.equity,
            self.config.initial_capital,
            self.strategy.entry_timeframe,
        )
        metrics["bars_in_dataset"] = bars_in_dataset
        metrics["bars_evaluated"] = bars_evaluated
        return BacktestResult(
            strategy_hash=self.strategy.spec_hash,
            dataset_hash=str(self.dataset.dataset_hash),
            engine_version=ENGINE_VERSION,
            indicator_version=INDICATOR_VERSION,
            run_config=self.config.model_dump(mode="json"),
            orders=self.orders,
            trades=self.closed_trades,
            equity=self.equity,
            events=self.events,
            metrics=metrics,
            attribution=build_attribution(self.closed_trades, self.orders),
            final_balance=self.account.balance,
        )

    def _group_bars(self) -> dict[str, dict[str, list[Any]]]:
        grouped: dict[str, dict[str, list[Any]]] = defaultdict(lambda: defaultdict(list))
        for bar in self.dataset.bars:
            symbol = normalize_symbol(bar.symbol)
            if symbol in self.metadata:
                if not forex_market_open(bar.timestamp):
                    raise ValueError(
                        "dataset contains a bar opened during the closed Forex weekend"
                    )
                grouped[symbol][_enum(bar.timeframe)].append(bar)
        for frames in grouped.values():
            for bars in frames.values():
                bars.sort(key=lambda item: item.timestamp)
        missing = [symbol for symbol in self.strategy.symbols if symbol not in grouped]
        if missing:
            raise ValueError(f"dataset is missing strategy symbols: {missing}")
        return grouped

    def _execution_costs(self) -> ExecutionCosts:
        raw = self.strategy.costs
        spread = raw.get("spread", {})
        slippage = raw.get("slippage", {})
        commission_cfg = raw.get("commission", {})
        carry = raw.get("swap_or_carry", {})
        carry_model = _enum(carry.get("type", "none"))
        if carry_model == "bar_column":
            raise ValueError("bar-column carry requires a dataset carrying that field")
        return ExecutionCosts(
            _enum(spread.get("type", spread.get("model", "fixed_pips"))),
            _number(spread, "value", "pips", default=0.0),
            tuple(
                (_enum(item["session"]), float(item["pips"])) for item in spread.get("values", [])
            ),
            _enum(slippage.get("type", slippage.get("model", "none"))),
            _number(slippage, "value", default=0.0),
            _enum(slippage.get("distribution", "normal")),
            _number(slippage, "mean", default=0.0),
            _number(slippage, "standard_deviation", default=0.0),
            _number(slippage, "maximum_absolute_pips", default=0.0),
            _enum(commission_cfg.get("type", commission_cfg.get("model", "none"))),
            _number(commission_cfg, "value", default=0.0),
            carry_model,
            _number(carry, "value_per_lot", default=0.0),
        )

    def _reference_entry(
        self, side: Side, bar: Any, frames: dict[str, list[Any]], index: int
    ) -> float:
        entry = self.strategy.entry
        reference = _enum(entry.get("price_reference", "next_bar_open"))
        if reference in {"next_bar_open", "signal_bar_close", "fixed_offset_from_signal_close"}:
            base = float(bar.close)
        elif reference == "previous_high":
            base = float(frames[self.strategy.entry_timeframe][max(0, index - 1)].high)
        elif reference == "previous_low":
            base = float(frames[self.strategy.entry_timeframe][max(0, index - 1)].low)
        elif reference == "indicator_value":
            indicator = entry["indicator"]
            timeframe = _enum(indicator["timeframe"])
            context = ConditionContext(
                frames,
                bar.timestamp + timedelta(minutes=TIMEFRAME_MINUTES[self.strategy.entry_timeframe]),
                self.strategy.entry_timeframe,
                self._condition_cache,
            )
            indicator_index = context.index(timeframe)
            if indicator_index < 0:
                raise ValueError("insufficient history for entry indicator")
            values = context.series(
                timeframe,
                _enum(indicator["indicator"]),
                (int(indicator["period"]),),
            )
            if values[indicator_index] is None:
                raise ValueError("insufficient warm-up for entry indicator")
            base = float(values[indicator_index])
        else:
            raise ValueError("unsupported entry price reference")
        offset_type = _enum(entry.get("offset_type", "pips"))
        offset = _number(entry, "offset_value")
        meta = self.metadata[bar.symbol]
        if offset_type == "none":
            amount = 0.0
        elif offset_type == "pips":
            amount = offset * meta.pip_size
        elif offset_type == "ticks":
            amount = offset * meta.tick_size
        elif offset_type == "percentage":
            amount = base * offset / 100
        elif offset_type == "price":
            amount = offset
        else:
            raise ValueError("unsupported entry offset type")
        direction = 1.0 if side == Side.LONG else -1.0
        if _enum(entry["order_type"]) == "limit":
            direction *= -1.0
        return base + direction * amount

    def _stop_price(
        self, symbol: str, side: Side, signal_index: int, bar: Any, frames: dict[str, list[Any]]
    ) -> float:
        stop = self.strategy.stop
        kind = _enum(stop["type"])
        value = _number(stop, "value", "multiple", default=1.0)
        close = float(bar.close)
        meta = self.metadata[symbol]
        if kind == "fixed_pips":
            distance = value * meta.pip_size
            return close - distance if side == Side.LONG else close + distance
        if kind == "percentage":
            distance = close * value / 100
            return close - distance if side == Side.LONG else close + distance
        lookback = int(stop.get("lookback_bars", stop.get("period", 14)))
        entry_bars = frames[self.strategy.entry_timeframe]
        if kind == "atr_multiple":
            timeframe = _enum(stop.get("timeframe", self.strategy.entry_timeframe))
            context = ConditionContext(
                frames,
                bar.timestamp + timedelta(minutes=TIMEFRAME_MINUTES[self.strategy.entry_timeframe]),
                self.strategy.entry_timeframe,
                self._condition_cache,
            )
            atr_index = context.index(timeframe)
            values = context.series(timeframe, "atr", (lookback,))
            current = values[atr_index] if atr_index >= 0 else None
            if current is None:
                raise ValueError("insufficient ATR warm-up for stop")
            distance = float(current) * value
            return close - distance if side == Side.LONG else close + distance
        window = entry_bars[max(0, signal_index - lookback + 1) : signal_index + 1]
        if len(window) < lookback:
            raise ValueError("insufficient swing warm-up for stop")
        buffer = _number(stop, "buffer_pips") * meta.pip_size
        return (
            min(float(item.low) for item in window) - buffer
            if side == Side.LONG
            else max(float(item.high) for item in window) + buffer
        )

    def _targets(
        self,
        side: Side,
        reference: float,
        stop_price: float,
        bar: Any,
        frames: dict[str, list[Any]],
        signal_index: int,
    ) -> list[Target]:
        risk = abs(reference - stop_price)
        meta = self.metadata[bar.symbol]
        targets: list[Target] = []
        for index, target in enumerate(self.strategy.targets):
            kind = _enum(target["type"])
            value = _number(target, "value", "multiple", default=1.0)
            if kind == "risk_reward":
                distance = risk * value
            elif kind == "fixed_pips":
                distance = value * meta.pip_size
            elif kind == "percentage":
                distance = reference * value / 100
            elif kind == "atr_multiple":
                timeframe = _enum(target.get("timeframe", self.strategy.entry_timeframe))
                period = int(target.get("period", 14))
                context = ConditionContext(
                    frames,
                    bar.timestamp
                    + timedelta(minutes=TIMEFRAME_MINUTES[self.strategy.entry_timeframe]),
                    self.strategy.entry_timeframe,
                    self._condition_cache,
                )
                target_index = context.index(timeframe)
                values = context.series(timeframe, "atr", (period,))
                current = values[target_index] if target_index >= 0 else None
                if current is None:
                    raise ValueError("insufficient ATR warm-up for target")
                distance = float(current) * value
            elif kind == "structure_level":
                lookback = int(target["lookback_bars"])
                entry_bars = frames[self.strategy.entry_timeframe]
                window = entry_bars[max(0, signal_index - lookback + 1) : signal_index + 1]
                if len(window) < lookback:
                    raise ValueError("insufficient structure warm-up for target")
                buffer = _number(target, "buffer_pips") * meta.pip_size
                price = (
                    max(float(item.high) for item in window) + buffer
                    if side == Side.LONG
                    else min(float(item.low) for item in window) - buffer
                )
                if (side == Side.LONG and price <= reference) or (
                    side == Side.SHORT and price >= reference
                ):
                    raise ValueError("structure target is not favorable to the entry")
                fraction = _number(target, "size_percent", default=100.0) / 100
                targets.append(Target(price, fraction, f"TP{index + 1}"))
                continue
            else:
                raise ValueError("unsupported target type")
            price = reference + distance if side == Side.LONG else reference - distance
            fraction = _number(target, "size_percent", default=100.0) / 100
            targets.append(Target(price, fraction, f"TP{index + 1}"))
        return targets

    def _size(self, symbol: str, reference: float, stop: float) -> float:
        sizing = self.strategy.sizing
        kind = _enum(sizing["type"])
        value = _number(sizing, "value", "lot", "lots", "notional", "risk_percent")
        meta = self.metadata[symbol]
        if kind == "fixed_lot":
            raw = value
        elif kind == "fixed_notional":
            raw = value / (meta.contract_size * reference)
        elif kind == "risk_percent":
            risk_cash = self.account.equity * value / 100
            risk_per_lot = abs(reference - stop) * meta.contract_size
            if risk_per_lot <= 0:
                raise ValueError("risk-percent sizing requires a positive stop distance")
            raw = risk_cash / risk_per_lot
        else:
            raise ValueError("unsupported position sizing")
        rounded = round_lot(raw, meta)
        if rounded < meta.minimum_lot:
            raise ValueError("position is below minimum lot")
        return rounded

    def _create_order(
        self, symbol: str, side: Side, index: int, bar: Any, frames: dict[str, list[Any]]
    ) -> Order | None:
        try:
            reference = self._reference_entry(side, bar, frames, index)
            stop = self._stop_price(symbol, side, index, bar, frames)
            if (side == Side.LONG and stop >= reference) or (
                side == Side.SHORT and stop <= reference
            ):
                return None
            targets = self._targets(side, reference, stop, bar, frames, index)
            minimum_rr = _number(self.strategy.risk, "minimum_reward_risk", default=0.0)
            rr = abs(targets[-1].price - reference) / abs(reference - stop)
            if rr < minimum_rr:
                return None
            size = self._size(symbol, reference, stop)
        except ValueError as exc:
            self.events.append({"type": "order_rejected", "symbol": symbol, "reason": str(exc)})
            return None
        order_type = OrderType(_enum(self.strategy.entry["order_type"]))
        valid = int(self.strategy.entry.get("valid_for_bars", 1))
        return Order(
            order_id=opaque_id("ord"),
            symbol=symbol,
            side=side,
            order_type=order_type,
            created_index=index,
            activation_index=index + 1,
            expiry_index=index + valid,
            reference_price=reference,
            requested_price=None if order_type == OrderType.MARKET else reference,
            size_lots=size,
            stop_price=stop,
            target_prices=targets,
            signal_time=bar.timestamp
            + timedelta(minutes=TIMEFRAME_MINUTES[self.strategy.entry_timeframe]),
        )

    def _can_create_order(self, symbol: str, side: Side, index: int, decision_time: Any) -> bool:
        risk = self.strategy.risk
        open_positions = [position for position in self.positions if position.remaining_size > 0]
        pending = [order for order in self.orders if order.status == OrderStatus.PENDING]
        if len(open_positions) + len(pending) >= int(risk.get("max_open_positions", 1)):
            return False
        if sum(position.symbol == symbol for position in open_positions) >= int(
            risk.get("max_positions_per_symbol", 1)
        ):
            return False
        if any(order.symbol == symbol and order.side == side for order in pending):
            return False
        # allow_reentry=false blocks only while a prior fill on this symbol is still open
        # (cleared in _close_fraction). One-at-a-time sizing stays on max_open_positions.
        if not self.strategy.entry.get("allow_reentry", False) and symbol in self._entered_symbols:
            return False
        date_key = decision_time.date().isoformat()
        if self._daily_trades[date_key] >= int(risk.get("daily_trade_limit", 100)):
            return False
        daily_loss_limit = _number(risk, "max_daily_loss_percent", default=100.0)
        if self._daily_realized[date_key] <= -self.config.initial_capital * daily_loss_limit / 100:
            return False
        # Consecutive-loss circuit breaker is enforced via cooldown pause + counter
        # reset in _close_fraction (not a permanent halt for the rest of the sample).
        return index >= self._cooldown_until_index[symbol]

    def _process_orders(self, symbol: str, index: int, bar: Any) -> None:
        costs = self._execution_costs()
        meta = self.metadata[symbol]
        for order in self.orders:
            if order.symbol != symbol or order.status != OrderStatus.PENDING:
                continue
            if expire_order(order, index):
                self.events.append({"type": "order_expired", "order_id": order.order_id})
                continue
            if index < order.activation_index:
                continue
            reference = order_trigger_reference(order, bar)
            if reference is None:
                continue
            required_margin = (
                order.size_lots * meta.contract_size * reference / self.config.leverage
            )
            if required_margin > self.account.free_margin:
                order.status = OrderStatus.REJECTED
                order.cancellation_reason = "insufficient_margin"
                self.events.append(
                    {
                        "type": "order_rejected",
                        "order_id": order.order_id,
                        "symbol": symbol,
                        "reason": "insufficient_margin",
                    }
                )
                continue
            fill = executable_fill(bar, order.side, "entry", reference, meta, costs, self.rng)
            level_shift = reference - order.reference_price
            stop_price = order.stop_price + level_shift
            shifted_targets = [
                Target(target.price + level_shift, target.size_fraction, target.label)
                for target in order.target_prices
            ]
            order.status = OrderStatus.FILLED
            order.fill_time = bar.timestamp
            order.fill_price = fill.price
            order.stop_price = stop_price
            order.target_prices = shifted_targets
            entry_spread = fill.spread_cost_price * order.size_lots * meta.contract_size
            entry_slippage = fill.slippage_cost_price * order.size_lots * meta.contract_size
            entry_commission = commission(order.size_lots, fill.price, meta, costs)
            position = Position(
                position_id=opaque_id("pos"),
                trade_id=opaque_id("trd"),
                symbol=symbol,
                side=order.side,
                entry_time=bar.timestamp,
                entry_index=index,
                entry_price=fill.price,
                reference_entry_price=reference,
                initial_size=order.size_lots,
                remaining_size=order.size_lots,
                initial_stop=stop_price,
                current_stop=stop_price,
                targets=shifted_targets,
                initial_risk_price=abs(reference - stop_price),
                entry_order_type=order.order_type,
                entry_requested_price=order.requested_price,
                spread_cost=entry_spread,
                slippage_cost=entry_slippage,
                commission_cost=entry_commission,
                entry_spread_cost=entry_spread,
                entry_slippage_cost=entry_slippage,
                entry_commission_cost=entry_commission,
                last_carry_date=bar.timestamp.date().isoformat(),
            )
            self.positions.append(position)
            self._entered_symbols.add(symbol)
            self._daily_trades[bar.timestamp.date().isoformat()] += 1
            self.events.append(
                {
                    "type": "order_filled",
                    "order_id": order.order_id,
                    "position_id": position.position_id,
                    "execution_time": bar.timestamp.isoformat(),
                    "execution_price": fill.price,
                    "execution_policy": "next_bar_or_pending_trigger",
                }
            )

    def _process_positions(self, symbol: str, index: int, bar: Any) -> None:
        for position in list(self.positions):
            if position.symbol != symbol or position.remaining_size <= 0:
                continue
            position.bars_held = index - position.entry_index + 1
            self._apply_carry(position, bar)
            decision = (
                resolve_entry_bar(position, bar, self.config.intrabar_policy, self.config.doji_path)
                if index == position.entry_index
                else resolve_intrabar(
                    position, bar, self.config.intrabar_policy, self.config.doji_path
                )
            )
            if decision.rejected:
                self.events.append(
                    {
                        "type": "intrabar_ambiguous_rejected",
                        "position_id": position.position_id,
                        "policy": self.config.intrabar_policy.value,
                        "timestamp": bar.timestamp.isoformat(),
                    }
                )
                position.intrabar_ambiguous = True
                continue
            if decision.ambiguous:
                position.intrabar_ambiguous = True
                self.events.append(
                    {
                        "type": "intrabar_ambiguous",
                        "position_id": position.position_id,
                        "policy": self.config.intrabar_policy.value,
                        "timestamp": bar.timestamp.isoformat(),
                    }
                )
            if decision.stop_hit:
                stop_reference = position.current_stop
                if position.side == Side.LONG and float(bar.open) < stop_reference:
                    stop_reference = float(bar.open)
                if position.side == Side.SHORT and float(bar.open) > stop_reference:
                    stop_reference = float(bar.open)
                self._close_fraction(
                    position, position.remaining_size, stop_reference, bar, "stop_loss"
                )
                continue
            for target_index in decision.target_indices:
                target = position.targets[target_index]
                size = min(
                    position.remaining_size,
                    position.initial_size * (target.size_fraction - target.filled_fraction),
                )
                if size <= 0:
                    continue
                target.filled_fraction += size / position.initial_size
                self._close_fraction(position, size, target.price, bar, target.label.lower())
            if decision.stop_after_targets and position.remaining_size > 1e-12:
                stop_reference = position.current_stop
                if position.side == Side.LONG and float(bar.open) < stop_reference:
                    stop_reference = float(bar.open)
                if position.side == Side.SHORT and float(bar.open) > stop_reference:
                    stop_reference = float(bar.open)
                self._close_fraction(
                    position,
                    position.remaining_size,
                    stop_reference,
                    bar,
                    "stop_loss",
                )
            if position.remaining_size <= 1e-12:
                continue
            self._update_management(position, index, bar)

    def _close_fraction(
        self, position: Position, size: float, reference: float, bar: Any, reason: str
    ) -> None:
        size = min(size, position.remaining_size)
        if size <= 0:
            return
        meta = self.metadata[position.symbol]
        costs = self._execution_costs()
        fill = executable_fill(bar, position.side, "exit", reference, meta, costs, self.rng)
        gross = pnl_for_move(position.side, position.reference_entry_price, reference, size, meta)
        exit_spread = fill.spread_cost_price * size * meta.contract_size
        exit_slippage = fill.slippage_cost_price * size * meta.contract_size
        exit_commission = (
            0.0
            if costs.commission_model == "per_trade"
            else commission(size, fill.price, meta, costs)
        )
        fraction = size / position.initial_size
        entry_cost = (
            position.entry_spread_cost
            + position.entry_slippage_cost
            + position.entry_commission_cost
        ) * fraction
        net = gross - entry_cost - exit_spread - exit_slippage - exit_commission
        position.gross_pnl += gross
        position.spread_cost += exit_spread
        position.slippage_cost += exit_slippage
        position.commission_cost += exit_commission
        position.realized_pnl += net
        position.remaining_size = max(0.0, position.remaining_size - size)
        position.events.append(
            {
                "type": "partial_exit" if position.remaining_size > 0 else "final_exit",
                "timestamp": bar.timestamp.isoformat(),
                "size": size,
                "reference_price": reference,
                "execution_price": fill.price,
                "reason": reason,
                "net_pnl": net,
            }
        )
        self.events.extend(position.events[-1:])
        self.account.realize(net)
        if position.remaining_size > 1e-12:
            position.status = PositionStatus.PARTIALLY_CLOSED
            return
        position.status = PositionStatus.STOPPED if reason == "stop_loss" else PositionStatus.CLOSED
        initial_risk = position.initial_risk_price * position.initial_size * meta.contract_size
        trade = Trade(
            trade_id=position.trade_id,
            symbol=position.symbol,
            side=position.side,
            entry_time=position.entry_time,
            exit_time=bar.timestamp,
            entry_price=position.entry_price,
            exit_price=fill.price,
            initial_size=position.initial_size,
            gross_pnl=position.gross_pnl,
            spread_cost=position.spread_cost,
            slippage_cost=position.slippage_cost,
            commission_cost=position.commission_cost,
            carry_cost=position.carry_cost,
            net_pnl=position.realized_pnl,
            r_multiple=position.realized_pnl / initial_risk if initial_risk > 0 else None,
            holding_bars=position.bars_held,
            exit_reason=reason,
            session=forex_session(position.entry_time),
            intrabar_ambiguous=position.intrabar_ambiguous,
            intrabar_policy=(
                self.config.intrabar_policy.value if position.intrabar_ambiguous else None
            ),
        )
        self.closed_trades.append(trade)
        date_key = bar.timestamp.date().isoformat()
        self._daily_realized[date_key] += trade.net_pnl
        close_index = position.entry_index + position.bars_held
        if trade.net_pnl < 0:
            self._consecutive_losses += 1
            cooldown = int(self.strategy.risk.get("cooldown_after_loss_bars", 0))
            max_losses = int(self.strategy.risk.get("max_consecutive_losses", 10_000))
            # Circuit breaker: pause, then resume. Never freeze the whole backtest sample.
            if self._consecutive_losses >= max_losses:
                raw_pause = self.strategy.risk.get("consecutive_loss_pause_bars")
                pause_bars = (
                    int(raw_pause)
                    if raw_pause is not None
                    else max(cooldown * max_losses, max_losses * 2)
                )
                self._cooldown_until_index[position.symbol] = close_index + max(pause_bars, cooldown)
                self.events.append(
                    {
                        "type": "risk_consecutive_loss_pause",
                        "symbol": position.symbol,
                        "consecutive_losses": self._consecutive_losses,
                        "pause_bars": pause_bars,
                        "resume_index": self._cooldown_until_index[position.symbol],
                    }
                )
                self._consecutive_losses = 0
            else:
                self._cooldown_until_index[position.symbol] = close_index + cooldown
        else:
            self._consecutive_losses = 0
        entry_cooldown = int(self.strategy.entry.get("cooldown_bars", 0))
        self._cooldown_until_index[position.symbol] = max(
            self._cooldown_until_index[position.symbol],
            close_index + entry_cooldown,
        )
        # Position fully closed — allow later signals (subject to cooldown / max_open).
        self._entered_symbols.discard(position.symbol)

    def _apply_carry(self, position: Position, bar: Any) -> None:
        costs = self._execution_costs()
        current = bar.timestamp.date()
        if not position.last_carry_date:
            position.last_carry_date = current.isoformat()
            return
        previous = date.fromisoformat(position.last_carry_date)
        days = (current - previous).days
        if days <= 0:
            return
        if costs.carry_model == "fixed_daily":
            carry = costs.carry_value_per_lot * position.remaining_size * days
            position.carry_cost += carry
            position.realized_pnl -= carry
            self.account.realize(-carry)
        position.last_carry_date = current.isoformat()

    def _update_management(self, position: Position, index: int, bar: Any) -> None:
        management = self.strategy.management
        break_even = management.get("move_to_break_even")
        if break_even and not position.break_even_active:
            trigger_type = _enum(break_even.get("trigger_type", "r_multiple"))
            trigger_value = _number(break_even, "trigger_value", default=1.0)
            favorable = (
                float(bar.high) - position.reference_entry_price
                if position.side == Side.LONG
                else position.reference_entry_price - float(bar.low)
            )
            hit_count = sum(target.filled_fraction > 0 for target in position.targets)
            target_hit = hit_count >= int(break_even.get("apply_after_target", 1))
            triggered = (
                favorable >= position.initial_risk_price * trigger_value
                if trigger_type in {"r_multiple", "after_r"}
                else target_hit
                if trigger_type in {"after_target", "target"}
                else favorable >= trigger_value * self.metadata[position.symbol].pip_size
            )
            if triggered:
                offset = _number(break_even, "new_stop_offset", "new_stop_offset_pips", default=0.0)
                candidate = (
                    position.entry_price + offset * self.metadata[position.symbol].pip_size
                    if position.side == Side.LONG
                    else position.entry_price - offset * self.metadata[position.symbol].pip_size
                )
                if tighten_stop(position, candidate):
                    position.break_even_active = True
        trailing = management.get("trailing_stop")
        if trailing:
            favorable = (
                float(bar.high) - position.reference_entry_price
                if position.side == Side.LONG
                else position.reference_entry_price - float(bar.low)
            )
            activation = _number(trailing, "activation_r", default=0.0)
            frequency = int(trailing.get("update_every_bars", 1))
            if (
                favorable >= position.initial_risk_price * activation
                and position.bars_held % frequency == 0
            ):
                kind = _enum(trailing.get("type", "fixed_pips"))
                value = _number(trailing, "value", default=0.0)
                if kind == "fixed_pips":
                    distance = value * self.metadata[position.symbol].pip_size
                    basis = float(bar.close)
                    candidate = basis - distance if position.side == Side.LONG else basis + distance
                elif kind == "atr_multiple":
                    distance = max(0.0, float(bar.high) - float(bar.low)) * value
                    basis = (
                        float(bar.close)
                        if trailing.get("price_basis", "close") == "close"
                        else float(bar.high if position.side == Side.LONG else bar.low)
                    )
                    candidate = basis - distance if position.side == Side.LONG else basis + distance
                else:
                    candidate = float(bar.low) if position.side == Side.LONG else float(bar.high)
                tighten_stop(position, candidate)
        maximum = management.get("maximum_holding_bars")
        if maximum and position.bars_held >= int(maximum):
            position.pending_exit_reason = "maximum_holding_bars"

    def _activate_pending_stops(self, symbol: str) -> None:
        for position in self.positions:
            if position.symbol == symbol and position.remaining_size > 0:
                apply_pending_stop(position)

    def _execute_pending_exits(self, symbol: str, index: int, bar: Any) -> None:
        for position in self.positions:
            if (
                position.symbol == symbol
                and position.remaining_size > 0
                and position.pending_exit_reason
                and index > position.entry_index
            ):
                reason = position.pending_exit_reason
                position.pending_exit_reason = None
                self._close_fraction(
                    position, position.remaining_size, float(bar.open), bar, reason
                )

    def _schedule_management_exits(
        self, symbol: str, index: int, bar: Any, signal_sides: tuple[Side, ...]
    ) -> None:
        management = self.strategy.management
        for position in self.positions:
            if position.symbol != symbol or position.remaining_size <= 0:
                continue
            if management.get("close_on_opposite_signal") and any(
                side != position.side for side in signal_sides
            ):
                position.pending_exit_reason = "opposite_signal"
            if (
                management.get("session_close_exit")
                and forex_session(
                    bar.timestamp
                    + timedelta(minutes=TIMEFRAME_MINUTES[self.strategy.entry_timeframe])
                )
                == "off_session"
            ):
                position.pending_exit_reason = "session_close"
            if self.strategy.entry.get("cancel_on_opposite_signal"):
                for order in self.orders:
                    if (
                        order.symbol == symbol
                        and order.status == OrderStatus.PENDING
                        and any(side != order.side for side in signal_sides)
                    ):
                        order.status = OrderStatus.CANCELLED
                        order.cancellation_reason = "opposite_signal"

    def _close_end_of_run(self, grouped: dict[str, dict[str, list[Any]]]) -> None:
        for position in self.positions:
            if position.remaining_size <= 0:
                continue
            bars = grouped[position.symbol][self.strategy.entry_timeframe]
            if not bars:
                continue
            bar = bars[-1]
            position.bars_held = max(position.bars_held, len(bars) - position.entry_index)
            self._close_fraction(
                position, position.remaining_size, float(bar.close), bar, "end_of_run"
            )
