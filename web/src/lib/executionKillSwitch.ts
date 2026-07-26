/**
 * Master kill switch, dual enablement, and account-identity halt
 * (RELIABILITY_PLAN.md item 11, the part deferred past phase 0).
 *
 * These are USER-VISIBLE EXECUTION protections layered ON TOP of every existing
 * gate — they can only ever BLOCK execution, never authorize it. Nothing here
 * touches the model's BUY/SELL/WAIT authority, the statistical gates, or the
 * requirement for explicit user confirmation.
 *
 * Three independent protections:
 *
 * 1. **Master kill switch** — one flag halts ALL order submission instantly,
 *    for every user and route, without a deploy. It is checked at the single
 *    execution choke point, so nothing can route around it.
 * 2. **Dual enablement for live** — real-money execution requires TWO separate
 *    switches set independently (a server-side env and an explicit runtime
 *    flag). A single fat-fingered setting can therefore never take an account
 *    live; demo/shadow are unaffected.
 * 3. **Account-identity halt** — if the broker reports an account id different
 *    from the one the platform believes it is trading, execution stops. Trading
 *    the wrong account is unrecoverable, so an ambiguous identity is a hard
 *    stop, never a warning.
 */

export type ExecutionHaltCode =
  | "kill_switch"
  | "live_not_dual_enabled"
  | "account_mismatch";

export interface ExecutionHalt {
  halted: true;
  code: ExecutionHaltCode;
  /** Safe operator-facing sentence (Arabic UI is the default surface). */
  reason: string;
}

export type ExecutionHaltCheck = ExecutionHalt | { halted: false };

const PASS: ExecutionHaltCheck = { halted: false };

function envTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** DB flag key checked alongside the env switch (set from ops without a deploy). */
export const KILL_SWITCH_FLAG = "trading_kill_switch";

/** The SECOND live enable, set independently from the env switch. */
export const LIVE_ENABLED_FLAG = "live_trading_enabled";

/**
 * Is this execution going to a real-money account?
 *
 * IMPORTANT — this deliberately takes the BROKER'S REPORTED account type, not
 * an environment variable. An earlier version of this file read `OANDA_ENV`,
 * which was simply the wrong signal: on an EA/MT5 deployment OANDA is only the
 * chart DATA source, so `OANDA_ENV=practice` said nothing about where orders
 * actually go. The protection silently never engaged on exactly the setup it
 * was meant to guard. Callers now pass the value resolved from the live broker
 * connection (`getResolvedExecutionEnv`).
 *
 * `null` means the broker has not reported an account type. That is treated as
 * NOT live, because an unidentified connection cannot execute anyway — verified
 * broker equity is required upstream — so forcing dual enablement there would
 * only block legitimate demo trading without protecting anything.
 */
export function isRealMoneyExecution(resolvedEnv: "demo" | "live" | null): boolean {
  return resolvedEnv === "live";
}

/**
 * Is the master kill switch engaged? Either source engages it — an operator
 * must be able to stop trading from ops OR from config, and neither can be
 * overridden by the other. `dbFlagValue` is passed in so this stays pure.
 */
export function isKillSwitchEngaged(dbFlagValue?: string | null): boolean {
  return envTruthy(process.env.TRADING_KILL_SWITCH) || envTruthy(dbFlagValue ?? undefined);
}

/**
 * Live (real-money) execution demands two independent enables. Demo/shadow
 * modes are NOT gated here — this exists solely to make "accidentally live"
 * impossible.
 */
export function isLiveDualEnabled(input: {
  /** Server-side switch (env), deliberately deploy-scoped. */
  envEnabled?: boolean;
  /** Independent runtime switch (account/ops flag). */
  runtimeEnabled?: boolean;
}): boolean {
  const envEnabled = input.envEnabled ?? envTruthy(process.env.LIVE_TRADING_ENABLED);
  return Boolean(envEnabled && input.runtimeEnabled);
}

