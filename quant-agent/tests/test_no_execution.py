"""THE EXECUTION BOUNDARY.

This module is the machine-checked statement of the one promise the bot track
makes: there is no code path from this service to a real broker, and adding one
cannot happen by accident.

Two independent claims, each checked structurally rather than by reading:

  1. **No network.** No module under `app/engine/bots/` imports httpx,
     requests, socket, urllib, http.client, aiohttp, websockets, ftplib,
     smtplib, telnetlib or asyncio's network helpers — directly, as a `from`
     import, or through a dynamic `__import__`/`importlib` call.
  2. **One broker.** `QuantBrokerPort` is declared exactly once in the tree,
     and `SimulatedQuantBroker` is the only class anywhere that implements it —
     checked both by AST (who names it as a base) and at runtime (who is
     registered as a subclass, and who structurally satisfies the protocol).

If someone adds a live broker, both halves of (2) fail and this file names the
new class. That is the intended review trigger: wiring real execution must be a
deliberate, visible change, never a configuration toggle.
"""

from __future__ import annotations

import ast
import importlib
import inspect
import pkgutil
from pathlib import Path

import app
from app.engine.bots.engine import QuantBrokerPort
from app.engine.bots.simulated_broker import SimulatedQuantBroker

APP_ROOT = Path(app.__file__).resolve().parent
BOTS_ROOT = APP_ROOT / "engine" / "bots"

#: Anything here can open a connection. `asyncio` as a whole is fine; its
#: connection helpers are not, so they are matched on the attribute path.
FORBIDDEN_MODULES = frozenset(
    {
        "aiohttp",
        "ftplib",
        "http",
        "httpx",
        "requests",
        "smtplib",
        "socket",
        "ssl",
        "telnetlib",
        "urllib",
        "urllib3",
        "websocket",
        "websockets",
        "xmlrpc",
    }
)

FORBIDDEN_CALL_PATHS = (
    "asyncio.open_connection",
    "asyncio.start_server",
    "socket.socket",
    "urllib.request.urlopen",
)


def _bot_modules() -> list[Path]:
    files = sorted(BOTS_ROOT.rglob("*.py"))
    assert files, "app/engine/bots contains no modules — the scan would pass vacuously"
    return files


def _all_app_modules() -> list[Path]:
    return sorted(APP_ROOT.rglob("*.py"))


def _root_of(name: str) -> str:
    return name.split(".", 1)[0]


def test_no_bot_module_imports_a_network_library() -> None:
    offenders: list[str] = []
    for path in _bot_modules():
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if _root_of(alias.name) in FORBIDDEN_MODULES:
                        offenders.append(f"{path.name}:{node.lineno} import {alias.name}")
            elif isinstance(node, ast.ImportFrom) and node.module:
                if _root_of(node.module) in FORBIDDEN_MODULES:
                    offenders.append(f"{path.name}:{node.lineno} from {node.module}")
    assert offenders == [], f"network imports under app/engine/bots: {offenders}"


def test_no_bot_module_imports_a_network_library_dynamically() -> None:
    """A static import scan is only worth as much as the absence of
    `__import__("httpx")` and `importlib.import_module(...)` beside it."""
    offenders: list[str] = []
    for path in _bot_modules():
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            target = node.func
            name = ""
            if isinstance(target, ast.Name):
                name = target.id
            elif isinstance(target, ast.Attribute):
                name = target.attr
            if name in ("__import__", "import_module", "eval", "exec", "compile"):
                offenders.append(f"{path.name}:{node.lineno} {name}(...)")
    assert offenders == [], f"dynamic import/eval under app/engine/bots: {offenders}"


def test_no_bot_module_calls_a_connection_helper() -> None:
    offenders: list[str] = []
    for path in _bot_modules():
        source = path.read_text(encoding="utf-8")
        for needle in FORBIDDEN_CALL_PATHS:
            if needle in source:
                offenders.append(f"{path.name}: {needle}")
    assert offenders == [], f"connection helpers under app/engine/bots: {offenders}"


def test_the_broker_port_is_declared_exactly_once() -> None:
    declarations = [
        path.relative_to(APP_ROOT).as_posix()
        for path in _all_app_modules()
        if any(
            isinstance(node, ast.ClassDef) and node.name == "QuantBrokerPort"
            for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"), filename=str(path)))
        )
    ]
    assert declarations == ["engine/bots/engine.py"]


def test_simulated_quant_broker_is_the_only_declared_implementation() -> None:
    """AST view: who names `QuantBrokerPort` as a base class?"""
    implementations: list[tuple[str, str]] = []
    for path in _all_app_modules():
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.ClassDef):
                continue
            for base in node.bases:
                base_name = (
                    base.id
                    if isinstance(base, ast.Name)
                    else base.attr
                    if isinstance(base, ast.Attribute)
                    else ""
                )
                if base_name == "QuantBrokerPort":
                    implementations.append((path.relative_to(APP_ROOT).as_posix(), node.name))
    assert implementations == [("engine/bots/simulated_broker.py", "SimulatedQuantBroker")]


def test_simulated_quant_broker_is_the_only_registered_subclass() -> None:
    """Runtime view: import every module, then ask the protocol itself."""
    for module_info in pkgutil.walk_packages(app.__path__, prefix="app."):
        importlib.import_module(module_info.name)
    subclasses = {cls.__name__ for cls in QuantBrokerPort.__subclasses__()}
    assert subclasses == {"SimulatedQuantBroker"}


def test_no_other_class_structurally_satisfies_the_port() -> None:
    """Structural view: a `Protocol` accepts duck types, so a live broker that
    never names the port would still be usable. Nothing else in the tree may
    have all five methods."""
    required = ("normalize_quantity", "place_limit", "cancel", "account_leg_size", "hedge_mode")
    matches: list[str] = []
    for module_info in pkgutil.walk_packages(app.__path__, prefix="app."):
        module = importlib.import_module(module_info.name)
        for name, obj in vars(module).items():
            if not inspect.isclass(obj) or obj is QuantBrokerPort:
                continue
            if obj.__module__ != module_info.name:
                continue
            if all(callable(getattr(obj, method, None)) for method in required):
                matches.append(f"{module_info.name}.{name}")
    assert matches == ["app.engine.bots.simulated_broker.SimulatedQuantBroker"]


def test_the_simulated_broker_labels_itself_as_simulation() -> None:
    assert SimulatedQuantBroker.execution_mode == "simulation"


def test_no_bot_module_mentions_a_live_execution_switch() -> None:
    """There is no flag, env var or config key that turns simulation into
    execution. If one appears, this fails and names the file."""
    needles = ("execution_mode = \"live\"", "'live'", '"live"', "os.environ", "getenv")
    offenders: list[str] = []
    for path in _bot_modules():
        source = path.read_text(encoding="utf-8")
        for needle in needles:
            if needle in source:
                offenders.append(f"{path.name}: {needle}")
    assert offenders == [], f"live-execution switch under app/engine/bots: {offenders}"
