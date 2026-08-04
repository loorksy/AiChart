# Task: remove the EA bridge from AiChart — completely, and without breaking anything else

You are working in the **AiChart** repository (`github.com/loorksy/AiChart`, **private** — it must stay private, a licensed TradingView library is committed inside it). Arabic RTL-first trading platform: Next.js 16 App Router, React 19, TypeScript, Tailwind v4, plus a separate MCP server under `mcp/`.

## The goal, stated precisely

Delete the **EA bridge** so that:

1. **Everything it did runs on the MetaApi cloud account instead** — including the MCP tools.
2. **No other feature stops working.** Not one.
3. **It leaves no trace.** No dead identifier, no orphan translation key, no stale table, no doc that describes a thing that no longer exists.

The owner approved this without reservation. All users are developers working with them. Account id 3 (`ahmedissatr@gmail.com`) has a live EA connection and will lose its path — known and accepted.

**Do not place live orders to test.** The linked account is real. Verification is static and structural, described at the end.

## Start here — work is already in progress

Branch **`chore/remove-ea`** is pushed, one WIP commit (`ff228a56`), **37 files / 6639 lines** already deleted:

- `web/src/app/api/agent/ea/**`, `web/src/app/api/ea/**` — 18 route files
- `web/src/lib/ea*.ts` — 10 modules (`eaStore`, `eaAuth`, `eaTradeCommands`, `eaCommandWait`, `eaLiveState`, `eaQuoteMetrics`, `eaHealthMonitor`, `eaPositionSync`, `eaChartDraw`, `eaAgentCommands`)
- `web/src/lib/brokers/eaAdapter.ts`
- `web/src/components/settings/EaConnectCard.tsx`
- `ea/` — the MQL5 source

**That branch does not compile. This is deliberate.** Rebase onto latest `main`, then run `npx tsc --noEmit` in `web/` and let the compiler enumerate every remaining dependency. Do not guess at call sites.

## There is no "cloud bridge" to build

Do not build a queue, a poller, a heartbeat, or any client-side component. The bridge concept **disappears**.

EA was a workaround for reaching MetaTrader on the user's own machine — we could not call it, so we made it call us:

```
createEaCommand(...)                      // insert a row into ea_commands
waitForEaCommandAck(id, ACK_TIMEOUT_MS)   // poll the DB until the EA acks
```

MetaApi holds the account server-side and answers directly:

```ts
const result = await conn.createMarketBuyOrder(symbol, lots, sl, tp, { comment });
```

The replacement is strictly simpler than what it replaces.

## Already cloud-ready — verify, then rely on it

```
web/src/lib/brokers/
  index.ts                    getBrokerAdapter(kind) → metaapi | mt_ea | mt5_local
  metaApiAdapter.ts           implements market buy/sell — real, not a stub
  eaAdapter.ts                DELETE
  mt5LocalAdapter.ts          KEEP — self-hosted bridge, not EA, not in scope
  tradeManagementDispatch.ts  has `backend === "metaapi"` branches for
                              modify / partial-close / cancel
```

`web/src/lib/execution.ts:678` calls `getBrokerAdapter(broker, "spot")`. Removing `mt_ea` removes a branch that already has a working sibling.

---

# Part 1 — remove it

## The 9 MCP endpoints

Of 46 endpoints the MCP tools call, only these are EA-named. The other 37 (analysis, candles, price, scan, portfolio, recommendations, memory, snapshots, approvals) are backend-neutral — **leave them completely alone**.

**Already dispatch to the cloud; only the URL says "ea". Rename, keep behaviour:**
- `/api/agent/ea/modify-sl-tp` → `/api/agent/trade/modify-sl-tp`
- `/api/agent/ea/cancel-order` → `/api/agent/trade/cancel-order`
- `/api/agent/ea/close-partial` → `/api/agent/trade/close-partial`

All three route through `tradeManagementDispatch`, which has a working `metaapi` branch. Delete only the `backend === "ea"` branch inside each. Update the MCP tool definitions to the new paths.

**Cloud-aware already; strip the EA branch, keep the cloud answer:**
- `live-quotes` → bid/ask from `rpc.getSymbolPrice`. `/api/market/forex-price` already does this and computes spread via `lib/spread.ts` — reuse it, do not write it twice.
- `symbols` → `rpc.getSymbols()`
- `reconnect` → the redeploy path in `lib/metaapi/lifecycle.ts`

**Pure bridge; delete the tool:**
- `diagnostics` — EA health, nothing left to diagnose
- `query-terminal` — queries a terminal that will not exist
- `chart-capture` — screenshots the user's terminal. **A working replacement already exists and is what recommendations use today**: `lib/chart/platformChartCapture.ts` via `/api/agent/chart/snapshot`. Repoint any caller.

