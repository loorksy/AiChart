"""Sandboxed execution for AI-generated trading strategy code.

Adapted from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
(http://www.apache.org/licenses/LICENSE-2.0). See NOTICE.md in this
package's parent for the full attribution and the changes made from the
original: pandas/numpy import support and their IO-method blocklist were
removed entirely (quant-agent's Features are plain Python floats/lists
with no pandas/numpy dependency), which also removes the corresponding
defensive checks that existed only to guard pandas/numpy-specific attack
surface. Everything else -- the AST/regex validation, restricted
builtins, module proxy, timeout mechanism, and subprocess isolation --
is ported with the same mechanism as the original.
"""
import builtins as _builtins_mod
import os
import signal
import sys
import threading
import time
import traceback
import types
from contextlib import contextmanager
from typing import Any


class TimeoutError(Exception):
    """Raised when sandboxed code execution exceeds its time limit."""
    pass


_BUILTINS_WHITELIST: set[str] = {
    'bool', 'int', 'float', 'complex', 'str', 'bytes', 'bytearray',
    'list', 'tuple', 'dict', 'set', 'frozenset',
    'range', 'slice', 'memoryview',
    'abs', 'round', 'pow', 'divmod', 'min', 'max', 'sum',
    'len', 'enumerate', 'zip', 'map', 'filter', 'sorted', 'reversed',
    'iter', 'next', 'all', 'any',
    'repr', 'ascii', 'chr', 'ord', 'format', 'bin', 'hex', 'oct',
    'hash', 'id',
    'isinstance', 'issubclass', 'hasattr', 'callable',
    'print',
    'Exception', 'ValueError', 'TypeError', 'KeyError', 'IndexError',
    'AttributeError', 'ZeroDivisionError', 'StopIteration',
    'RuntimeError', 'OverflowError', 'ArithmeticError',
    'NotImplementedError', 'NameError', 'ImportError',
    'True', 'False', 'None',
    'Ellipsis', 'NotImplemented',
    'staticmethod', 'classmethod', 'property', 'super',
    'object',
}

SAFE_IMPORT_MODULES: set[str] = {
    'math', 'statistics', 'datetime', 'collections', 'functools',
    'itertools', 'decimal', 'fractions',
}

_FORBIDDEN_DUNDER_SUFFIXES: set[str] = {
    'builtins__', 'import__', 'class__', 'bases__', 'subclasses__', 'mro__',
    'globals__', 'code__', 'func__', 'dict__', 'module__', 'getattribute__',
    'setattr__', 'delattr__', 'init__', 'reduce__', 'getstate__', 'setstate__',
    'call__', 'getitem__', 'setitem__', 'delitem__', 'iter__', 'next__',
    'traceback__', 'closure__', 'defaults__', 'kwdefaults__',
    'loader__', 'spec__', 'path__', 'file__', 'cached__', 'package__',
}

_OPERATOR_ACCESSOR_NAMES: set[str] = {'attrgetter', 'itemgetter', 'methodcaller'}

_DANGEROUS_METHOD_NAMES: set[str] = {
    'eval', 'query',
    'getframe', 'currentframe', 'stack', 'getouterframes',
    'load_module', 'exec_module', 'create_module', 'find_module',
    'find_spec', 'path_hook', 'path_hooks', 'get_data', 'get_code',
    'get_source', 'get_resource_reader',
}

_BLOCKED_MODULE_ATTRS: set[str] = {
    '__loader__', '__spec__', '__builtins__', '__path__', '__file__',
    '__cached__', '__package__', '__dict__', '__class__', '__module__',
}
_SAFE_MODULE_DUNDER_ATTRS: set[str] = {'__name__', '__doc__', '__all__'}


class _SafeModuleProxy(types.ModuleType):
    """Read-only view of an allowed module without importer internals."""

    def __getattribute__(self, name: str) -> Any:
        if name in _BLOCKED_MODULE_ATTRS or (
            name.startswith('__')
            and name.endswith('__')
            and name not in _SAFE_MODULE_DUNDER_ATTRS
        ):
            raise AttributeError(f"module attribute is not available: {name}")
        value = super().__getattribute__(name)
        if isinstance(value, types.ModuleType) and not isinstance(value, _SafeModuleProxy):
            ok, _ = _is_safe_import_name(getattr(value, '__name__', ''))
            if not ok:
                raise AttributeError(f"module attribute is not available: {name}")
            return _wrap_imported_module(value)
        return value


