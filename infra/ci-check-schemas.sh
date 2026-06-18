#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../mcp"
npm run schemas:check
