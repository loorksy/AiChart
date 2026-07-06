"""MT5 broker symbol mapping.

Brokers name the same instrument differently (EURUSD, EURUSDm, EURUSD.pro),
and OANDA/platform symbols differ again (EUR_USD ↔ EURUSD). Execution must use
the *broker-exact* symbol reported by the EA, so we resolve a platform symbol
to the EA's own symbol list. Port of ``lib/mt5SymbolMap.ts`` +
``markets/forexCanonical.ts``.
"""

from __future__ import annotations

import re

_ALNUM = re.compile(r"[^A-Za-z0-9]")


def forex_canonical_key(symbol: str) -> str:
    """First 6 alphanumerics, uppercased (EURUSDm → EURUSD, XAUUSD.pro → XAUUSD)."""
    alnum = _ALNUM.sub("", symbol or "")
    return (alnum[:6] if len(alnum) >= 6 else alnum).upper()


def resolve_mt5_symbol(ea_symbols: list[str], symbol: str) -> str | None:
    """Map a platform symbol to the broker's exact MT5 symbol name.

    Priority: exact match → case-insensitive → forex-canonical (6-letter) match.
    Returns the broker-exact case (e.g. ``EURUSDm``), or None if unavailable.
    """
    query = (symbol or "").strip()
    if not query or not ea_symbols:
        return None
    if query in ea_symbols:
        return query
    q_up = query.upper()
    for s in ea_symbols:
        if s.upper() == q_up:
            return s
    key = forex_canonical_key(query)
    if key:
        for s in ea_symbols:
            if forex_canonical_key(s) == key:
                return s
    return None
