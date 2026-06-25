#!/usr/bin/env bash
set -euo pipefail

export WINEDLLOVERRIDES="ucrtbase=n,b;api-ms-win-crt-runtime-l1-1-0=n,b"

rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 2>/dev/null || true
Xvfb :99 -screen 0 1280x800x16 &
sleep 2

if [ -n "${MT5_BRIDGE_TOKEN:-}" ]; then
  printf '%s' "$MT5_BRIDGE_TOKEN" > /data/bridge_token
fi

# MetaTrader5 Python IPC fails under Wine on Linux (error -10005).
export MT5_CONNECT_CAPABLE="${MT5_CONNECT_CAPABLE:-0}"

MT5_DIR='C:\Program Files\MetaTrader 5'
CONFIG_WIN="${MT5_DIR}\\Config"
CONFIG_LINUX="/opt/mt5/drive_c/Program Files/MetaTrader 5/Config"
mkdir -p "$CONFIG_LINUX" /data/mt5-config
if [ -f /data/mt5-config/servers.dat ]; then
  cp /data/mt5-config/servers.dat "$CONFIG_LINUX/servers.dat"
fi

echo "[mt5-bridge] starting MT5 terminal (portable)..."
wine "${MT5_DIR}\\terminal64.exe" /portable &
for _ in $(seq 1 30); do
  if pgrep -f terminal64.exe >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
sleep 10

echo "[mt5-bridge] starting REST shim on :18812"
exec wine C:\\Python39\\python.exe Z:\\opt\\shim.py
