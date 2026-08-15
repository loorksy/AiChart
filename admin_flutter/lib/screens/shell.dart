import 'package:flutter/material.dart';

import '../api/models.dart';
import '../api/repository.dart';
import '../i18n.dart';
import 'admins.dart';
import 'billing.dart';
import 'config.dart';
import 'overview.dart';
import 'support.dart';
import 'users.dart';

class AdminShell extends StatefulWidget {
  final AdminRepository repo;
  final SessionUser user;
  final Future<void> Function() onLogout;
  final ThemeMode themeMode;
  final VoidCallback onToggleTheme;
  final VoidCallback onToggleLocale;

  const AdminShell({
    super.key,
    required this.repo,
    required this.user,
    required this.onLogout,
    required this.themeMode,
    required this.onToggleTheme,
    required this.onToggleLocale,
  });

  @override
  State<AdminShell> createState() => _AdminShellState();
}

class _AdminShellState extends State<AdminShell> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    final l = L.of(context);
    final wide = MediaQuery.sizeOf(context).width >= 900;

    // The roles surface is owner territory — hidden without roles_write
    // (the API re-checks regardless; this only trims the navigation).
    final canManageRoles =
        widget.user.adminPermissions.contains('roles_write');

    final destinations = [
      (Icons.dashboard_outlined, Icons.dashboard, l.t('overview')),
      (Icons.group_outlined, Icons.group, l.t('users')),
      (Icons.payments_outlined, Icons.payments, l.t('billing')),
      (Icons.key_outlined, Icons.key, l.t('config')),
      (Icons.support_agent_outlined, Icons.support_agent, l.t('support')),
      if (canManageRoles)
        (
          Icons.admin_panel_settings_outlined,
          Icons.admin_panel_settings,
          l.t('admins')
        ),
    ];

    final pages = [
      OverviewScreen(repo: widget.repo),
      UsersScreen(repo: widget.repo, adminId: widget.user.id),
      BillingScreen(repo: widget.repo),
      ConfigScreen(repo: widget.repo),
      SupportScreen(repo: widget.repo),
      if (canManageRoles)
        AdminsScreen(repo: widget.repo, selfId: widget.user.id),
    ];

    final appBar = AppBar(
      title: Text(l.t('appTitle')),
      actions: [
        IconButton(
          tooltip: l.t('language'),
          onPressed: widget.onToggleLocale,
          icon: const Icon(Icons.translate),
        ),
        IconButton(
          tooltip: l.t('theme'),
          onPressed: widget.onToggleTheme,
          icon: Icon(widget.themeMode == ThemeMode.dark
              ? Icons.light_mode_outlined
              : Icons.dark_mode_outlined),
        ),
        IconButton(
          tooltip: l.t('logout'),
          onPressed: () => widget.onLogout(),
          icon: const Icon(Icons.logout),
        ),
        const SizedBox(width: 4),
      ],
    );

    final body = IndexedStack(index: _index, children: pages);

    if (wide) {
      return Scaffold(
        appBar: appBar,
        body: Row(
          children: [
            LayoutBuilder(
              builder: (context, constraints) {
                return SingleChildScrollView(
                  child: ConstrainedBox(
                    constraints:
                        BoxConstraints(minHeight: constraints.maxHeight),
                    child: IntrinsicHeight(
                      child: NavigationRail(
                        selectedIndex: _index,
                        onDestinationSelected: (i) =>
                            setState(() => _index = i),
                        labelType: NavigationRailLabelType.all,
                        destinations: [
                          for (final d in destinations)
                            NavigationRailDestination(
                              icon: Icon(d.$1),
                              selectedIcon: Icon(d.$2),
                              label: Text(d.$3),
                            ),
                        ],
                      ),
                    ),
                  ),
                );
              },
            ),
            const VerticalDivider(width: 1),
            Expanded(child: body),
          ],
        ),
      );
    }

    return Scaffold(
      appBar: appBar,
      body: body,
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: [
          for (final d in destinations)
            NavigationDestination(
              icon: Icon(d.$1),
              selectedIcon: Icon(d.$2),
              label: d.$3,
            ),
        ],
      ),
    );
  }
}

/// Shared async-load scaffold: spinner → error+retry → content.
class AsyncBody<T> extends StatelessWidget {
  final Future<T>? future;
  final Widget Function(BuildContext, T) builder;
  final VoidCallback onRetry;

  const AsyncBody({
    super.key,
    required this.future,
    required this.builder,
    required this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    final l = L.of(context);
    return FutureBuilder<T>(
      future: future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snap.hasError) {
          return Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(l.t('loadFailed')),
                const SizedBox(height: 4),
                Text(
                  '${snap.error}',
                  style: TextStyle(
                    fontSize: 12,
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                  textDirection: TextDirection.ltr,
                ),
                const SizedBox(height: 12),
                OutlinedButton(onPressed: onRetry, child: Text(l.t('retry'))),
              ],
            ),
          );
        }
        return builder(context, snap.data as T);
      },
    );
  }
}
