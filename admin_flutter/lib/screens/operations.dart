import 'package:flutter/material.dart';

import '../api/models.dart';
import '../api/repository.dart';
import '../i18n.dart';
import 'shell.dart';

/// System health, per-user usage, doctrine counters, and the audit trail.
///
/// The counters at the top are not vanity metrics: each one counts a way the
/// platform could have broken its own rules — a plan written without passing
/// the gates, an execution in the wrong mode, a plan edited outside the
/// revision path, two surfaces describing the same moment differently. They
/// should read zero. A number that is not zero is a bug, not a statistic.
class OperationsScreen extends StatefulWidget {
  final AdminRepository repo;
  const OperationsScreen({super.key, required this.repo});

  @override
  State<OperationsScreen> createState() => _OperationsScreenState();
}

class _OperationsScreenState extends State<OperationsScreen> {
  late Future<_OpsData> _future;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    _future = _OpsData.load(widget.repo);
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final l = L.of(context);
    final scheme = Theme.of(context).colorScheme;

    return AsyncBody<_OpsData>(
      future: _future,
      onRetry: _load,
      builder: (context, data) => ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  l.t('health'),
                  style: const TextStyle(
                      fontWeight: FontWeight.w800, fontSize: 15),
                ),
              ),
              IconButton(
                tooltip: l.t('refresh'),
                icon: const Icon(Icons.refresh, size: 20),
                onPressed: _load,
              ),
            ],
          ),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Wrap(
                spacing: 24,
                runSpacing: 12,
                children: [
                  _Flag(label: 'LLM', ok: data.health.llm),
                  _Flag(
                    label: data.health.aiProvider ?? '—',
                    ok: data.health.aiProvider != null,
                  ),
                  _Flag(label: 'Telegram', ok: data.health.telegram),
                  _Flag(label: 'CRON_SECRET', ok: data.health.cronSecretSet),
                  _Stat(
                    label: l.t('totalUsers'),
                    value: '${data.health.usersTotal}',
                  ),
                  _Stat(
                    label: l.t('active'),
                    value: '${data.health.usersActive}',
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text(
            l.t('doctrineCounters'),
            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
          ),
          Text(
            l.t('doctrineNote'),
            style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
          ),
          const SizedBox(height: 8),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Wrap(
                spacing: 24,
                runSpacing: 12,
                children: [
                  for (final e in data.diagnostics.critical.entries)
                    _Stat(
                      label: e.key,
                      value: '${e.value}',
                      // Zero is the only good number here.
                      tone: e.value == 0 ? null : scheme.error,
                    ),
                  _Stat(
                    label: 'unpaired',
                    value: '${data.diagnostics.parityUnpaired}',
                  ),
                ],
              ),
            ),
          ),
          if (data.diagnostics.counters.isNotEmpty) ...[
            const SizedBox(height: 8),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Wrap(
                  spacing: 24,
                  runSpacing: 12,
                  children: [
                    for (final e in data.diagnostics.counters.entries)
                      _Stat(label: e.key, value: '${e.value}'),
                  ],
                ),
              ),
            ),
          ],
          const SizedBox(height: 16),
          Text(
            l.t('usage'),
            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
          ),
          const SizedBox(height: 8),
          for (final row in data.usage.take(50))
            Card(
              margin: const EdgeInsets.only(bottom: 6),
              child: ListTile(
                dense: true,
                title: Text(row.email, textDirection: TextDirection.ltr),
                trailing: Text(
                  '${row.usedToday} / ${row.quota}',
                  textDirection: TextDirection.ltr,
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                    color: row.usedToday >= row.quota ? scheme.error : null,
                  ),
                ),
              ),
            ),
          const SizedBox(height: 16),
          Text(
            l.t('auditTrail'),
            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
          ),
          const SizedBox(height: 8),
          for (final row in data.audit.take(100))
            Card(
              margin: const EdgeInsets.only(bottom: 6),
              child: ListTile(
                dense: true,
                title: Text(row.action, textDirection: TextDirection.ltr),
                subtitle: row.detail == null
                    ? null
                    : Text(row.detail!,
                        textDirection: TextDirection.ltr,
                        style: const TextStyle(fontSize: 11)),
                trailing: Text(
                  row.createdAt,
                  textDirection: TextDirection.ltr,
                  style: TextStyle(
                      fontSize: 11, color: scheme.onSurfaceVariant),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Everything this screen shows, fetched together so one spinner covers it.
class _OpsData {
  final AdminHealth health;
  final DiagnosticsReport diagnostics;
  final List<UsageRow> usage;
  final List<AuditRow> audit;

  _OpsData({
    required this.health,
    required this.diagnostics,
    required this.usage,
    required this.audit,
  });

  static Future<_OpsData> load(AdminRepository repo) async {
    final results = await Future.wait([
      repo.health(),
      repo.diagnostics(),
      repo.usage(),
      repo.recentAudit(),
    ]);
    return _OpsData(
      health: results[0] as AdminHealth,
      diagnostics: results[1] as DiagnosticsReport,
      usage: results[2] as List<UsageRow>,
      audit: results[3] as List<AuditRow>,
    );
  }
}

class _Flag extends StatelessWidget {
  final String label;
  final bool ok;
  const _Flag({required this.label, required this.ok});

  @override
  Widget build(BuildContext context) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            ok ? Icons.check_circle : Icons.cancel_outlined,
            size: 18,
            color: ok
                ? const Color(0xFF16A34A)
                : Theme.of(context).colorScheme.error,
          ),
          const SizedBox(width: 6),
          Text(label, textDirection: TextDirection.ltr),
        ],
      );
}

class _Stat extends StatelessWidget {
  final String label;
  final String value;
  final Color? tone;
  const _Stat({required this.label, required this.value, this.tone});

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label,
            textDirection: TextDirection.ltr,
            style: TextStyle(
              fontSize: 11,
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
          Text(
            value,
            textDirection: TextDirection.ltr,
            style: TextStyle(
                fontWeight: FontWeight.w800, fontSize: 16, color: tone),
          ),
        ],
      );
}
