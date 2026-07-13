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
