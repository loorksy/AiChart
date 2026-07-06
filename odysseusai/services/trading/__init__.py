"""Odysseus native trading engine (Python).

This package is the Python rewrite of the former AiChart trading platform.
It is the single source of truth for Odysseus trading capability: market
data, technical indicators, the Risk Guard, trades/portfolio, the MT5/EA
execution bridge, recommendations, and the agent trading tools.

Submodules are intentionally dependency-light so the pure-logic layers
(indicators, risk) can be imported and unit-tested without a database,
broker connection, or network access.
"""

from __future__ import annotations

__all__ = [
    "constants",
    "indicators",
    "risk",
]
