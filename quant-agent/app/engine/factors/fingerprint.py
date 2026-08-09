"""A content fingerprint per factor, so a formula cannot change silently.

This module has no upstream counterpart — it exists to close the gap the port
inherited. QuantDinger hard-codes `version = "1.0.0"` on all 61 factors, keeps
it out of every cache key, and has no bump mechanism, so editing a kernel
changes every stored research result with no detectable signal.

`formula_fingerprint()` hashes the things that can move a number: the factor's
id, its declared defaults and required fields, and the normalized source of its
kernel plus every module-level helper that kernel transitively calls (across
both `compute.py` and `frame.py`). `tests/test_factors_version.py` freezes the
result next to the declared version, so an edit to `_rsi` fails CI until `rsi`
is bumped, while an edit to `_rsi` leaves `sma` untouched.

Two deliberate properties:

  * **Comments, docstrings and line layout do not count.** The source is
    reduced to its token stream first, so documenting a kernel or re-wrapping
    a call across lines is free. Anything that changes the tokens is not.
  * **Shared helpers propagate.** Editing `_ema_values` moves every EMA-derived
    factor and only those; editing `divide()` in `frame.py` moves every factor
    that divides. That is the correct blast radius, and it is why the closure
    is followed rather than hashing each kernel in isolation.

`inspect.getsource` needs the `.py` files on disk, so this is called from tests
and tooling only — never on a request path.
"""

from __future__ import annotations

import hashlib
import inspect
import io
import json
import tokenize
from collections.abc import Callable
from types import CodeType, FunctionType, ModuleType
from typing import Any

from app.engine.factors import compute as compute_module
from app.engine.factors import frame as frame_module

FINGERPRINT_LENGTH = 16

# Only names defined in these two modules are followed; a call into the stdlib
# (`math.sqrt`) is a stable dependency and is not part of the closure.
_SOURCE_MODULES: tuple[ModuleType, ...] = (compute_module, frame_module)

# Constants worth hashing out of a dispatch lambda. A lambda's `co_consts` can
# also hold nested code objects, whose `repr` carries a memory address and is
# therefore useless as a fingerprint input.
_HASHABLE_CONSTS = (str, int, float, bool, type(None))


def formula_fingerprint(
    factor_id: str,
    kernel: Callable[..., Any],
    *,
    default_params: dict[str, Any],
    required_fields: tuple[str, ...],
) -> str:
    """A short, stable digest of everything that could move this factor's value."""
    parts: list[str] = [
        factor_id,
        json.dumps(default_params, sort_keys=True, separators=(",", ":")),
        ",".join(required_fields),
        # The dispatch lambda itself: which kernel it calls, and with which
        # literal arguments (`_ma_distance(..., exponential=True)` differs from
        # its `False` sibling only here).
        repr(sorted(_referenced_names(kernel.__code__))),
        repr([const for const in kernel.__code__.co_consts if isinstance(const, _HASHABLE_CONSTS)]),
    ]
    for name in sorted(_closure(kernel)):
        parts.append(name)
        parts.append(_normalized_source(_resolve(name)))
    digest = hashlib.sha256("\x1e".join(parts).encode("utf-8")).hexdigest()
    return digest[:FINGERPRINT_LENGTH]


def _referenced_names(code: CodeType) -> set[str]:
    """Every global name the code object mentions, including from the bodies of
    functions nested inside it (`_ultimate_oscillator`'s local `average`)."""
    names = set(code.co_names)
    for const in code.co_consts:
        if isinstance(const, CodeType):
            names |= _referenced_names(const)
    return names


def _resolve(name: str) -> FunctionType | None:
    for module in _SOURCE_MODULES:
        candidate = getattr(module, name, None)
        if isinstance(candidate, FunctionType) and candidate.__module__ == module.__name__:
            return candidate
    return None


def _closure(kernel: Callable[..., Any]) -> set[str]:
    """Transitive set of helper names the kernel reaches inside our own modules."""
    found: set[str] = set()
    pending = [name for name in _referenced_names(kernel.__code__) if _resolve(name)]
    while pending:
        name = pending.pop()
        if name in found:
            continue
        found.add(name)
        function = _resolve(name)
        if function is None:  # pragma: no cover - guarded by the pending filter
            continue
        for referenced in _referenced_names(function.__code__):
            if referenced not in found and _resolve(referenced):
                pending.append(referenced)
    return found


_SKIPPED_TOKENS = frozenset(
    {
        tokenize.COMMENT,
        tokenize.NL,
        tokenize.NEWLINE,
        tokenize.INDENT,
        tokenize.DEDENT,
        tokenize.ENCODING,
        tokenize.ENDMARKER,
    }
)


def _normalized_source(function: FunctionType | None) -> str:
    """The function's token stream, minus comments, layout and its docstring.

    Tokenizing (rather than hashing the text, or an `ast.dump` whose field set
    moves between Python releases) is what makes a re-wrapped call or a new
    explanatory comment free, while any change to the code itself is not.
    """
    if function is None:  # pragma: no cover - guarded by `_closure`
        return ""
    readline = io.StringIO(inspect.getsource(function)).readline
    tokens: list[str] = []
    depth = 0
    header_closed = False
    expect_docstring = False
    for token in tokenize.generate_tokens(readline):
        if token.type in _SKIPPED_TOKENS:
            continue
        if expect_docstring:
            expect_docstring = False
            if token.type == tokenize.STRING:
                continue  # the docstring: prose, not formula
        if token.string in "([{":
            depth += 1
        elif token.string in ")]}":
            depth -= 1
        elif token.string == ":" and depth == 0 and not header_closed:
            header_closed = True
            expect_docstring = True
        tokens.append(token.string)
    return "\x1f".join(tokens)
