/// Typed views over the platform's admin API responses. Field names mirror
/// the server JSON exactly; parsing is defensive because SQLite and Postgres
/// installs stringify numbers/booleans differently.
library;

import 'dart:convert';

int asInt(dynamic v, [int fallback = 0]) {
  if (v is int) return v;
  if (v is num) return v.toInt();
  if (v is String) return int.tryParse(v) ?? fallback;
  return fallback;
}

double asDouble(dynamic v, [double fallback = 0]) {
  if (v is double) return v;
  if (v is num) return v.toDouble();
  if (v is String) return double.tryParse(v) ?? fallback;
  return fallback;
}

bool asBool(dynamic v) {
  if (v is bool) return v;
  if (v is num) return v != 0;
  if (v is String) return v == '1' || v.toLowerCase() == 'true';
  return false;
}

String? asStringOrNull(dynamic v) => v?.toString();

class SessionUser {
  final int id;
  final String email;
  final String role;
  final String status;
  final String? username;

  /// Fine-grained admin permissions from /api/me (cosmetic gating only —
  /// every admin API re-checks server-side).
  final List<String> adminPermissions;

  SessionUser({
    required this.id,
    required this.email,
    required this.role,
    required this.status,
    this.username,
    this.adminPermissions = const [],
  });

  factory SessionUser.fromJson(Map<String, dynamic> j,
          {List<String> permissions = const []}) =>
      SessionUser(
        id: asInt(j['id']),
        email: j['email']?.toString() ?? '',
        role: j['role']?.toString() ?? 'user',
        status: j['status']?.toString() ?? '',
        username: asStringOrNull(j['username']),
        adminPermissions: permissions,
      );
}

class AdminRoleRow {
  final int userId;
  final String email;

  /// null means the implicit "owner" (no explicit admin_roles row).
  final String? adminRole;

  AdminRoleRow({required this.userId, required this.email, this.adminRole});

  factory AdminRoleRow.fromJson(Map<String, dynamic> j) => AdminRoleRow(
        userId: asInt(j['user_id']),
        email: j['email']?.toString() ?? '',
        adminRole: asStringOrNull(j['admin_role']),
      );
}

class AdminUserView {
  final int id;
  final String email;
  final String role;
  final String status;
  final String? username;
  final String? telegramId;
  final String? accessExpiresAt;
  final String? createdAt;
  final String signupVia;
  final bool canExecute;
  final int claudeQuota;

  AdminUserView({
    required this.id,
    required this.email,
    required this.role,
    required this.status,
    this.username,
    this.telegramId,
    this.accessExpiresAt,
    this.createdAt,
    required this.signupVia,
    required this.canExecute,
    required this.claudeQuota,
  });

  factory AdminUserView.fromJson(Map<String, dynamic> j) => AdminUserView(
        id: asInt(j['id']),
        email: j['email']?.toString() ?? '',
        role: j['role']?.toString() ?? 'user',
        status: j['status']?.toString() ?? '',
        username: asStringOrNull(j['username']),
        telegramId: asStringOrNull(j['telegram_id']),
        accessExpiresAt: asStringOrNull(j['access_expires_at']),
        createdAt: asStringOrNull(j['created_at']),
        signupVia: j['signup_via']?.toString() ?? 'email',
        canExecute: asBool(j['can_execute']),
        claudeQuota: asInt(j['claude_quota'], 1000),
      );
}

class ConfigField {
  final String key;
  final String label;
  final String labelEn;
  final String group;
  final String? type;
  final String? placeholder;
  final bool configured;
  final String? source;
  final bool secret;
  final String? masked;
  final String? value;

  ConfigField({
    required this.key,
    required this.label,
    required this.labelEn,
    required this.group,
    this.type,
    this.placeholder,
    required this.configured,
    this.source,
    required this.secret,
    this.masked,
    this.value,
  });

  factory ConfigField.fromJson(Map<String, dynamic> j) => ConfigField(
        key: j['key']?.toString() ?? '',
        label: j['label']?.toString() ?? '',
        labelEn: j['labelEn']?.toString() ?? '',
        group: j['group']?.toString() ?? 'ops',
        type: asStringOrNull(j['type']),
        placeholder: asStringOrNull(j['placeholder']),
        configured: asBool(j['configured']),
        source: asStringOrNull(j['source']),
        secret: asBool(j['secret']),
        masked: asStringOrNull(j['masked']),
        value: asStringOrNull(j['value']),
      );
}

