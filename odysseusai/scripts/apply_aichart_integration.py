#!/usr/bin/env python3
"""Patch an Odysseus checkout to load the bundled AiChart chat integration.

Run from the `odysseusai/` directory after these files are present there:

    python scripts/apply_aichart_integration.py

The patch is idempotent and only edits app.py and static/index.html.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app.py"
INDEX = ROOT / "static" / "index.html"

APP_MARKER = "# ========= INCLUDE ROUTERS ========="
APP_INSERT = """
# AiChart Trading Workspace
from routes.aichart_routes import setup_aichart_routes
app.include_router(setup_aichart_routes())
"""

HEAD_MARKER = "<head>"
ASSET_INSERT = """
  <link rel="stylesheet" href="/static/aichart_chat_panel.css">
  <script defer src="/static/js/aichart_chat_panel.js"></script>"""


def patch_once(path: Path, marker: str, insert: str) -> None:
    text = path.read_text(encoding="utf-8")
    if insert.strip() in text:
        print(f"already patched {path.relative_to(ROOT)}")
        return
    if marker not in text:
        raise SystemExit(f"Cannot patch {path}: marker not found: {marker!r}")
    path.write_text(text.replace(marker, marker + insert, 1), encoding="utf-8")
    print(f"patched {path.relative_to(ROOT)}")


def main() -> None:
    if not APP.exists():
        raise SystemExit(f"Missing {APP}")
    if not INDEX.exists():
        raise SystemExit(f"Missing {INDEX}")
    patch_once(APP, APP_MARKER, APP_INSERT)
    patch_once(INDEX, HEAD_MARKER, ASSET_INSERT)
    print("AiChart integration enabled in Odysseus.")


if __name__ == "__main__":
    main()
