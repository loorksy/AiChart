# AiChart / Lonora — DESIGN.md

The one written design system for this product. AI agents and humans generating
or reviewing UI read this file and follow it. Every value below is codified
from the live tokens in `src/app/globals.css` — when the two disagree, the CSS
is the bug or this file needs a reviewed update, never a silent fork.

## 1. Visual Theme & Atmosphere

Calm, dense, professional trading desk. **Black ink on white paper** in light
mode; **pure black surfaces** in dark mode. No grey midtone washes, no
gradients, no glow, no purple. Color is never decoration: green/red/amber/blue
appear only when they carry trading or status meaning. The interface should
feel like an instrument, not a brochure.

## 2. Color Palette & Roles

Use Tailwind semantic classes (`bg-background`, `text-muted-foreground`,
`text-buy` …) — never raw hex in components.

| Role | Token | Light | Dark | Rule |
|---|---|---|---|---|
| Surface | `--background` / `--card` | `#ffffff` | `#000000` / `#0a0a0a` | cards elevate by border, not shadow |
| Text | `--foreground` | `#000000` | `#f5f5f5` | |
| Secondary text | `--muted-foreground` | `#404040` | `#a3a3a3` | AA on its surface |
| Primary action | `--primary` | black | near-white | monochrome buttons |
| Border | `--border` | `#e5e5e5` | `#1f1f1f` | 1px, everywhere |
| **Buy / long** | `--buy` | `#15803d` | `#22c55e` | trade DIRECTION only |
| **Sell / short** | `--sell` | `#dc2626` | `#ef4444` | trade DIRECTION only |
| Healthy status | `--success` | same values as buy | | deliberately separate token — status must not drag if the trading palette is retuned |
| Warning / pending | `--warning` | `#d97706` | `#f59e0b` | conditional plans, auto-mode chip, approaching levels |
| Info | `--info` | `#0284c7` | `#38bdf8` | neutral information |
| Destructive | `--destructive` | `#dc2626` | `#ef4444` | irreversible actions only |
| Charts | `--chart-1..5` | grey/blue/green/amber/red | | series order fixed |

Hard rules:
- Buy/sell colors mean direction. Never reuse them for generic success/error.
- P&L and price text routes through `text-buy` / `text-sell` (AA-checked).
- Tradability chips: `now` → buy tones, `soon` → warning tones, `watch_only` →
  muted; `rejected` is never rendered as a card at all.

## 3. Typography

- Sans (UI, default): Cairo, falling back to Inter — Arabic-first.
- Mono (numbers, symbols, ids): JetBrains Mono. Every price, size, id, and
  code renders `font-mono`.
- Serif (marketing/landing only): Fraunces. Never inside the app shell.
- Sizes: body `text-sm`, dense metadata `text-[11px]`–`text-xs`, section
  titles `text-sm font-semibold`, page titles `text-lg font-semibold`.
- Numbers never localize their digits inside charts and levels; direction
  markers handle RTL, not digit reshaping.

## 4. Component Stylings

- **Buttons**: `components/squareui/button.tsx` variants only. Primary =
  monochrome fill; outline for secondary; destructive red reserved for
  irreversible acts. Min touch target 44px (`min-h-11`) on mobile, `sm:` may
  reduce to 36px.
- **Cards**: `rounded-xl border border-border bg-card p-3`. No card-in-card:
  inner groupings use borderless `bg-muted/50` insets (see SettingsClient).
- **Chips / badges**: `rounded-full border px-2 py-0.5 text-[11px]` with the
  semantic tone classes (see EXEC_STATE_CLASSES / TRADABILITY_CLASSES in
  `ActiveRecommendationsPanel.tsx` — copy those, don't reinvent).
- **Agent output**: one card grammar — outcome first, tradability chip,
  levels, collapsible evidence, actions. `AgentRunStages` is the only run
  checklist. The thinking caret is a 2px pulsing bar, not a spinner.
- **Inputs**: `bg-transparent` inside the composer shell; forms use the
  squareui field patterns.

## 5. Layout Principles

- One shell: start-side collapsible sidebar + top bar (active symbol, the two
  balances — subscription credit vs broker equity, ALWAYS separate) + content.
- Spacing scale: multiples of 0.25rem; card gutters `p-3`, page gutters `p-4`.
- Density is a feature: prefer a compact table/list over big empty cards.
- Radius: `--radius: 0.625rem` (inputs/insets) and `--radius-lg`/`rounded-xl`
  (cards). Full-round only chips and avatar-sized controls.

## 6. Depth & Elevation

Flat by default. Elevation = border + surface step (`--surface-elevated`,
`#0a0a0a` on dark), never drop shadows. `--glow-brand: none` is a decision,
not an omission. Popovers/menus use `--popover` + border.

## 7. Do's and Don'ts

- **Do** render every number with its source reachable (tooltip or label):
  broker, platform feed, backtest, or memory-derived estimate.
- **Do** keep buy=green/sell=red even in monochrome contexts — direction is
  the one thing color always means here.
- **Don't** introduce new hex values in components; add a token or use an
  existing role.
- **Don't** use purple, gradients, glassmorphism, or decorative animation.
  Motion is limited to state feedback (pulse, spin, collapse) ≤300ms.
- **Don't** render a far-from-market plan as an actionable card (watch-only
  section exists for that).
- **Don't** put static quick-action buttons in the chat — all follow-ups are
  model-generated per turn (tested by `noStaticQuickActions.test.ts`).

## 8. Responsive Behavior

- Mobile-first; the chat composer is the reference: full-width text tier, then
  a controls tier — never crowd controls beside the caret.
- Touch targets ≥44px on mobile (`min-h-11` / `size-11`), may shrink at `sm:`.
- Wide content (tables, charts) scrolls inside its own container — the page
  never scrolls horizontally.
- **RTL is the primary direction.** Use logical properties/classes only:
  `ms-*/me-*/ps-*/pe-*`, `start/end` — never `ml/mr/left/right` for layout.
  Icons that imply direction (send arrows) get `rtl:rotate-180`. Every new
  screen is reviewed in Arabic-dark first, then English-light.

## 9. Agent Prompt Guide

When generating UI for this codebase:

1. Read this file first; use only semantic Tailwind classes backed by the
   tokens above.
2. Reuse before creating: `components/squareui/*`, `components/foundation`
   (PageHeader, Surface), the chip/card patterns named in §4.
3. Both locales, both themes, RTL-safe logical classes — in the same PR.
4. All user-facing strings go through `useLocale().t()` with keys added to
   BOTH `src/lib/i18n/ar.ts` and `en.ts` (a parity test enforces it).
5. Trading semantics: direction colors for direction, warning for pending/
   conditional, muted for watch-only; never a raw hex, never purple.
6. Accessibility: aria-labels on icon buttons, focus-visible rings
   (`focus-visible:ring-2 ring-ring`), AA contrast on both themes.