_DANGEROUS_FRAME_ATTRS: set[str] = {
    'gi_frame', 'gi_code', 'gi_yieldfrom',
    'cr_frame', 'cr_code', 'cr_await',
    'ag_frame', 'ag_code', 'ag_await',
    'f_globals', 'f_locals', 'f_back', 'f_builtins',
    'f_code', 'f_trace', 'f_lasti', 'f_lineno',
    'tb_frame', 'tb_next', 'tb_lasti', 'tb_lineno',
    'func_globals', 'func_code', 'func_closure', 'func_dict',
}

def _is_safe_import_name(name: str) -> tuple[bool, str | None]:
    """Validate import names against the module whitelist."""
    root = str(name or '').split('.')[0]
    if root not in SAFE_IMPORT_MODULES:
        return False, f"Import not allowed: {name}"
    return True, None


def _wrap_imported_module(module: Any) -> Any:
    """Copy a module into a proxy that hides loader/spec escape attributes."""
    if isinstance(module, _SafeModuleProxy):
        return module
    if not isinstance(module, types.ModuleType):
        return module

    proxy = _SafeModuleProxy(getattr(module, '__name__', 'safe_module'))
    for name, value in module.__dict__.items():
        if name in _BLOCKED_MODULE_ATTRS:
            continue
        if name.startswith('__') and name.endswith('__') and name not in _SAFE_MODULE_DUNDER_ATTRS:
            continue
        setattr(proxy, name, value)
    return proxy


def _make_safe_import() -> Any:
    """Create a restricted __import__ that only allows whitelisted modules."""
    def safe_import(name: str, *args: Any, **kwargs: Any) -> Any:
        ok, err = _is_safe_import_name(name)
        if ok:
            return _wrap_imported_module(
                _builtins_mod.__import__(name, *args, **kwargs)
            )
        raise ImportError(err or f"Import not allowed: {name}")
    return safe_import


def _sanitize_exec_namespace(namespace: dict[str, Any] | None) -> None:
    """Replace ambient raw modules with importer-safe proxies in-place."""
    if namespace is None:
        return
    for name, value in list(namespace.items()):
        if name == '__builtins__':
            continue
        if isinstance(value, types.ModuleType) and not isinstance(value, _SafeModuleProxy):
            namespace[name] = _wrap_imported_module(value)


def build_safe_builtins(extra_allowed: set[str] | None = None) -> dict[str, Any]:
    """Build a restricted __builtins__ dict for sandboxed exec()."""
    allowed = _BUILTINS_WHITELIST | (extra_allowed or set())
    safe = {}
    for name in allowed:
        val = getattr(_builtins_mod, name, None)
        if val is not None:
            safe[name] = val
    safe['__import__'] = _make_safe_import()
    return safe


# --- Timeout (cross-platform) ---


