#!/usr/bin/env bash
set -euo pipefail

REAL="$(readlink -f /opt/aichart)"
ENV_FILE="$REAL/web/.env"
OVERRIDE="/root/aichart-runtime/research-override.yml"

set -a
# shellcheck disable=SC1091
source <(grep -E '^(RESEARCH_SERVICE_INTERNAL_TOKEN|RESEARCH_SWARM_ENABLED|RESEARCH_SWARM_PRESETS_ENABLED|RESEARCH_SERVICE_MAX_CONCURRENT_JOBS)=' "$ENV_FILE" | sed 's/\r$//')
set +a

if [[ -z "${RESEARCH_SERVICE_INTERNAL_TOKEN:-}" ]]; then
  echo "ERROR: RESEARCH_SERVICE_INTERNAL_TOKEN missing from web/.env" >&2
  exit 1
fi

echo "token_len=${#RESEARCH_SERVICE_INTERNAL_TOKEN}"
docker compose -p aichart-production \
  -f "$REAL/infra/docker-compose.yml" \
  -f "$OVERRIDE" \
  --profile research \
  up -d --no-deps research

sleep 4
docker ps --filter name=aichart-production-research --format '{{.Names}} {{.Status}}'
if curl -fsS -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:8090/healthz; then
  echo RESEARCH_OK
else
  echo RESEARCH_FAIL
  docker logs aichart-production-research-1 --tail 40
  exit 2
fi
