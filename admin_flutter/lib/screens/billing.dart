import 'package:flutter/material.dart';
import 'package:intl/intl.dart' as intl;

import '../api/models.dart';
import '../api/repository.dart';
import '../i18n.dart';
import 'shell.dart';

/// Billing = profit report + subscription search + credit adjustments,
/// backed by /api/admin/billing/* and /api/admin/subscriptions.
class BillingScreen extends StatefulWidget {
  final AdminRepository repo;
  const BillingScreen({super.key, required this.repo});

  @override
  State<BillingScreen> createState() => _BillingScreenState();
}

class _BillingScreenState extends State<BillingScreen> {
  late Future<ProfitReport> _future;
  List<SubscriptionUser> _searchResults = const [];
  bool _searching = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    _future = widget.repo.profit();
    setState(() {});
  }

  Future<void> _search(String q) async {
    if (q.trim().length < 2) {
      setState(() => _searchResults = const []);
      return;
    }
    setState(() => _searching = true);
    try {
      final res = await widget.repo.searchSubscriptions(q.trim());
      if (mounted) setState(() => _searchResults = res);
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  Future<void> _activatePlanDialog(int userId, String email) async {
    final l = L.of(context);
    final messenger = ScaffoldMessenger.of(context);
    int months = 1;
    bool gift = false;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text('${l.t('activatePlan')} — $email'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(child: Text(l.t('months'))),
                  DropdownButton<int>(
                    value: months,
                    items: [
                      for (var m = 1; m <= 12; m++)
                        DropdownMenuItem(
                            value: m,
                            child: Text('$m', textDirection: TextDirection.ltr)),
                    ],
                    onChanged: (v) => setDialogState(() => months = v ?? 1),
                  ),
                ],
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(l.t('gift'), style: const TextStyle(fontSize: 14)),
                value: gift,
                onChanged: (v) => setDialogState(() => gift = v),
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
              child: Text(l.t('activatePlan')),
            ),
          ],
        ),
      ),
    );

    if (confirmed != true) return;
    try {
      await widget.repo
          .activatePlan(userId: userId, months: months, gift: gift);
      messenger.showSnackBar(SnackBar(content: Text(l.t('planActivated'))));
      _load();
      await _search(email);
    } catch (e) {
      messenger
          .showSnackBar(SnackBar(content: Text('${l.t('saveFailed')} $e')));
    }
  }

  Future<void> _subscriptionAction(
      int userId, String email, String action) async {
    final l = L.of(context);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await widget.repo.setSubscriptionAction(userId, action);
      messenger.showSnackBar(SnackBar(content: Text(l.t('saved'))));
      await _search(email);
    } catch (e) {
      messenger
          .showSnackBar(SnackBar(content: Text('${l.t('saveFailed')} $e')));
    }
  }

  Future<void> _adjustDialog(int userId, String email) async {
    final l = L.of(context);
    final amount = TextEditingController();
    final reason = TextEditingController();
    final messenger = ScaffoldMessenger.of(context);

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('${l.t('adjustCredits')} — $email'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: amount,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true, signed: true),
              textDirection: TextDirection.ltr,
              decoration: InputDecoration(
                  labelText: '${l.t('amount')} (USD)', hintText: '5 / -5'),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: reason,
              decoration: InputDecoration(labelText: l.t('reason')),
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
            child: Text(l.t('apply')),
          ),
        ],
      ),
    );

    if (confirmed != true) return;
    final value = double.tryParse(amount.text.trim());
    if (value == null || value == 0 || reason.text.trim().length < 5) {
      messenger.showSnackBar(SnackBar(content: Text(l.t('saveFailed'))));
      return;
    }
    try {
      await widget.repo.adjustCredits(
          userId: userId, amountUsd: value, reason: reason.text.trim());
      messenger.showSnackBar(SnackBar(content: Text(l.t('saved'))));
      _load();
    } catch (e) {
      messenger
          .showSnackBar(SnackBar(content: Text('${l.t('saveFailed')} $e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = L.of(context);
    final money = intl.NumberFormat.currency(symbol: r'$');
    final scheme = Theme.of(context).colorScheme;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        TextField(
          decoration: InputDecoration(
            hintText: '${l.t('search')} (${l.t('email')})',
            prefixIcon: _searching
                ? const Padding(
                    padding: EdgeInsets.all(12),
                    child: SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2)),
                  )
                : const Icon(Icons.search, size: 20),
            isDense: true,
          ),
          textDirection: TextDirection.ltr,
          onSubmitted: _search,
        ),
        if (_searchResults.isNotEmpty) ...[
          const SizedBox(height: 8),
          for (final u in _searchResults)
            Card(
              margin: const EdgeInsets.only(bottom: 8),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(u.email,
                        textDirection: TextDirection.ltr,
                        style: const TextStyle(fontWeight: FontWeight.w600)),
                    const SizedBox(height: 2),
                    Text(
                      '${l.t('plan')}: ${u.planStatus}'
                      '${u.subscriptionExpiresAt == null ? '' : ' · ${u.subscriptionExpiresAt}'}',
                      style: const TextStyle(fontSize: 12),
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 6,
                      children: [
                        // Stripe is not wired up — activation is a manual
                        // admin grant.
                        FilledButton(
                          onPressed: () =>
                              _activatePlanDialog(u.userId, u.email),
                          child: Text(l.t('activatePlan')),
                        ),
                        if (u.planStatus == 'active')
                          OutlinedButton(
                            onPressed: () => _subscriptionAction(
                                u.userId, u.email, 'suspend'),
                            child: Text(l.t('suspendPlan')),
                          )
                        else if (u.planStatus == 'suspended' ||
                            u.planStatus == 'expired')
                          OutlinedButton(
                            onPressed: () => _subscriptionAction(
                                u.userId, u.email, 'restore_trial'),
                            child: Text(l.t('restoreTrial')),
                          ),
                        OutlinedButton(
                          onPressed: () => _adjustDialog(u.userId, u.email),
                          child: Text(l.t('adjustCredits')),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
        ],
        const SizedBox(height: 16),
        AsyncBody<ProfitReport>(
          future: _future,
          onRetry: _load,
          builder: (context, report) {
            final totals = report.totals;
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Wrap(
                      spacing: 20,
                      runSpacing: 8,
                      children: [
                        for (final entry in totals.entries)
                          if (entry.value is num)
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  entry.key,
                                  textDirection: TextDirection.ltr,
                                  style: TextStyle(
                                      fontSize: 11,
                                      color: scheme.onSurfaceVariant),
                                ),
                                Text(
                                  money.format(entry.value),
                                  textDirection: TextDirection.ltr,
                                  style: const TextStyle(
                                      fontWeight: FontWeight.w700),
                                ),
                              ],
                            ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                for (final row in report.perUser.take(50))
                  Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    child: ListTile(
                      dense: true,
                      title: Text(row.email, textDirection: TextDirection.ltr),
                      subtitle: Text(
                        '${l.t('revenue')} ${money.format(row.revenueUsd)} · '
                        '${l.t('cost')} ${money.format(row.providerCostUsd)}',
                        textDirection: TextDirection.ltr,
                        style: const TextStyle(fontSize: 12),
                      ),
                      trailing: Text(
                        money.format(row.profitUsd),
                        textDirection: TextDirection.ltr,
                        style: TextStyle(
                          fontWeight: FontWeight.w800,
                          color: row.profitUsd >= 0
                              ? const Color(0xFF16A34A)
                              : scheme.error,
                        ),
                      ),
                      onTap: () => _adjustDialog(row.userId, row.email),
                    ),
                  ),
              ],
            );
          },
        ),
      ],
    );
  }
}
