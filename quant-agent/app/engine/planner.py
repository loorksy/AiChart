"""Turns a chosen Signal (via combine.py) plus its Features into the full
persisted recommendation shape (plan section 3): validity window sized in
bars of the source interval, and a content-addressed idempotency key so the
same bar/strategy pair never produces two rows."""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timedelta

from app.core.ids import opaque_id
from app.engine.combine import CombineResult
from app.engine.features import Features
from app.storage.models import NoSignalResponse, Recommendation, utc_now

_MT_STYLE = re.compile(r"^(MN|M|H|D|W)(\d+)$")
_GENERIC_STYLE = re.compile(r"^(\d+)(S|M|H|D|W)$")
_UNIT_SECONDS = {"S": 1, "M": 60, "H": 3600, "D": 86400, "W": 604800, "MN": 30 * 86400}


def interval_seconds(interval: str) -> int:
    """Accepts MetaTrader-style intervals ("M1","M5","H1","H4","D1","W1",
    "MN1") and generic digit-first intervals ("1m","15m","4h","1d")."""
    text = interval.strip().upper()
    match = _MT_STYLE.match(text)
    if match:
        unit, amount = match.group(1), int(match.group(2))
        return _UNIT_SECONDS[unit] * amount
    match = _GENERIC_STYLE.match(text)
    if match:
        amount, unit = int(match.group(1)), match.group(2)
        return _UNIT_SECONDS[unit] * amount
    raise ValueError(f"unrecognized interval: {interval!r}")


def compute_idempotency_key(
    symbol: str, interval: str, source_bar_close_time: str, strategy_id: str
) -> str:
    digest = hashlib.sha256()
    payload = "|".join([symbol, interval, source_bar_close_time, strategy_id]).encode("utf-8")
    digest.update(payload)
    return digest.hexdigest()


def compute_validity_expires_at(
    source_bar_close_time: str, interval: str, validity_bars: int
) -> str:
    close_at = datetime.fromisoformat(source_bar_close_time.replace("Z", "+00:00"))
    span = timedelta(seconds=interval_seconds(interval) * validity_bars)
    return (close_at + span).isoformat()


def build_recommendation(
    *,
    features: Features,
    combine_result: CombineResult,
    owner_user_id: int,
    validity_bars: int,
) -> Recommendation | None:
    if combine_result.signal is None:
        return None
    signal = combine_result.signal
    source_bar_close_time = features.times[-1]
    rationale_text = "; ".join([*combine_result.rationale, *signal.rationale])
    evidence = {
        "signal": signal.evidence,
        "combine_rationale": combine_result.rationale,
        "corroborating_strategies": [s.strategy_id for s in combine_result.corroborating],
        "conflicting_strategies": [
            {"strategy_id": s.strategy_id, "direction": s.direction}
            for s in combine_result.conflicting
        ],
        "regime": features.regime,
    }
    now_iso = utc_now().isoformat()
    return Recommendation(
        id=opaque_id("qrec"),
        owner_user_id=owner_user_id,
        symbol=features.symbol,
        market=features.market,
        interval=features.interval,
        direction=signal.direction,
        plan_type=signal.plan_type,
        entry=signal.entry,
        stop_loss=signal.stop_loss,
        take_profit=signal.take_profit,
        targets=signal.targets,
        confidence=signal.confidence,
        strategy_id=signal.strategy_id,
        strategy_version=signal.strategy_version,
        regime=features.regime,
        rationale=rationale_text,
        evidence=evidence,
        validity_expires_at=compute_validity_expires_at(
            source_bar_close_time, features.interval, validity_bars
        ),
        lifecycle_state="active",
        source_bar_close_time=source_bar_close_time,
        idempotency_key=compute_idempotency_key(
            features.symbol, features.interval, source_bar_close_time, signal.strategy_id
        ),
        created_at=now_iso,
        updated_at=now_iso,
    )


def build_no_signal_response(features: Features, combine_result: CombineResult) -> NoSignalResponse:
    return NoSignalResponse(
        symbol=features.symbol,
        market=features.market,
        interval=features.interval,
        regime=features.regime,
        rationale="; ".join(combine_result.rationale),
        source_bar_close_time=features.times[-1],
    )
