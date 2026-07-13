from __future__ import annotations

import asyncio
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any, Protocol

from .canonical import canonical_strategy_dict
from .errors import StrategyStoreConflictError
from .hashing import strategy_spec_hash
from .models import StrategyDefinition, StrategyVersion, StrategyVersionStatus
from .schema import StrategySpecification
from .validation import parse_strategy_specification


class StrategyStore(Protocol):
    """Version store contract; implementations must never mutate historical versions."""

    async def create_version(
        self,
        specification: StrategySpecification | Mapping[str, Any],
        *,
        version_number: int,
        created_by_user_id: int,
        parent_version_id: str | None = None,
        status: StrategyVersionStatus = StrategyVersionStatus.VALID,
        change_summary: str = "",
    ) -> StrategyVersion: ...

    async def get_definition(self, strategy_id: str) -> StrategyDefinition | None: ...
    async def get_version(self, strategy_id: str, version_id: str) -> StrategyVersion | None: ...
    async def list_versions(self, strategy_id: str) -> tuple[StrategyVersion, ...]: ...


class InMemoryStrategyStore:
    """Volatile process-local store for development/tests; restart loses every version."""

    def __init__(self) -> None:
        self._definitions: dict[str, StrategyDefinition] = {}
        self._versions: dict[tuple[str, str], StrategyVersion] = {}
        self._version_numbers: dict[tuple[str, int], str] = {}
        self._lock = asyncio.Lock()

    async def create_version(
        self,
        specification: StrategySpecification | Mapping[str, Any],
        *,
        version_number: int,
        created_by_user_id: int,
        parent_version_id: str | None = None,
        status: StrategyVersionStatus = StrategyVersionStatus.VALID,
        change_summary: str = "",
    ) -> StrategyVersion:
        spec = parse_strategy_specification(specification)
        now = datetime.now(UTC)
        version = StrategyVersion(
            strategy_id=spec.strategy_id,
            version_id=spec.version_id,
            version_number=version_number,
            parent_version_id=parent_version_id,
            spec_version=spec.spec_version,
            canonical_spec=canonical_strategy_dict(spec),
            spec_hash=strategy_spec_hash(spec),
            created_by_user_id=created_by_user_id,
            created_at=now,
            status=status,
            change_summary=change_summary,
        )
        async with self._lock:
            key = (spec.strategy_id, spec.version_id)
            number_key = (spec.strategy_id, version_number)
            if key in self._versions or number_key in self._version_numbers:
                raise StrategyStoreConflictError("strategy versions are immutable and unique")
            existing = self._definitions.get(spec.strategy_id)
            prior = sorted(
                (item for item in self._versions.values() if item.strategy_id == spec.strategy_id),
                key=lambda item: item.version_number,
            )
            if existing is not None:
                expected = prior[-1].version_number + 1
                if version_number != expected:
                    raise StrategyStoreConflictError("version_number must increase by one")
                if parent_version_id != prior[-1].version_id:
                    raise StrategyStoreConflictError(
                        "parent_version_id must reference the latest version"
                    )
            elif version_number != 1 or parent_version_id is not None:
                raise StrategyStoreConflictError("first version must be version 1 without a parent")

            definition = StrategyDefinition(
                strategy_id=spec.strategy_id,
                name=spec.name,
                description=spec.description,
                market=spec.market,
                symbols=spec.symbols,
                enabled=spec.enabled,
                created_by_user_id=(
                    existing.created_by_user_id if existing is not None else created_by_user_id
                ),
                created_at=existing.created_at if existing is not None else now,
                latest_version_id=spec.version_id,
            )
            self._versions[key] = version
            self._version_numbers[number_key] = spec.version_id
            self._definitions[spec.strategy_id] = definition
            return version.model_copy(deep=True)

    async def get_definition(self, strategy_id: str) -> StrategyDefinition | None:
        async with self._lock:
            value = self._definitions.get(strategy_id)
            return value.model_copy(deep=True) if value is not None else None

    async def get_version(self, strategy_id: str, version_id: str) -> StrategyVersion | None:
        async with self._lock:
            value = self._versions.get((strategy_id, version_id))
            return value.model_copy(deep=True) if value is not None else None

    async def list_versions(self, strategy_id: str) -> tuple[StrategyVersion, ...]:
        async with self._lock:
            values = sorted(
                (value for value in self._versions.values() if value.strategy_id == strategy_id),
                key=lambda value: value.version_number,
            )
            return tuple(value.model_copy(deep=True) for value in values)
