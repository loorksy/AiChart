import 'client.dart';
import 'models.dart';

/// One place that knows the admin endpoints. Screens depend on this, never on
/// paths — mirrors how the web console isolates fetch calls in panels.
class AdminRepository {
  final ApiClient api;
  AdminRepository(this.api);

  // ── Session ─────────────────────────────────────────────────────
  Future<SessionUser> login(String email, String password) async {
    final j = await api
        .sendJson('POST', '/api/auth/login', {'email': email, 'password': password});
    return SessionUser.fromJson(j['user'] as Map<String, dynamic>);
  }

  /// Returns null when there is no session (401) instead of throwing.
  Future<SessionUser?> currentUser() async {
    try {
      final j = await api.getJson('/api/me');
      return SessionUser.fromJson(j['user'] as Map<String, dynamic>);
    } on ApiException catch (e) {
      if (e.unauthorized) return null;
      rethrow;
    }
  }

  Future<void> logout() => api.sendJson('POST', '/api/auth/logout', const {});

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

  Future<void> adjustCredits(
          {required int userId,
          required double amountUsd,
          required String reason}) =>
      api.sendJson('POST', '/api/admin/billing/adjust', {
        'user_id': userId,
        'amount_usd': amountUsd,
        'reason': reason,
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

  // ── Support ─────────────────────────────────────────────────────
  Future<List<TicketRow>> tickets({String? status}) async {
    final j = await api.getJson('/api/admin/support',
        query: status == null ? null : {'status': status});
    return ((j['tickets'] as List?) ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(TicketRow.fromJson)
        .toList();
  }

  Future<TicketThread> ticket(int id) async => TicketThread.fromJson(
      await api.getJson('/api/admin/support', query: {'ticket': '$id'}));

  Future<void> replyTicket(int id, String body) => api.sendJson(
      'POST', '/api/admin/support',
      {'action': 'reply', 'ticket_id': id, 'body': body});

  Future<void> closeTicket(int id) => api
      .sendJson('POST', '/api/admin/support', {'action': 'close', 'ticket_id': id});
}
