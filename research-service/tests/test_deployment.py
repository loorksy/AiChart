from pathlib import Path


def test_dockerfile_is_non_root_pinned_and_has_no_baked_secret() -> None:
    root = Path(__file__).parents[1]
    dockerfile = (root / "Dockerfile").read_text(encoding="utf-8")
    lock = (root / "requirements.lock").read_text(encoding="utf-8")
    assert "USER 10001:10001" in dockerfile
    assert "HEALTHCHECK" in dockerfile
    assert "requirements.lock" in dockerfile
    assert "RESEARCH_SERVICE_INTERNAL_TOKEN=" not in dockerfile
    assert "openssh" not in dockerfile.lower()
    assert "browser" not in dockerfile.lower()
    assert all("==" in line for line in lock.splitlines() if line.strip())


def test_compose_profile_is_opt_in_and_restrictive() -> None:
    compose = (Path(__file__).parents[2] / "infra" / "docker-compose.yml").read_text(
        encoding="utf-8"
    )
    research = compose.split("  research:\n", 1)[1].split("\n  mt5:", 1)[0]
    assert 'profiles: ["research"]' in research
    assert "read_only: true" in research
    assert "cap_drop:" in research and "- ALL" in research
    assert "no-new-privileges:true" in research
    assert "research-internal" in research
    assert "docker.sock" not in research
    assert "../web" not in research
    assert "research-work:/var/lib/aichart-research/work" in research
    assert "RESEARCH_SWARM_ENABLED=${RESEARCH_SWARM_ENABLED:-0}" in research
    assert "RESEARCH_SWARM_PRESETS_ENABLED=${RESEARCH_SWARM_PRESETS_ENABLED:-0}" in research
    assert "RESEARCH_SERVICE_STORAGE=sqlite" in research
    assert "RESEARCH_SERVICE_JOB_DB_PATH=/var/lib/aichart-research/work/" in research
    assert "/var/lib/aichart-research/work:size=" not in research


def test_optional_capture_flags_and_redis_are_safe_by_default() -> None:
    root = Path(__file__).parents[2]
    dockerfile = (root / "infra" / "Dockerfile").read_text(encoding="utf-8")
    compose = (root / "infra" / "docker-compose.yml").read_text(encoding="utf-8")
    assert "ENV BINANCE_CAPTURE_ENABLED=0" in dockerfile
    assert "ENV TRADINGVIEW_MCP_ENABLED=0" in dockerfile
    assert "BINANCE_CAPTURE_ENABLED=${BINANCE_CAPTURE_ENABLED:-0}" in compose
    assert "TRADINGVIEW_MCP_ENABLED=${TRADINGVIEW_MCP_ENABLED:-0}" in compose
    assert '"127.0.0.1:3000:3000"' in compose
    redis = compose.split("  redis:\n", 1)[1].split("\nvolumes:\n", 1)[0]
    assert "--appendonly yes" in redis
    assert "redis-data:/data" in redis
    assert "healthcheck:" in redis
