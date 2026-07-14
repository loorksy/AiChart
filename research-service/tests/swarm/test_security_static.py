from __future__ import annotations

import ast
from pathlib import Path

from app.swarm.policies import ROLE_POLICIES
from app.swarm.presets import PRESETS, build_tasks


def test_swarm_runtime_has_no_arbitrary_code_network_or_process_capability() -> None:
    root = Path(__file__).parents[2] / "app" / "swarm"
    forbidden_modules = {"subprocess", "importlib", "requests", "httpx", "urllib", "socket"}
    forbidden_calls = {"eval", "exec", "compile", "open", "__import__"}
    for path in root.glob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                assert not {name.name.split(".")[0] for name in node.names} & forbidden_modules
            if isinstance(node, ast.ImportFrom) and node.module:
                assert node.module.split(".")[0] not in forbidden_modules
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                assert node.func.id not in forbidden_calls


def test_no_role_or_preset_can_obtain_execution_permissions() -> None:
    denied = {
        "trade.execute",
        "trade.manage",
        "chart.write",
        "shell",
        "bash",
        "subprocess",
        "mt5",
        "broker",
        "database.query",
    }
    for role in ROLE_POLICIES.values():
        assert not set(role.allowed_tools) & denied
    for preset in PRESETS.values():
        tasks = build_tasks(preset, "swr_static", max_attempts=2, task_timeout=300)
        assert all(not set(task.allowed_tools) & denied for task in tasks)
