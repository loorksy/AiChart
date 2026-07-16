# AiChart brand mark

Approved face-mark identity (two circles + diamond).

## Source

- Master vector: operator Desktop `logo/lonora.svg`
- Rejected: solid black exports, blank white square SVG, legacy hexagon `public/logo.png`

## Production files

| File | Format | Theme | Use |
|---|---|---|---|
| `aichart-mark.svg` | SVG, transparent | Dark UI (white mark) | Logo, large identity |
| `aichart-mark-light.svg` | SVG, transparent | Light UI (dark mark) | Logo, large identity |
| `aichart-mark-dark.png` | PNG, transparent | Dark UI | Fallback logo |
| `aichart-mark-light.png` | PNG, transparent | Light UI | Fallback logo |
| `aichart-avatar-32.png` / `64.png` | PNG, transparent | Dark UI | Agent avatar |
| `aichart-avatar-light-32.png` / `64.png` | PNG, transparent | Light UI | Agent avatar |

## Components

- `AiChartLogo` — theme-aware mark
- `AgentAvatar` — small 24–36px agent identity in chat/voice/empty states

Regenerate rasters: `node scripts/generate-brand-assets.mjs` (requires `sharp`).
