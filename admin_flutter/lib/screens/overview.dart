import 'package:flutter/material.dart';
import 'package:intl/intl.dart' as intl;

import '../api/models.dart';
import '../api/repository.dart';
import '../i18n.dart';
import 'shell.dart';

class OverviewScreen extends StatefulWidget {
  final AdminRepository repo;
  const OverviewScreen({super.key, required this.repo});

  @override
  State<OverviewScreen> createState() => _OverviewScreenState();
}

class _OverviewScreenState extends State<OverviewScreen> {
  late Future<(OverviewResponse, AdminHealth)> _future;
  int _days = 30;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    _future = () async {
      final overview = await widget.repo.overview(days: _days);
      final health = await widget.repo.health();
      return (overview, health);
    }();
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final l = L.of(context);
    return AsyncBody<(OverviewResponse, AdminHealth)>(
      future: _future,
      onRetry: _load,
      builder: (context, data) {
        final (overview, health) = data;
        final money = intl.NumberFormat.currency(symbol: r'$');
        return RefreshIndicator(
          onRefresh: () async => _load(),
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      l.t('overview'),
                      style: Theme.of(context)
                          .textTheme
                          .titleLarge
                          ?.copyWith(fontWeight: FontWeight.w800),
                    ),
                  ),
                  SegmentedButton<int>(
                    segments: const [
                      ButtonSegment(value: 7, label: Text('7')),
                      ButtonSegment(value: 30, label: Text('30')),
                      ButtonSegment(value: 90, label: Text('90')),
                    ],
                    selected: {_days},
                    onSelectionChanged: (s) {
                      _days = s.first;
                      _load();
                    },
                  ),
                ],
              ),
              const SizedBox(height: 16),
              _HealthCard(health: health),
              const SizedBox(height: 12),
              if (overview.kpis != null) ...[
                Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  children: [
                    _KpiCard(
                      title: l.t('profit'),
                      value: money.format(overview.kpis!.profitUsd.value),
                      pct: overview.kpis!.profitUsd.pct,
                    ),
                    _KpiCard(
                      title: l.t('revenue'),
                      value: money.format(overview.kpis!.revenueUsd.value),
                      pct: overview.kpis!.revenueUsd.pct,
                    ),
                    _KpiCard(
                      title: l.t('cost'),
                      value:
                          money.format(overview.kpis!.providerCostUsd.value),
                      pct: overview.kpis!.providerCostUsd.pct,
                    ),
                    _KpiCard(
                      title: l.t('activeSubscriptions'),
                      value: overview.kpis!.payingSubscribers.value
                          .toStringAsFixed(0),
                      pct: overview.kpis!.payingSubscribers.pct,
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                if (overview.series.isNotEmpty)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: SizedBox(
                        height: 160,
                        child: _ProfitBars(series: overview.series),
                      ),
                    ),
                  ),
              ],
            ],
          ),
        );
      },
    );
  }
}

class _HealthCard extends StatelessWidget {
  final AdminHealth health;
  const _HealthCard({required this.health});

  @override
  Widget build(BuildContext context) {
    final l = L.of(context);
    final scheme = Theme.of(context).colorScheme;

    Widget dot(bool ok) => Icon(
          Icons.circle,
          size: 10,
          color: ok ? const Color(0xFF16A34A) : scheme.error,
        );

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Wrap(
          spacing: 16,
          runSpacing: 10,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text(
              l.t('health'),
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            Row(mainAxisSize: MainAxisSize.min, children: [
              dot(health.llm),
              const SizedBox(width: 6),
              Text('LLM${health.aiProvider == null ? '' : ' (${health.aiProvider})'}'),
            ]),
            Row(mainAxisSize: MainAxisSize.min, children: [
              dot(health.telegram),
              const SizedBox(width: 6),
              const Text('Telegram'),
            ]),
            Row(mainAxisSize: MainAxisSize.min, children: [
              dot(health.cronSecretSet),
              const SizedBox(width: 6),
              const Text('Cron'),
            ]),
            Chip(
              label: Text(
                '${l.t('totalUsers')}: ${health.usersTotal} · ${l.t('active')}: ${health.usersActive}',
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _KpiCard extends StatelessWidget {
  final String title;
  final String value;
  final double? pct;

  const _KpiCard({required this.title, required this.value, this.pct});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final up = (pct ?? 0) >= 0;
    return SizedBox(
      width: 170,
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title,
                  style:
                      TextStyle(fontSize: 12, color: scheme.onSurfaceVariant)),
              const SizedBox(height: 6),
              Text(
                value,
                textDirection: TextDirection.ltr,
                style:
                    const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 4),
              Text(
                pct == null ? '—' : '${up ? '▲' : '▼'} ${pct!.abs().toStringAsFixed(1)}%',
                textDirection: TextDirection.ltr,
                style: TextStyle(
                  fontSize: 12,
                  color: pct == null
                      ? scheme.onSurfaceVariant
                      : up
                          ? const Color(0xFF16A34A)
                          : scheme.error,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Dependency-free daily profit bars — enough to read the trend at a glance.
class _ProfitBars extends StatelessWidget {
  final List<OverviewSeriesPoint> series;
  const _ProfitBars({required this.series});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final maxAbs = series
        .map((p) => p.profit.abs())
        .fold<double>(0, (a, b) => a > b ? a : b);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        for (final p in series)
          Expanded(
            child: Tooltip(
              message: '${p.day}\n${p.profit.toStringAsFixed(2)}\$',
              child: Container(
                margin: const EdgeInsets.symmetric(horizontal: 1),
                height: maxAbs == 0
                    ? 2
                    : 10 + 140 * (p.profit.abs() / maxAbs),
                decoration: BoxDecoration(
                  color: p.profit >= 0 ? scheme.secondary : scheme.error,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
          ),
      ],
    );
  }
}
