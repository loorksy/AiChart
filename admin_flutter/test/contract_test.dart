import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:lonora_admin/api/models.dart';

/// The client half of the admin API contract.
///
/// Defect 9 in one line: the Dart model read `parity.unpaired` as a list and
/// called `.length` on it, while the server had always sent a count. `7 as
/// List?` threw, and because the Operations screen loads four sources with
/// `Future.wait`, that single cast killed the whole screen — the operator saw
/// "Failed to load data. TypeError: 7: type 'int' is not a subtype of type
/// `List<dynamic>?`" and nothing else. Health, usage and the audit trail all
/// parsed fine; they were collateral.
///
/// Every test in the repo stayed green through it, because the guard that
/// existed asked "does the client call this endpoint?" — never "do the two
/// sides agree about the shape of what crosses the wire?". That question is
/// what this file asks, from the client side, against the same fixtures
/// `src/lib/__tests__/adminContract.test.ts` holds the server to.
///
/// A parse that THROWS is the failure mode being pinned; assertions on values
/// come second, and exist so a silently-wrong coercion is caught too.
void main() {
  final fixtures = jsonDecode(
    File('test/fixtures/admin_contracts.json').readAsStringSync(),
  ) as Map<String, dynamic>;

  Map<String, dynamic> f(String endpoint) {
    final value = fixtures[endpoint];
    expect(value, isNotNull, reason: 'no fixture for $endpoint');
    return value as Map<String, dynamic>;
  }

  List<Map<String, dynamic>> listOf(Map<String, dynamic> json, String key) =>
      ((json[key] as List?) ?? const []).whereType<Map<String, dynamic>>().toList();

  test('diagnostics: the Operations screen parses the real payload', () {
    // The exact regression. `unpaired` is a COUNT.
    final report = DiagnosticsReport.fromJson(f('admin/diagnostics'));
    expect(report.parityUnpaired, 7);
    expect(report.critical['unexplainedParity'], 2);
    expect(report.counters['completeContracts'], 41);
    expect(report.reevaluation['confirmed'], 4);
    expect(report.caseMemory['closed'], 9);
    // `byClassification` is a nested map inside totals; the flat coercer skips
    // it rather than crashing. Pinned so that stays a deliberate omission.
    expect(report.parityTotals['pairs'], 12);
    expect(report.parityTotals.containsKey('byClassification'), false);
  });

  test('the support inbox carries per-conversation unread counts', () {
    final inbox = SupportInbox.fromJson(f('admin/support'));
    expect(inbox.tickets.single.id, 4);
    // The trap: JSON object keys are strings even when the server built the
    // map from numeric ticket ids. A badge keyed by `int` finds nothing if the
    // client keeps the key as it arrived.
    expect(inbox.unread[4], 2);
    expect(inbox.unreadTotal, 2);
  });

  test('a support thread parses messages with and without attachments', () {
    final thread = TicketThread.fromJson(f('admin/support?ticket'));
    expect(thread.messages.length, 3);

    final plain = thread.messages[0];
    expect(plain.hasAttachment, false);
    expect(plain.attachmentIsImage, false);

    final image = thread.messages[1];
    // A message may be a file and nothing else — the bubble must not require
    // text to render.
    expect(image.body, '');
    expect(image.hasAttachment, true);
    expect(image.attachmentIsImage, true);
    expect(image.attachmentName, 'screenshot.png');
    expect(image.attachmentBytes, 21044);

    final pdf = thread.messages[2];
    expect(pdf.hasAttachment, true);
    // A PDF is shown as a labelled file, never fed to Image.memory.
    expect(pdf.attachmentIsImage, false);
  });

  test('diagnostics: a zero count parses too', () {
    // `0 as List?` threw exactly like `7 as List?` did — this screen was broken
    // for every possible value, not only a populated one.
    final json = Map<String, dynamic>.from(f('admin/diagnostics'));
    json['parity'] = {'totals': <String, dynamic>{}, 'unpaired': 0};
    expect(DiagnosticsReport.fromJson(json).parityUnpaired, 0);
  });

  test('health, usage and the audit trail parse', () {
    final health = AdminHealth.fromJson(f('admin/health'));
    expect(health.aiProvider, 'anthropic');
    expect(health.usersTotal, 12);

    final usage = listOf(f('admin/usage'), 'usage').map(UsageRow.fromJson).toList();
    expect(usage.single.quota, 1000);

    final audit =
        listOf(f('admin/health'), 'recent_audit').map(AuditRow.fromJson).toList();
    expect(audit.single.action, 'platform_config');
  });

  test('the overview roster reads the key the server actually sends', () {
    // The server answers under `rows`; the client read `users` and therefore
    // returned an empty list forever — the same contract drift, failing
    // silently instead of loudly.
    final rows = listOf(f('admin/overview/users'), 'rows')
        .map(ProfitUserRow.fromJson)
        .toList();
    expect(rows.single.profitUsd, 15.5);
    expect(
      (f('admin/overview/users')['users'] as List?),
      isNull,
      reason: 'if the server ever adds `users`, revisit the client key',
    );
  });

  test('overview KPIs parse', () {
    final overview = OverviewResponse.fromJson(f('admin/overview'));
    expect(overview.days, 30);
    expect(overview.kpis!.payingSubscribers.value, 3);
    expect(overview.series.single.profit, 5.0);
  });

  test('subscriptions carry the balance and no trial counters', () {
    final rows = listOf(f('admin/subscriptions'), 'users')
        .map(SubscriptionUser.fromJson)
        .toList();
    expect(rows.single.credits, 50);
    expect(rows.single.planStatus, 'trial');
  });

  test('the whole pricing surface parses', () {
    final cfg = BillingConfig.fromJson(f('admin/billing/config'));
    expect(cfg.plan.signupGrantCredits, 50);
    expect(cfg.plan.minRrFirstTargetBp, 250);
    expect(cfg.currentPrice!.creditsPerCycle, 1200);
    expect(cfg.creditPrices['chat_turn'], 0);
    // 0/1 from SQLite must coerce to bool, not throw.
    expect(cfg.packs.single.active, true);
    expect(cfg.offers.single.active, true);
  });

  test('providers and the model status parse', () {
    final providers = ProviderOverview.fromJson(f('admin/config/providers'));
    expect(providers.active, 'anthropic');
    expect(providers.providers.single.model, 'claude-sonnet-4-6');

    final status = AgentModelStatus.fromJson(f('admin/agent-model-status'));
    expect(status.platformModel, 'claude-sonnet-4-6');
    expect(status.fallbacks, isNotEmpty);
  });

  test('model prices, ads, users, roles, support and profit parse', () {
    expect(
      listOf(f('admin/model-prices'), 'prices').map(ModelPrice.fromJson).single.inputUsdPerM,
      3.0,
    );

    final ads = listOf(f('admin/ads'), 'ads').map(AdCampaign.fromJson).toList();
    expect(ads.single.slides.single.text, 'hello');
    expect(ads.single.active, true);

    expect(
      listOf(f('admin/users'), 'users').map(AdminUserView.fromJson).single.claudeQuota,
      1000,
    );
    expect(
      listOf(f('admin/roles'), 'admins').map(AdminRoleRow.fromJson).single.email,
      'boss@lonora.test',
    );
    final ticket = listOf(f('admin/support'), 'tickets').map(TicketRow.fromJson).single;
    expect(ticket.needsHuman, true);

    final profit = ProfitReport.fromJson(f('admin/billing/profit'));
    expect(profit.perUser.single.events, 22);

    final reset = AccountResetResult.fromJson(f('admin/billing/reset-accounts'));
    expect(reset.grantEach, 50);
  });

  test('config fields keep a secret masked and never expose its value', () {
    final field = listOf(f('admin/config'), 'fields').map(ConfigField.fromJson).single;
    expect(field.secret, true);
    expect(field.masked, isNotNull);
    expect(field.value, isNull, reason: 'a secret never ships its plaintext');
  });

  test('every fixture is exercised by this file', () {
    // A fixture nobody parses is a contract nobody checks. The server-side
    // test asserts the same set from its end.
    final exercised = {
      'admin/diagnostics',
      'admin/health',
      'admin/usage',
      'admin/overview/users',
      'admin/overview',
      'admin/subscriptions',
      'admin/billing/config',
      'admin/config/providers',
      'admin/agent-model-status',
      'admin/model-prices',
      'admin/ads',
      'admin/users',
      'admin/roles',
      'admin/support',
      'admin/support?ticket',
      'admin/billing/profit',
      'admin/billing/reset-accounts',
      'admin/config',
    };
    final declared = fixtures.keys.where((k) => !k.startsWith('_')).toSet();
    expect(
      declared.difference(exercised),
      isEmpty,
      reason: 'these fixtures are never parsed by any test',
    );
  });
}
