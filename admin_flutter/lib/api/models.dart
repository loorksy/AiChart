/// Typed views over the platform's admin API responses. Field names mirror
/// the server JSON exactly; parsing is defensive because SQLite and Postgres
/// installs stringify numbers/booleans differently.
library;

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

  SessionUser({
    required this.id,
    required this.email,
    required this.role,
    required this.status,
    this.username,
  });

  factory SessionUser.fromJson(Map<String, dynamic> j) => SessionUser(
        id: asInt(j['id']),
        email: j['email']?.toString() ?? '',
        role: j['role']?.toString() ?? 'user',
        status: j['status']?.toString() ?? '',
        username: asStringOrNull(j['username']),
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

class SubscriptionUser {
  final int userId;
  final String email;
  final String role;
  final String status;
  final String planStatus;
  final int trialInteractionsUsed;
  final int trialRecommendationsUsed;
  final String? subscriptionExpiresAt;
  final String? note;

  SubscriptionUser({
    required this.userId,
    required this.email,
    required this.role,
    required this.status,
    required this.planStatus,
    required this.trialInteractionsUsed,
    required this.trialRecommendationsUsed,
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
        trialInteractionsUsed: asInt(j['trial_interactions_used']),
        trialRecommendationsUsed: asInt(j['trial_recommendations_used']),
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

  MessageRow({
    required this.id,
    required this.author,
    required this.body,
    required this.createdAt,
  });

  factory MessageRow.fromJson(Map<String, dynamic> j) => MessageRow(
        id: asInt(j['id']),
        author: j['author']?.toString() ?? 'user',
        body: j['body']?.toString() ?? '',
        createdAt: asInt(j['created_at']),
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
