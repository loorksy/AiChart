import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lonora_admin/api/models.dart';
import 'package:lonora_admin/i18n.dart';
import 'package:lonora_admin/theme.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('models parse SQLite-style loose types', () {
    final user = AdminUserView.fromJson({
      'id': '7',
      'email': 'x@y.z',
      'role': 'user',
      'status': 'active',
      'signup_via': 'email',
      'can_execute': 'true',
      'claude_quota': '500',
    });
    expect(user.id, 7);
    expect(user.canExecute, true);
    expect(user.claudeQuota, 500);

    final field = ConfigField.fromJson({
      'key': 'OANDA_API_TOKEN',
      'label': 'مفتاح OANDA',
      'labelEn': 'OANDA_API_TOKEN',
      'group': 'markets',
      'configured': true,
      'secret': true,
      'masked': 'abcd…1234',
    });
    expect(field.secret, true);
    expect(field.value, null);
  });

  test('session user keeps admin_permissions from /api/me or login', () {
    final user = SessionUser.fromJson({
      'id': 1,
      'email': 'boss@t.local',
      'role': 'admin',
      'status': 'active',
    }, permissions: ['users_read', 'roles_write']);
    expect(user.adminPermissions, contains('roles_write'));
    expect(user.role, 'admin');
  });

  test('overview handles null kpis (no profit_read permission)', () {
    final o = OverviewResponse.fromJson({
      'ok': true,
      'days': 30,
      'permissions': ['users_read'],
      'kpis': null,
      'series': [],
      'leaders': [],
    });
    expect(o.kpis, null);
    expect(o.permissions, contains('users_read'));
  });

  test('billing config parses the whole pricing surface', () {
    final cfg = BillingConfig.fromJson({
      'ok': true,
      'plan': {
        'signup_grant_credits': '250',
        'min_rr_first_target_bp': 250,
        'low_balance_threshold': 50,
        'expiry_warn_days': 5,
      },
      'current_price': {
        'id': 3,
        'price_cents': 18000,
        'credits_per_cycle': 1200,
        'cycle_days': 30,
        'archived_at': null,
      },
      'credit_prices': {'recommendation': 10, 'chat_turn': 0, 'mt5_link': '0'},
      'packs': [
        {'id': 1, 'credits': 500, 'price_cents': 9000, 'active': 1, 'sort': 0},
      ],
      'offers': [
        {
          'id': 2,
          'kind': 'percent',
          'value': 20,
          'starts_at': 1,
          'ends_at': 2,
          'active': 1,
        },
      ],
      'payments_configured': false,
    });
    expect(cfg.plan.signupGrantCredits, 250);
    expect(cfg.plan.minRrFirstTargetBp, 250);
    expect(cfg.currentPrice!.creditsPerCycle, 1200);
    // Chat is free, and a zero price must survive as zero rather than
    // collapsing into "unset".
    expect(cfg.creditPrices['chat_turn'], 0);
    expect(cfg.packs.single.active, true);
    expect(cfg.offers.single.kind, 'percent');
    expect(cfg.paymentsConfigured, false);
  });

  test('a provider that failed after its last success reads as failing', () {
    final overview = ProviderOverview.fromJson({
      'ok': true,
      'active': 'openai',
      'providers': [
        {
          'id': 'openai',
          'label': 'OpenAI',
          'active': true,
          'keyConfigured': true,
          'keyField': 'OPENAI_API_KEY',
          'model': 'gpt-5.6',
          'lastSuccessAt': 1000,
          'lastFailureAt': 2000,
          'lastFailureCode': 'provider_billing',
        },
        {
          'id': 'anthropic',
          'label': 'Anthropic',
          'active': false,
          'keyConfigured': false,
          'keyField': 'ANTHROPIC_API_KEY',
          'model': null,
          'lastSuccessAt': null,
          'lastFailureAt': null,
          'lastFailureCode': null,
        },
      ],
    });
    expect(overview.active, 'openai');
    final openai = overview.providers.first;
    // The whole point of the per-provider row: the operator can see WHICH
    // account is failing and why, instead of "the AI is down".
    expect(openai.lastFailureCode, 'provider_billing');
    expect(openai.lastFailureAt! > openai.lastSuccessAt!, true);
    // Only the active provider reports the model it would answer with.
    expect(overview.providers.last.model, null);
  });

  test('ad campaigns parse slides whether encoded or decoded', () {
    final encoded = AdCampaign.fromJson({
      'id': 1,
      'slides_json': '[{"text":"hello","image_path":"a.png"}]',
      'audience': 'subscribers',
      'active': 1,
      'starts_at': null,
      'ends_at': null,
    });
    expect(encoded.slides.single.text, 'hello');
    expect(encoded.slides.single.imagePath, 'a.png');

    final decoded = AdCampaign.fromJson({
      'id': 2,
      'slides': [
        {'text': 'hi'},
      ],
      'audience': 'all',
      'active': 0,
    });
    expect(decoded.slides.single.imagePath, null);
    expect(decoded.active, false);
  });

  test('a subscription row carries the balance and no trial counters', () {
    final row = SubscriptionUser.fromJson({
      'user_id': 4,
      'email': 'a@b.c',
      'role': 'user',
      'status': 'active',
      'plan_status': 'trial',
      'credits': '120',
      'subscription_expires_at': null,
    });
    expect(row.credits, 120);
    // There is ONE currency. If a trial counter ever comes back into this
    // model, the billing model has regressed.
    expect(
      SubscriptionUser.fromJson(const {}).credits,
      0,
      reason: 'a missing balance reads as zero, never as null',
    );
  });

  test('every t() key the code asks for exists in BOTH languages', () {
    // The platform's rule, mirrored here: a missing language key is an
    // explicit test failure, never a silent fallback that ships the raw key
    // name to the screen. Scanning the source means the guard cannot rot the
    // way a hand-written key list does.
    final literal = _tCall;
    final asked = <String, String>{};
    for (final file in _dartSources()) {
      final text = file.readAsStringSync();
      for (final match in literal.allMatches(text)) {
        asked[match.group(1)!] = file.path;
      }
    }
    expect(asked.length, greaterThan(40), reason: 'the scan found nothing');

    // Keys built at runtime from a known set — the scan cannot see these, so
    // they are named here alongside the enumeration that produces them.
    for (final op in ['recommendation', 'chat_turn', 'mt5_link']) {
      asked['op_$op'] = 'pricing.dart';
    }
    for (final audience in [
      'all',
      'subscribers',
      'non_subscribers',
      'trial',
    ]) {
      asked['audience_$audience'] = 'ads.dart';
    }
    for (final role in [
      'owner',
      'support',
      'user_manager',
      'content_manager',
      'finance',
    ]) {
      asked['role_$role'] = 'admins.dart';
    }

    final missing = <String>[];
    for (final entry in asked.entries) {
      for (final code in L.localeCodes) {
        if (!L.has(entry.key, code)) {
          missing.add('$code: ${entry.key}  (${entry.value})');
        }
      }
    }
    expect(missing, isEmpty, reason: missing.join('\n'));
  });

  test('the string table carries no key the code stopped asking for', () {
    // The other direction: a key nobody uses is dead weight that outlives the
    // feature it described — exactly how "restore trial" survived the trial
    // being deleted.
    final literal = _tCall;
    final asked = <String>{};
    for (final file in _dartSources()) {
      for (final match in literal.allMatches(file.readAsStringSync())) {
        asked.add(match.group(1)!);
      }
    }
    const dynamicPrefixes = ['op_', 'audience_', 'role_'];
    final unused = L.keys
        .where((k) => !asked.contains(k))
        .where((k) => !dynamicPrefixes.any(k.startsWith))
        .toList();
    expect(unused, isEmpty, reason: 'unused keys: ${unused.join(', ')}');
  });

  test('themes build for both brightnesses with token colors', () {
    final light = lonoraTheme(Brightness.light);
    final dark = lonoraTheme(Brightness.dark);
    expect(light.scaffoldBackgroundColor, const Color(0xFFFFFFFF));
    expect(dark.scaffoldBackgroundColor, const Color(0xFF000000));
    expect(dark.colorScheme.secondary, LonoraTokens.darkGold);
  });
}

/// A `t('key')` call — and not `Text('…')` or `fromEnvironment('…')`, which
/// also end in "t(". The boundary before the `t` is what separates them.
final _tCall =
    RegExp(r"""(?<![A-Za-z0-9_])t\(\s*'([a-zA-Z_][a-zA-Z_0-9]*)'\s*\)""");

/// Every Dart source in the app (tests excluded).
List<File> _dartSources() {
  final dir = Directory('lib');
  return dir
      .listSync(recursive: true)
      .whereType<File>()
      .where((f) => f.path.endsWith('.dart'))
      .toList();
}
