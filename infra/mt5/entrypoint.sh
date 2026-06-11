#!/usr/bin/env bash
set -euo pipefail

# Virtual display for the MT5 terminal.
Xvfb :99 -screen 0 1280x800x16 &
sleep 2

echo "[mt5-bridge] starting REST shim on :18812"
exec wine python /opt/shim.py
