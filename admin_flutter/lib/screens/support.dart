import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart' as intl;

import '../api/file_picker.dart';
import '../api/models.dart';
import '../api/repository.dart';
import '../i18n.dart';
import '../theme.dart';
import 'shell.dart';

/// Support as a conversation workspace — the same language as the
/// end-user chat, with a ticket list beside (or behind) the thread.
///
/// Wide: list on the start edge (right in RTL), thread takes the rest.
/// Narrow / Android WebView: the list is the screen; tapping a row
/// opens the thread full-screen. A back chevron returns to the list.
/// There is no popup. Selecting a row IS opening the conversation.
class SupportScreen extends StatefulWidget {
  final AdminRepository repo;
  const SupportScreen({super.key, required this.repo});

  /// Below this the thread is a full screen, not a second pane.
  /// The admin APK is a phone WebView; it must get the stacked layout.
  static const wideBreakpoint = 720.0;

  @override
  State<SupportScreen> createState() => _SupportScreenState();
}

class _SupportScreenState extends State<SupportScreen> {
  late Future<SupportInbox> _future;
  String? _statusFilter;
  int? _selectedId;
  TicketRow? _selectedPreview;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    _future = widget.repo.supportInbox(status: _statusFilter);
    setState(() {});
  }

  void _open(TicketRow ticket) {
    setState(() {
      _selectedId = ticket.id;
      _selectedPreview = ticket;
    });
  }

  void _closeThread() {
    setState(() {
      _selectedId = null;
      _selectedPreview = null;
    });
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final wide =
        MediaQuery.sizeOf(context).width >= SupportScreen.wideBreakpoint;
    final showList = wide || _selectedId == null;
    final showThread = _selectedId != null;

    final list = _InboxPane(
      future: _future,
      statusFilter: _statusFilter,
      selectedId: _selectedId,
      onFilter: (value) {
        _statusFilter = value;
        _load();
      },
      onRefresh: _load,
      onOpen: _open,
    );

    final thread = showThread
        ? _ThreadPane(
            key: ValueKey(_selectedId),
            repo: widget.repo,
            ticketId: _selectedId!,
            preview: _selectedPreview,
            showBack: !wide,
            onBack: _closeThread,
            onChanged: _load,
          )
        : const _EmptyThread();

    if (!wide) {
      return showList ? list : thread;
    }

    return Row(
      children: [
        SizedBox(width: 340, child: list),
        const VerticalDivider(width: 1),
        Expanded(child: thread),
      ],
    );
  }
}

class _InboxPane extends StatelessWidget {
  final Future<SupportInbox> future;
  final String? statusFilter;
  final int? selectedId;
  final ValueChanged<String?> onFilter;
  final VoidCallback onRefresh;
  final ValueChanged<TicketRow> onOpen;

  const _InboxPane({
    required this.future,
    required this.statusFilter,
    required this.selectedId,
    required this.onFilter,
    required this.onRefresh,
    required this.onOpen,
  });

