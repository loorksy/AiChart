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
      'has_mt5': 0,
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

  test('both locales cover every string key', () {
    const l = L(Locale('ar'));
    const en = L(Locale('en'));
    for (final key in [
      'appTitle', 'login', 'overview', 'users', 'billing', 'config', 'support'
    ]) {
      expect(l.t(key), isNot(key), reason: 'ar missing $key');
      expect(en.t(key), isNot(key), reason: 'en missing $key');
    }
  });

  test('themes build for both brightnesses with token colors', () {
    final light = lonoraTheme(Brightness.light);
    final dark = lonoraTheme(Brightness.dark);
    expect(light.scaffoldBackgroundColor, const Color(0xFFFFFFFF));
    expect(dark.scaffoldBackgroundColor, const Color(0xFF000000));
    expect(dark.colorScheme.secondary, LonoraTokens.darkGold);
  });
}
