#!/usr/bin/env bash
MCP_SECRET=$(grep '^MCP_AUTH_SECRET=' /opt/aichart/web/.env | cut -d= -f2-)
curl -s -X POST http://127.0.0.1:3010/api/admin/mcp-auth/verify \
  -H "Content-Type: application/json" \
  -H "X-MCP-Auth-Secret: ${MCP_SECRET}" \
  -d '{"email":"loorksy@gmail.com","password":"ahmetlork0009"}'
echo ""
