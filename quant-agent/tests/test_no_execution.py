"""THE EXECUTION BOUNDARY — service side.

The engine under `app/engine/bots/` must never open a network connection or
talk to a venue. Live arming (`execution_mode: live` on a saved bot row) is
storage/API state the web platform reads before createIntent → executeIntent;
it is NOT a second broker inside this service.

Checked structurally:

  1. **No network under `app/engine/bots/`.** No httpx/requests/socket/urllib
     (etc.), no dynamic `__import__`/`importlib`/`eval`/`exec`, no connection
     helpers. Comments are stripped before textual scans.
  2. **One broker.** `QuantBrokerPort` is declared exactly once, and
     `SimulatedQuantBroker` is the only implementation — AST, subclass, and
     structural.
"""

from __future__ import annotations

import ast
import importlib
import inspect
import pkgutil
import re
from pathlib import Path

import app
from app.engine.bots.engine import QuantBrokerPort
from app.engine.bots.simulated_broker import SimulatedQuantBroker

APP_ROOT = Path(app.__file__).resolve().parent
BOTS_ROOT = APP_ROOT / "engine" / "bots"

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


def _strip_comments(source: str) -> str:
    """Drop comments before textual scans so prose cannot false-positive."""
    try:
        return ast.unparse(ast.parse(source))
    except SyntaxError:
        # Fallback: crude strip if a file somehow fails to parse as a module
        # body (should not happen for our tree).
        no_block = re.sub(r'"""[\s\S]*?"""|\'\'\'[\s\S]*?\'\'\'', "", source)
        return re.sub(r"#.*$", "", no_block, flags=re.M)


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
        source = _strip_comments(path.read_text(encoding="utf-8"))
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
    for module_info in pkgutil.walk_packages(app.__path__, prefix="app."):
        importlib.import_module(module_info.name)
    subclasses = {cls.__name__ for cls in QuantBrokerPort.__subclasses__()}
    assert subclasses == {"SimulatedQuantBroker"}


def test_no_other_class_structurally_satisfies_the_port() -> None:
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


def test_engine_bots_do_not_import_http_clients() -> None:
    """Belt-and-braces textual scan (comments stripped) for the four names
    called out in the product invariant."""
    needles = ("httpx", "requests", "socket", "urllib")
    offenders: list[str] = []
    for path in _bot_modules():
        source = _strip_comments(path.read_text(encoding="utf-8"))
        for needle in needles:
            if re.search(rf"\b{re.escape(needle)}\b", source):
                offenders.append(f"{path.name}: {needle}")
    assert offenders == [], f"forbidden network tokens under app/engine/bots: {offenders}"
