import 'package:flutter/material.dart';

import '../api/models.dart';
import '../api/repository.dart';
import '../i18n.dart';
import 'credit_dialog.dart';
import 'shell.dart';

class UsersScreen extends StatefulWidget {
  final AdminRepository repo;
  final int adminId;
  const UsersScreen({super.key, required this.repo, required this.adminId});

  @override
  State<UsersScreen> createState() => _UsersScreenState();
}

class _UsersScreenState extends State<UsersScreen> {
  late Future<List<AdminUserView>> _future;
  String _query = '';
  String _statusFilter = 'all';

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    _future = widget.repo.users();
    setState(() {});
  }

  Future<void> _setStatus(AdminUserView u, String status) async {
    final l = L.of(context);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await widget.repo.patchUser(u.id, {'status': status});
      messenger.showSnackBar(SnackBar(content: Text(l.t('saved'))));
      _load();
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('${l.t('saveFailed')} $e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = L.of(context);
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  decoration: InputDecoration(
                    hintText: l.t('search'),
                    prefixIcon: const Icon(Icons.search, size: 20),
                    isDense: true,
                  ),
                  onChanged: (v) =>
                      setState(() => _query = v.trim().toLowerCase()),
                ),
              ),
              const SizedBox(width: 8),
              DropdownButton<String>(
                value: _statusFilter,
                underline: const SizedBox.shrink(),
                items: [
                  DropdownMenuItem(value: 'all', child: Text(l.t('status'))),
                  DropdownMenuItem(value: 'active', child: Text(l.t('active'))),
                  DropdownMenuItem(
                      value: 'pending', child: Text(l.t('pending'))),
                  DropdownMenuItem(
                      value: 'suspended', child: Text(l.t('disabled'))),
                ],
                onChanged: (v) => setState(() => _statusFilter = v ?? 'all'),
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
          child: AsyncBody<List<AdminUserView>>(
            future: _future,
            onRetry: _load,
            builder: (context, users) {
              final filtered = users.where((u) {
                if (_statusFilter != 'all' && u.status != _statusFilter) {
                  return false;
                }
                if (_query.isEmpty) return true;
                return u.email.toLowerCase().contains(_query) ||
                    (u.username ?? '').toLowerCase().contains(_query);
              }).toList();
              if (filtered.isEmpty) {
                return Center(child: Text(l.t('noResults')));
              }
              return ListView.separated(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
                itemCount: filtered.length,
                separatorBuilder: (_, _) => const SizedBox(height: 8),
                itemBuilder: (context, i) => _UserTile(
                  user: filtered[i],
                  isSelf: filtered[i].id == widget.adminId,
                  onSetStatus: (s) => _setStatus(filtered[i], s),
                  onAdjustCredits: () => adjustCreditsDialog(
                    context: context,
                    repo: widget.repo,
                    userId: filtered[i].id,
                    email: filtered[i].email,
                    onDone: _load,
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

class _UserTile extends StatelessWidget {
  final AdminUserView user;
  final bool isSelf;
  final ValueChanged<String> onSetStatus;
  final VoidCallback onAdjustCredits;

  const _UserTile({
    required this.user,
    required this.isSelf,
    required this.onSetStatus,
    required this.onAdjustCredits,
  });

  @override
  Widget build(BuildContext context) {
    final l = L.of(context);
    final scheme = Theme.of(context).colorScheme;

    final (statusLabel, statusColor) = switch (user.status) {
      'active' => (l.t('active'), const Color(0xFF16A34A)),
      'pending' => (l.t('pending'), scheme.secondary),
      _ => (l.t('disabled'), scheme.error),
    };

    return Card(
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
        leading: CircleAvatar(
          backgroundColor: scheme.surfaceContainerHighest,
          child: Text(
            user.email.isEmpty ? '?' : user.email[0].toUpperCase(),
            style: TextStyle(color: scheme.onSurface),
          ),
        ),
        title: Row(
          children: [
            Flexible(
              child: Text(
                user.email,
                overflow: TextOverflow.ellipsis,
                textDirection: TextDirection.ltr,
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
            ),
            if (user.role == 'admin') ...[
              const SizedBox(width: 6),
              Chip(
                label: Text(l.t('admin')),
                visualDensity: VisualDensity.compact,
                padding: EdgeInsets.zero,
              ),
            ],
          ],
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 2),
          child: Row(
            children: [
              Icon(Icons.circle, size: 8, color: statusColor),
              const SizedBox(width: 4),
              Text(statusLabel, style: const TextStyle(fontSize: 12)),
              const SizedBox(width: 10),
              Text(
                user.signupVia,
                style:
                    TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                textDirection: TextDirection.ltr,
              ),
            ],
          ),
        ),
        trailing: PopupMenuButton<String>(
          onSelected: (value) {
            if (value == 'credits') {
              onAdjustCredits();
            } else {
              onSetStatus(value);
            }
          },
          itemBuilder: (context) => [
            PopupMenuItem(value: 'credits', child: Text(l.t('adjustCredits'))),
            // Status changes stop at your own account: locking yourself out
            // of the console is not an action worth offering.
            if (!isSelf) ...[
              const PopupMenuDivider(),
              if (user.status != 'active')
                PopupMenuItem(value: 'active', child: Text(l.t('approve'))),
              if (user.status == 'active')
                PopupMenuItem(value: 'suspended', child: Text(l.t('disable'))),
              if (user.status == 'suspended')
                PopupMenuItem(value: 'active', child: Text(l.t('enable'))),
            ],
          ],
        ),
      ),
    );
  }
}