class OverviewDelta {
  final double value;
  final double prev;
  final double? pct;

  OverviewDelta({required this.value, required this.prev, this.pct});

  factory OverviewDelta.fromJson(Map<String, dynamic> j) => OverviewDelta(
        value: asDouble(j['value']),
        prev: asDouble(j['prev']),
        pct: j['pct'] == null ? null : asDouble(j['pct']),
      );
}

class OverviewKpis {
  final OverviewDelta profitUsd;
  final OverviewDelta revenueUsd;
  final OverviewDelta providerCostUsd;
  final OverviewDelta payingSubscribers;
  final int giftUsers;
  final int trialUsers;
  final double systemCostUsd;

  OverviewKpis({
    required this.profitUsd,
    required this.revenueUsd,
    required this.providerCostUsd,
    required this.payingSubscribers,
    required this.giftUsers,
    required this.trialUsers,
    required this.systemCostUsd,
  });

  factory OverviewKpis.fromJson(Map<String, dynamic> j) => OverviewKpis(
        profitUsd: OverviewDelta.fromJson(j['profit_usd'] ?? const {}),
        revenueUsd: OverviewDelta.fromJson(j['revenue_usd'] ?? const {}),
        providerCostUsd:
            OverviewDelta.fromJson(j['provider_cost_usd'] ?? const {}),
        payingSubscribers:
            OverviewDelta.fromJson(j['paying_subscribers'] ?? const {}),
        giftUsers: asInt(j['gift_users']),
        trialUsers: asInt(j['trial_users']),
        systemCostUsd: asDouble(j['system_cost_usd']),
      );
}

class OverviewSeriesPoint {
  final String day;
  final double revenue;
  final double cost;
  final double profit;

  OverviewSeriesPoint({
    required this.day,
    required this.revenue,
    required this.cost,
    required this.profit,
  });

  factory OverviewSeriesPoint.fromJson(Map<String, dynamic> j) =>
      OverviewSeriesPoint(
        day: j['day']?.toString() ?? '',
        revenue: asDouble(j['revenue']),
        cost: asDouble(j['cost']),
        profit: asDouble(j['profit']),
      );
}

class OverviewResponse {
  final int days;
  final List<String> permissions;
  final OverviewKpis? kpis;
  final List<OverviewSeriesPoint> series;

  OverviewResponse({
    required this.days,
    required this.permissions,
    this.kpis,
    required this.series,
  });

  factory OverviewResponse.fromJson(Map<String, dynamic> j) =>
      OverviewResponse(
        days: asInt(j['days'], 30),
        permissions: ((j['permissions'] as List?) ?? const [])
            .map((e) => e.toString())
            .toList(),
        kpis: j['kpis'] == null
            ? null
            : OverviewKpis.fromJson(j['kpis'] as Map<String, dynamic>),
        series: ((j['series'] as List?) ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(OverviewSeriesPoint.fromJson)
            .toList(),
      );
}

/// One account as the billing surfaces see it. There is ONE currency —
/// credits — so there are no trial counters here: `plan_status` says whether
/// the account is Free, subscribed or lapsed, and `credits` is the balance.
class SubscriptionUser {
  final int userId;
  final String email;
  final String role;
  final String status;
  final String planStatus;
  final int credits;
  final String? subscriptionExpiresAt;
  final String? note;

  SubscriptionUser({
    required this.userId,
    required this.email,
    required this.role,
    required this.status,
    required this.planStatus,
    required this.credits,
    this.subscriptionExpiresAt,
    this.note,
  });

  factory SubscriptionUser.fromJson(Map<String, dynamic> j) =>
      SubscriptionUser(
        userId: asInt(j['user_id']),
        email: j['email']?.toString() ?? '',
        role: j['role']?.toString() ?? 'user',
        status: j['status']?.toString() ?? '',
        planStatus: j['plan_status']?.toString() ?? '',
        credits: asInt(j['credits']),
        subscriptionExpiresAt: asStringOrNull(j['subscription_expires_at']),
        note: asStringOrNull(j['note']),
      );
}

class ProfitUserRow {
  final int userId;
  final String email;
  final String? tier;
  final double revenueUsd;
  final double providerCostUsd;
  final double profitUsd;
  final int events;

