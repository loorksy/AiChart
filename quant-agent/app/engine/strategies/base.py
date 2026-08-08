from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, ClassVar, Literal

from pydantic import BaseModel, Field

from app.engine.features import Features, Regime

Direction = Literal["buy", "sell"]
PlanType = Literal["immediate", "anticipatory", "conditional"]


class Signal(BaseModel):
    """What a single strategy produces when it fires. Carries everything
    planner.py needs to turn it into a full recommendation, and everything
    combine.py needs to arbitrate between strategies transparently."""

    strategy_id: str
    strategy_version: str
    direction: Direction
    plan_type: PlanType
    entry: float | None
    stop_loss: float
    take_profit: float | None
    targets: list[float] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0)
    regime: Regime
    rationale: list[str] = Field(default_factory=list)
    evidence: dict[str, Any] = Field(default_factory=dict)


class Strategy(ABC):
    """One deterministic, inspectable decision rule. No parameter fitting,
    no ML, no black box — see engineering plan section 3."""

    strategy_id: ClassVar[str]
    version: ClassVar[str]
    display_name: ClassVar[str]
    description: ClassVar[str]
    regime_affinity: ClassVar[Regime]

    @abstractmethod
    def evaluate(self, features: Features) -> Signal | None:
        """Return a Signal if this strategy's conditions fire on the latest
        bar of `features`, else None. Must never raise for well-formed
        Features with enough history — callers rely on that to run every
        registered strategy unconditionally."""
        raise NotImplementedError
