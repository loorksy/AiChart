import 'package:flutter/material.dart';

import '../api/models.dart';
import '../api/repository.dart';
import '../i18n.dart';
import 'shell.dart';

/// Every priced or bounded number the platform enforces, in one screen.
///
/// The rule this screen exists to hold: none of these numbers is a constant
/// in code. The subscription price, what each operation costs in credits,
/// the welcome balance a new account is handed, the minimum reward:risk the
/// agent must clear before it may publish a plan — all of it is data an
/// operator sets here.
///
/// Two behaviours are worth knowing before touching anything:
///   - Publishing a plan price writes a NEW immutable row. Subscribers keep
///     the row they bought; nothing already sold changes underneath them.
///   - Raising or lowering the welcome grant affects accounts created AFTER
///     the change. Existing balances are never revisited, and no account can
///     be granted twice — the ledger's uniqueness is what guarantees it.
class PricingScreen extends StatefulWidget {
  final AdminRepository repo;
  const PricingScreen({super.key, required this.repo});

  @override
  State<PricingScreen> createState() => _PricingScreenState();
}

class _PricingScreenState extends State<PricingScreen> {
  late Future<BillingConfig> _future;
  bool _busy = false;

  // Draft state — nothing is sent until the matching save button is pressed.
  final _grant = TextEditingController();
  final _minRr = TextEditingController();
  final _lowBalance = TextEditingController();
  final _expiryWarn = TextEditingController();
  final Map<String, TextEditingController> _opPrice = {};

  final _priceUsd = TextEditingController();
  final _priceCredits = TextEditingController();
  final _priceDays = TextEditingController(text: '30');

  final _packCredits = TextEditingController();
  final _packUsd = TextEditingController();

  String _offerKind = 'percent';
  final _offerValue = TextEditingController();
  DateTime? _offerStarts;
  DateTime? _offerEnds;

