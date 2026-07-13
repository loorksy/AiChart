from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .models import IntrabarPolicy, OrderType, Position, Side, Target


@dataclass(frozen=True, slots=True)
class IntrabarDecision:
    stop_hit: bool
    target_indices: tuple[int, ...]
    ambiguous: bool
    rejected: bool = False
    stop_after_targets: bool = False


def _touches_stop(position: Position, bar: Any) -> bool:
    return bool(
        float(bar.low) <= position.current_stop
        if position.side == Side.LONG
        else float(bar.high) >= position.current_stop
    )


def _touched_targets(position: Position, bar: Any) -> tuple[int, ...]:
    touched: list[int] = []
    for index, target in enumerate(position.targets):
        if target.filled_fraction >= target.size_fraction:
            continue
        hit = bar.high >= target.price if position.side == Side.LONG else bar.low <= target.price
        if hit:
            touched.append(index)
    return tuple(touched)


def resolve_intrabar(
    position: Position,
    bar: Any,
    policy: IntrabarPolicy,
    doji_path: str = "conservative",
) -> IntrabarDecision:
    stop = _touches_stop(position, bar)
    targets = _touched_targets(position, bar)
    ambiguous = stop and bool(targets)
    if not ambiguous:
        return IntrabarDecision(stop, targets, False)
    if policy == IntrabarPolicy.REJECT_AMBIGUOUS:
        return IntrabarDecision(False, (), True, True)
    if policy in {IntrabarPolicy.WORST_CASE, IntrabarPolicy.STOP_FIRST}:
        return IntrabarDecision(True, (), True)
    if policy in {IntrabarPolicy.BEST_CASE, IntrabarPolicy.TARGET_FIRST}:
        return IntrabarDecision(
            False,
            targets,
            True,
            stop_after_targets=policy == IntrabarPolicy.TARGET_FIRST,
        )
    bullish = bar.close > bar.open
    bearish = bar.close < bar.open
    if bullish:
        stop_first = position.side == Side.LONG
    elif bearish:
        stop_first = position.side == Side.SHORT
    else:
        stop_first = (
            doji_path != "high_first" if position.side == Side.LONG else doji_path != "low_first"
        )
    return IntrabarDecision(
        stop_first,
        () if stop_first else targets,
        True,
        stop_after_targets=not stop_first,
    )


@dataclass(frozen=True, slots=True)
class _PathOutcome:
    targets: tuple[int, ...]
    stop_after_targets: bool


def resolve_entry_bar(
    position: Position,
    bar: Any,
    policy: IntrabarPolicy,
    doji_path: str = "conservative",
) -> IntrabarDecision:
    """Resolve pending-entry and exit ordering without using pre-entry extremes as fills."""

    if position.entry_order_type == OrderType.MARKET:
        return resolve_intrabar(position, bar, policy, doji_path)
    low_first = _path_outcome(
        position, [float(bar.open), float(bar.low), float(bar.high), float(bar.close)]
    )
    high_first = _path_outcome(
        position, [float(bar.open), float(bar.high), float(bar.low), float(bar.close)]
    )
    ambiguous = low_first != high_first
    if ambiguous and policy == IntrabarPolicy.REJECT_AMBIGUOUS:
        return IntrabarDecision(False, (), True, True)
    if policy == IntrabarPolicy.OHLC_PATH:
        if float(bar.close) > float(bar.open):
            selected = low_first
        elif float(bar.close) < float(bar.open):
            selected = high_first
        elif doji_path == "low_first":
            selected = low_first
        elif doji_path == "high_first":
            selected = high_first
        else:
            selected = _select_outcome(position, bar, low_first, high_first, best=False)
    elif policy in {IntrabarPolicy.WORST_CASE, IntrabarPolicy.BEST_CASE}:
        selected = _select_outcome(
            position,
            bar,
            low_first,
            high_first,
            best=policy == IntrabarPolicy.BEST_CASE,
        )
    else:
        all_targets = tuple(
            sorted(
                set(low_first.targets) | set(high_first.targets),
                key=lambda index: position.targets[index].price,
                reverse=position.side == Side.SHORT,
            )
        )
        any_stop = low_first.stop_after_targets or high_first.stop_after_targets
        if policy == IntrabarPolicy.STOP_FIRST and any_stop:
            return IntrabarDecision(True, (), ambiguous)
        selected = _PathOutcome(all_targets, any_stop)
    return IntrabarDecision(
        False,
        selected.targets,
        ambiguous,
        stop_after_targets=selected.stop_after_targets,
    )


