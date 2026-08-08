"""Security + correctness coverage for safe_exec_isolated_batch (the
backtest-only sibling of safe_exec_isolated -- see that function's
docstring for why a batch path exists at all: one subprocess for an entire
historical replay instead of one per bar).

These tests exist to prove: (1) the batch path is exactly as safe as the
live per-call path (same validator, same rejections), (2) it actually
processes a whole batch inside ONE subprocess (not one per call -- a
regression here would silently reopen the performance problem this
mechanism exists to solve), (3) per-bar and whole-batch timeouts both work,
and (4) a single bad bar never aborts the rest of the batch.
"""

from __future__ import annotations

import time

from app.sandbox.safe_exec import safe_exec_isolated_batch, validate_code_safety

_ECHO_LAST_CLOSE = """
def evaluate(features):
    closes = features.get('closes') or []
    if not closes:
        return None
    return {'value': closes[-1]}
"""

_NEVER_FIRES = """
def evaluate(features):
    return None
"""

_RAISES_ON_ODD_INDEX = """
_calls = {'n': 0}

def evaluate(features):
    _calls['n'] += 1
    if _calls['n'] % 2 == 1:
        raise RuntimeError('deliberately broken on odd calls')
    return {'value': _calls['n']}
"""

_INFINITE_LOOP_ON_FIRST_CALL_ONLY = """
_first = {'done': False}

def evaluate(features):
    if not _first['done']:
        _first['done'] = True
        while True:
            pass
    return {'value': 1}
"""

_ALWAYS_INFINITE_LOOP = """
def evaluate(features):
    while True:
        pass
"""

_ACCUMULATES_ACROSS_CALLS = """
_seen = []

def evaluate(features):
    _seen.append(1)
    return {'cumulative_calls': len(_seen)}
"""

_UNSAFE_CODE = "import os\n\ndef evaluate(features):\n    os.system('id')\n    return None\n"


def _inputs(n: int) -> list[dict]:
    return [{'closes': [1.0, 2.0, 3.0 + i]} for i in range(n)]


# ---------------------------------------------------------------------------
# Safety parity with the live path
# ---------------------------------------------------------------------------


def test_rejects_unsafe_code_without_spawning() -> None:
    result = safe_exec_isolated_batch(_UNSAFE_CODE, _inputs(3))
    assert result['success'] is False
    assert 'unsafe' in (result['error'] or '').lower()


def test_batch_and_single_path_agree_on_validate_code_safety() -> None:
    """The batch function must never accept code the shared validator
    itself rejects -- it delegates, it doesn't reimplement."""
    ok, _ = validate_code_safety(_UNSAFE_CODE)
    assert ok is False
    result = safe_exec_isolated_batch(_UNSAFE_CODE, _inputs(1))
    assert result['success'] is False


# ---------------------------------------------------------------------------
# Correctness: one call per input, results aligned, no-signal handled
# ---------------------------------------------------------------------------


def test_processes_every_input_and_aligns_outputs() -> None:
    result = safe_exec_isolated_batch(_ECHO_LAST_CLOSE, _inputs(5))
    assert result['success'] is True
    outputs = result['result']['outputs']
    assert result['result']['truncated'] is False
    assert len(outputs) == 5
    assert [o['value'] for o in outputs] == [3.0, 4.0, 5.0, 6.0, 7.0]


def test_never_fires_returns_all_none() -> None:
    result = safe_exec_isolated_batch(_NEVER_FIRES, _inputs(4))
    assert result['success'] is True
    assert result['result']['outputs'] == [None, None, None, None]


def test_empty_batch_succeeds_with_no_outputs() -> None:
    result = safe_exec_isolated_batch(_ECHO_LAST_CLOSE, [])
    assert result['success'] is True
    assert result['result']['outputs'] == []


# ---------------------------------------------------------------------------
# One bad bar never aborts the batch (contract parity with the live path,
# where GeneratedCodeStrategy.evaluate() never raises to its own caller)
# ---------------------------------------------------------------------------


def test_a_raising_call_is_recorded_as_none_not_a_batch_failure() -> None:
    result = safe_exec_isolated_batch(_RAISES_ON_ODD_INDEX, _inputs(4))
    assert result['success'] is True
    outputs = result['result']['outputs']
    assert len(outputs) == 4
    # Calls 1,3 raise (odd) -> None; calls 2,4 succeed.
    assert outputs[0] is None
    assert outputs[1] == {'value': 2}
    assert outputs[2] is None
    assert outputs[3] == {'value': 4}


def test_per_call_timeout_on_one_bar_does_not_kill_the_whole_batch() -> None:
    """The pathological call hangs forever; the per-call timeout must cut
    just that call short (recorded as None) and let the rest of the batch
    proceed -- this is the whole point of a per-bar safety net inside the
    shared batch timeout."""
    result = safe_exec_isolated_batch(
        _INFINITE_LOOP_ON_FIRST_CALL_ONLY,
        _inputs(3),
        wall_clock_timeout=30,
        per_call_timeout=1,
    )
    assert result['success'] is True
    outputs = result['result']['outputs']
    assert len(outputs) == 3
    assert outputs[0] is None  # the hung call, cut short and recorded as no-signal
    assert outputs[1] == {'value': 1}
    assert outputs[2] == {'value': 1}


# ---------------------------------------------------------------------------
# Timeouts: whole-batch wall clock actually bounds total run time
# ---------------------------------------------------------------------------


def test_wall_clock_timeout_bounds_a_batch_of_always_hanging_calls() -> None:
    started = time.monotonic()
    result = safe_exec_isolated_batch(
        _ALWAYS_INFINITE_LOOP,
        _inputs(50),
        wall_clock_timeout=3,
        per_call_timeout=1,
    )
    elapsed = time.monotonic() - started
    # Every call hangs and gets cut by the 1s per-call timeout, so the
    # 3s wall clock check between calls should stop the batch well before
    # all 50 calls would otherwise run (50s+ if unbounded).
    assert result['success'] is True
    assert result['result']['truncated'] is True
    assert len(result['result']['outputs']) < 50
    assert elapsed < 20, (
        f"batch should self-truncate well under the 50-call worst case, took {elapsed}s"
    )


# ---------------------------------------------------------------------------
# One subprocess for the whole batch (the actual point of this mechanism)
# ---------------------------------------------------------------------------


def test_entire_batch_runs_in_a_single_subprocess() -> None:
    """A module-level accumulator only grows across calls if they share one
    process/namespace. `os` is unimportable inside the sandbox (by design),
    so a getpid()-based check isn't available from inside sandboxed code --
    an accumulating counter is the mechanism the sandbox itself permits, and
    it proves the same thing: if this ever regressed to spawning a fresh
    process per call, `_seen` would reset to [] every time and
    `cumulative_calls` would read 1 on every single output, never grow."""
    result = safe_exec_isolated_batch(_ACCUMULATES_ACROSS_CALLS, _inputs(10))
    assert result['success'] is True
    outputs = result['result']['outputs']
    assert len(outputs) == 10
    assert [o['cumulative_calls'] for o in outputs] == list(range(1, 11))