Remove deleted tools from the MCP registry **and** from every prompt/description string that advertises them, so the agent never offers a tool that is gone.

## UI surfaces

- `ForexMethodSelector` — drop the EA option. If only one method remains, **remove the control entirely** rather than shipping a picker with one item; and remove the `blockedByEaMethod` prop it feeds on `Mt5LinkCard`.
- `DataSourceChoice` — drop the `ea` row.
- `SettingsClient` connections tab — remove the EA card's props and all `canDownloadEa` plumbing.
- `tvDatafeed.ts` — remove `EA_EXCHANGE`, `EA_TICKER_PREFIX`, `isEaTicker`, `stripEaPrefix`, and the `ea` search branch. Note the `viaEa` term also guards symbol-case handling — read the comment there before touching it and preserve the broker-spelling behaviour.

## Database

Drop `ea_commands`, `ea_connections`, `ea_market_cache`.

**Edit both `web/src/lib/db/sqlite.ts` and `web/src/lib/db/pg.ts`.** They are maintained in parallel; changing one and not the other is a production-only failure.

---

# Part 2 — do not break anything else

This is the half that goes wrong. Work through it deliberately.

## The production landmine: `FOREX_BACKEND=ea`

The production `.env` on the VPS contains:

```
FOREX_BACKEND=ea
```

`getForexBackend()` reads it and returns `"ea"` **for every user**. Removing the EA branch without handling this variable changes what that value resolves to across the whole platform, silently.

Handle it explicitly, in this order:

1. Decide what the value should mean once EA is gone, and make `getForexBackend()` say so unambiguously — do not let a stale `ea` fall through to a default by accident.
2. Update `web/.env.example`.
3. **Update the VPS `.env` as part of the deploy**, not after. Back it up first (`cp .env /root/.env.bak.$(date +%s)`).

Also check `FOREX_DATA_SOURCE` (currently `oanda`) and `resolveForexBackendFromPref` in `lib/brokers/forexBackend.ts`, which honours a per-user `trading_settings.forex_backend`. **Rows in that column may still say `'ea'`.** Decide what those users resolve to and migrate the column — a stored preference naming a backend that no longer exists must not fall into an undefined state.

## Inventory before and after

Take these **before** you start and diff them at the end. Every difference must be an EA removal or a rename you intended.

```bash
# API endpoints
git ls-tree -r --name-only origin/main -- web/src/app/api | grep 'route.ts$' | sort > /tmp/api.before

# MCP tool names
grep -rhoE 'name: "[a-z0-9_]+"' mcp/src/tools/*.ts | sort > /tmp/tools.before

# admin console tabs
grep -oE '"[a-z_]+"' web/src/components/admin/chrome/adminNavTree.ts | sort -u > /tmp/tabs.before
```

State the three diffs in the PR description.

## Things that break quietly if you are careless

- **`mt5local` is not EA.** Keep `mt5LocalAdapter`, the `mt5_local` broker kind, and `MT5_BRIDGE_URL`. The owner asked to remove EA only.
- **Both dictionaries.** A test enforces that `ar.ts` and `en.ts` have identical key sets. Remove every EA key from both, and remove nothing a non-EA surface still renders.
- **CRLF line endings.** Script-based find/replace silently no-ops on `\n` anchors. Use the editor's edit tools or line-aware scripts.
- **Tests that reference EA.** Some assert EA behaviour and should go with it. Others use EA merely as a fixture for a rule that still applies — `executionMatrix.test.ts` patches `getBrokerAdapter("mt_ea")` to observe the execution path generically. **Read each one and decide; do not bulk-delete tests to make the suite green.** A deleted test is a deleted guarantee.
- **Dependencies.** If you add or remove any npm package, regenerate `package-lock.json` **on the Linux VPS**, copy it back, and commit it. A Windows-generated lockfile omits `@emnapi/*` and takes production down with a 502. This has happened twice.

---

# Part 3 — leave no trace

A grep for `ea` matches ordinary English words, so search for **these** specific residues:

