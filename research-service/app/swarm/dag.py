from __future__ import annotations

from collections import defaultdict

from app.errors import ServiceError
from app.swarm.models import SwarmTask


def validate_dag(tasks: list[SwarmTask], *, max_tasks: int, max_depth: int) -> list[list[str]]:
    if not tasks or len(tasks) > max_tasks:
        raise ServiceError("SWARM_DAG_INVALID", "task graph size is invalid", 422)
    by_id = {task.task_id: task for task in tasks}
    if len(by_id) != len(tasks):
        raise ServiceError("SWARM_DAG_INVALID", "duplicate task identifier", 422)
    for task in tasks:
        if task.task_id in task.dependencies:
            raise ServiceError("SWARM_DAG_INVALID", "task cannot depend on itself", 422)
        if any(dependency not in by_id for dependency in task.dependencies):
            raise ServiceError("SWARM_DAG_INVALID", "task dependency is missing", 422)
    layers = topological_layers(tasks)
    if len(layers) > max_depth:
        raise ServiceError("SWARM_DAG_INVALID", "task graph depth exceeds server limit", 422)
    return layers


def topological_layers(tasks: list[SwarmTask]) -> list[list[str]]:
    by_id = {task.task_id: task for task in tasks}
    indegree = {task.task_id: len(set(task.dependencies)) for task in tasks}
    children: dict[str, list[str]] = defaultdict(list)
    for task in tasks:
        for dependency in set(task.dependencies):
            children[dependency].append(task.task_id)
    ready = sorted(task_id for task_id, degree in indegree.items() if degree == 0)
    layers: list[list[str]] = []
    visited = 0
    while ready:
        layer = ready
        layers.append(layer)
        visited += len(layer)
        following: list[str] = []
        for task_id in layer:
            for child in sorted(children.get(task_id, [])):
                indegree[child] -= 1
                if indegree[child] == 0:
                    following.append(child)
        ready = sorted(set(following))
    if visited != len(by_id):
        raise ServiceError("SWARM_DAG_INVALID", "task graph contains a cycle", 422)
    return layers


def deterministic_order(tasks: list[SwarmTask]) -> list[str]:
    return [task_id for layer in topological_layers(tasks) for task_id in layer]
