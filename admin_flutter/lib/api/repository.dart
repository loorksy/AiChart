import 'dart:convert';
import 'dart:typed_data';

import 'client.dart';
import 'file_picker.dart';
import 'models.dart';

/// One place that knows the admin endpoints — and the ONLY admin client the
/// platform has: the old in-app Next.js panel is gone, so an endpoint that is
/// not reachable from here is not reachable by an operator at all. A repo test
/// (`adminSurfaceParity`) fails when an /api/admin route has no method here,
/// which is what keeps that true as routes are added.
class AdminRepository {
  final ApiClient api;
  AdminRepository(this.api);

  // ── Session ─────────────────────────────────────────────────────
  Future<SessionUser> login(String email, String password) async {
    final j = await api
        .sendJson('POST', '/api/auth/login', {'email': email, 'password': password});
    final token = j['token']?.toString();
    if (token != null && token.isNotEmpty) {
      api.bearerToken = token;
    }
    final permissions = ((j['admin_permissions'] as List?) ?? const [])
        .map((e) => e.toString())
        .toList();
    var user = SessionUser.fromJson(j['user'] as Map<String, dynamic>,
        permissions: permissions);
    // Older servers omit admin_permissions on login — fill from /api/me
    // before the shell renders so the Admins tab is not raced away.
    if (user.role == 'admin' && user.adminPermissions.isEmpty) {
      final full = await currentUser();
      if (full != null) user = full;
    }
    return user;
  }

  /// Returns null when there is no session (401) instead of throwing.
  Future<SessionUser?> currentUser() async {
    try {
      final j = await api.getJson('/api/me');
      final permissions = ((j['admin_permissions'] as List?) ?? const [])
          .map((e) => e.toString())
          .toList();
      return SessionUser.fromJson(j['user'] as Map<String, dynamic>,
          permissions: permissions);
    } on ApiException catch (e) {
      if (e.unauthorized) return null;
      rethrow;
    }
  }

  Future<void> logout() async {
    try {
      await api.sendJson('POST', '/api/auth/logout', const {});
    } finally {
      api.bearerToken = null;
    }
  }

  // ── Overview / health ───────────────────────────────────────────
  Future<OverviewResponse> overview({int days = 30}) async {
    final j =
        await api.getJson('/api/admin/overview', query: {'days': '$days'});
    return OverviewResponse.fromJson(j);
  }

  Future<AdminHealth> health() async =>
      AdminHealth.fromJson(await api.getJson('/api/admin/health'));