  ProfitUserRow({
    required this.userId,
    required this.email,
    this.tier,
    required this.revenueUsd,
    required this.providerCostUsd,
    required this.profitUsd,
    required this.events,
  });

  factory ProfitUserRow.fromJson(Map<String, dynamic> j) => ProfitUserRow(
        userId: asInt(j['user_id']),
        email: j['email']?.toString() ?? '',
        tier: asStringOrNull(j['tier']),
        revenueUsd: asDouble(j['revenue_usd']),
        providerCostUsd: asDouble(j['provider_cost_usd']),
        profitUsd: asDouble(j['profit_usd']),
        events: asInt(j['events']),
      );
}

class ProfitReport {
  final List<ProfitUserRow> perUser;
  final Map<String, dynamic> totals;

  ProfitReport({required this.perUser, required this.totals});

  factory ProfitReport.fromJson(Map<String, dynamic> j) => ProfitReport(
        perUser: ((j['per_user'] as List?) ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(ProfitUserRow.fromJson)
            .toList(),
        totals: (j['totals'] as Map<String, dynamic>?) ?? const {},
      );
}

class TicketRow {
  final int id;
  final int userId;
  final String subject;
  final String status;
  final int? assignedTo;
  final bool needsHuman;
  final int updatedAt;

  TicketRow({
    required this.id,
    required this.userId,
    required this.subject,
    required this.status,
    this.assignedTo,
    required this.needsHuman,
    required this.updatedAt,
  });

  factory TicketRow.fromJson(Map<String, dynamic> j) => TicketRow(
        id: asInt(j['id']),
        userId: asInt(j['user_id']),
        subject: j['subject']?.toString() ?? '',
        status: j['status']?.toString() ?? '',
        assignedTo: j['assigned_to'] == null ? null : asInt(j['assigned_to']),
        needsHuman: asBool(j['needs_human']),
        updatedAt: asInt(j['updated_at']),
      );
}

class MessageRow {
  final int id;
  final String author;
  final String body;
  final int createdAt;

  /// A file sent with this message, served through the support attachment
  /// route (which checks that the reader is in this conversation).
  final String? attachmentPath;
  final String? attachmentName;
  final int? attachmentBytes;

  MessageRow({
    required this.id,
    required this.author,
    required this.body,
    required this.createdAt,
    this.attachmentPath,
    this.attachmentName,
    this.attachmentBytes,
  });

  bool get hasAttachment =>
      attachmentPath != null && attachmentPath!.isNotEmpty;

  /// True for an image, which the thread renders inline rather than as a link.
  bool get attachmentIsImage =>
      hasAttachment &&
      RegExp(r'\.(png|jpe?g|gif|webp)$', caseSensitive: false)
          .hasMatch(attachmentPath!);

  factory MessageRow.fromJson(Map<String, dynamic> j) => MessageRow(
        id: asInt(j['id']),
        author: j['author']?.toString() ?? 'user',
        body: j['body']?.toString() ?? '',
        createdAt: asInt(j['created_at']),
        attachmentPath: asStringOrNull(j['attachment_path']),
        attachmentName: asStringOrNull(j['attachment_name']),
        attachmentBytes:
            j['attachment_bytes'] == null ? null : asInt(j['attachment_bytes']),
      );
}

class TicketThread {
  final TicketRow ticket;
  final List<MessageRow> messages;

  TicketThread({required this.ticket, required this.messages});

  factory TicketThread.fromJson(Map<String, dynamic> j) => TicketThread(
        ticket: TicketRow.fromJson(j['ticket'] as Map<String, dynamic>),
        messages: ((j['messages'] as List?) ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(MessageRow.fromJson)
            .toList(),
      );
}

class AdminHealth {
  final String status;
  final bool llm;
  final String? aiProvider;
  final bool telegram;
  final bool cronSecretSet;
  final int usersTotal;
  final int usersActive;

  AdminHealth({
    required this.status,
    required this.llm,
    this.aiProvider,
    required this.telegram,
    required this.cronSecretSet,
    required this.usersTotal,
    required this.usersActive,
  });

