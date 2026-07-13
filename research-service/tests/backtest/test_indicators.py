from app.backtest.indicators import atr, bollinger, ema, macd, rsi, sma


def test_indicator_warmup_and_known_values() -> None:
    values = [1.0, 2.0, 3.0, 4.0, 5.0]
    assert sma(values, 3) == [None, None, 2.0, 3.0, 4.0]
    assert ema(values, 3)[:3] == [None, None, 2.0]
    assert rsi(values, 2)[0:2] == [None, None]
    assert rsi(values, 2)[2] == 100.0
    atr_values = atr(values, [value - 0.5 for value in values], values, 2)
    assert atr_values[0] is None
    assert atr_values[1] is not None


def test_macd_and_bollinger_are_deterministic_without_forward_windows() -> None:
    values = [float(index) for index in range(1, 50)]
    first = macd(values)
    second = macd(values)
    assert first == second
    lower, middle, upper = bollinger(values, 5, 2)
    assert all(value is None for value in middle[:4])
    assert lower[4] < middle[4] < upper[4]
