"""Declarative strategy generator package (plan section 5).

A user-facing "strategy generator" in `web/` lets an LLM propose a new
strategy, but this service never calls an LLM and never executes generated
code. It only validates a closed, pydantic-typed condition tree
(`schema.GeneratedStrategySpec`, no `eval`/`exec` anywhere) and interprets it
against `app.engine.features.Features` (`interpreter.DeclarativeStrategy`),
producing the exact same `Signal` shape the two hardcoded strategies do.
"""

from __future__ import annotations
