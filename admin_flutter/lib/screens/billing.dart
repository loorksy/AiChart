import 'package:flutter/material.dart';
import 'package:intl/intl.dart' as intl;

import '../api/models.dart';
import '../api/repository.dart';
import '../i18n.dart';
import 'credit_dialog.dart';
import 'shell.dart';

/// Subscriptions, manual credit top-ups, the profit report, and what each
/// model costs us.
///
/// Two things here move real money. Activating a plan is a manual grant
/// (there is no payment provider wired up), and adjusting credits writes
/// straight to the ledger — which is why the reason is mandatory and travels
/// with the amount.
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
                      '${l.t('plan')}: ${u.planStatus} · '
                      '${u.credits} ${l.t('credits')}'
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
                                u.userId, u.email, 'restore_free'),
                            child: Text(l.t('restoreFree')),
                          ),
                        OutlinedButton(
                          onPressed: () => adjustCreditsDialog(
                            context: context,
                            repo: widget.repo,
                            userId: u.userId,
                            email: u.email,
                            currentBalance: u.credits,
                            onDone: () {
                              _load();
                              _search(u.email);
                            },
                          ),
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
        _ModelPricesCard(repo: widget.repo),
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
                      onTap: () => adjustCreditsDialog(
                        context: context,
                        repo: widget.repo,
                        userId: row.userId,
                        email: row.email,
                        onDone: _load,
                      ),
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

/// What each model costs US per million tokens — the numbers the usage meter
/// turns into the provider-cost column of the profit report. Read per call,
/// so an edit applies to the very next LLM call with nothing to restart.
class _ModelPricesCard extends StatefulWidget {
  final AdminRepository repo;
  const _ModelPricesCard({required this.repo});

  @override
  State<_ModelPricesCard> createState() => _ModelPricesCardState();
}

class _ModelPricesCardState extends State<_ModelPricesCard> {
  late Future<List<ModelPrice>> _future;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    _future = widget.repo.modelPrices();
    setState(() {});
  }

  Future<void> _edit(ModelPrice price) async {
    final l = L.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final input = TextEditingController(text: '${price.inputUsdPerM}');
    final output = TextEditingController(text: '${price.outputUsdPerM}');

    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(price.model, textDirection: TextDirection.ltr),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: input,
              textDirection: TextDirection.ltr,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(labelText: l.t('inputPerM')),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: output,
              textDirection: TextDirection.ltr,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(labelText: l.t('outputPerM')),
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
            child: Text(l.t('save')),
          ),
        ],
      ),
    );
    if (ok != true) return;

    final inValue = double.tryParse(input.text.trim());
    final outValue = double.tryParse(output.text.trim());
    if (inValue == null || outValue == null) {
      messenger.showSnackBar(SnackBar(content: Text(l.t('amountInvalid'))));
      return;
    }
    try {
      await widget.repo.saveModelPrice(ModelPrice(
        provider: price.provider,
        model: price.model,
        inputUsdPerM: inValue,
        outputUsdPerM: outValue,
      ));
      messenger.showSnackBar(SnackBar(content: Text(l.t('saved'))));
      _load();
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('${l.t('saveFailed')} $e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = L.of(context);
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    l.t('modelPrices'),
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
            Text(
              l.t('modelPricesNote'),
              style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: 8),
            FutureBuilder<List<ModelPrice>>(
              future: _future,
              builder: (context, snap) {
                if (snap.connectionState != ConnectionState.done) {
                  return const Padding(
                    padding: EdgeInsets.all(12),
                    child: Center(child: CircularProgressIndicator()),
                  );
                }
                if (snap.hasError) {
                  return Text('${l.t('loadFailed')} ${snap.error}',
                      style: TextStyle(color: scheme.error));
                }
                final prices = snap.data ?? const <ModelPrice>[];
                return Column(
                  children: [
                    for (final price in prices)
                      ListTile(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        title: Text(price.model,
                            textDirection: TextDirection.ltr),
                        subtitle: Text(
                          '${price.provider} · in ${price.inputUsdPerM} · '
                          'out ${price.outputUsdPerM}',
                          textDirection: TextDirection.ltr,
                          style: const TextStyle(fontSize: 11),
                        ),
                        trailing: const Icon(Icons.edit_outlined, size: 18),
                        onTap: () => _edit(price),
                      ),
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}
