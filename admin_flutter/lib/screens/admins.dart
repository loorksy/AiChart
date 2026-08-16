import 'package:flutter/material.dart';

import '../api/models.dart';
import '../api/repository.dart';
import '../i18n.dart';
import 'shell.dart';

/// Admin roles — the same surface the old web console had: who administers
/// the platform and with which permission set. Granting a role promotes the
/// account to admin; removing it demotes back to a regular user. The API
/// (roles_write) refuses self-edits server-side.
class AdminsScreen extends StatefulWidget {
  final AdminRepository repo;
  final int selfId;
  const AdminsScreen({super.key, required this.repo, required this.selfId});

  @override
  State<AdminsScreen> createState() => _AdminsScreenState();
}

/// Roles as the server defines them (adminRoles.ts). "owner" grants all.
const kAdminRoles = [
  'owner',
  'support',
  'user_manager',
  'content_manager',
  'finance',
];

class _AdminsScreenState extends State<AdminsScreen> {
  late Future<List<AdminRoleRow>> _future;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    _future = widget.repo.adminRoles();
    setState(() {});
  }

  String _roleLabel(BuildContext context, String? role) {
    final l = L.of(context);
    return l.t('role_${role ?? 'owner'}');
  }

  Future<void> _apply(int userId, String? role) async {
    final l = L.of(context);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await widget.repo.setAdminRole(userId, role);
      messenger.showSnackBar(SnackBar(content: Text(l.t('saved'))));
      _load();
    } catch (e) {
      messenger
          .showSnackBar(SnackBar(content: Text('${l.t('saveFailed')} $e')));
    }
  }

  Future<void> _addAdminDialog() async {
    final l = L.of(context);
    final messenger = ScaffoldMessenger.of(context);
    List<AdminUserView> users;
    try {
      users = (await widget.repo.users())
          .where((u) => u.role != 'admin')
          .toList();
    } catch (e) {
      messenger
          .showSnackBar(SnackBar(content: Text('${l.t('loadFailed')} $e')));
      return;
    }
    if (!mounted) return;
    if (users.isEmpty) {
      messenger.showSnackBar(SnackBar(content: Text(l.t('noResults'))));
      return;
    }

    int? userId = users.first.id;
    String role = 'support';

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(l.t('addAdmin')),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              DropdownButton<int>(
                value: userId,
                isExpanded: true,
                items: [
                  for (final u in users)
                    DropdownMenuItem(
                      value: u.id,
                      child: Text(u.email,
                          overflow: TextOverflow.ellipsis,
                          textDirection: TextDirection.ltr),
                    ),
                ],
                onChanged: (v) => setDialogState(() => userId = v),
              ),
              const SizedBox(height: 8),
              DropdownButton<String>(
                value: role,
                isExpanded: true,
                items: [
                  for (final r in kAdminRoles)
                    DropdownMenuItem(
                        value: r, child: Text(_roleLabel(context, r))),
                ],
                onChanged: (v) =>
                    setDialogState(() => role = v ?? 'support'),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(l.t('close')),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(l.t('addAdmin')),
            ),
          ],
        ),
      ),
    );

    if (confirmed == true && userId != null) {
      await _apply(userId!, role);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = L.of(context);
    final scheme = Theme.of(context).colorScheme;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  l.t('admins'),
                  style: Theme.of(context)
                      .textTheme
                      .titleLarge
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
              ),
              FilledButton.icon(
                onPressed: _addAdminDialog,
                icon: const Icon(Icons.person_add_alt, size: 16),
                label: Text(l.t('addAdmin')),
              ),
              const SizedBox(width: 4),
              IconButton(
                tooltip: l.t('refresh'),
                onPressed: _load,
                icon: const Icon(Icons.refresh),
              ),
            ],
          ),
        ),
        Expanded(
          child: AsyncBody<List<AdminRoleRow>>(
            future: _future,
            onRetry: _load,
            builder: (context, admins) {
              if (admins.isEmpty) {
                return Center(child: Text(l.t('noResults')));
              }
              return ListView.separated(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
                itemCount: admins.length,
                separatorBuilder: (_, _) => const SizedBox(height: 8),
                itemBuilder: (context, i) {
                  final a = admins[i];
                  final isSelf = a.userId == widget.selfId;
                  return Card(
                    child: ListTile(
                      leading: Icon(
                        a.adminRole == null || a.adminRole == 'owner'
                            ? Icons.shield
                            : Icons.admin_panel_settings_outlined,
                        color: a.adminRole == null || a.adminRole == 'owner'
                            ? scheme.secondary
                            : scheme.onSurfaceVariant,
                      ),
                      title: Text(a.email,
                          textDirection: TextDirection.ltr,
                          style: const TextStyle(fontWeight: FontWeight.w600)),
                      subtitle: Text(
                        _roleLabel(context, a.adminRole),
                        style: const TextStyle(fontSize: 12),
                      ),
                      trailing: isSelf
                          ? Chip(
                              label: Text(l.t('you')),
                              visualDensity: VisualDensity.compact,
                            )
                          : PopupMenuButton<String>(
                              onSelected: (v) =>
                                  _apply(a.userId, v == '__demote' ? null : v),
                              itemBuilder: (context) => [
                                for (final r in kAdminRoles)
                                  if (r != (a.adminRole ?? 'owner'))
                                    PopupMenuItem(
                                      value: r,
                                      child: Text(_roleLabel(context, r)),
                                    ),
                                const PopupMenuDivider(),
                                PopupMenuItem(
                                  value: '__demote',
                                  child: Text(
                                    l.t('demoteAdmin'),
                                    style: TextStyle(color: scheme.error),
                                  ),
                                ),
                              ],
                            ),
                    ),
                  );
                },
              );
            },
          ),
        ),
      ],
    );
  }
}