  static const _ops = ['recommendation', 'chat_turn', 'mt5_link'];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final c in [
      _grant,
      _minRr,
      _lowBalance,
      _expiryWarn,
      _priceUsd,
      _priceCredits,
      _priceDays,
      _packCredits,
      _packUsd,
      _offerValue,
      ..._opPrice.values,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  void _load() {
    _future = widget.repo.billingConfig().then((cfg) {
      _grant.text = '${cfg.plan.signupGrantCredits}';
      _minRr.text = '${cfg.plan.minRrFirstTargetBp}';
      _lowBalance.text = '${cfg.plan.lowBalanceThreshold}';
      _expiryWarn.text = '${cfg.plan.expiryWarnDays}';
      for (final op in _ops) {
        _opPrice
            .putIfAbsent(op, () => TextEditingController())
            .text = '${cfg.creditPrices[op] ?? 0}';
      }
      return cfg;
    });
    setState(() {});
  }

  /// Runs one write and reloads, reporting the server's own message on
  /// failure rather than a generic one.
  Future<void> _run(Future<void> Function() action) async {
    final l = L.of(context);
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    try {
      await action();
      messenger.showSnackBar(SnackBar(content: Text(l.t('saved'))));
      _load();
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('${l.t('saveFailed')} $e')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  int _int(TextEditingController c) => int.tryParse(c.text.trim()) ?? 0;

  @override
  Widget build(BuildContext context) {
    return AsyncBody<BillingConfig>(
      future: _future,
      onRetry: _load,
      builder: (context, cfg) => ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _paymentsBadge(cfg),
          const SizedBox(height: 12),
          _planPriceCard(cfg),
          const SizedBox(height: 12),
          _creditPricesCard(cfg),
          const SizedBox(height: 12),
          _limitsCard(cfg),
          const SizedBox(height: 12),
          _calculatorCard(cfg),
          const SizedBox(height: 12),
          _packsCard(cfg),
          const SizedBox(height: 12),
          _offersCard(cfg),
          const SizedBox(height: 12),
          _dangerCard(cfg),
        ],
      ),
    );
  }

  Widget _paymentsBadge(BillingConfig cfg) {
    final l = L.of(context);
    return Row(
      children: [
        Chip(
          avatar: Icon(
            cfg.paymentsConfigured ? Icons.check_circle : Icons.info_outline,
            size: 18,
          ),
          label: Text(
              cfg.paymentsConfigured ? l.t('stripeOn') : l.t('stripeOff')),
        ),
        const SizedBox(width: 8),
        if (!cfg.paymentsConfigured)
          Expanded(
            child: Text(
              l.t('stripeHint'),
              style: TextStyle(
                fontSize: 12,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
          ),
      ],
    );
  }

  Widget _planPriceCard(BillingConfig cfg) {
    final l = L.of(context);
    final price = cfg.currentPrice;
    return _Section(
      title: l.t('planPrice'),
      note: l.t('planPriceNote'),
      children: [
        if (price == null)
          Text(l.t('noPrice'))
        else
          Text(
            '\$${(price.priceCents / 100).toStringAsFixed(2)} / '
            '${price.cycleDays}d → ${price.creditsPerCycle} '
            '${l.t('credits')}  (#${price.id})',
            textDirection: TextDirection.ltr,
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
        const SizedBox(height: 12),
        _NumberRow(children: [
          _Number(controller: _priceUsd, label: l.t('priceUsd'), decimal: true),
          _Number(controller: _priceCredits, label: l.t('creditsPerCycle')),
          _Number(controller: _priceDays, label: l.t('cycleDays')),
        ]),
        const SizedBox(height: 10),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: FilledButton(
            onPressed: _busy
                ? null
                : () {
                    final usd = double.tryParse(_priceUsd.text.trim()) ?? 0;
                    final credits = _int(_priceCredits);
                    final days = _int(_priceDays);
                    if (credits <= 0 || days <= 0) return;
                    _run(() => widget.repo.publishPlanPrice(
                          priceCents: (usd * 100).round(),
                          creditsPerCycle: credits,
                          cycleDays: days,
                        ));
                  },
            child: Text(l.t('publishPrice')),
          ),
        ),
      ],
    );
  }

  Widget _creditPricesCard(BillingConfig cfg) {
    final l = L.of(context);
    return _Section(
      title: l.t('creditPrices'),
      note: l.t('creditPricesNote'),
      children: [
        _NumberRow(children: [
          for (final op in _ops)
            _Number(controller: _opPrice[op]!, label: l.t('op_$op')),
        ]),
        const SizedBox(height: 10),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: FilledButton(
            onPressed: _busy
                ? null
                : () => _run(() => widget.repo.saveBillingSettings(
                      creditPrices: {
                        for (final op in _ops) op: _int(_opPrice[op]!),
                      },
                    )),
            child: Text(l.t('save')),
          ),
        ),
      ],
    );
  }

  Widget _limitsCard(BillingConfig cfg) {
    final l = L.of(context);
    return _Section(
      title: l.t('accountLimits'),
      note: l.t('signupGrantNote'),
      children: [
        _NumberRow(children: [
          _Number(controller: _grant, label: l.t('signupGrant')),
          _Number(controller: _minRr, label: l.t('minRr')),
          _Number(controller: _lowBalance, label: l.t('lowBalance')),
          _Number(controller: _expiryWarn, label: l.t('expiryWarn')),
        ]),
        const SizedBox(height: 6),
        Text(
          l.t('minRrNote'),
          style: TextStyle(
            fontSize: 12,
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: 10),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: FilledButton(
            onPressed: _busy
                ? null
                : () => _run(() => widget.repo.saveBillingSettings(
                      signupGrantCredits: _int(_grant),
                      minRrFirstTargetBp: _int(_minRr),
                      lowBalanceThreshold: _int(_lowBalance),
                      expiryWarnDays: _int(_expiryWarn),
                    )),
            child: Text(l.t('save')),
          ),
        ),
      ],
    );
  }

  /// Display only — it writes nothing. It answers "what does one credit cost,
  /// and how many recommendations does a cycle buy?" from the numbers
  /// currently typed above, before they are published.
  Widget _calculatorCard(BillingConfig cfg) {
    final l = L.of(context);
    final usd = double.tryParse(_priceUsd.text.trim()) ??
        (cfg.currentPrice?.priceCents ?? 0) / 100;
    final credits = _int(_priceCredits) > 0
        ? _int(_priceCredits)
        : (cfg.currentPrice?.creditsPerCycle ?? 0);
    final recPrice = _int(_opPrice['recommendation']!);
    if (usd <= 0 || credits <= 0) {
      return _Section(
        title: l.t('calculator'),
        children: [Text(l.t('calculatorEmpty'))],
      );
    }
    final perCredit = usd / credits;
    final recs = recPrice > 0 ? (credits ~/ recPrice) : null;
    return _Section(
      title: l.t('calculator'),
      note: l.t('calculatorNote'),
      children: [
        Wrap(
          spacing: 24,
          runSpacing: 10,
          children: [
            _Stat(label: l.t('perCredit'), value: '\$${perCredit.toStringAsFixed(4)}'),
            if (recs != null)
              _Stat(label: l.t('recsPerCycle'), value: '$recs'),
            if (recPrice > 0)
              _Stat(
                label: l.t('recCost'),
                value: '\$${(perCredit * recPrice).toStringAsFixed(2)}',
              ),
          ],
        ),
      ],
    );
  }

  Widget _packsCard(BillingConfig cfg) {
    final l = L.of(context);
    return _Section(
      title: l.t('topupPacks'),
      note: l.t('packsNote'),
      children: [
        for (final pack in cfg.packs)
          ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            title: Text(
              '${pack.credits} ${l.t('credits')} — '
              '\$${(pack.priceCents / 100).toStringAsFixed(2)}',
              textDirection: TextDirection.ltr,
            ),
            subtitle: pack.archived ? Text(l.t('archived')) : null,
            trailing: pack.archived
                ? null
                : Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Switch(
                        value: pack.active,
                        onChanged: _busy
                            ? null
                            : (v) => _run(() =>
                                widget.repo.updatePack(pack.id, active: v)),
                      ),
                      IconButton(
                        tooltip: l.t('archive'),
                        icon: const Icon(Icons.archive_outlined, size: 20),
                        onPressed: _busy
                            ? null
                            : () => _run(() => widget.repo
                                .updatePack(pack.id, archive: true)),
                      ),
                    ],
                  ),
          ),
        const Divider(),
        _NumberRow(children: [
          _Number(controller: _packCredits, label: l.t('credits')),
          _Number(controller: _packUsd, label: l.t('priceUsd'), decimal: true),
        ]),
        const SizedBox(height: 10),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: FilledButton(
            onPressed: _busy
                ? null
                : () {
                    final credits = _int(_packCredits);
                    final usd = double.tryParse(_packUsd.text.trim()) ?? -1;
                    if (credits <= 0 || usd < 0) return;
                    _run(() async {
                      await widget.repo.createPack(
                        credits: credits,
                        priceCents: (usd * 100).round(),
                      );
                      _packCredits.clear();
                      _packUsd.clear();
                    });
                  },
            child: Text(l.t('addPack')),
          ),
        ),
      ],
    );
  }

  Widget _offersCard(BillingConfig cfg) {
    final l = L.of(context);
    return _Section(
      title: l.t('offers'),
      note: l.t('offersNote'),
      children: [
        for (final offer in cfg.offers)
          ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            title: Text(
              offer.kind == 'percent'
                  ? '${offer.value}%'
                  : '\$${(offer.value / 100).toStringAsFixed(2)}',
              textDirection: TextDirection.ltr,
            ),
            subtitle: Text(
              '${_day(offer.startsAt)} → ${_day(offer.endsAt)}',
              textDirection: TextDirection.ltr,
              style: const TextStyle(fontSize: 12),
            ),
            trailing: Switch(
              value: offer.active,
              onChanged: _busy
                  ? null
                  : (v) =>
                      _run(() => widget.repo.setOfferActive(offer.id, v)),
            ),
          ),
        const Divider(),
        Row(
          children: [
            DropdownButton<String>(
              value: _offerKind,
              items: [
                DropdownMenuItem(value: 'percent', child: Text(l.t('percent'))),
                DropdownMenuItem(
                    value: 'fixed_cents', child: Text(l.t('fixedAmount'))),
              ],
              onChanged: (v) => setState(() => _offerKind = v ?? 'percent'),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _Number(controller: _offerValue, label: l.t('value')),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: () => _pickDate(true),
                child: Text(_offerStarts == null
                    ? l.t('startsAt')
                    : _day(_offerStarts!.millisecondsSinceEpoch)),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: OutlinedButton(
                onPressed: () => _pickDate(false),
                child: Text(_offerEnds == null
                    ? l.t('endsAt')
                    : _day(_offerEnds!.millisecondsSinceEpoch)),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: FilledButton(
            onPressed: _busy
                ? null
                : () {
                    final value = _int(_offerValue);
                    final starts = _offerStarts;
                    final ends = _offerEnds;
                    if (value <= 0 || starts == null || ends == null) return;
                    _run(() async {
                      await widget.repo.createOffer(
                        kind: _offerKind,
                        // A percentage stays a percentage; a fixed discount is
                        // typed in dollars and stored in cents.
                        value: _offerKind == 'percent' ? value : value * 100,
                        startsAt: starts.millisecondsSinceEpoch,
                        endsAt: ends.millisecondsSinceEpoch,
                      );
                      _offerValue.clear();
                      setState(() {
                        _offerStarts = null;
                        _offerEnds = null;
                      });
                    });
                  },
            child: Text(l.t('addOffer')),
          ),
        ),
      ],
    );
  }

  Widget _dangerCard(BillingConfig cfg) {
    final l = L.of(context);
    final scheme = Theme.of(context).colorScheme;
    return _Section(
      title: l.t('dangerZone'),
      note: l.t('resetNote'),
      tone: scheme.error,
      children: [
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: OutlinedButton.icon(
            style: OutlinedButton.styleFrom(foregroundColor: scheme.error),
            icon: const Icon(Icons.restart_alt),
            label: Text(l.t('resetAccounts')),
            onPressed: _busy ? null : () => _confirmReset(cfg),
          ),
        ),
      ],
    );
  }

  Future<void> _confirmReset(BillingConfig cfg) async {
    final l = L.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final typed = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l.t('resetAccounts')),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l.t('resetWarning')),
            const SizedBox(height: 12),
            TextField(
              controller: typed,
              textDirection: TextDirection.ltr,
              decoration: const InputDecoration(hintText: 'RESET'),
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
            child: Text(l.t('confirm')),
          ),
        ],
      ),
    );
    if (ok != true) return;
    // The server demands the phrase too — this is the second lock, not the
    // only one.
    if (typed.text.trim() != 'RESET') {
      messenger.showSnackBar(SnackBar(content: Text(l.t('resetNotConfirmed'))));
      return;
    }
    setState(() => _busy = true);
    try {
      final result = await widget.repo.resetAllAccounts();
      messenger.showSnackBar(SnackBar(
        content: Text('${result.accounts} → ${l.t('free')} · '
            '${result.granted} × ${result.grantEach} ${l.t('credits')}'),
      ));
      _load();
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('${l.t('saveFailed')} $e')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pickDate(bool start) async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: now,
      firstDate: now.subtract(const Duration(days: 365)),
      lastDate: now.add(const Duration(days: 365 * 3)),
    );
    if (picked == null) return;
    setState(() {
      if (start) {
        _offerStarts = picked;
      } else {
        // An offer window is inclusive of its last day.
        _offerEnds = picked.add(const Duration(hours: 23, minutes: 59));
      }
    });
  }

  String _day(int ms) {
    final d = DateTime.fromMillisecondsSinceEpoch(ms);
    return '${d.year}-${d.month.toString().padLeft(2, '0')}-'
        '${d.day.toString().padLeft(2, '0')}';
  }
}

