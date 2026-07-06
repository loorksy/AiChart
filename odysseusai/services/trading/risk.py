"""Risk Guard — the single authority that decides whether a trade may execute.

Faithful Python port of the former AiChart ``lib/riskGuard.ts`` plus the
shared helpers from ``lib/rewardRisk.ts`` and ``lib/riskLimits.ts``.

Every hard cap lives here and is enforced in code — the LLM cannot bypass
it. Checks run in priority order and return the first blocking reason.
Pure logic (no I/O), so it is directly unit-testable.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

DEFAULT_MIN_CONFIDENCE = 80
PRACTICE_MIN_CONFIDENCE_FLOOR = 50
DEFAULT_MIN_RR = 1

NON_FOREX_MARKET_MESSAGE = (
    "المنصة حالياً فوركس فقط — الأسواق الأخرى غير مفعّلة."
)


# ── reward:risk ───────────────────────────────────────────────────────────────
def compute_reward_risk(
    entry: float | None,
    stop_loss: float | None,
    take_profit: float | None,
) -> float | None:
    """Pure reward:risk helper."""
    if entry is None or stop_loss is None or take_profit is None:
        return None
    risk = abs(entry - stop_loss)
    reward = abs(take_profit - entry)
    if not (risk > 0) or not (reward >= 0):
        return None
    return reward / risk


# ── admin-cap resolution ──────────────────────────────────────────────────────
def resolve_max_open_trades(user_max_open_trades: Any, admin_cap: Any) -> int:
    """Effective max concurrent open trades.

    Admin caps are CEILINGS: a cap of 0 (or less) means UNLIMITED -> the
    user's own setting governs. Never let a 0 admin cap silently block
    every trade (the ``min(userValue, 0) == 0`` trap).
    """
    try:
        user = max(0, int(user_max_open_trades))
    except (TypeError, ValueError):
        user = 0
    try:
        cap = float(admin_cap)
    except (TypeError, ValueError):
        return user
    if not math.isfinite(cap) or cap <= 0:
        return user
    return min(user, int(cap))


def resolve_effective_capital(user_max_capital: float, admin_capital_cap: Any) -> float:
    try:
        cap = float(admin_capital_cap)
    except (TypeError, ValueError):
        return user_max_capital
    if not math.isfinite(cap) or cap <= 0:
        return user_max_capital
    return min(user_max_capital, cap)


def get_effective_min_rr(settings: dict[str, Any]) -> float:
    try:
        v = float(settings.get("min_rr"))
    except (TypeError, ValueError):
        return DEFAULT_MIN_RR
    return v if math.isfinite(v) and v >= 0 else DEFAULT_MIN_RR


def get_effective_min_confidence(settings: dict[str, Any], ctx: "RiskContext") -> int:
    # External minimum-confidence gate is disabled by design: the decision is
    # left entirely to the agent's analysis (mirrors AiChart behaviour).
    return 0


@dataclass
class ProposedTrade:
    symbol: str
    side: str  # "buy" | "sell"
    notional: float  # quote-currency (USD) amount / risk budget
    confidence: float = 0.0
    market: str | None = None
    market_type: str = "spot"  # 'spot' | 'futures'
    leverage: float = 1.0
    entry: float | None = None
    stop_loss: float | None = None  # mandatory for every trade
    take_profit: float | None = None


@dataclass
class RiskContext:
    open_trades_count: int = 0
    today_realized_pnl_pct: float = 0.0  # negative = net loss today
    today_realized_pnl_usd: float = 0.0
    month_realized_pnl_pct: float = 0.0  # negative = net loss this month
    explicit_approval: bool = False
    practice_mode: bool = False
    resolved_env: str | None = None  # actual broker env ('demo'|'live')
    env_preference: str = "demo"


@dataclass
class RiskDecision:
    ok: bool
    reason: str
    effective_capital: float = 0.0
    per_trade_max: float = 0.0
    deny_code: str | None = None
    deny_details: dict[str, Any] = field(default_factory=dict)


def _truthy(v: Any) -> bool:
    """Tolerant of SQLite (0/1) and Postgres (bool) representations."""
    return not (v == 0 or v is False)


def evaluate_trade(
    settings: dict[str, Any],
    limits: dict[str, Any],
    proposed: ProposedTrade,
    ctx: RiskContext,
) -> RiskDecision:
    """Decide whether a trade may execute. First blocking reason wins."""
    max_capital = float(settings.get("max_capital", 0) or 0)
    capital_cap = limits.get("max_capital_cap", 0)
    effective_capital = resolve_effective_capital(max_capital, capital_cap)
    per_trade_pct = float(settings.get("per_trade_pct", 0) or 0)
    per_trade_max = (effective_capital * per_trade_pct) / 100
    max_open = resolve_max_open_trades(
        settings.get("max_open_trades", 0), limits.get("max_open_trades_cap", 0)
    )

    def deny(reason: str, code: str | None = None, details: dict | None = None) -> RiskDecision:
        return RiskDecision(
            ok=False,
            reason=reason,
            effective_capital=effective_capital,
            per_trade_max=per_trade_max,
            deny_code=code,
            deny_details=details or {},
        )

    # Master per-user toggle. When OFF (0) the platform runs "full autonomous":
    # the agent is the sole authority, so the risk/permission gates are SKIPPED.
    # Non-negotiable execution safety (kill switch, env sanity, mandatory SL,
    # "can't risk more than you have") still applies.
    risk_enforced = _truthy(settings.get("risk_guard_enabled", 1))

    # Platform emergency kill switch (admin) — always enforced.
    if _truthy(limits.get("kill_switch", False)):
        return deny("مفتاح الإيقاف الطارئ مفعّل من الإدارة — لا تنفيذ.")

    # Always enforced (execution validity).
    if risk_enforced and not _truthy(limits.get("can_execute", True)):
        return deny("التنفيذ التلقائي غير مصرّح به من الإدارة.")

    relaxed = ctx.practice_mode is True or ctx.resolved_env == "demo"

    min_confidence = get_effective_min_confidence(settings, ctx)
    if risk_enforced and proposed.confidence < min_confidence:
        return deny(
            f"الثقة ({proposed.confidence}%) أقل من الحد الأدنى ({min_confidence}%).",
            code="LOW_CONFIDENCE",
            details={"confidence": proposed.confidence, "minConfidence": min_confidence},
        )

    if (
        risk_enforced
        and settings.get("mode") != "auto"
        and not ctx.explicit_approval
        and not ctx.practice_mode
    ):
        return deny("وضعك الحالي توصيات فقط، لا تنفيذ.")

    preference = ctx.env_preference or "demo"
    if preference == "demo" and ctx.resolved_env == "live" and not ctx.practice_mode:
        return deny("التفضيل تجريبي لكن الحساب المتصل حقيقي — بدّل الحساب أو البيئة أولاً.")

    # Forex-only platform policy.
    requested_market = proposed.market or settings.get("active_market")
    if requested_market and requested_market != "forex":
        return deny(NON_FOREX_MARKET_MESSAGE)

    if risk_enforced and not _symbol_allowed(settings.get("allowed_assets", ""), proposed.symbol):
        return deny(f"الأصل {proposed.symbol} غير ضمن قائمتك المسموح بها.")

    # Objective trade-quality gates (discipline, NOT a confidence cutoff).
    if risk_enforced and proposed.stop_loss is None:
        return deny(
            "وقف الخسارة إلزامي لكل صفقة — حدّد وقفاً واضحاً قبل الدخول."
        )

    min_rr = get_effective_min_rr(settings)
    if risk_enforced and min_rr > 0:
        rr = compute_reward_risk(proposed.entry, proposed.stop_loss, proposed.take_profit)
        if rr is not None and rr < min_rr:
            return deny(
                f"العائد/المخاطرة ({rr:.2f}) أقل من الحد الأدنى ({min_rr}) — لا ننفّذ."
            )

    # Futures disabled (forex-only).
    if (proposed.market_type or "spot") == "futures":
        return deny(NON_FOREX_MARKET_MESSAGE)

    if effective_capital <= 0:
        return deny("لم تُحدّد سقف رأس مال صالحاً.")
    if proposed.notional > effective_capital:
        return deny("حجم الصفقة يتجاوز سقف رأس المال المسموح.")

    # Risk gates below: skipped entirely in full-autonomous mode.
    if risk_enforced and proposed.notional > per_trade_max + 1e-8:
        return deny(f"حجم الصفقة يتجاوز الحد الأقصى للصفقة الواحدة ({per_trade_max:.2f}).")

    if risk_enforced and ctx.open_trades_count >= max_open:
        return deny(f"بلغت الحد الأقصى للصفقات المفتوحة ({max_open}).")

    daily_loss = float(settings.get("daily_loss_limit_pct", 0) or 0)
    if risk_enforced and daily_loss > 0 and ctx.today_realized_pnl_pct <= -daily_loss:
        return deny(f"بلغت حد الخسارة اليومي (−{daily_loss}%). توقّف لليوم.")

    monthly_loss = float(settings.get("monthly_loss_limit_pct", 0) or 0)
    if risk_enforced and monthly_loss > 0 and ctx.month_realized_pnl_pct <= -monthly_loss:
        return deny(f"بلغت حد الخسارة الشهري (−{monthly_loss}%).")

    if risk_enforced and not relaxed:
        daily_target_pct = float(settings.get("daily_profit_target_pct", 0) or 0)
        if daily_target_pct > 0 and ctx.today_realized_pnl_pct >= daily_target_pct:
            return deny(f"بلغت هدف الربح اليومي (+{daily_target_pct}%). لا صفقات جديدة اليوم.")

        daily_target_usd = float(settings.get("daily_profit_target_usd", 0) or 0)
        if daily_target_usd > 0 and ctx.today_realized_pnl_usd >= daily_target_usd:
            return deny(
                f"بلغت هدف الربح اليومي (+{daily_target_usd:.2f} USD). لا صفقات جديدة اليوم."
            )

    return RiskDecision(
        ok=True,
        reason="مسموح",
        effective_capital=effective_capital,
        per_trade_max=per_trade_max,
    )


def _symbol_allowed(allowed_assets: str | None, symbol: str) -> bool:
    """Empty/None allow-list means all forex symbols are permitted."""
    raw = (allowed_assets or "").strip()
    if not raw:
        return True
    allowed = {s.strip().upper() for s in raw.replace(",", " ").split() if s.strip()}
    return symbol.strip().upper() in allowed
