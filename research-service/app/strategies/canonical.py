from __future__ import annotations

import json
from typing import Any, cast

from .schema import StrategySpecification


def canonical_strategy_dict(specification: StrategySpecification) -> dict[str, Any]:
    """Return the validated JSON-compatible representation used for persistence."""
    value = specification.model_dump(mode="json", by_alias=True, exclude_none=True)
    normalized = json.loads(json.dumps(value, allow_nan=False, ensure_ascii=False))
    return cast(dict[str, Any], normalized)


def canonical_strategy_json(specification: StrategySpecification) -> str:
    """Serialize without whitespace and with recursively sorted object keys."""
    return json.dumps(
        canonical_strategy_dict(specification),
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