/// A titled card with an optional explanatory note — the shape every
/// configuration block on this screen uses.
class _Section extends StatelessWidget {
  final String title;
  final String? note;
  final Color? tone;
  final List<Widget> children;

  const _Section({
    required this.title,
    this.note,
    this.tone,
    required this.children,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              title,
              style: TextStyle(
                fontWeight: FontWeight.w800,
                fontSize: 15,
                color: tone,
              ),
            ),
            if (note != null) ...[
              const SizedBox(height: 4),
              Text(
                note!,
                style: TextStyle(
                    fontSize: 12, color: scheme.onSurfaceVariant),
              ),
            ],
            const SizedBox(height: 12),
            ...children,
          ],
        ),
      ),
    );
  }
}

class _NumberRow extends StatelessWidget {
  final List<Widget> children;
  const _NumberRow({required this.children});

  @override
  Widget build(BuildContext context) => Wrap(
        spacing: 12,
        runSpacing: 12,
        children: [
          for (final child in children)
            SizedBox(width: 170, child: child),
        ],
      );
}

class _Number extends StatelessWidget {
  final TextEditingController controller;
  final String label;
  final bool decimal;

  const _Number({
    required this.controller,
    required this.label,
    this.decimal = false,
  });

  @override
  Widget build(BuildContext context) => TextField(
        controller: controller,
        textDirection: TextDirection.ltr,
        keyboardType: TextInputType.numberWithOptions(decimal: decimal),
        decoration: InputDecoration(labelText: label, isDense: true),
      );
}

class _Stat extends StatelessWidget {
  final String label;
  final String value;
  const _Stat({required this.label, required this.value});

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label,
            style: TextStyle(
              fontSize: 11,
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
          Text(
            value,
            textDirection: TextDirection.ltr,
            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
          ),
        ],
      );
}
