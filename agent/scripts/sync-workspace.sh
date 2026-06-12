#!/usr/bin/env bash
# Syncs the version-controlled agent workspace into the live OpenClaw
# workspace. Knowledge files are overwritten; runtime state (memory diary,
# sessions) is never touched, and MEMORY.md is only seeded if missing.
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../workspace" && pwd)"
DEST_DIR="${OPENCLAW_WORKSPACE:-$HOME/.openclaw/workspace}"

mkdir -p "$DEST_DIR/skills" "$DEST_DIR/memory"

# Knowledge files: repo is the source of truth.
for f in SOUL.md AGENTS.md USER.md HEARTBEAT.md EA_TROUBLESHOOTING.md; do
  if [ -f "$SRC_DIR/$f" ]; then
    cp "$SRC_DIR/$f" "$DEST_DIR/$f"
    echo "synced $f"
  fi
done

# MEMORY.md: seed once — the agent owns it afterwards.
if [ -f "$SRC_DIR/MEMORY.md" ] && [ ! -f "$DEST_DIR/MEMORY.md" ]; then
  cp "$SRC_DIR/MEMORY.md" "$DEST_DIR/MEMORY.md"
  echo "seeded MEMORY.md"
fi

# Skills: replace managed skill folders wholesale.
for skill in "$SRC_DIR/skills"/*/; do
  name="$(basename "$skill")"
  rm -rf "${DEST_DIR:?}/skills/$name"
  cp -r "$skill" "$DEST_DIR/skills/$name"
  echo "synced skill $name"
done

echo "workspace synced to $DEST_DIR"
