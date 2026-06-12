#!/usr/bin/env python3
import json
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "/root/.openclaw/openclaw.json"
c = json.load(open(path))
primary = c.get("agents", {}).get("defaults", {}).get("model", {}).get("primary")
providers = c.get("models", {}).get("providers", {}).get("anthropic", {}).get("models", [])
ids = [m.get("id") for m in providers]
print("primary:", primary)
print("providers:", ", ".join(ids) if ids else "(none)")