class _TimeoutWatchdog:
    """One bounded watchdog thread shared by all non-main-thread executions."""

    def __init__(self) -> None:
        self._condition = threading.Condition()
        self._registrations: dict[int, tuple[float, int, float, threading.Event]] = {}
        self._next_token = 0
        self._thread: threading.Thread | None = None
        self._pid = os.getpid()
        if hasattr(os, "register_at_fork"):
            os.register_at_fork(after_in_child=self._after_fork)

    def _after_fork(self) -> None:
        self._condition = threading.Condition()
        self._registrations = {}
        self._thread = None
        self._pid = os.getpid()

    def register(
        self,
        *,
        target_tid: int,
        seconds: float,
        timed_out: threading.Event,
    ) -> int:
        with self._condition:
            current_pid = os.getpid()
            if current_pid != self._pid:
                self._pid = current_pid
                self._registrations.clear()
                self._thread = None
            self._ensure_thread_locked()
            self._next_token += 1
            token = self._next_token
            self._registrations[token] = (
                time.monotonic() + max(0.001, float(seconds)),
                int(target_tid),
                float(seconds),
                timed_out,
            )
            self._condition.notify()
            return token

    def cancel(self, token: int) -> None:
        with self._condition:
            self._registrations.pop(int(token), None)
            self._condition.notify()

    def _ensure_thread_locked(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(
            target=self._run,
            name="SafeExecTimeoutWatchdog",
            daemon=True,
        )
        self._thread.start()

    def _run(self) -> None:
        while True:
            due = []
            with self._condition:
                while not self._registrations:
                    self._condition.wait()
                now = time.monotonic()
                next_deadline = min(item[0] for item in self._registrations.values())
                if next_deadline > now:
                    self._condition.wait(next_deadline - now)
                    continue
                for token, (deadline, target_tid, seconds, timed_out) in list(
                    self._registrations.items()
                ):
                    if deadline <= now:
                        self._registrations.pop(token, None)
                        due.append((token, target_tid, seconds, timed_out))
            for _token, target_tid, seconds, timed_out in due:
                self._inject_timeout(target_tid, seconds, timed_out)

    @staticmethod
    def _inject_timeout(
        target_tid: int,
        seconds: float,
        timed_out: threading.Event,
    ) -> None:
        timed_out.set()
        try:
            import ctypes

            ret = ctypes.pythonapi.PyThreadState_SetAsyncExc(
                ctypes.c_ulong(target_tid),
                ctypes.py_object(TimeoutError),
            )
            if ret == 0:
                pass
            elif ret > 1:
                ctypes.pythonapi.PyThreadState_SetAsyncExc(
                    ctypes.c_ulong(target_tid),
                    ctypes.py_object(0),
                )
        except Exception:  # noqa: S110 - best-effort timeout injection, nothing to act on
            pass


_TIMEOUT_WATCHDOG = _TimeoutWatchdog()


@contextmanager
def timeout_context(seconds: int) -> Any:
    """Bound user-code execution time.

    Uses SIGALRM on Unix main threads and a timer-based async exception
    fallback elsewhere.
    """
    is_main_thread = threading.current_thread() is threading.main_thread()

    if sys.platform != 'win32' and is_main_thread:
        def timeout_handler(signum: int, frame: Any) -> None:
            raise TimeoutError(f"Code execution timed out after {seconds} seconds")
        try:
            old_handler = signal.signal(signal.SIGALRM, timeout_handler)
            signal.alarm(seconds)
            try:
                yield
            finally:
                signal.alarm(0)
                signal.signal(signal.SIGALRM, old_handler)
            return
        except ValueError:
            pass

    target_tid = threading.current_thread().ident
    if target_tid is None:
        raise RuntimeError("Current execution thread has no identifier")
    timed_out = threading.Event()
    token = _TIMEOUT_WATCHDOG.register(
        target_tid=target_tid,
        seconds=float(seconds),
        timed_out=timed_out,
    )
    try:
        yield
    finally:
        _TIMEOUT_WATCHDOG.cancel(token)
        if timed_out.is_set():
            raise TimeoutError(f"Code execution timed out after {seconds} seconds")


# --- Core execution ---


def safe_exec_code(
    code: str,
    exec_globals: dict[str, Any],
    exec_locals: dict[str, Any] | None = None,
    timeout: int = 30,
    max_memory_mb: int | None = None,
) -> dict[str, Any]:
    """Validate and execute Python code with sandbox namespace/timeout guards."""
    is_safe, validation_error = validate_code_safety(code)
    if not is_safe:
        return {
            'success': False,
            'error': f"Unsafe code rejected: {validation_error}",
            'result': None,
        }

    exec_globals['__builtins__'] = build_safe_builtins()
    if exec_locals is None:
        exec_locals = exec_globals
    elif exec_locals is not exec_globals:
        exec_locals['__builtins__'] = exec_globals['__builtins__']
    _sanitize_exec_namespace(exec_globals)
    if exec_locals is not exec_globals:
        _sanitize_exec_namespace(exec_locals)

    if max_memory_mb is None:
        max_memory_mb = 500

    try:
        rlimit_enabled = (
            sys.platform != 'win32'
            and os.getenv('SAFE_EXEC_ENABLE_RLIMIT', 'false').lower() == 'true'
        )
        if rlimit_enabled:
            try:
                import resource
                max_memory_bytes = max_memory_mb * 1024 * 1024
                resource.setrlimit(resource.RLIMIT_AS, (max_memory_bytes, max_memory_bytes))
            except (ImportError, ValueError, OSError):
                pass

        with timeout_context(timeout):
            # validate_code_safety(code) already ran at the top of this function.
            exec(code, exec_globals, exec_locals)  # noqa: S102

        return {'success': True, 'error': None, 'result': None}

    except MemoryError:
        error_msg = f"Code execution exceeded the {max_memory_mb}MB memory limit"
        return {'success': False, 'error': error_msg, 'result': None}
    except TimeoutError as e:
        return {'success': False, 'error': str(e), 'result': None}
    except Exception as e:
        error_msg = f"Code execution error: {str(e)}\n{traceback.format_exc()}"
        return {'success': False, 'error': error_msg, 'result': None}


def safe_exec_with_validation(
    code: str,
    exec_globals: dict[str, Any],
    exec_locals: dict[str, Any] | None = None,
    timeout: int = 60,
    max_memory_mb: int | None = None,
    pre_import: str = "",
) -> dict[str, Any]:
    """Validate + execute user code in one call.

    1. Runs validate_code_safety(); rejects unsafe code.
    2. Replaces any caller-provided builtins with build_safe_builtins().
    3. Wraps pre-injected module objects to hide importer metadata.
    4. Executes pre_import (if any), then user code via safe_exec_code().
    """
    is_safe, err = validate_code_safety(code)
    if not is_safe:
        return {'success': False, 'error': f"Unsafe code rejected: {err}", 'result': None}

    exec_globals['__builtins__'] = build_safe_builtins()
    if exec_locals is not None and exec_locals is not exec_globals:
        exec_locals['__builtins__'] = exec_globals['__builtins__']
    _sanitize_exec_namespace(exec_globals)
    if exec_locals is not None and exec_locals is not exec_globals:
        _sanitize_exec_namespace(exec_locals)

    if pre_import:
        pre_import_safe, pre_import_err = validate_code_safety(pre_import)
        if not pre_import_safe:
            return {
                'success': False,
                'error': f"Unsafe pre-import rejected: {pre_import_err}",
                'result': None,
            }
        try:
            exec(pre_import, exec_globals)  # noqa: S102 - validate_code_safety() just ran above
        except Exception as e:
            return {'success': False, 'error': f"Pre-import failed: {e}", 'result': None}

    return safe_exec_code(
        code=code,
        exec_globals=exec_globals,
        exec_locals=exec_locals,
        timeout=timeout,
        max_memory_mb=max_memory_mb,
    )


# --- Subprocess isolation ---


def safe_exec_isolated(
    code: str,
    input_data: dict[str, Any] | None = None,
    timeout: int = 60,
    max_memory_mb: int = 500,
) -> dict[str, Any]:
    """Execute user code in an isolated subprocess.

    Data is serialized via pickle through pipes. The subprocess has its own
    memory space; a crash or infinite loop only kills the child.

    Args:
        code: Python code to execute
        input_data: dict of variable names to inject (must be picklable)
        timeout: max seconds
        max_memory_mb: memory limit (Linux only, via RLIMIT_AS)

    Returns:
        dict with 'success', 'error', 'result' (the child's exec_env after run)
    """
    import multiprocessing
    import pickle

    is_safe, err = validate_code_safety(code)
    if not is_safe:
        return {'success': False, 'error': f"Unsafe code rejected: {err}", 'result': None}

    def _worker(
        code: str,
        input_data: dict[str, Any] | None,
        max_memory_mb: int,
        result_pipe: Any,
    ) -> None:
        try:
            if sys.platform != 'win32':
                try:
                    import resource
                    mem = max_memory_mb * 1024 * 1024
                    resource.setrlimit(resource.RLIMIT_AS, (mem, mem))
                except Exception:  # noqa: S110 - best-effort memory cap, not fatal if unsupported
                    pass

            exec_env: dict[str, Any] = {'__builtins__': build_safe_builtins()}
            if input_data:
                exec_env.update(input_data)

            # Input data is caller-controlled and must not replace the
            # sandbox builtins or smuggle raw module objects into the child.
            exec_env['__builtins__'] = build_safe_builtins()
            _sanitize_exec_namespace(exec_env)

            exec(code, exec_env)  # noqa: S102 - the sandbox itself; validated above

            # Extract only picklable, non-module results.
            output = {}
            for k, v in exec_env.items():
                if k.startswith('_'):
                    continue
                try:
                    pickle.dumps(v)
                    output[k] = v
                except Exception:  # noqa: S110 - unpicklable locals are just dropped
                    pass

            result_pipe.send({'success': True, 'error': None, 'result': output})
        except Exception as e:
            result_pipe.send({
                'success': False,
                'error': f"{type(e).__name__}: {e}",
                'result': None,
            })
        finally:
            result_pipe.close()

    parent_conn, child_conn = multiprocessing.Pipe(duplex=False)

    proc = multiprocessing.Process(
        target=_worker,
        args=(code, input_data, max_memory_mb, child_conn),
        daemon=True,
    )
    proc.start()
    child_conn.close()

    # Drain the pipe BEFORE joining, not after. `os.write()` to a pipe
    # blocks once the kernel buffer (commonly 64KB on Linux) is full, so a
    # child whose pickled result exceeds that size would block forever
    # inside `result_pipe.send()` if nothing reads until after `proc.join()`
    # returns -- `join()` itself never touches the pipe, so parent and child
    # would deadlock (parent waiting to join, child waiting for buffer
    # space). Reading first lets the child keep writing (and finish) while
    # the parent concurrently drains it; `join()` below is then expected to
    # return almost immediately.
    result: dict[str, Any] | None = None
    try:
        if parent_conn.poll(timeout=timeout):
            try:
                result = parent_conn.recv()
            except Exception:  # noqa: S110 - corrupt/partial payload treated as "no result" below
                result = None
    finally:
        parent_conn.close()

    proc.join(timeout=5)

    if proc.is_alive():
        proc.kill()
        proc.join(timeout=5)
        return {
            'success': False,
            'error': f"Code execution timed out after {timeout} seconds; subprocess terminated",
            'result': None,
        }

    if result is not None:
        return result

    if proc.exitcode != 0:
        return {
            'success': False,
            'error': f"Subprocess exited abnormally (exit code: {proc.exitcode})",
            'result': None,
        }

    return {'success': False, 'error': "Subprocess returned no result", 'result': None}


# --- Batch subprocess isolation (backtest-only) ---


def safe_exec_isolated_batch(
    code: str,
    per_call_inputs: list[dict[str, Any]],
    wall_clock_timeout: int = 90,
    per_call_timeout: int = 1,
    max_memory_mb: int = 500,
) -> dict[str, Any]:
    """Run `evaluate(features)` many times inside ONE isolated subprocess.

    This is the backtest-only sibling of `safe_exec_isolated`, which spawns a
    fresh subprocess PER CALL -- correct for a single live per-bar decision,
    but far too slow to replay thousands of historical bars (subprocess
    spawn overhead alone would dominate). Here, one subprocess is spawned for
    the whole batch: `exec()` runs once to define `evaluate`, then the child
    calls it once per entry in `per_call_inputs`, each call individually
    bounded by `per_call_timeout` (a SIGALRM-based interrupt, same mechanism
    as `timeout_context`) so one pathological bar cannot silently consume the
    whole batch budget. The child also checks a wall-clock deadline before
    each call and stops early (returning whatever it already computed, with
    `truncated: True`) rather than relying solely on the parent's hard kill.
    The parent still enforces `wall_clock_timeout` as the ultimate backstop
    via `proc.join()` + `proc.kill()`, identical in spirit to
    `safe_exec_isolated`'s own timeout handling.

    Known, deliberate semantic difference from the live per-call path: this
    reuses ONE exec'd namespace across every call in the batch, whereas live
    evaluation gives every single call a brand-new subprocess with zero
    carried state. `evaluate(features)` is already required to be a pure
    function of the full `features` history it's handed each call (live and
    batch alike), so this does not change what CORRECT strategy code can
    observe -- but code that (incorrectly) binds a mutable module-level
    global would accumulate state across a batch that could never
    accumulate across independent live calls. This is intentionally left as
    a documented asymmetry rather than a new AST restriction: the existing
    safety validation already governs what the code may DO, not how many
    times a well-behaved `evaluate()` may be called against the same
    interpreter state.

    Args:
        code: source defining a module-level `evaluate(features)` function.
        per_call_inputs: one dict per bar, passed as `features` to `evaluate`.
        wall_clock_timeout: hard ceiling (seconds) for the ENTIRE batch.
        per_call_timeout: ceiling (seconds) for a SINGLE `evaluate()` call.
        max_memory_mb: memory limit for the one child process (Linux only).

    Returns:
        dict with 'success', 'error', and on success 'result':
        {'outputs': list[dict | None] (aligned 1:1 with per_call_inputs,
        shorter than the input if truncated), 'truncated': bool}.
    """
    import multiprocessing

    is_safe, err = validate_code_safety(code)
    if not is_safe:
        return {'success': False, 'error': f"Unsafe code rejected: {err}", 'result': None}

    def _worker(
        code: str,
        per_call_inputs: list[dict[str, Any]],
        wall_clock_timeout: int,
        per_call_timeout: int,
        max_memory_mb: int,
        result_pipe: Any,
    ) -> None:
        try:
            if sys.platform != 'win32':
                try:
                    import resource
                    mem = max_memory_mb * 1024 * 1024
                    resource.setrlimit(resource.RLIMIT_AS, (mem, mem))
                except Exception:  # noqa: S110 - best-effort memory cap, not fatal if unsupported
                    pass

            exec_env: dict[str, Any] = {'__builtins__': build_safe_builtins()}
            _sanitize_exec_namespace(exec_env)
            exec(code, exec_env)  # noqa: S102 - the sandbox itself; validated above

            evaluate_fn = exec_env.get('evaluate')
            if not callable(evaluate_fn):
                result_pipe.send({
                    'success': False,
                    'error': "Code does not define a callable 'evaluate' function",
                    'result': None,
                })
                return

            deadline = time.monotonic() + max(0.001, float(wall_clock_timeout))
            outputs: list[Any] = []
            truncated = False
            for features_view in per_call_inputs:
                if time.monotonic() >= deadline:
                    truncated = True
                    break
                try:
                    with timeout_context(per_call_timeout):
                        output = evaluate_fn(features_view)
                except Exception:
                    # Contract parity with the live path: a single bar's
                    # failure (including a per-call timeout) never aborts
                    # the batch -- it's recorded as "no signal" for that
                    # bar, exactly as GeneratedCodeStrategy.evaluate() never
                    # raises to its own caller.
                    output = None
                outputs.append(output)

            result_pipe.send({
                'success': True,
                'error': None,
                'result': {'outputs': outputs, 'truncated': truncated},
            })
        except Exception as e:
            result_pipe.send({
                'success': False,
                'error': f"{type(e).__name__}: {e}",
                'result': None,
            })
        finally:
            result_pipe.close()

    parent_conn, child_conn = multiprocessing.Pipe(duplex=False)

    proc = multiprocessing.Process(
        target=_worker,
        args=(
            code,
            per_call_inputs,
            wall_clock_timeout,
            per_call_timeout,
            max_memory_mb,
            child_conn,
        ),
        daemon=True,
    )
    proc.start()
    child_conn.close()

    # Drain the pipe BEFORE joining, not after -- same fix, same reason, as
    # `safe_exec_isolated` (see that function's comment). This matters more
    # here: a batch's pickled `outputs` list grows with every bar, so it is
    # far more likely than a single live call to exceed the pipe's kernel
    # buffer and deadlock a join-then-read ordering.
    result: dict[str, Any] | None = None
    try:
        if parent_conn.poll(timeout=wall_clock_timeout + 10):
            try:
                result = parent_conn.recv()
            except Exception:  # noqa: S110 - corrupt/partial payload treated as "no result" below
                result = None
    finally:
        parent_conn.close()

    proc.join(timeout=5)

    if proc.is_alive():
        proc.kill()
        proc.join(timeout=5)
        return {
            'success': False,
            'error': (
                f"Batch execution timed out after {wall_clock_timeout} seconds; "
                "subprocess terminated"
            ),
            'result': None,
        }

    if result is not None:
        return result

    if proc.exitcode != 0:
        return {
            'success': False,
            'error': f"Subprocess exited abnormally (exit code: {proc.exitcode})",
            'result': None,
        }

    return {'success': False, 'error': "Subprocess returned no result", 'result': None}


# --- Static validation ---


def _fold_string_constant(node: Any) -> str | None:
    """Resolve compile-time string concatenation for sandbox static checks."""
    import ast

    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left = _fold_string_constant(node.left)
        right = _fold_string_constant(node.right)
        if left is not None and right is not None:
            return left + right
    return None


def _string_has_forbidden_dunder(text: str) -> bool:
    """Reject string literals that name introspection / escape dunders."""
    if not text or '__' not in text:
        return False
    lowered = text.lower()
    for suffix in _FORBIDDEN_DUNDER_SUFFIXES:
        if suffix in lowered:
            return True
    return False


def _is_operator_accessor_call(node: Any) -> bool:
    import ast

    if not isinstance(node, ast.Call):
        return False
    func = node.func
    if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name):
        return func.value.id == 'operator' and func.attr in _OPERATOR_ACCESSOR_NAMES
    if isinstance(func, ast.Name):
        return func.id in _OPERATOR_ACCESSOR_NAMES
    return False


