# PR #66 Production Deployment Report

**Status:** Not deployed.

**Decision:** `NO-GO — MANUAL RELEASE GATE FAILED`

## Summary

Manual VPS release qualification for PR #66 was started under an authorized GitHub Actions bypass (billing lock). Isolated RC gates were executed on `srv1150752` against head `2a06170be0e4870d664adabfc12205221433c08c`.

Production was **not** changed. Verified production web health commit remained:

`d995fdf52ab2983bc116407999777048ee9396e8`

## Why deployment did not proceed

Mandatory gates failed or were not verified:

- OpenAI provider not configured on VPS
- Authenticated MCP suite not run
- Browser qualification not run
- First-party lint error on changed files (at tested head)
- PostgreSQL release validator contract failure
- Historical Candidate-backed adapter path not fully verified

## Merge / deploy fields

| Field | Value |
|---|---|
| Merge commit | *none* |
| Deployed commit | *none* (production still `d995fdf`) |
| Web `/api/healthz` commit | `d995fdf…` |
| MCP `/health` commit | not re-verified this pass after RC work; production symlink unchanged |
| Live trades during qualification | **No** |
| Rollback ready | **Yes** — remain on / redeploy `d995fdf` |

See `docs/MANUAL_VPS_RELEASE_QUALIFICATION_PR66.md` for the full gate table.