  @override
  Widget build(BuildContext context) {
    final l = L.of(context);
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
          child: Row(
            children: [
              Expanded(
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: AlignmentDirectional.centerStart,
                  child: SegmentedButton<String?>(
                    segments: [
                      ButtonSegment(value: null, label: Text(l.t('status'))),
                      ButtonSegment(
                          value: 'open', label: Text(l.t('ticketOpen'))),
                      ButtonSegment(
                          value: 'closed', label: Text(l.t('ticketClosed'))),
                    ],
                    selected: {statusFilter},
                    onSelectionChanged: (s) => onFilter(s.first),
                  ),
                ),
              ),
              IconButton(
                tooltip: l.t('refresh'),
                onPressed: onRefresh,
                icon: const Icon(Icons.refresh),
              ),
            ],
          ),
        ),
        Expanded(
          child: AsyncBody<SupportInbox>(
            future: future,
            onRetry: onRefresh,
            builder: (context, inbox) {
              final tickets = inbox.tickets;
              if (tickets.isEmpty) {
                return Center(child: Text(l.t('noResults')));
              }
              return ListView.separated(
                key: const Key('support-inbox'),
                padding: const EdgeInsets.fromLTRB(12, 4, 12, 16),
                itemCount: tickets.length,
                separatorBuilder: (_, _) => const SizedBox(height: 8),
                itemBuilder: (context, i) {
                  final t = tickets[i];
                  final unread = inbox.unread[t.id] ?? 0;
                  final selected = t.id == selectedId;
                  return _InboxRow(
                    ticket: t,
                    unread: unread,
                    selected: selected,
                    onTap: () => onOpen(t),
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

class _InboxRow extends StatelessWidget {
  final TicketRow ticket;
  final int unread;
  final bool selected;
  final VoidCallback onTap;

  const _InboxRow({
    required this.ticket,
    required this.unread,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final l = L.of(context);
    final scheme = Theme.of(context).colorScheme;
    final waiting = unread > 0 || ticket.needsHuman;
    return Material(
      color: selected
          ? scheme.secondary.withValues(alpha: 0.12)
          : scheme.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(LonoraTokens.radiusLg),
        side: BorderSide(
          color: selected ? scheme.secondary : scheme.outline,
        ),
      ),
      child: ListTile(
        selected: selected,
        leading: Icon(
          unread > 0
              ? Icons.mark_email_unread_outlined
              : Icons.mark_email_read_outlined,
          color: waiting ? scheme.secondary : null,
        ),
        title: Text(ticket.title,
            maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: Text(
          '#${ticket.id} · ${ticket.isClosed ? l.t('ticketClosed') : l.t('ticketOpen')} · '
          '${_clock(ticket.updatedAt)}',
          style: const TextStyle(fontSize: 12),
          textDirection: TextDirection.ltr,
        ),
        trailing: unread > 0
            ? _UnreadBadge(count: unread, label: l.t('unread'))
            : null,
        onTap: onTap,
      ),
    );
  }
}

class _EmptyThread extends StatelessWidget {
  const _EmptyThread();

  @override
  Widget build(BuildContext context) {
    final l = L.of(context);
    return Center(
      key: const Key('support-empty'),
      child: Text(
        l.t('selectConversation'),
        style: TextStyle(
          color: Theme.of(context).colorScheme.onSurfaceVariant,
          fontSize: 14,
        ),
      ),
    );
  }
}

class _ThreadPane extends StatefulWidget {
  final AdminRepository repo;
  final int ticketId;
  final TicketRow? preview;
  final bool showBack;
  final VoidCallback onBack;
  final VoidCallback onChanged;

  const _ThreadPane({
    super.key,
    required this.repo,
    required this.ticketId,
    required this.preview,
    required this.showBack,
    required this.onBack,
    required this.onChanged,
  });

  @override
  State<_ThreadPane> createState() => _ThreadPaneState();
}

class _ThreadPaneState extends State<_ThreadPane> {
  late Future<TicketThread> _future;
  final _reply = TextEditingController();
  final _scroll = ScrollController();
  bool _busy = false;
  PickedFile? _pending;
  String? _error;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _load();
    _poll = Timer.periodic(const Duration(seconds: 15), (_) {
      if (!_busy) _load();
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    _reply.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _load() {
    _future = widget.repo.ticket(widget.ticketId);
    setState(() {});
    _future.then((_) {
      if (!mounted) return;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scroll.hasClients) {
          _scroll.jumpTo(_scroll.position.maxScrollExtent);
        }
      });
    }).catchError((_) {});
  }

  Future<void> _pick() async {
    final file = await pickImageFile(
      accept: const [
        'image/png',
        'image/jpeg',
        'image/gif',
        'image/webp',
        'application/pdf'
      ],
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
      await widget.repo
          .replyTicket(widget.ticketId, text, attachment: _pending);
      _reply.clear();
      _pending = null;
      _load();
      widget.onChanged();
    } catch (e) {
      setState(() => _error = '${l.t('saveFailed')} $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
      _load();
      widget.onChanged();
    } catch (e) {
      if (mounted) {
        setState(() => _error = '${L.of(context).t('saveFailed')} $e');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = L.of(context);
    final scheme = Theme.of(context).colorScheme;
    return AsyncBody<TicketThread>(
      future: _future,
      onRetry: _load,
      builder: (context, thread) {
        final ticket = thread.ticket;
        final email = (ticket.userEmail ?? widget.preview?.userEmail)?.trim();
        final visible =
            thread.messages.where((m) => !m.isRatingRequest).toList();
        return Column(
          key: const Key('support-thread'),
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _ThreadHeader(
              ticket: ticket,
              email: email,
              showBack: widget.showBack,
              busy: _busy,
              onBack: widget.onBack,
              onRefresh: _load,
              onClose: () => _run(() => widget.repo.closeTicket(ticket.id)),
              onReopen: () => _run(() => widget.repo.reopenTicket(ticket.id)),
              onRequestRating: () =>
                  _run(() => widget.repo.requestSupportRating(ticket.id)),
            ),
            const Divider(height: 1),
            Expanded(
              child: ListView.builder(
                controller: _scroll,
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
                itemCount: visible.length +
                    (ticket.ratingPending || ticket.rating != null ? 1 : 0),
                itemBuilder: (context, i) {
                  if (i == visible.length) {
                    return _RatingNote(ticket: ticket);
                  }
                  final m = visible[i];
                  final previous = i > 0 ? visible[i - 1] : null;
                  final newDay = previous == null ||
                      !_sameDay(previous.createdAt, m.createdAt);
                  return Column(
                    children: [
                      if (newDay) _DaySeparator(at: m.createdAt),
                      _Bubble(repo: widget.repo, message: m),
                    ],
                  );
                },
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
                child: Text(_error!,
                    style: TextStyle(color: scheme.error, fontSize: 12)),
              ),
            if (ticket.isClosed)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
                child: Text(
                  l.t('conversationClosed'),
                  style: TextStyle(
                    color: scheme.onSurfaceVariant,
                    fontSize: 12,
                  ),
                ),
              ),
            if (_pending != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
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
              padding: const EdgeInsets.fromLTRB(8, 4, 8, 12),
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
                      enabled: !_busy,
                      minLines: 1,
                      maxLines: 4,
                      textInputAction: TextInputAction.send,
                      decoration:
                          InputDecoration(hintText: l.t('writeMessage')),
                      onSubmitted: (_) => _busy ? null : _send(),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    tooltip: l.t('send'),
                    onPressed: _busy ? null : _send,
                    icon: const Icon(Icons.send),
                  ),
                ],
              ),
            ),
          ],
        );
      },
    );
  }
}

class _ThreadHeader extends StatelessWidget {
  final TicketRow ticket;
  final String? email;
  final bool showBack;
  final bool busy;
  final VoidCallback onBack;
  final VoidCallback onRefresh;
  final VoidCallback onClose;
  final VoidCallback onReopen;
  final VoidCallback onRequestRating;

  const _ThreadHeader({
    required this.ticket,
    required this.email,
    required this.showBack,
    required this.busy,
    required this.onBack,
    required this.onRefresh,
    required this.onClose,
    required this.onReopen,
    required this.onRequestRating,
  });

  @override
  Widget build(BuildContext context) {
    final l = L.of(context);
    final scheme = Theme.of(context).colorScheme;
    final name = (email != null && email!.isNotEmpty)
        ? email!
        : '#${ticket.userId}';
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 8, 8, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              if (showBack)
                IconButton(
                  key: const Key('support-back'),
                  tooltip: l.t('support'),
                  onPressed: onBack,
                  icon: const Icon(Icons.arrow_back),
                ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontSize: 15, fontWeight: FontWeight.w700),
                      textDirection: email != null && email!.contains('@')
                          ? TextDirection.ltr
                          : null,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '#${ticket.id} · ${l.t('created')} ${_iso(_clock(ticket.createdAt))} · '
                      '${l.t('updated')} ${_iso(_clock(ticket.updatedAt))}',
                      style: TextStyle(
                        fontSize: 11,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              _StatusChip(closed: ticket.isClosed),
            ],
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              if (ticket.rating != null)
                Padding(
                  padding: const EdgeInsetsDirectional.only(start: 12, end: 8),
                  child: Text(
                    '${l.t('rated')} ${'★' * ticket.rating!}${'☆' * (5 - ticket.rating!)}',
                    style: TextStyle(fontSize: 12, color: scheme.secondary),
                  ),
                ),
              const Spacer(),
              IconButton(
                tooltip: l.t('refresh'),
                onPressed: busy ? null : onRefresh,
                icon: const Icon(Icons.refresh),
              ),
              IconButton(
                tooltip: l.t('requestRating'),
                onPressed: busy ? null : onRequestRating,
                icon: Icon(
                  ticket.ratingPending
                      ? Icons.star
                      : Icons.star_outline,
                  color: ticket.ratingPending || ticket.rating != null
                      ? scheme.secondary
                      : null,
                ),
              ),
              if (ticket.isOpen)
                TextButton(
                  onPressed: busy ? null : onClose,
                  child: Text(l.t('close')),
                )
              else
                TextButton(
                  onPressed: busy ? null : onReopen,
                  child: Text(l.t('ticketReopen')),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  final bool closed;
  const _StatusChip({required this.closed});

  @override
  Widget build(BuildContext context) {
    final l = L.of(context);
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: closed
            ? scheme.surfaceContainerHighest
            : scheme.secondary.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        closed ? l.t('ticketClosed') : l.t('ticketOpen'),
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          color: closed ? scheme.onSurfaceVariant : scheme.secondary,
        ),
      ),
    );
  }
}

class _DaySeparator extends StatelessWidget {
  final int at;
  const _DaySeparator({required this.at});

  @override
  Widget build(BuildContext context) {
    final l = L.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        children: [
          const Expanded(child: Divider()),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10),
            child: Text(
              _dayLabel(at, l),
              style: TextStyle(
                fontSize: 11,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          const Expanded(child: Divider()),
        ],
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  final AdminRepository repo;
  final MessageRow message;
  const _Bubble({required this.repo, required this.message});

  @override
  Widget build(BuildContext context) {
    final l = L.of(context);
    final scheme = Theme.of(context).colorScheme;
    final mine = message.author == 'admin';
    final caption = message.author == 'bot'
        ? l.t('supportBot')
        : l.t('supportUser');
    // The operator is "me" (end-aligned). The person and the bot sit at
    // the start, the same way the user chat seats the team.
    if (mine) {
      return Align(
        alignment: AlignmentDirectional.centerEnd,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: scheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: _BubbleBody(
                    repo: repo,
                    message: message,
                    onPrimary: false,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  _iso(_clock(message.createdAt)),
                  style: TextStyle(
                    fontSize: 11,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Align(
      alignment: AlignmentDirectional.centerStart,
      child: Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 24,
              height: 24,
              margin: const EdgeInsets.only(top: 2),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                    color: scheme.secondary.withValues(alpha: 0.4)),
                color: scheme.secondary.withValues(alpha: 0.12),
              ),
              child: Icon(
                message.author == 'bot'
                    ? Icons.smart_toy_outlined
                    : Icons.person_outline,
                size: 13,
                color: scheme.secondary,
              ),
            ),
            const SizedBox(width: 8),
            Flexible(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '$caption  ${_iso(_clock(message.createdAt))}',
                    style: TextStyle(
                      fontSize: 11,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 2),
                  _BubbleBody(
                    repo: repo,
                    message: message,
                    onPrimary: false,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BubbleBody extends StatelessWidget {
  final AdminRepository repo;
  final MessageRow message;
  final bool onPrimary;
  const _BubbleBody({
    required this.repo,
    required this.message,
    required this.onPrimary,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final fg = onPrimary ? scheme.onPrimary : scheme.onSurface;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (message.body.isNotEmpty)
          Text(message.body, style: TextStyle(color: fg, fontSize: 13)),
        if (message.hasAttachment)
          Padding(
            padding: EdgeInsets.only(top: message.body.isNotEmpty ? 8 : 0),
            child: _Attachment(
              repo: repo,
              message: message,
              onPrimary: onPrimary,
            ),
          ),
      ],
    );
  }
}

class _RatingNote extends StatelessWidget {
  final TicketRow ticket;
  const _RatingNote({required this.ticket});

  @override
  Widget build(BuildContext context) {
    final l = L.of(context);
    final scheme = Theme.of(context).colorScheme;
    final label = ticket.rating != null
        ? '${l.t('rated')} ${'★' * ticket.rating!}${'☆' * (5 - ticket.rating!)}'
        : l.t('ratingRequested');
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Center(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          decoration: BoxDecoration(
            color: scheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: scheme.outline),
          ),
          child: Text(
            label,
            style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
          ),
        ),
      ),
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

String _iso(String text) => text.isEmpty ? text : '\u2068$text\u2069';

String _clock(int ms) {
  if (ms <= 0) return '';
  return intl.DateFormat('HH:mm')
      .format(DateTime.fromMillisecondsSinceEpoch(ms));
}

bool _sameDay(int a, int b) {
  final x = DateTime.fromMillisecondsSinceEpoch(a);
  final y = DateTime.fromMillisecondsSinceEpoch(b);
  return x.year == y.year && x.month == y.month && x.day == y.day;
}

String _dayLabel(int ms, L l) {
  final dt = DateTime.fromMillisecondsSinceEpoch(ms);
  final now = DateTime.now();
  final day = DateTime(dt.year, dt.month, dt.day);
  final today = DateTime(now.year, now.month, now.day);
  if (day == today) return l.t('today');
  if (day == today.subtract(const Duration(days: 1))) return l.t('yesterday');
  return intl.DateFormat('d MMM').format(dt);
}