| residue | where |
|---|---|
| `"mt_ea"` — 40 occurrences | `BrokerKind` union in `lib/markets/types.ts`, `forexModeToBrokerKind`, adapter map, tests |
| `backend === "ea"` / `source === "ea"` — 21 branches | routes, dispatch, data-source resolution |
| `EA_EXCHANGE`, `EA_TICKER_PREFIX`, `isEaTicker`, `stripEaPrefix`, `viaEa` | `tvDatafeed.ts` |
| `canDownloadEa`, `eaEnabled`, `getEaConnectionMeta` | settings loader, `SettingsClient`, `SettingsModal` |
| `connect.ea*`, `data_source.ea*`, `needs_ea` | `ar.ts` **and** `en.ts` |
| `ea_commands`, `ea_connections`, `ea_market_cache` | `sqlite.ts` **and** `pg.ts` |
| `FOREX_BACKEND`, `EA_*` | `.env.example`, VPS `.env` |
| EA tool names and descriptions | `mcp/src/tools/mt5.ts`, `mcp/src/tools/schemas/*` |

Delete these documentation files — they describe a component that will not exist:

```
agent/workspace/EA_TROUBLESHOOTING.md
ea/mt5/EA_COMMANDS_V4.md
```

And update — do not delete — the sections mentioning EA in:

```
CI_AND_DEPLOYMENT.md
docs/UNIFIED_AGENT_IMPLEMENTATION_PLAN.md
docs/UNIFIED_AGENT_COMPLETION_AUDIT.md
docs/VIBE_INTEGRATION_AUDIT.md
docs/LOCAL_COMPLETION_PROMPT.md
```

Also delete `CURSOR_PROMPT_remove_ea.md` — this file — in the same PR.

**A user-facing string that still says «جسر EA» or «Expert Advisor» is a trace.** So is an error message telling someone to install something that no longer exists. Read the Arabic strings, not just the identifiers.

---

# Verification

Local, in `web/`:

```bash
npx tsc --noEmit          # must be clean
npm run build             # must be clean
npm run test:unit         # exactly 3 failures, listed below
```

The three permanent failures are the Redis release validator and need the deployed instance:
- `refuses to run without an explicit isolation declaration`
- `refuses when the target IS the deployed instance`
- `still requires authentication on the isolated instance`

**Anything else failing is yours.**

Then the residue sweep — each of these must return nothing:

```bash
grep -rn '"mt_ea"' web/src mcp/src --include=*.ts --include=*.tsx
grep -rn 'EA_EXCHANGE\|isEaTicker\|stripEaPrefix\|canDownloadEa' web/src
grep -rn 'ea_commands\|ea_connections\|ea_market_cache' web/src
grep -rn 'connect\.ea\|data_source\.ea\|needs_ea' web/src/lib/i18n
```

Then deploy and confirm the platform still works:

```bash
ssh 72.60.83.140 'cd /opt/aichart && cp web/.env /root/.env.bak.$(date +%s) \
  && git fetch origin main && git reset --hard origin/main \
  && rm -rf web/.next && cd web && npm run build \
  && pm2 restart aichart-web aichart-mcp aichart-worker'
```

Handle `FOREX_BACKEND` in that same session. Then curl `https://aichart.lork.cloud` for `/`, `/health`, `/console`, `/console/connect`, `/console/mt5`, `/console/platform`, `/console/billing`, `/pricing`, `/blog`, `/docs` — all must be 200.

Confirm from the server that the cloud path still resolves for the linked account (user id 5, Exness, deployed) — read `/api/market/data-source`, `/api/market/klines?source=metaapi`, and `/api/market/forex-price`, and check they still return candles, a source of `metaapi`, and a spread. **Reading is enough. Do not place an order.**

## A warning worth heeding

Four defects this week passed a clean `tsc`, a clean build, and a green suite, and were caught only by poking the deployed system:

| defect | why the build could not see it |
|---|---|
| SDK root import resolved to the browser bundle → `ReferenceError: window is not defined` | an export map is runtime resolution, not a type |
| `XAUUSDm` uppercased to `XAUUSDM` → "Symbol does not exist" | broker symbols are case-sensitive; four call sites folded case |
| billing lived inside the undeploy that was removed → nothing was ever charged | no type expresses "this meter still runs" |
| `mt_accounts.state` is `'deployed'`; the check compared `"DEPLOYED"` | same word, two different objects |

A green build is not evidence that this worked.

# Deliverable

One PR against `main`. In the description state:

- the three before/after inventories (endpoints, MCP tool names, admin tabs), and that every difference is an EA removal or an intended rename
- for each of the 9 MCP endpoints: deleted, renamed, or reimplemented on the cloud
- how `FOREX_BACKEND` and any stored `forex_backend = 'ea'` rows were handled
- the residue sweep output
- what you verified on production, with the actual output — **including anything that did not work**

Write commit messages and comments that explain **why**, not what. Match the surrounding code's density and idiom. Every comment explaining a non-obvious decision should say what breaks without it.
