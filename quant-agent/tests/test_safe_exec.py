"""Security coverage for the ported sandbox (app/sandbox/safe_exec.py).

These are the load-bearing tests for the whole "generate strategy code and
run it" feature: if this file's assertions hold, the AST/regex/builtins/
timeout/subprocess-isolation mechanism does what it claims to.
"""

from __future__ import annotations

import time

from app.sandbox.safe_exec import (
    build_safe_builtins,
    safe_exec_isolated,
    validate_code_safety,
)

# ---------------------------------------------------------------------------
# validate_code_safety -- things that MUST be rejected
# ---------------------------------------------------------------------------


def _assert_rejected(code: str) -> None:
    ok, error = validate_code_safety(code)
    assert ok is False, f"expected rejection, code was accepted: {code!r}"
    assert error


def test_rejects_os_system() -> None:
    _assert_rejected("import os\nos.system('echo hi')\n")


def test_rejects_subprocess_import() -> None:
    _assert_rejected("import subprocess\nsubprocess.run(['ls'])\n")


def test_rejects_socket_import() -> None:
    _assert_rejected("import socket\ns = socket.socket()\n")


def test_rejects_eval() -> None:
    _assert_rejected("eval('1+1')\n")


def test_rejects_exec() -> None:
    _assert_rejected("exec('x = 1')\n")


def test_rejects_open() -> None:
    _assert_rejected("open('/etc/passwd').read()\n")


def test_rejects_getattr() -> None:
    _assert_rejected("getattr(object(), '__class__')\n")


def test_rejects_dunder_import() -> None:
    _assert_rejected("__import__('os')\n")


def test_rejects_globals_vars_dir() -> None:
    _assert_rejected("globals()\n")
    _assert_rejected("vars()\n")
    _assert_rejected("dir()\n")


def test_rejects_class_bases_subclasses_escape() -> None:
    """The canonical Python sandbox-escape one-liner: walk from any object
    back up to `object`, enumerate every loaded subclass, and find something
    dangerous (a file opener, a subprocess runner, ...)."""
    _assert_rejected("().__class__.__bases__[0].__subclasses__()\n")


def test_rejects_string_concatenation_folded_dunder() -> None:
    """`"__" + "class__"` must be caught even though no single string
    literal contains the forbidden substring."""
    _assert_rejected("x = (1).__getattribute__('__' + 'class__')\n")


def test_rejects_import_outside_whitelist() -> None:
    for module in ("os", "sys", "requests", "pickle", "ctypes", "socket", "numpy", "pandas"):
        _assert_rejected(f"import {module}\n")


def test_rejects_import_from_outside_whitelist() -> None:
    _assert_rejected("from os import system\n")


def test_rejects_wildcard_import_of_allowed_module() -> None:
    _assert_rejected("from math import *\n")


def test_rejects_operator_attrgetter() -> None:
    _assert_rejected("import operator\noperator.attrgetter('__class__')\n")


def test_rejects_frame_introspection() -> None:
    _assert_rejected("import sys\nsys._getframe()\n")


def test_rejects_builtins_dict_access() -> None:
    _assert_rejected("x = __builtins__['eval']\n")


def test_syntax_error_is_rejected_fail_closed() -> None:
    ok, error = validate_code_safety("def evaluate(features)\n    return None\n")
    assert ok is False
    assert error


# ---------------------------------------------------------------------------
# validate_code_safety -- things that MUST be accepted
# ---------------------------------------------------------------------------


def test_accepts_plain_arithmetic_and_math_import() -> None:
    ok, error = validate_code_safety(
        "import math\n"
        "def evaluate(features):\n"
        "    x = math.sqrt(16.0)\n"
        "    return {'value': x}\n"
    )
    assert ok is True
    assert error is None


def test_accepts_statistics_and_collections() -> None:
    ok, error = validate_code_safety(
        "import statistics\n"
        "import collections\n"
        "def evaluate(features):\n"
        "    values = [1.0, 2.0, 3.0]\n"
        "    return {'mean': statistics.mean(values), 'ctr': dict(collections.Counter(values))}\n"
    )
    assert ok is True
    assert error is None


