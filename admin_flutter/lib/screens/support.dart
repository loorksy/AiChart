import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart' as intl;

import '../api/file_picker.dart';
import '../api/models.dart';
import '../api/repository.dart';
import '../i18n.dart';
import 'shell.dart';

/// Support, as a conversation rather than a ticket queue.
///
/// Two things separate this from the list it replaced: the inbox says how many
/// messages are actually WAITING in each conversation (an open conversation
/// with nothing new in it is not work), and a thread carries files both ways.
class SupportScreen extends StatefulWidget {
  final AdminRepository repo;
  const SupportScreen({super.key, required this.repo});

  @override
  State<SupportScreen> createState() => _SupportScreenState();
}

class _SupportScreenState extends State<SupportScreen> {
  late Future<SupportInbox> _future;
  String? _statusFilter;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    _future = widget.repo.supportInbox(status: _statusFilter);
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
          child: AsyncBody<SupportInbox>(
            future: _future,
            onRetry: _load,
            builder: (context, inbox) {
              final tickets = inbox.tickets;
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
                  final unread = inbox.unread[t.id] ?? 0;
                  return Card(
                    child: ListTile(
                      leading: Icon(
                        unread > 0
                            ? Icons.mark_email_unread_outlined
                            : Icons.mark_email_read_outlined,
                        color: unread > 0 || t.needsHuman
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
                      trailing: unread > 0
                          ? _UnreadBadge(count: unread, label: l.t('unread'))
                          : null,
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

/// How many messages are waiting in one conversation.
class _UnreadBadge extends StatelessWidget {
  final int count;
  final String label;
  const _UnreadBadge({required this.count, required this.label});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Tooltip(
      message: label,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
        decoration: BoxDecoration(
          color: scheme.error,
          borderRadius: BorderRadius.circular(999),
        ),
        child: Text(
          '$count',
          style: TextStyle(
            color: scheme.onError,
            fontSize: 12,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
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
  PickedFile? _pending;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    _future = widget.repo.ticket(widget.ticketId);
    setState(() {});
  }

  Future<void> _pick() async {
    final file = await pickImageFile(
      accept: const ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'],
    );
    if (file == null) return;
    setState(() {
      _pending = file;
      _error = null;
    });
  }

  Future<void> _send() async {
    final l = L.of(context);
    final text = _reply.text.trim();
    if (text.isEmpty && _pending == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.repo.replyTicket(widget.ticketId, text, attachment: _pending);
      _reply.clear();
      _pending = null;
      _load();
    } catch (e) {
      setState(() => _error = '${l.t('saveFailed')} $e');
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
                      IconButton(
                        tooltip: l.t('refresh'),
                        onPressed: _busy ? null : _load,
                        icon: const Icon(Icons.refresh),
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
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                if (m.body.isNotEmpty)
                                  Text(
                                    m.body,
                                    style: TextStyle(
                                      color: m.author == 'admin'
                                          ? scheme.onPrimary
                                          : scheme.onSurface,
                                      fontSize: 13,
                                    ),
                                  ),
                                if (m.hasAttachment)
                                  Padding(
                                    padding: EdgeInsets.only(
                                        top: m.body.isNotEmpty ? 8 : 0),
                                    child: _Attachment(
                                      repo: widget.repo,
                                      message: m,
                                      onPrimary: m.author == 'admin',
                                    ),
                                  ),
                              ],
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
                    child: Text(_error!,
                        style: TextStyle(color: scheme.error, fontSize: 12)),
                  ),
                if (thread.ticket.status == 'open') ...[
                  const Divider(height: 1),
                  if (_pending != null)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                      child: Row(
                        children: [
                          const Icon(Icons.attach_file, size: 16),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              '${_pending!.name} · ${(_pending!.sizeBytes / 1024).toStringAsFixed(0)} KB',
                              style: const TextStyle(fontSize: 12),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          IconButton(
                            tooltip: l.t('delete'),
                            onPressed: () => setState(() => _pending = null),
                            icon: const Icon(Icons.close, size: 16),
                          ),
                        ],
                      ),
                    ),
                  Padding(
                    padding: const EdgeInsets.all(12),
                    child: Row(
                      children: [
                        IconButton(
                          tooltip: l.t('attachFile'),
                          onPressed: _busy ? null : _pick,
                          icon: const Icon(Icons.attach_file),
                        ),
                        Expanded(
                          child: TextField(
                            controller: _reply,
                            decoration:
                                InputDecoration(hintText: l.t('writeMessage')),
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

/// One attachment inside a thread bubble.
///
/// The bytes are fetched through the authenticated client rather than handed
/// to `Image.network`: these files are private, behind an ownership check, and
/// a bare browser request carries none of this console's session.
class _Attachment extends StatefulWidget {
  final AdminRepository repo;
  final MessageRow message;
  final bool onPrimary;
  const _Attachment({
    required this.repo,
    required this.message,
    required this.onPrimary,
  });

  @override
  State<_Attachment> createState() => _AttachmentState();
}

class _AttachmentState extends State<_Attachment> {
  Future<Uint8List>? _bytes;

  @override
  void initState() {
    super.initState();
    if (widget.message.attachmentIsImage) _fetch();
  }

  void _fetch() {
    _bytes = widget.repo.supportAttachment(widget.message.attachmentPath!);
  }

  @override
  Widget build(BuildContext context) {
    final l = L.of(context);
    final scheme = Theme.of(context).colorScheme;
    final fg = widget.onPrimary ? scheme.onPrimary : scheme.onSurface;
    final label = widget.message.attachmentName?.trim();

    if (!widget.message.attachmentIsImage) {
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.description_outlined, size: 16, color: fg),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              label == null || label.isEmpty ? l.t('attachment') : label,
              style: TextStyle(color: fg, fontSize: 12),
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      );
    }

    return FutureBuilder<Uint8List>(
      future: _bytes,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const SizedBox(
            height: 60,
            child: Center(
              child: SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
          );
        }
        if (snap.hasError || snap.data == null) {
          return Text(
            l.t('attachmentFailed'),
            style: TextStyle(color: fg, fontSize: 12),
          );
        }
        return ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: Image.memory(
            snap.data!,
            fit: BoxFit.contain,
            width: 320,
            errorBuilder: (_, _, _) => Text(
              l.t('attachmentFailed'),
              style: TextStyle(color: fg, fontSize: 12),
            ),
          ),
        );
      },
    );
  }
}
