from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel


@dataclass(frozen=True, slots=True)
class CompiledStrategy:
    raw: dict[str, Any]
    spec_hash: str
    symbols: tuple[str, ...]
    entry_timeframe: str
    higher_timeframes: tuple[str, ...]
    direction: str
    long_conditions: dict[str, Any] | None
    short_conditions: dict[str, Any] | None
    entry: dict[str, Any]
    stop: dict[str, Any]
    targets: tuple[dict[str, Any], ...]
    sizing: dict[str, Any]
    management: dict[str, Any]
    risk: dict[str, Any]
    costs: dict[str, Any]


def _canonical_hash(value: dict[str, Any]) -> str:
    canonical = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode()).hexdigest()


def compile_strategy(spec: BaseModel | dict[str, Any]) -> CompiledStrategy:
    raw = (
        spec.model_dump(mode="json", by_alias=True, exclude_none=True)
        if isinstance(spec, BaseModel)
        else spec
    )
    timeframes = raw["timeframes"]
    direction = raw["direction"]
    shared = raw.get("entry_conditions")
    long_conditions = raw.get("long_entry_conditions") or (shared if direction == "long" else None)
    short_conditions = raw.get("short_entry_conditions") or (
        shared if direction == "short" else None
    )
    targets_config = raw.get("take_profit") or raw.get("targets")
    if isinstance(targets_config, dict) and "targets" in targets_config:
        targets = targets_config["targets"]
    elif isinstance(targets_config, list):
        targets = targets_config
    else:
        targets = [targets_config]
    canonical_hash = raw.get("spec_hash") or _canonical_hash(raw)
    return CompiledStrategy(
        raw=raw,
        spec_hash=canonical_hash,
        symbols=tuple(raw["symbols"]),
        entry_timeframe=str(timeframes["entry"]),
        higher_timeframes=tuple(str(value) for value in timeframes.get("higher", [])),
        direction=direction,
        long_conditions=long_conditions,
        short_conditions=short_conditions,
        entry=raw["entry"],
        stop=raw.get("stop_loss") or raw["stop"],
        targets=tuple(target for target in targets if target),
        sizing=raw["position_sizing"],
        management=raw.get("trade_management") or raw.get("management", {}),
        risk=raw.get("risk_controls", {}),
        costs=raw.get("cost_model") or raw["costs"],
    )
