import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lonora_admin/api/client.dart';
import 'package:lonora_admin/api/models.dart';
import 'package:lonora_admin/api/repository.dart';
import 'package:lonora_admin/i18n.dart';
import 'package:lonora_admin/screens/admins.dart';
import 'package:lonora_admin/screens/ads.dart';
import 'package:lonora_admin/screens/billing.dart';
import 'package:lonora_admin/screens/config.dart';
import 'package:lonora_admin/screens/operations.dart';
import 'package:lonora_admin/screens/overview.dart';
import 'package:lonora_admin/screens/pricing.dart';
import 'package:lonora_admin/screens/providers.dart';
import 'package:lonora_admin/screens/shell.dart';
import 'package:lonora_admin/screens/support.dart';
import 'package:lonora_admin/screens/users.dart';

/// Can an operator actually REACH every screen?
///
/// This exists because the guard that came before it could not answer that.
/// It read every Dart file as one blob and checked that each `/api/admin`
/// path appeared somewhere in it — and every path lives in `repository.dart`,
/// so it passed whether or not a screen existed, and whether or not anything
/// linked to it. Deleting the Ads destination outright left it green. A file
/// on disk is not a destination; an endpoint with a client method is not a
/// screen.
///
/// So this pumps the real shell and reads the widget tree it built:
///
///   - every required destination is rendered, by its own name;
///   - the destination list and the page stack are the SAME length and the
///     SAME order — they are two parallel lists in `shell.dart`, and an entry
///     added to one and not the other silently shifts every screen after it
///     onto the wrong label;
///   - selecting a destination shows that screen.
///
/// The screens fire their loads in initState and fail without a server; that
/// is fine and deliberate. Each one renders its own error-and-retry state, so
/// the tree under test is the real tree — no fakes standing in for it.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  /// Destinations in the order `shell.dart` declares them, paired with the
  /// screen that must sit at the same index. Adding a screen to the console
  /// means adding it HERE too — which is the point: the requirement is
  /// written down once, and the shell has to match it.
  const required = <(String, Type)>[
    ('overview', OverviewScreen),
    ('users', UsersScreen),
    ('billing', BillingScreen),
    ('pricing', PricingScreen),
    ('ads', AdsScreen),
    ('providers', ProvidersScreen),
    ('config', ConfigScreen),
    ('operations', OperationsScreen),
    ('support', SupportScreen),
    ('admins', AdminsScreen),
  ];

  Widget shell({List<String> permissions = const ['roles_write']}) {
    final repo = AdminRepository(ApiClient());
    return MaterialApp(
      locale: const Locale('en'),
      supportedLocales: L.supported,
      localizationsDelegates: const [LDelegate(), DefaultMaterialLocalizations.delegate, DefaultWidgetsLocalizations.delegate],
      home: AdminShell(
        repo: repo,
        user: SessionUser(
          id: 1,
          email: 'admin@lonora.test',
          role: 'admin',
          status: 'active',
          adminPermissions: permissions,
        ),
        onLogout: () async {},
        themeMode: ThemeMode.dark,
        onToggleTheme: () {},
        onToggleLocale: () {},
      ),
    );
  }

  /// A window wide enough for the rail (the drawer is asserted separately).
  void useWideWindow(WidgetTester tester) {
    tester.view.physicalSize = const Size(1600, 1200);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
  }

  testWidgets('every required screen has a destination that reaches it',
      (tester) async {
    useWideWindow(tester);
    await tester.pumpWidget(shell());
    await tester.pump();

    const en = L(Locale('en'));
    final rail = tester.widget<NavigationRail>(find.byType(NavigationRail));
    final stack = tester.widget<IndexedStack>(find.byType(IndexedStack));

    // The two lists must line up. A destination added without its page (or
    // the reverse) shifts every entry after it onto the wrong screen — the
    // failure mode that cannot be seen by reading either list alone.
    expect(
      rail.destinations.length,
      stack.children.length,
      reason: 'destinations and pages have drifted apart in shell.dart',
    );

    for (var i = 0; i < required.length; i++) {
      final (key, screen) = required[i];
      expect(
        rail.destinations.length,
        greaterThan(i),
        reason: 'no destination at index $i — ${en.t(key)} is unreachable',
      );
      final label = rail.destinations[i].label;
      expect(
        label is Text ? label.data : null,
        en.t(key),
        reason: 'destination $i should be ${en.t(key)}',
      );
      expect(
        stack.children[i].runtimeType,
        screen,
        reason: '${en.t(key)} must open $screen, not ${stack.children[i].runtimeType}',
      );
    }

    // Nothing beyond the list: a screen with no destination is not reachable,
    // and a destination with no screen would have thrown above.
    expect(rail.destinations.length, required.length);
  });

  testWidgets('selecting a destination shows that screen', (tester) async {
    useWideWindow(tester);
    await tester.pumpWidget(shell());
    await tester.pump();

    const en = L(Locale('en'));
    // Ads is the one the old guard could not see. Reach it the way an
    // operator does: tap its name.
    await tester.tap(find.text(en.t('ads')).first);
    await tester.pump();

    final stack = tester.widget<IndexedStack>(find.byType(IndexedStack));
    expect(
      stack.index,
      required.indexWhere((r) => r.$1 == 'ads'),
      reason: 'tapping Ads must select the Ads page',
    );
    expect(stack.children[stack.index!].runtimeType, AdsScreen);
  });

  testWidgets('on a phone the destinations live in a drawer, not a bottom bar',
      (tester) async {
    tester.view.physicalSize = const Size(600, 1000);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(shell());
    await tester.pump();

    // A bottom bar cannot hold ten destinations; the console uses a drawer.
    expect(find.byType(NavigationBar), findsNothing);
    final scaffold = tester.widget<Scaffold>(
      find.descendant(of: find.byType(AdminShell), matching: find.byType(Scaffold)).first,
    );
    expect(scaffold.drawer, isNotNull, reason: 'the phone layout needs a drawer');
    expect(scaffold.bottomNavigationBar, isNull);

    // And it opens, carrying the same destinations.
    final state = tester.state<ScaffoldState>(find.byType(Scaffold).first);
    state.openDrawer();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    const en = L(Locale('en'));
    for (final (key, _) in required) {
      expect(
        find.text(en.t(key)),
        findsWidgets,
        reason: '${en.t(key)} is missing from the drawer',
      );
    }
  });

  testWidgets('a permission-gated destination is dropped with its page',
      (tester) async {
    // The Admins destination is owner territory. When it is hidden, the two
    // lists must SHORTEN TOGETHER — this is exactly where parallel lists go
    // wrong, because the condition is written twice.
    useWideWindow(tester);
    await tester.pumpWidget(shell(permissions: const []));
    await tester.pump();

    final rail = tester.widget<NavigationRail>(find.byType(NavigationRail));
    final stack = tester.widget<IndexedStack>(find.byType(IndexedStack));
    expect(rail.destinations.length, required.length - 1);
    expect(stack.children.length, required.length - 1);
    expect(find.byType(AdminsScreen), findsNothing);
    // Everything before it keeps its own page.
    for (var i = 0; i < required.length - 1; i++) {
      expect(stack.children[i].runtimeType, required[i].$2);
    }
  });
}
