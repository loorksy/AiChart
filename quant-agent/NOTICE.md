# Third-Party Notices

## safe_exec.py sandboxing mechanism

`app/sandbox/safe_exec.py` is adapted from [QuantDinger](https://github.com/OpenByteInc/QuantDinger),
Copyright Open Byte Inc., licensed under the Apache License, Version 2.0.
A copy of the license is available at http://www.apache.org/licenses/LICENSE-2.0
and is included verbatim in this repository at
`quant-agent/LICENSES/apache-2.0-safe_exec.txt`.

Changes made from the original: pandas/numpy import support and their
IO-method blocklist (`read_csv`, `to_csv`, `savez`, etc.) were removed
entirely, since this service's generated strategy code operates on plain
Python floats/lists with no pandas/numpy dependency — this also removes
the defensive checks that existed solely to guard pandas/numpy-specific
attack surface (`_dangerous_pd_numpy_*`, `_PANDAS_NUMPY_ROOTS`, related
regex patterns, and the numpy-submodule entries in
`_DANGEROUS_SUBMODULE_ATTRS`). The AST/regex validation, restricted
builtins, module proxy, timeout mechanism, and subprocess isolation
(`safe_exec_isolated`) are otherwise unchanged in mechanism from the
original.

The quant-agent-specific "compile and discover" contract
(`app/engine/strategies/generated_code/contract.py`) and the strategy
interpreter (`app/engine/strategies/generated_code/interpreter.py`) are
new, independent code written for this service's much smaller
`evaluate(features) -> dict | None` contract — they are not a port of
QuantDinger's `strategy_v2/contract.py`, which implements a full
portfolio/order/schedule trading engine contract that has no equivalent
here.
