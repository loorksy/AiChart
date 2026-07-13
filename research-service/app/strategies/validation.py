from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from pydantic import ValidationError

from .canonical import canonical_strategy_dict
from .errors import StrategyValidationError
from .hashing import strategy_spec_hash
from .models import StrategyValidationResult
from .schema import StrategySpecification


def parse_strategy_specification(
    value: StrategySpecification | Mapping[str, Any],
) -> StrategySpecification:
    if isinstance(value, StrategySpecification):
        return value
    try:
        # JSON-mode validation accepts JSON enum/datetime representations while
        # the models retain strict primitive and unknown-key handling.
        payload = json.dumps(dict(value), allow_nan=False, ensure_ascii=False)
        return StrategySpecification.model_validate_json(payload, strict=True)
    except (TypeError, ValueError, ValidationError) as exc:
        raise StrategyValidationError(_safe_error(exc)) from exc


def validate_strategy_specification(
    value: StrategySpecification | Mapping[str, Any],
) -> StrategyValidationResult:
    try:
        specification = parse_strategy_specification(value)
    except StrategyValidationError as exc:
        return StrategyValidationResult(valid=False, errors=(str(exc),))
    return StrategyValidationResult(
        valid=True,
        canonical_spec=canonical_strategy_dict(specification),
        spec_hash=strategy_spec_hash(specification),
    )


def _safe_error(exc: Exception) -> str:
    if isinstance(exc, ValidationError):
        errors: list[str] = []
        for item in exc.errors(include_url=False, include_input=False):
            location = ".".join(str(part) for part in item["loc"])
            message = str(item["msg"])
            errors.append(f"{location}: {message}" if location else message)
        return "; ".join(errors[:20])
    return "strategy specification is not valid JSON data"
