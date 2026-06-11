#!/usr/bin/env bash
set -euo pipefail

export WINEDLLOVERRIDES="ucrtbase=n,b;api-ms-win-crt-runtime-l1-1-0=n,b"

rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 2>/dev/null || true
Xvfb :99 -screen 0 1280x800x16 &
sleep 2

echo "[mt5-bridge] starting REST shim on :18812"
exec wine C:\\Python39\\python.exe Z:\\opt\\shim.py