def _path_outcome(position: Position, path: list[float]) -> _PathOutcome:
    requested = position.entry_requested_price
    assert requested is not None
    start = _entry_path(position.entry_order_type, position.side, requested, path)
    if start is None:
        return _PathOutcome((), False)
    remaining_path = start
    targets: list[int] = []
    filled: set[int] = set()
    for start_price, end_price in zip(remaining_path, remaining_path[1:], strict=False):
        events: list[tuple[float, str, int | None]] = []
        if _crossed(start_price, end_price, position.current_stop):
            events.append((position.current_stop, "stop", None))
        for index, target in enumerate(position.targets):
            if index not in filled and _crossed(start_price, end_price, target.price):
                events.append((target.price, "target", index))
        events.sort(key=lambda item: item[0], reverse=end_price < start_price)
        for _price, kind, target_index in events:
            if kind == "stop":
                return _PathOutcome(tuple(targets), True)
            assert target_index is not None
            filled.add(target_index)
            targets.append(target_index)
    return _PathOutcome(tuple(targets), False)


def _entry_path(
    order_type: OrderType,
    side: Side,
    requested: float,
    path: list[float],
) -> list[float] | None:
    open_price = path[0]
    marketable = (
        open_price <= requested
        if order_type == OrderType.LIMIT and side == Side.LONG
        else open_price >= requested
        if order_type == OrderType.LIMIT
        else open_price >= requested
        if side == Side.LONG
        else open_price <= requested
    )
    if marketable:
        return path
    for index, (start, end) in enumerate(zip(path, path[1:], strict=False)):
        triggers = (
            start > requested >= end
            if order_type == OrderType.LIMIT and side == Side.LONG
            else start < requested <= end
            if order_type == OrderType.LIMIT
            else start < requested <= end
            if side == Side.LONG
            else start > requested >= end
        )
        if triggers:
            return [requested, end, *path[index + 2 :]]
    return None


def _crossed(start: float, end: float, level: float) -> bool:
    return min(start, end) <= level <= max(start, end) and start != end


def _select_outcome(
    position: Position,
    bar: Any,
    first: _PathOutcome,
    second: _PathOutcome,
    *,
    best: bool,
) -> _PathOutcome:
    def score(outcome: _PathOutcome) -> float:
        remaining = 1.0
        value = 0.0
        direction = 1.0 if position.side == Side.LONG else -1.0
        for index in outcome.targets:
            fraction = min(remaining, position.targets[index].size_fraction)
            value += (
                fraction
                * direction
                * (position.targets[index].price - position.reference_entry_price)
            )
            remaining -= fraction
        terminal = position.current_stop if outcome.stop_after_targets else float(bar.close)
        return value + remaining * direction * (terminal - position.reference_entry_price)

    first_score = score(first)
    second_score = score(second)
    return (
        max((first_score, first), (second_score, second), key=lambda item: item[0])[1]
        if best
        else min((first_score, first), (second_score, second), key=lambda item: item[0])[1]
    )


def tighten_stop(position: Position, candidate: float) -> bool:
    if position.side == Side.LONG:
        if candidate <= position.current_stop:
            return False
    elif candidate >= position.current_stop or candidate <= 0:
        return False
    position.pending_stop = candidate
    return True


def apply_pending_stop(position: Position) -> None:
    if position.pending_stop is None:
        return
    if position.side == Side.LONG:
        position.current_stop = max(position.current_stop, position.pending_stop)
    else:
        position.current_stop = min(position.current_stop, position.pending_stop)
    position.pending_stop = None


def target_remaining_fraction(target: Target) -> float:
    return max(0.0, target.size_fraction - target.filled_fraction)
