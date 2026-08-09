from __future__ import annotations

from app.engine.strategies.generated_code.contract import compile_and_discover

_VALID_CODE = """
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

_NO_SIGNAL_CODE = """
def evaluate(features):
    return None
"""


def test_valid_code_compiles_and_discovers() -> None:
    ok, error = compile_and_discover(_VALID_CODE)
    assert ok is True
    assert error is None


def test_no_signal_code_is_valid_at_discovery() -> None:
    ok, error = compile_and_discover(_NO_SIGNAL_CODE)
    assert ok is True
    assert error is None


def test_unsafe_code_is_rejected_with_a_clear_error() -> None:
    unsafe = "import os\n\ndef evaluate(features):\n    os.system('id')\n    return None\n"
    ok, error = compile_and_discover(unsafe)
    assert ok is False
    assert error
    assert "unsafe" in error.lower() or "not allowed" in error.lower()


def test_code_missing_evaluate_function_is_rejected() -> None:
    ok, error = compile_and_discover("value = 1 + 1\n")
    assert ok is False
    assert error
    assert "evaluate" in error.lower()


def test_code_returning_invalid_output_shape_is_rejected() -> None:
    # Passes the AST/regex sandbox check cleanly, but returns nonsense
    # (negative stop multiple) that a second, independent gate must catch.
    code = """
def evaluate(features):
    return {
        'direction': 'buy',
        'stop_loss_atr_multiple': -5.0,
        'take_profit_r_multiples': [1.0],
        'rationale': 'bad output',
    }
"""
    ok, error = compile_and_discover(code)
    assert ok is False
    assert error


def test_code_returning_descending_targets_is_rejected() -> None:
    code = """
def evaluate(features):
    return {
        'direction': 'buy',
        'stop_loss_atr_multiple': 1.0,
        'take_profit_r_multiples': [3.0, 2.0, 1.0],
        'rationale': 'descending targets are invalid',
    }
"""
    ok, error = compile_and_discover(code)
    assert ok is False
    assert error


def test_code_that_raises_inside_evaluate_is_rejected_not_crashed() -> None:
    code = """
def evaluate(features):
    return 1 / 0
"""
    ok, error = compile_and_discover(code)
    assert ok is False
    assert error


def test_syntactically_invalid_code_is_rejected_fail_closed() -> None:
    ok, error = compile_and_discover("def evaluate(features)\n    return None\n")
    assert ok is False
    assert error
