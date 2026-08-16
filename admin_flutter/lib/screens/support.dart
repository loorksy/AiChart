import 'package:flutter/material.dart';
import 'package:intl/intl.dart' as intl;

import '../api/models.dart';
import '../api/repository.dart';
import '../i18n.dart';
import 'shell.dart';

class SupportScreen extends StatefulWidget {
  final AdminRepository repo;
  const SupportScreen({super.key, required this.repo});

  @override
  State<SupportScreen> createState() => _SupportScreenState();
}

class _SupportScreenState extends State<SupportScreen> {
  late Future<List<TicketRow>> _future;
  String? _statusFilter;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    _future = widget.repo.tickets(status: _statusFilter);
    setState(() {});
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
                child: Text(
                  l.t('support'),
                  style: Theme.of(context)
                      .textTheme
                      .titleLarge
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
              ),
              SegmentedButton<String?>(
                segments: [
                  ButtonSegment(value: null, label: Text(l.t('status'))),
                  ButtonSegment(value: 'open', label: Text(l.t('ticketOpen'))),
                  ButtonSegment(
                      value: 'closed', label: Text(l.t('ticketClosed'))),
                ],
                selected: {_statusFilter},
                onSelectionChanged: (s) {
                  _statusFilter = s.first;
                  _load();
                },
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
          child: AsyncBody<List<TicketRow>>(
            future: _future,
            onRetry: _load,
            builder: (context, tickets) {
              if (tickets.isEmpty) {
                return Center(child: Text(l.t('noResults')));
              }
              final fmt = intl.DateFormat('y/MM/dd HH:mm');
              return ListView.separated(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
                itemCount: tickets.length,
                separatorBuilder: (_, _) => const SizedBox(height: 8),
                itemBuilder: (context, i) {
                  final t = tickets[i];
                  return Card(
                    child: ListTile(
                      leading: Icon(
                        t.status == 'open'
                            ? Icons.mark_email_unread_outlined
                            : Icons.mark_email_read_outlined,
                        color: t.needsHuman
                            ? Theme.of(context).colorScheme.secondary
                            : null,
                      ),
                      title: Text(t.subject,
                          maxLines: 1, overflow: TextOverflow.ellipsis),
                      subtitle: Text(
                        '#${t.id} · ${t.status == 'open' ? l.t('ticketOpen') : l.t('ticketClosed')} · '
                        '${fmt.format(DateTime.fromMillisecondsSinceEpoch(t.updatedAt))}',
                        style: const TextStyle(fontSize: 12),
                        textDirection: TextDirection.ltr,
                      ),
                      onTap: () async {
                        await showDialog(
                          context: context,
                          builder: (_) =>
                              _TicketDialog(repo: widget.repo, ticketId: t.id),
                        );
                        _load();
                      },
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

class _TicketDialog extends StatefulWidget {
  final AdminRepository repo;
  final int ticketId;
  const _TicketDialog({required this.repo, required this.ticketId});

  @override
  State<_TicketDialog> createState() => _TicketDialogState();
}

class _TicketDialogState extends State<_TicketDialog> {
  late Future<TicketThread> _future;
  final _reply = TextEditingController();
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    _future = widget.repo.ticket(widget.ticketId);
    setState(() {});
  }

  Future<void> _send() async {
    final l = L.of(context);
    if (_reply.text.trim().isEmpty) return;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    try {
      await widget.repo.replyTicket(widget.ticketId, _reply.text.trim());
      _reply.clear();
      _load();
    } catch (e) {
      messenger
          .showSnackBar(SnackBar(content: Text('${l.t('saveFailed')} $e')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _close() async {
    setState(() => _busy = true);
    try {
      await widget.repo.closeTicket(widget.ticketId);
      if (mounted) Navigator.pop(context);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = L.of(context);
    final scheme = Theme.of(context).colorScheme;
    return Dialog(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560, maxHeight: 640),
        child: AsyncBody<TicketThread>(
          future: _future,
          onRetry: _load,
          builder: (context, thread) {
            return Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          thread.ticket.subject,
                          style: const TextStyle(
                              fontSize: 16, fontWeight: FontWeight.w700),
                        ),
                      ),
                      if (thread.ticket.status == 'open')
                        TextButton(
                          onPressed: _busy ? null : _close,
                          child: Text(l.t('ticketClosed')),
                        ),
                      IconButton(
                        onPressed: () => Navigator.pop(context),
                        icon: const Icon(Icons.close),
                      ),
                    ],
                  ),
                ),
                const Divider(height: 1),
                Flexible(
                  child: ListView(
                    shrinkWrap: true,
                    padding: const EdgeInsets.all(16),
                    children: [
                      for (final m in thread.messages)
                        Align(
                          alignment: m.author == 'admin'
                              ? AlignmentDirectional.centerEnd
                              : AlignmentDirectional.centerStart,
                          child: Container(
                            margin: const EdgeInsets.only(bottom: 8),
                            padding: const EdgeInsets.symmetric(
                                horizontal: 12, vertical: 8),
                            constraints: const BoxConstraints(maxWidth: 420),
                            decoration: BoxDecoration(
                              color: m.author == 'admin'
                                  ? scheme.primary
                                  : scheme.surfaceContainerHighest,
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Text(
                              m.body,
                              style: TextStyle(
                                color: m.author == 'admin'
                                    ? scheme.onPrimary
                                    : scheme.onSurface,
                                fontSize: 13,
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                if (thread.ticket.status == 'open') ...[
                  const Divider(height: 1),
                  Padding(
                    padding: const EdgeInsets.all(12),
                    child: Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _reply,
                            decoration:
                                InputDecoration(hintText: l.t('support')),
                            onSubmitted: (_) => _busy ? null : _send(),
                          ),
                        ),
                        const SizedBox(width: 8),
                        IconButton.filled(
                          onPressed: _busy ? null : _send,
                          icon: const Icon(Icons.send),
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            );
          },
        ),
      ),
    );
  }
}