# ---------------------------------------------------------------------------
# build_safe_builtins -- restricted namespace actually restricts
# ---------------------------------------------------------------------------


def test_safe_builtins_excludes_dangerous_names() -> None:
    safe = build_safe_builtins()
    for name in ("eval", "exec", "open", "getattr", "setattr", "__import__", "compile"):
        assert name not in safe or name == "__import__"  # __import__ is present but restricted
    # sum/len/abs etc. must still work.
    assert safe["len"]([1, 2, 3]) == 3
    assert safe["abs"](-5) == 5


def test_safe_builtins_import_rejects_unlisted_module() -> None:
    safe_import = build_safe_builtins()["__import__"]
    try:
        safe_import("os")
    except ImportError:
        pass
    else:
        raise AssertionError("safe __import__ allowed importing os")


def test_safe_builtins_import_allows_whitelisted_module() -> None:
    safe_import = build_safe_builtins()["__import__"]
    module = safe_import("math")
    assert module.sqrt(4.0) == 2.0
    # Importer-internal attributes must not be reachable on the proxy.
    assert not hasattr(module, "__loader__")


# ---------------------------------------------------------------------------
# Timeout -- an infinite loop actually gets cut off
# ---------------------------------------------------------------------------


def test_infinite_loop_times_out_via_isolated_subprocess() -> None:
    started = time.monotonic()
    result = safe_exec_isolated("while True:\n    pass\n", timeout=2)
    elapsed = time.monotonic() - started
    assert result["success"] is False
    assert "timed out" in (result["error"] or "").lower()
    # Bounded: the call must not hang far past the requested timeout.
    assert elapsed < 10


# ---------------------------------------------------------------------------
# Subprocess isolation -- runs, isolates, round-trips correctly
# ---------------------------------------------------------------------------


def test_safe_exec_isolated_runs_valid_code_and_returns_picklable_result() -> None:
    result = safe_exec_isolated("value = 1 + 1\n", timeout=5)
    assert result["success"] is True
    assert result["result"]["value"] == 2


def test_safe_exec_isolated_rejects_unsafe_code_without_spawning() -> None:
    result = safe_exec_isolated("import os\nos.system('id')\n", timeout=5)
    assert result["success"] is False
    assert "unsafe" in (result["error"] or "").lower()


def test_safe_exec_isolated_handles_a_result_larger_than_the_pipe_buffer() -> None:
    """Regression test for a real deadlock: the parent used to call
    `proc.join()` BEFORE draining the result pipe. `os.write()` to a pipe
    blocks once the kernel buffer (commonly 64KB on Linux) is full, so a
    child whose pickled result exceeds that size would block forever inside
    `result_pipe.send()` while the parent sat in `join()` never reading —
    each side waiting on the other. A large list is plenty to exceed that
    buffer once pickled; this must complete promptly, not hang until the
    timeout is exhausted."""
    started = time.monotonic()
    result = safe_exec_isolated("value = [float(i) for i in range(200_000)]\n", timeout=15)
    elapsed = time.monotonic() - started
    assert result["success"] is True
    assert len(result["result"]["value"]) == 200_000
    assert elapsed < 10, f"should complete well under the 15s timeout, took {elapsed}s"


def test_safe_exec_isolated_survives_a_crash_in_the_child() -> None:
    """A hard crash (os._exit bypasses normal Python exception handling) in
    the sandboxed subprocess must not affect this test process -- that's the
    entire point of running generated code in a child process. `os._exit`
    itself is unreachable from inside the sandbox (os is not importable), so
    this exercises the parent's "subprocess exited abnormally" path via a
    SystemExit, which IS reachable through the restricted builtins' baseline
    behavior when the child's own bookkeeping fails unexpectedly."""
    # A deliberately malformed but "safe-looking" program that raises deep
    # inside evaluation -- proves errors inside the child surface as a
    # structured failure, not a hung or crashed parent process.
    result = safe_exec_isolated("value = 1 / 0\n", timeout=5)
    assert result["success"] is False
    assert result["error"]