  // ── Users ───────────────────────────────────────────────────────
  Future<List<AdminUserView>> users() async {
    final j = await api.getJson('/api/admin/users');
    return ((j['users'] as List?) ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(AdminUserView.fromJson)
        .toList();
  }

  Future<void> patchUser(int id, Map<String, dynamic> patch) =>
      api.sendJson('PATCH', '/api/admin/users/$id', patch);

  // ── Subscriptions / billing ─────────────────────────────────────
  Future<List<SubscriptionUser>> searchSubscriptions(String q) async {
    final j = await api.getJson('/api/admin/subscriptions', query: {'q': q});
    return ((j['users'] as List?) ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(SubscriptionUser.fromJson)
        .toList();
  }

  Future<ProfitReport> profit() async =>
      ProfitReport.fromJson(await api.getJson('/api/admin/billing/profit'));

  /// Manual credit top-up (or clawback) for ONE account.
  ///
  /// `credits` is a signed INTEGER of credits — the platform's only
  /// currency — and `reason` is mandatory because it is written into the
  /// ledger next to the amount: every manual move stays explainable months
  /// later. A negative amount goes through the same conditional debit as a
  /// spend, so it can empty a balance and can never take it below zero
  /// (the server answers 409 instead).
  Future<int> adjustCredits({
    required int userId,
    required int credits,
    required String reason,
  }) async {
    final j = await api.sendJson('POST', '/api/admin/billing/adjust', {
      'user_id': userId,
      'credits': credits,
      'reason': reason,
    });
    return asInt(j['balance']);
  }

  /// Manual plan activation — Stripe is not wired up, so the admin grants the
  /// plan directly. Access is governed by the ENTITLEMENT layer
  /// (`user_entitlements.plan_status`), not the `subscriptions` table, so the
  /// entitlement activation must come first; the billing grant afterwards is
  /// the revenue/credits bookkeeping (gift months are $0 revenue).
  Future<void> activatePlan(
      {required int userId, required int months, required bool gift}) async {
    final expiresAt = DateTime.now()
        .toUtc()
        .add(Duration(days: months * 30))
        .toIso8601String();
    await api.sendJson('POST', '/api/admin/subscriptions/$userId', {
      'action': 'activate',
      'expiresAt': expiresAt,
    });
    await api.sendJson('POST', '/api/admin/billing/subscription', {
      'user_id': userId,
      'months': months,
      'gift': gift,
    });
  }

  Future<void> setSubscriptionAction(int userId, String action,
          {String? note}) =>
      api.sendJson('POST', '/api/admin/subscriptions/$userId', {
        'action': action,
        if (note != null && note.isNotEmpty) 'note': note,
      });

  // ── Platform config ─────────────────────────────────────────────
  Future<List<ConfigField>> configFields() async {
    final j = await api.getJson('/api/admin/config');
    return ((j['fields'] as List?) ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(ConfigField.fromJson)
        .toList();
  }

  Future<List<ConfigField>> saveConfig(Map<String, dynamic> patch) async {
    final j = await api.sendJson('PUT', '/api/admin/config', patch);
    return ((j['fields'] as List?) ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(ConfigField.fromJson)
        .toList();
  }

  // ── Admin roles ─────────────────────────────────────────────────
  Future<List<AdminRoleRow>> adminRoles() async {
    final j = await api.getJson('/api/admin/roles');
    return ((j['admins'] as List?) ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(AdminRoleRow.fromJson)
        .toList();
  }

  /// role = null demotes the account back to a regular user.
  Future<void> setAdminRole(int userId, String? role) =>
      api.sendJson('POST', '/api/admin/roles', {'user_id': userId, 'role': role});

  // ── Support ─────────────────────────────────────────────────────
  /// The inbox: conversations plus how many messages wait in each.
  Future<SupportInbox> supportInbox({String? status}) async =>
      SupportInbox.fromJson(await api.getJson('/api/admin/support',
          query: status == null ? null : {'status': status}));

  Future<List<TicketRow>> tickets({String? status}) async =>
      (await supportInbox(status: status)).tickets;

  Future<TicketThread> ticket(int id) async => TicketThread.fromJson(
      await api.getJson('/api/admin/support', query: {'ticket': '$id'}));

  /// Reply in a conversation, optionally with a file.
  ///
  /// The bytes go up as base64 in the same JSON action the panel already
  /// speaks. The SERVER validates them from their magic bytes and size — the
  /// filename travels only as a label.
  Future<void> replyTicket(int id, String body, {PickedFile? attachment}) =>
      api.sendJson('POST', '/api/admin/support', {
        'action': 'reply',
        'ticket_id': id,
        'body': body,
        if (attachment != null)
          'attachment': {
            'name': attachment.name,
            'data_base64': base64Encode(attachment.bytes),
          },
      });

  /// The bytes of one support attachment, fetched with the session attached.
  Future<Uint8List> supportAttachment(String storedName) =>
      api.getBytes('/api/support/attachment/$storedName');

  Future<void> closeTicket(int id) => api
      .sendJson('POST', '/api/admin/support', {'action': 'close', 'ticket_id': id});

  // ── Billing configuration ───────────────────────────────────────
  // Every priced or bounded number the platform enforces is DATA read and
  // written here — none of it is a constant in code.

  Future<BillingConfig> billingConfig() async =>
      BillingConfig.fromJson(await api.getJson('/api/admin/billing/config'));

  /// Settings that are edited in place: the welcome grant, the R:R floor,
  /// and the two warning thresholds. Credit prices ride along because they
  /// are versioned by the server, not by this call.
  Future<BillingConfig> saveBillingSettings({
    int? signupGrantCredits,
    int? minRrFirstTargetBp,
    int? lowBalanceThreshold,
    int? expiryWarnDays,
    Map<String, int>? creditPrices,
  }) async {
    final body = <String, dynamic>{
      'signup_grant_credits': ?signupGrantCredits,
      'min_rr_first_target_bp': ?minRrFirstTargetBp,
      'low_balance_threshold': ?lowBalanceThreshold,
      'expiry_warn_days': ?expiryWarnDays,
      if (creditPrices != null && creditPrices.isNotEmpty)
        'credit_prices': creditPrices,
    };
    return BillingConfig.fromJson(
        await api.sendJson('PUT', '/api/admin/billing/config', body));
  }

  /// Publishing a price writes a NEW immutable row and archives the old one —
  /// subscribers keep the terms they bought.
  Future<void> publishPlanPrice({
    required int priceCents,
    required int creditsPerCycle,
    required int cycleDays,
  }) =>
      api.sendJson('POST', '/api/admin/billing/config', {
        'price_cents': priceCents,
        'credits_per_cycle': creditsPerCycle,
        'cycle_days': cycleDays,
      });

  // ── Top-up packs ────────────────────────────────────────────────
  Future<List<TopupPack>> packs() async {
    final j = await api.getJson('/api/admin/billing/packs');
    return _packs(j);
  }

  Future<List<TopupPack>> createPack(
          {required int credits, required int priceCents, int? sort}) async =>
      _packs(await api.sendJson('POST', '/api/admin/billing/packs', {
        'credits': credits,
        'price_cents': priceCents,
        'sort': ?sort,
      }));

  /// Packs ARCHIVE, never vanish: an open checkout carries its own pinned
  /// terms and history keeps its reference.
  Future<List<TopupPack>> updatePack(int id,
          {bool? active, int? sort, bool archive = false}) async =>
      _packs(await api.sendJson('PATCH', '/api/admin/billing/packs', {
        'id': id,
        if (archive) 'archive': true,
        if (!archive) 'active': ?active,
        if (!archive) 'sort': ?sort,
      }));

  List<TopupPack> _packs(Map<String, dynamic> j) =>
      ((j['packs'] as List?) ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(TopupPack.fromJson)
          .toList();

  // ── Offers ──────────────────────────────────────────────────────
  Future<List<Offer>> offers() async =>
      _offers(await api.getJson('/api/admin/billing/offers'));

  Future<List<Offer>> createOffer({
    required String kind,
    required int value,
    required int startsAt,
    required int endsAt,
  }) async =>
      _offers(await api.sendJson('POST', '/api/admin/billing/offers', {
        'kind': kind,
        'value': value,
        'starts_at': startsAt,
        'ends_at': endsAt,
      }));

  Future<List<Offer>> setOfferActive(int id, bool active) async =>
      _offers(await api.sendJson(
          'PATCH', '/api/admin/billing/offers', {'id': id, 'active': active}));

  List<Offer> _offers(Map<String, dynamic> j) =>
      ((j['offers'] as List?) ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(Offer.fromJson)
          .toList();

  // ── Model prices (what a provider charges US) ───────────────────
  Future<List<ModelPrice>> modelPrices() async {
    final j = await api.getJson('/api/admin/model-prices');
    return ((j['prices'] as List?) ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(ModelPrice.fromJson)
        .toList();
  }

  Future<void> saveModelPrice(ModelPrice price) =>
      api.sendJson('PUT', '/api/admin/model-prices', {
        'provider': price.provider,
        'model': price.model,
        'input_usd_per_m': price.inputUsdPerM,
        'output_usd_per_m': price.outputUsdPerM,
      });

  // ── The one-time account reset ──────────────────────────────────
  /// Puts every non-admin account back to FREE with a fresh welcome balance:
  /// no subscription, no balance, no ledger, then the CURRENT grant. The
  /// confirmation phrase is required by the server, not just by the dialog.
  Future<AccountResetResult> resetAllAccounts() async =>
      AccountResetResult.fromJson(await api.sendJson(
          'POST', '/api/admin/billing/reset-accounts', {'confirm': 'RESET'}));

  // ── AI providers ────────────────────────────────────────────────
  /// Who is active, whose key is present, and how each one last answered.
  Future<ProviderOverview> providers() async =>
      ProviderOverview.fromJson(await api.getJson('/api/admin/config/providers'));

  /// The curated model catalogue for the active provider. The server proves
  /// the key works against the provider's own endpoint before answering, so a
  /// failure here IS the key verdict.
  Future<ModelCatalogue> modelCatalogue({String? draftKey}) async =>
      ModelCatalogue.fromJson(draftKey == null || draftKey.isEmpty
          ? await api.getJson('/api/admin/config/models')
          : await api.sendJson(
              'POST', '/api/admin/config/models', {'apiKey': draftKey}));

  Future<AgentModelStatus> agentModelStatus() async => AgentModelStatus.fromJson(
      await api.getJson('/api/admin/agent-model-status'));

  // ── Ads ─────────────────────────────────────────────────────────
  Future<List<AdCampaign>> ads() async =>
      _ads(await api.getJson('/api/admin/ads'));

  Future<List<AdCampaign>> createAd({
    required List<AdSlide> slides,
    required String audience,
    bool active = true,
    int? startsAt,
    int? endsAt,
  }) async =>
      _ads(await api.sendJson('POST', '/api/admin/ads', {
        'slides': slides.map((s) => s.toJson()).toList(),
        'audience': audience,
        'active': active,
        'starts_at': startsAt,
        'ends_at': endsAt,
      }));

  Future<List<AdCampaign>> updateAd(
    int id, {
    bool? active,
    String? audience,
    List<AdSlide>? slides,
  }) async =>
      _ads(await api.sendJson('PATCH', '/api/admin/ads', {
        'id': id,
        'active': ?active,
        'audience': ?audience,
        'slides': ?slides?.map((s) => s.toJson()).toList(),
      }));

  /// Deletion is a PATCH with `remove` — the server keeps ONE write path for
  /// a campaign so every change lands in the same audit entry shape.
  Future<List<AdCampaign>> deleteAd(int id) async => _ads(await api
      .sendJson('PATCH', '/api/admin/ads', {'id': id, 'remove': true}));

  /// Uploads one image FILE and returns what the server made of it.
  ///
  /// The bytes travel as bytes. The server checks the MAGIC BYTES and the size
  /// cap and ignores the filename and content type entirely, so what comes
  /// back — including whether the picture actually animates — is measured,
  /// not claimed by the client.
  Future<AdImageUpload> uploadAdImage({
    required Uint8List bytes,
    required String filename,
    String? mimeType,
  }) async {
    final j = await api.uploadFile(
      '/api/admin/ads/upload',
      bytes: bytes,
      filename: filename,
      mimeType: mimeType,
    );
    return AdImageUpload.fromJson(j);
  }

  /// What the picker may offer, straight from the server, so the dialog's
  /// filter and the rule that is actually enforced cannot drift apart.
  Future<AdUploadLimits> adUploadLimits() async =>
      AdUploadLimits.fromJson(await api.getJson('/api/admin/ads/upload'));

  List<AdCampaign> _ads(Map<String, dynamic> j) =>
      ((j['ads'] as List?) ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(AdCampaign.fromJson)
          .toList();

  // ── Operations ──────────────────────────────────────────────────
  Future<List<UsageRow>> usage() async {
    final j = await api.getJson('/api/admin/usage');
    return ((j['usage'] as List?) ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(UsageRow.fromJson)
        .toList();
  }

  Future<DiagnosticsReport> diagnostics() async =>
      DiagnosticsReport.fromJson(await api.getJson('/api/admin/diagnostics'));

  /// Moments where two surfaces described the same thing differently. The
  /// full entry list backs the summary the diagnostics screen shows.
  Future<Map<String, dynamic>> parity() =>
      api.getJson('/api/admin/parity');

  /// The audit trail — who changed what, newest first.
  Future<List<AuditRow>> recentAudit() async {
    final j = await api.getJson('/api/admin/health');
    return ((j['recent_audit'] as List?) ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(AuditRow.fromJson)
        .toList();
  }

  /// Users behind the overview KPIs (the dashboard's drill-down table).
  Future<List<ProfitUserRow>> overviewUsers({int days = 30}) async {
    final j = await api
        .getJson('/api/admin/overview/users', query: {'days': '$days'});
    // The route answers under `rows`, not `users` — reading the wrong key
    // returned an empty list forever instead of failing, which is the quieter
    // half of the same contract-drift bug that killed the Operations screen.
    return ((j['rows'] as List?) ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(ProfitUserRow.fromJson)
        .toList();
  }
}
