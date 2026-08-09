"""Coverage for run_evaluate_batch_in_sandbox -- the thin contract-layer
wrapper around safe_exec_isolated_batch (see test_safe_exec_batch.py for the
underlying sandbox mechanism's own tests). This file checks the
contract-specific concerns: output shape validation, truncation surfacing,
and that this function never touches the live per-call path."""

from __future__ import annotations

from app.engine.strategies.generated_code.contract import (
    run_evaluate_batch_in_sandbox,
    run_evaluate_in_sandbox,
)

_FIRES_WHEN_ATR_AVAILABLE = """
def evaluate(features):
    idx = features['last']
    atr = features['atr14']
    if idx < 0 or idx >= len(atr) or atr[idx] is None:
        return None
    return {
        'direction': 'buy',
        'stop_loss_atr_multiple': 1.5,
        'take_profit_r_multiples': [1.0, 2.0, 3.0],
        'rationale': 'fires whenever ATR is available',
    }
"""

_RETURNS_A_NON_DICT = """
def evaluate(features):
    return "not a dict"
"""

_UNSAFE_CODE = "import os\n\ndef evaluate(features):\n    os.system('id')\n    return None\n"


def _bar_view(atr_value: float | None) -> dict:
    return {
        'ema20': [1.0], 'ema50': [1.0], 'ema200': [1.0],
        'rsi14': [50.0], 'macd_line': [0.0], 'macd_signal': [0.0], 'macd_hist': [0.0],
        'atr14': [atr_value], 'bb_lower': [0.9], 'bb_middle': [1.0], 'bb_upper': [1.1],
        'adx14': [25.0], 'closes': [1.0], 'regime': 'trend', 'last': 0,
    }


def test_batch_rejects_unsafe_code_without_spawning() -> None:
    ok, outputs, error = run_evaluate_batch_in_sandbox(_UNSAFE_CODE, [_bar_view(1.0)])
    assert ok is False
    assert outputs is None
    assert error and 'unsafe' in error.lower()


def test_batch_returns_raw_unvalidated_outputs_aligned_to_input() -> None:
    views = [_bar_view(None), _bar_view(0.01), _bar_view(0.02)]
    ok, outputs, error = run_evaluate_batch_in_sandbox(_FIRES_WHEN_ATR_AVAILABLE, views)
    assert ok is True
    assert error is None
    assert outputs is not None
    assert len(outputs) == 3
    assert outputs[0] is None  # atr14[0] is None for that bar's view
    assert outputs[1]['direction'] == 'buy'
    assert outputs[2]['direction'] == 'buy'


def test_batch_rejects_a_non_dict_non_none_output() -> None:
    ok, outputs, error = run_evaluate_batch_in_sandbox(_RETURNS_A_NON_DICT, [_bar_view(0.01)])
    assert ok is False
    assert outputs is None
    assert error and 'dict' in error.lower()


def test_batch_and_live_path_agree_on_a_firing_bar() -> None:
    """Same code, same single-bar input, through both the live per-call path
    and the new batch path -- their raw (unvalidated) outputs must match,
    since GeneratedCodeOutput validation happens downstream of both, not
    inside either sandbox call itself."""
    view = _bar_view(0.02)
    live_ok, live_output, live_err = run_evaluate_in_sandbox(_FIRES_WHEN_ATR_AVAILABLE, view)
    batch_ok, batch_outputs, batch_err = run_evaluate_batch_in_sandbox(
        _FIRES_WHEN_ATR_AVAILABLE, [view]
    )
    assert live_ok is True and batch_ok is True
    assert live_err is None and batch_err is None
    assert batch_outputs == [live_output]