def _allowed_modules_hint() -> str:
    return f"Allowed modules: {', '.join(sorted(SAFE_IMPORT_MODULES))}"


def validate_code_safety(code: str) -> tuple[bool, str | None]:
    """Validate code safety with regex and AST checks."""
    import ast
    import re

    dangerous_patterns = [
        r'\bos\.system\b', r'\bos\.popen\b', r'\bos\.spawn\b',
        r'\bos\.exec\b', r'\bos\.fork\b', r'\bos\.environ\b',
        r'\bos\.getenv\b', r'\bos\.putenv\b',
        r'\bos\.remove\b', r'\bos\.unlink\b', r'\bos\.rmdir\b',
        r'\bos\.makedirs\b', r'\bos\.mkdir\b',
        r'\bos\.listdir\b', r'\bos\.walk\b', r'\bos\.scandir\b',
        r'\bos\.path\b',
        r'\bsubprocess\b', r'\bcommands\b',
        r'\b__import__\s*\(', r'\beval\s*\(', r'\bexec\s*\(',
        r'\bcompile\s*\(', r'\bopen\s*\(', r'\bfile\s*\(',
        r'\b__builtins__\b',
        r'\bimport\s+os\b', r'\bimport\s+sys\b',
        r'\bimport\s+subprocess\b', r'\bimport\s+shutil\b',
        r'\bimport\s+pymysql\b', r'\bimport\s+sqlite3\b',
        r'\bimport\s+psycopg\b', r'\bimport\s+sqlalchemy\b',
        r'\bimport\s+requests\b', r'\bimport\s+urllib\b',
        r'\bimport\s+http\b', r'\bimport\s+socket\b',
        r'\bimport\s+ftplib\b', r'\bimport\s+telnetlib\b',
        r'\bimport\s+smtplib\b', r'\bimport\s+ssl\b',
        r'\bimport\s+pickle\b', r'\bimport\s+cpickle\b',
        r'\bimport\s+marshal\b', r'\bimport\s+shelve\b',
        r'\bimport\s+ctypes\b', r'\bimport\s+cffi\b',
        r'\bimport\s+multiprocessing\b', r'\bimport\s+threading\b',
        r'\bimport\s+concurrent\b', r'\bimport\s+asyncio\b',
        r'\bimport\s+signal\b', r'\bimport\s+resource\b',
        r'\bimport\s+importlib\b', r'\bimport\s+imp\b',
        r'\bimport\s+builtins\b', r'\bimport\s+code\b',
        r'\bimport\s+codeop\b', r'\bimport\s+runpy\b',
        r'\bimport\s+tempfile\b', r'\bimport\s+glob\b',
        r'\bimport\s+pathlib\b', r'\bimport\s+io\b',
        r'\bimport\s+operator\b',
        r'\bimport\s+numpy\b', r'\bimport\s+pandas\b',
        r'\bimport\s+inspect\b',
        r'\boperator\.(attrgetter|itemgetter|methodcaller)\b',
        r'\bgetattr\s*\(', r'\bsetattr\s*\(', r'\bdelattr\s*\(',
        r'\b__getattribute__\b', r'\b__setattr__\b', r'\b__delattr__\b',
        r'\b__dict__\b', r'\b__class__\b', r'\b__bases__\b',
        r'\b__subclasses__\b', r'\b__mro__\b', r'\b__module__\b',
        r'\b__globals__\b', r'\b__code__\b', r'\b__func__\b',
        r'\bglobals\s*\(', r'\bvars\s*\(', r'\bdir\s*\(',
        r'\bbreakpoint\s*\(',
        r'\b__builtins__\s*[\[.]', r'\b__import__\s*\(',
        r'\bimportlib\b',
        # Frame / traceback / closure chains used to break out of the sandbox.
        r'\.(gi_frame|gi_code|cr_frame|cr_code|ag_frame|ag_code|'
        r'f_globals|f_locals|f_back|f_builtins|f_code|f_trace|'
        r'tb_frame|tb_next|func_globals|func_code|func_closure)\b',
        # sys.settrace / inspect.* could also pivot; block by name.
        r'\b(sys\._getframe|inspect\.(currentframe|stack|getouterframes|getframeinfo))\b',
    ]

    for pattern in dangerous_patterns:
        if re.search(pattern, code):
            return False, f"Unsafe code pattern detected: {pattern}"

    try:
        tree = ast.parse(code)
    except SyntaxError:
        return False, "Code syntax error"
    except Exception:
        # AST parse failure: reject fail-closed, not fail-open.
        return False, "Code parse failed"

    # NOTE: these names are checked on attribute calls and attribute aliases
    # like `mod.func(...)` or `fn = mod.func`.
    dangerous_modules = {
        'os', 'sys', 'subprocess', 'shutil', 'resource', 'operator',
        'pymysql', 'sqlite3', 'psycopg2', 'sqlalchemy',
        'requests', 'urllib', 'socket', 'ftplib', 'telnetlib', 'smtplib',
        'marshal', 'shelve',
        'ctypes', 'cffi',
        'multiprocessing', 'threading', 'concurrent', 'asyncio',
        'importlib', 'imp', 'builtins', 'codeop', 'runpy',
        'tempfile', 'glob', 'pathlib',
        'numpy', 'pandas', 'np', 'pd', 'inspect',
    }

    dangerous_call_names = {
        'eval', 'exec', 'compile', '__import__',
        'getattr', 'setattr', 'delattr',
        'globals', 'vars', 'dir', 'breakpoint',
        'open', 'input', 'exit', 'quit',
    }

    dangerous_dunder_attrs = {
        '__builtins__', '__import__', '__class__', '__bases__',
        '__subclasses__', '__mro__', '__globals__', '__code__',
        '__func__', '__dict__', '__module__', '__loader__', '__spec__',
        '__path__', '__file__', '__cached__', '__package__',
    }

    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            if _string_has_forbidden_dunder(node.value):
                return False, "Unsafe dunder string literal detected"

        if isinstance(node, ast.Import):
            for alias in node.names:
                ok, err = _is_safe_import_name(alias.name)
                if not ok:
                    return False, f"Import not allowed: '{alias.name}'. {_allowed_modules_hint()}"

        elif isinstance(node, ast.ImportFrom):
            if node.module:
                ok, err = _is_safe_import_name(node.module)
                if not ok:
                    return False, f"Import not allowed: '{node.module}'. {_allowed_modules_hint()}"

                for alias in node.names:
                    if alias.name == '*':
                        return False, "Wildcard imports are not allowed"
                    if alias.name.startswith('_'):
                        return False, f"Private import attributes are not allowed: {alias.name}"
                    if alias.name.lstrip('_') in dangerous_modules:
                        return False, f"Unsafe imported module detected: {alias.name}"
                    if alias.name in dangerous_dunder_attrs or (
                        alias.name.startswith('__') and alias.name.endswith('__')
                    ):
                        return False, f"Unsafe import attribute detected: {alias.name}"
                    if alias.name in _DANGEROUS_METHOD_NAMES:
                        return False, f"Unsafe imported capability detected: {alias.name}"
                    ok, err = _is_safe_import_name(f"{node.module}.{alias.name}")
                    if not ok:
                        return False, err or f"Import not allowed: {node.module}.{alias.name}"

        elif isinstance(node, ast.Call):
            if _is_operator_accessor_call(node):
                return False, "operator.attrgetter/itemgetter/methodcaller are not allowed"
            if isinstance(node.func, ast.Name) and node.func.id in dangerous_call_names:
                return False, f"Unsafe function call detected: {node.func.id}()"
            if isinstance(node.func, ast.Attribute):
                func_owner = node.func.value
                if isinstance(func_owner, ast.Name) and func_owner.id in dangerous_modules:
                    return False, f"Unsafe module call detected: {func_owner.id}.{node.func.attr}"
                # Block dangerous methods on any receiver — we cannot tell
                # statically whether `x.foo(...)` targets a safe local value
                # or something that pivots (e.g. an import-machinery method).
                if isinstance(node.func.attr, str) and node.func.attr in _DANGEROUS_METHOD_NAMES:
                    return False, f"Unsafe method call detected: .{node.func.attr}()"
            for arg in node.args:
                folded = _fold_string_constant(arg)
                if folded is not None and _string_has_forbidden_dunder(folded):
                    return False, "Unsafe dunder string argument detected"

        elif isinstance(node, ast.Attribute):
            if isinstance(node.attr, str) and (
                node.attr in dangerous_dunder_attrs
                or (
                    node.attr.startswith('__')
                    and node.attr.endswith('__')
                    and node.attr not in _SAFE_MODULE_DUNDER_ATTRS
                )
            ):
                return False, f"Unsafe attribute access detected: .{node.attr}"
            # Reject dangerous capability attributes even when user code first
            # stores the bound method and calls it indirectly later
            # (``loader.load_module`` -> ``fn = ...; fn('os')``).
            if isinstance(node.attr, str) and node.attr in _DANGEROUS_METHOD_NAMES:
                return False, f"Unsafe method access detected: .{node.attr}"
            if isinstance(node.attr, str) and node.attr in _DANGEROUS_FRAME_ATTRS:
                return False, f"Unsafe frame/closure attribute access detected: .{node.attr}"
            folded = _fold_string_constant(node)
            if folded is not None and _string_has_forbidden_dunder(folded):
                return False, "Unsafe dunder attribute access detected"

        elif isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
            folded = _fold_string_constant(node)
            if folded is not None and _string_has_forbidden_dunder(folded):
                return False, "Unsafe dunder string concatenation detected"

    return True, None