  factory AdminHealth.fromJson(Map<String, dynamic> j) {
    final users = (j['users'] as Map<String, dynamic>?) ?? const {};
    return AdminHealth(
      status: j['status']?.toString() ?? '',
      llm: asBool(j['llm']),
      aiProvider: asStringOrNull(j['ai_provider']),
      telegram: asBool(j['telegram']),
      cronSecretSet: asBool(j['cron_secret_set']),
      usersTotal: asInt(users['total']),
      usersActive: asInt(users['active']),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────
// Billing v3 configuration — every priced or bounded number the platform
// enforces. These mirror `lib/billing/planConfig.ts` row for row.
// ─────────────────────────────────────────────────────────────────────

class BillingPlan {
  /// Credits a NEW account is handed once, forever. 0 = no welcome balance.
  final int signupGrantCredits;

  /// Minimum reward:risk on the FIRST target, x100 (250 = 2.5:1). 0 = off.
  final int minRrFirstTargetBp;
  final int lowBalanceThreshold;
  final int expiryWarnDays;

  BillingPlan({
    required this.signupGrantCredits,
    required this.minRrFirstTargetBp,
    required this.lowBalanceThreshold,
    required this.expiryWarnDays,
  });

  factory BillingPlan.fromJson(Map<String, dynamic> j) => BillingPlan(
        signupGrantCredits: asInt(j['signup_grant_credits']),
        minRrFirstTargetBp: asInt(j['min_rr_first_target_bp']),
        lowBalanceThreshold: asInt(j['low_balance_threshold']),
        expiryWarnDays: asInt(j['expiry_warn_days']),
      );
}

/// A published plan price. Rows are IMMUTABLE: "changing the price" writes a
/// new row and archives this one, so a subscriber keeps the terms they bought.
class PlanPrice {
  final int id;
  final int priceCents;
  final int creditsPerCycle;
  final int cycleDays;
  final int? archivedAt;

  PlanPrice({
    required this.id,
    required this.priceCents,
    required this.creditsPerCycle,
    required this.cycleDays,
    this.archivedAt,
  });

  factory PlanPrice.fromJson(Map<String, dynamic> j) => PlanPrice(
        id: asInt(j['id']),
        priceCents: asInt(j['price_cents']),
        creditsPerCycle: asInt(j['credits_per_cycle']),
        cycleDays: asInt(j['cycle_days']),
        archivedAt: j['archived_at'] == null ? null : asInt(j['archived_at']),
      );
}

class TopupPack {
  final int id;
  final int credits;
  final int priceCents;
  final bool active;
  final int sort;
  final int? archivedAt;

  TopupPack({
    required this.id,
    required this.credits,
    required this.priceCents,
    required this.active,
    required this.sort,
    this.archivedAt,
  });

  bool get archived => archivedAt != null;

  factory TopupPack.fromJson(Map<String, dynamic> j) => TopupPack(
        id: asInt(j['id']),
        credits: asInt(j['credits']),
        priceCents: asInt(j['price_cents']),
        active: asBool(j['active']),
        sort: asInt(j['sort']),
        archivedAt: j['archived_at'] == null ? null : asInt(j['archived_at']),
      );
}

/// A discount window. It applies ONLY to checkouts created inside it —
/// evaluated when the checkout opens, never retroactively.
class Offer {
  final int id;
  final String kind; // percent | fixed_cents
  final int value;
  final int startsAt;
  final int endsAt;
  final bool active;

  Offer({
    required this.id,
    required this.kind,
    required this.value,
    required this.startsAt,
    required this.endsAt,
    required this.active,
  });

  factory Offer.fromJson(Map<String, dynamic> j) => Offer(
        id: asInt(j['id']),
        kind: j['kind']?.toString() ?? 'percent',
        value: asInt(j['value']),
        startsAt: asInt(j['starts_at']),
        endsAt: asInt(j['ends_at']),
        active: asBool(j['active']),
      );
}

class BillingConfig {
  final BillingPlan plan;
  final PlanPrice? currentPrice;

  /// Credits charged per operation, keyed by SpendOp.
  final Map<String, int> creditPrices;
  final List<TopupPack> packs;
  final List<Offer> offers;
  final bool paymentsConfigured;

  BillingConfig({
    required this.plan,
    this.currentPrice,
    required this.creditPrices,
    required this.packs,
    required this.offers,
    required this.paymentsConfigured,
  });

  factory BillingConfig.fromJson(Map<String, dynamic> j) => BillingConfig(
        plan: BillingPlan.fromJson(
            (j['plan'] as Map<String, dynamic>?) ?? const {}),
        currentPrice: j['current_price'] == null
            ? null
            : PlanPrice.fromJson(j['current_price'] as Map<String, dynamic>),
        creditPrices: {
          for (final e in
              ((j['credit_prices'] as Map<String, dynamic>?) ?? const {})
                  .entries)
            e.key: asInt(e.value),
        },
        packs: ((j['packs'] as List?) ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(TopupPack.fromJson)
            .toList(),
        offers: ((j['offers'] as List?) ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(Offer.fromJson)
            .toList(),
        paymentsConfigured: asBool(j['payments_configured']),
      );
}

// ─────────────────────────────────────────────────────────────────────
// Ads
// ─────────────────────────────────────────────────────────────────────

class AdSlide {
  final String? text;
  final String? imagePath;

  AdSlide({this.text, this.imagePath});

  factory AdSlide.fromJson(Map<String, dynamic> j) => AdSlide(
        text: asStringOrNull(j['text']),
        imagePath: asStringOrNull(j['image_path']),
      );

  Map<String, dynamic> toJson() => {
        if (text != null && text!.isNotEmpty) 'text': text,
        if (imagePath != null && imagePath!.isNotEmpty) 'image_path': imagePath,
      };
}

class AdCampaign {
  final int id;
  final List<AdSlide> slides;

  /// all | subscribers | non_subscribers | trial
  final String audience;
  final bool active;
  final int? startsAt;
  final int? endsAt;

  AdCampaign({
    required this.id,
    required this.slides,
    required this.audience,
    required this.active,
    this.startsAt,
    this.endsAt,
  });

  factory AdCampaign.fromJson(Map<String, dynamic> j) {
    // The server stores slides as a JSON string column; some responses
    // hand back the decoded list. Accept both.
    final raw = j['slides'] ?? j['slides_json'];
    final list = raw is List
        ? raw
        : (raw is String && raw.isNotEmpty ? jsonDecode(raw) as List : const []);
    return AdCampaign(
      id: asInt(j['id']),
      slides: list
          .whereType<Map<String, dynamic>>()
          .map(AdSlide.fromJson)
          .toList(),
      audience: j['audience']?.toString() ?? 'all',
      active: asBool(j['active']),
      startsAt: j['starts_at'] == null ? null : asInt(j['starts_at']),
      endsAt: j['ends_at'] == null ? null : asInt(j['ends_at']),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────
// AI providers
// ─────────────────────────────────────────────────────────────────────

/// One provider's live standing. `active` is the operator's explicit choice
/// (AI_PROVIDER) — the platform never switches provider on its own, so a
/// failure here names the account to top up instead of reading as
/// "the AI is down".
class ProviderStatus {
  final String id;
  final String label;
  final bool active;
  final bool keyConfigured;
  final String keyField;

  /// The model this provider answers with — only set for the active one.
  final String? model;
  final int? lastSuccessAt;
  final int? lastFailureAt;
  final String? lastFailureCode;

  ProviderStatus({
    required this.id,
    required this.label,
    required this.active,
    required this.keyConfigured,
    required this.keyField,
    this.model,
    this.lastSuccessAt,
    this.lastFailureAt,
    this.lastFailureCode,
  });

  factory ProviderStatus.fromJson(Map<String, dynamic> j) => ProviderStatus(
        id: j['id']?.toString() ?? '',
        label: j['label']?.toString() ?? '',
        active: asBool(j['active']),
        keyConfigured: asBool(j['keyConfigured']),
        keyField: j['keyField']?.toString() ?? '',
        model: asStringOrNull(j['model']),
        lastSuccessAt:
            j['lastSuccessAt'] == null ? null : asInt(j['lastSuccessAt']),
        lastFailureAt:
            j['lastFailureAt'] == null ? null : asInt(j['lastFailureAt']),
        lastFailureCode: asStringOrNull(j['lastFailureCode']),
      );
}

class ProviderOverview {
  final String active;
  final List<ProviderStatus> providers;

  ProviderOverview({required this.active, required this.providers});

  factory ProviderOverview.fromJson(Map<String, dynamic> j) => ProviderOverview(
        active: j['active']?.toString() ?? '',
        providers: ((j['providers'] as List?) ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(ProviderStatus.fromJson)
            .toList(),
      );
}

class ModelChoice {
  final String id;
  final String label;

  ModelChoice({required this.id, required this.label});

  factory ModelChoice.fromJson(Map<String, dynamic> j) => ModelChoice(
        id: j['id']?.toString() ?? '',
        label: j['label']?.toString() ?? '',
      );
}

class ModelCatalogue {
  final String provider;
  final List<ModelChoice> models;
  final String? defaultModel;

  ModelCatalogue({
    required this.provider,
    required this.models,
    this.defaultModel,
  });

  factory ModelCatalogue.fromJson(Map<String, dynamic> j) => ModelCatalogue(
        provider: j['provider']?.toString() ?? '',
        models: ((j['models'] as List?) ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(ModelChoice.fromJson)
            .toList(),
        defaultModel: asStringOrNull(j['defaultModel']),
      );
}

/// What the MCP channel would actually call with, and what it falls back to.
class AgentModelStatus {
  final String channel;
  final String platformModel;
  final String? platformRef;
  final List<String> fallbacks;

  AgentModelStatus({
    required this.channel,
    required this.platformModel,
    this.platformRef,
    required this.fallbacks,
  });

  factory AgentModelStatus.fromJson(Map<String, dynamic> j) => AgentModelStatus(
        channel: j['channel']?.toString() ?? '',
        platformModel: j['platformModel']?.toString() ?? '',
        platformRef: asStringOrNull(j['platformRef']),
        fallbacks: ((j['fallbacks'] as List?) ?? const [])
            .map((e) => e.toString())
            .toList(),
      );
}

/// What a million tokens costs us, per model. The usage meter reads these
/// per call, so an edit lands on the very next LLM call.
class ModelPrice {
  final String provider;
  final String model;
  final double inputUsdPerM;
  final double outputUsdPerM;

  ModelPrice({
    required this.provider,
    required this.model,
    required this.inputUsdPerM,
    required this.outputUsdPerM,
  });

  factory ModelPrice.fromJson(Map<String, dynamic> j) => ModelPrice(
        provider: j['provider']?.toString() ?? '',
        model: j['model']?.toString() ?? '',
        inputUsdPerM: asDouble(j['input_usd_per_m']),
        outputUsdPerM: asDouble(j['output_usd_per_m']),
      );
}

// ─────────────────────────────────────────────────────────────────────
// Operations
// ─────────────────────────────────────────────────────────────────────

class UsageRow {
  final int userId;
  final String email;
  final String status;
  final int usedToday;
  final int quota;

  UsageRow({
    required this.userId,
    required this.email,
    required this.status,
    required this.usedToday,
    required this.quota,
  });

  factory UsageRow.fromJson(Map<String, dynamic> j) => UsageRow(
        userId: asInt(j['user_id']),
        email: j['email']?.toString() ?? '',
        status: j['status']?.toString() ?? '',
        usedToday: asInt(j['used_today']),
        quota: asInt(j['quota'], 1000),
      );
}

class AuditRow {
  final int id;
  final int? userId;
  final String action;
  final String? detail;
  final String createdAt;

  AuditRow({
    required this.id,
    this.userId,
    required this.action,
    this.detail,
    required this.createdAt,
  });

  factory AuditRow.fromJson(Map<String, dynamic> j) => AuditRow(
        id: asInt(j['id']),
        userId: j['user_id'] == null ? null : asInt(j['user_id']),
        action: j['action']?.toString() ?? '',
        detail: asStringOrNull(j['detail']),
        createdAt: j['created_at']?.toString() ?? '',
      );
}

/// The counters that say whether the doctrine is holding: hidden writes,
/// executions in the wrong mode, plan edits outside the revision path, and
/// surfaces that disagreed about the same moment.
class DiagnosticsReport {
  final Map<String, num> critical;
  final Map<String, num> parityTotals;
  final int parityUnpaired;
  final Map<String, num> counters;
  final Map<String, num> reevaluation;
  final Map<String, num> caseMemory;

  DiagnosticsReport({
    required this.critical,
    required this.parityTotals,
    required this.parityUnpaired,
    required this.counters,
    required this.reevaluation,
    required this.caseMemory,
  });

  static Map<String, num> _numbers(dynamic raw) {
    final map = (raw as Map<String, dynamic>?) ?? const {};
    final out = <String, num>{};
    for (final e in map.entries) {
      if (e.value is num) {
        out[e.key] = e.value as num;
      } else if (e.value is String) {
        final parsed = num.tryParse(e.value as String);
        if (parsed != null) out[e.key] = parsed;
      }
    }
    return out;
  }

  factory DiagnosticsReport.fromJson(Map<String, dynamic> j) {
    final parity = (j['parity'] as Map<String, dynamic>?) ?? const {};
    return DiagnosticsReport(
      critical: _numbers(j['critical']),
      parityTotals: _numbers(parity['totals']),
      // The server sends a COUNT here, not a list of moments
      // (`parityLog.ts`: `unpaired: number`, computed by `COUNT(*)`). This
      // line read it as a list and took `.length`, so `7 as List?` threw and
      // — because the screen loads its four sources with `Future.wait` — the
      // single bad cast killed the whole Operations screen for the operator
      // while health, usage and the audit trail all parsed fine.
      //
      // It goes through the same coercer every other number in this file uses;
      // it was the one field bypassing them with a raw cast.
      parityUnpaired: asInt(parity['unpaired']),
      counters: _numbers(j['counters']),
      reevaluation: _numbers(j['reevaluation']),
      caseMemory: _numbers(j['caseMemory']),
    );
  }
}

/// Outcome of the one-time "everyone starts clean" reset.
class AccountResetResult {
  final int accounts;
  final int granted;
  final int grantEach;

  AccountResetResult({
    required this.accounts,
    required this.granted,
    required this.grantEach,
  });

  factory AccountResetResult.fromJson(Map<String, dynamic> j) =>
      AccountResetResult(
        accounts: asInt(j['accounts']),
        granted: asInt(j['granted']),
        grantEach: asInt(j['grantEach']),
      );
}

/// What the server made of an uploaded ad image.
class AdImageUpload {
  final String imagePath;
  final String ext;
  final int bytes;

  /// Measured from the file's own bytes, not guessed from its format: an
  /// operator can see before publishing whether the picture actually moves.
  final bool animated;
  final bool animatedCapable;

  AdImageUpload({
    required this.imagePath,
    required this.ext,
    required this.bytes,
    required this.animated,
    required this.animatedCapable,
  });

  factory AdImageUpload.fromJson(Map<String, dynamic> j) => AdImageUpload(
        imagePath: j['image_path']?.toString() ?? '',
        ext: j['ext']?.toString() ?? '',
        bytes: asInt(j['bytes']),
        animated: asBool(j['animated']),
        animatedCapable: asBool(j['animated_capable']),
      );
}

/// The upload bounds, read from the server rather than guessed client-side.
class AdUploadLimits {
  final int maxBytes;
  final List<String> accepted;

  AdUploadLimits({required this.maxBytes, required this.accepted});

  factory AdUploadLimits.fromJson(Map<String, dynamic> j) => AdUploadLimits(
        maxBytes: asInt(j['max_bytes'], 2 * 1024 * 1024),
        accepted: ((j['accepted'] as List?) ?? const ['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
            .map((e) => e.toString())
            .toList(),
      );
}

/// The support inbox: conversations plus what is unread in each.
///
/// A list that shows only "open" tells the admin which threads exist, not
/// which are WAITING on them — those are different questions, and only the
/// second one is a to-do list.
class SupportInbox {
  final List<TicketRow> tickets;
  final Map<int, int> unread;
  final int unreadTotal;

  SupportInbox({
    required this.tickets,
    required this.unread,
    required this.unreadTotal,
  });

  factory SupportInbox.fromJson(Map<String, dynamic> j) => SupportInbox(
        tickets: ((j['tickets'] as List?) ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(TicketRow.fromJson)
            .toList(),
        unread: {
          for (final e in ((j['unread'] as Map<String, dynamic>?) ?? const {}).entries)
            asInt(e.key): asInt(e.value),
        },
        unreadTotal: asInt(j['unread_total']),
      );
}