/**
 * Full pre-execution halt check. Returns the FIRST protection that blocks, in
 * safety-first order. `expectedAccountId`/`brokerAccountId` are compared only
 * when both are known — an unknown identity is handled by the caller's existing
 * readiness checks, not silently treated as a match.
 */
export function checkExecutionHalt(input: {
  killSwitchFlag?: string | null;
  isLive: boolean;
  liveEnvEnabled?: boolean;
  liveRuntimeEnabled?: boolean;
  expectedAccountId?: string | null;
  brokerAccountId?: string | null;
}): ExecutionHaltCheck {
  if (isKillSwitchEngaged(input.killSwitchFlag)) {
    return {
      halted: true,
      code: "kill_switch",
      reason: "التداول متوقف بأمر تشغيلي (مفتاح الإيقاف العام). لم يُرسل أي أمر.",
    };
  }

  if (
    input.isLive &&
    !isLiveDualEnabled({
      envEnabled: input.liveEnvEnabled,
      runtimeEnabled: input.liveRuntimeEnabled,
    })
  ) {
    return {
      halted: true,
      code: "live_not_dual_enabled",
      reason:
        "التنفيذ الحي يتطلب تفعيلين مستقلين، وأحدهما غير مُفعّل. لم يُرسل أي أمر.",
    };
  }

  const expected = input.expectedAccountId?.trim();
  const actual = input.brokerAccountId?.trim();
  if (expected && actual && expected !== actual) {
    return {
      halted: true,
      code: "account_mismatch",
      reason:
        "حساب الوسيط المتصل لا يطابق الحساب المتوقع — أُوقف التنفيذ حمايةً للحساب.",
    };
  }

  return PASS;
}

/**
 * Startup reconciliation verdict: what the platform believes vs what the broker
 * reports at boot. A mismatch in identity halts execution; a position-count
 * mismatch is reported for operator attention but does not by itself halt
 * (positions legitimately change while the process was down).
 */
export interface ReconciliationReport {
  accountMatches: boolean;
  /** Positions the broker knows about that the platform does not. */
  unknownBrokerPositions: number;
  /** Positions the platform believes are open that the broker does not report. */
  missingLocalPositions: number;
  /** True when execution must stay halted until an operator intervenes. */
  haltExecution: boolean;
  notes: string[];
}

export function reconcileAtStartup(input: {
  expectedAccountId?: string | null;
  brokerAccountId?: string | null;
  localOpenPositionIds: readonly string[];
  brokerOpenPositionIds: readonly string[];
}): ReconciliationReport {
  const expected = input.expectedAccountId?.trim();
  const actual = input.brokerAccountId?.trim();
  // Unknown identity is NOT a match: it is an unresolved question, and trading
  // the wrong account is unrecoverable.
  const accountMatches = Boolean(expected && actual && expected === actual);

  const local = new Set(input.localOpenPositionIds);
  const broker = new Set(input.brokerOpenPositionIds);
  const unknownBrokerPositions = [...broker].filter((id) => !local.has(id)).length;
  const missingLocalPositions = [...local].filter((id) => !broker.has(id)).length;

  const notes: string[] = [];
  if (!accountMatches) {
    notes.push(
      expected && actual
        ? "هوية حساب الوسيط لا تطابق الحساب المتوقع."
        : "تعذّر تأكيد هوية حساب الوسيط.",
    );
  }
  if (unknownBrokerPositions > 0) {
    notes.push(`الوسيط يعرض ${unknownBrokerPositions} مركزاً غير معروف للمنصة.`);
  }
  if (missingLocalPositions > 0) {
    notes.push(`${missingLocalPositions} مركزاً تعتبره المنصة مفتوحاً لا يعرضه الوسيط.`);
  }

  return {
    accountMatches,
    unknownBrokerPositions,
    missingLocalPositions,
    haltExecution: !accountMatches,
    notes,
  };
}
