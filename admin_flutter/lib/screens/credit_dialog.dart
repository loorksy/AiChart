import 'package:flutter/material.dart';

import '../api/repository.dart';
import '../i18n.dart';

/// The one manual credit adjustment dialog, shared by every screen that can
/// reach a user.
///
/// What it guarantees, and why each rule is here:
///   - the amount is a signed INTEGER of credits — the platform's only
///     currency. There is no dollar field, because nothing charges in dollars;
///   - the reason is mandatory and lands in the ledger beside the amount, so
///     a balance that looks wrong months later can still be explained;
///   - a negative amount goes through the same conditional debit as a spend:
///     it can empty a balance, never take it below zero. The server answers
///     409 in that case and the balance is left exactly as it was.
///
/// `currentBalance` is shown when the caller knows it — an adjustment decided
/// without seeing the current number is a guess.
Future<void> adjustCreditsDialog({
  required BuildContext context,
  required AdminRepository repo,
  required int userId,
  required String email,
  int? currentBalance,
  VoidCallback? onDone,
}) async {
  final l = L.of(context);
  final messenger = ScaffoldMessenger.of(context);
  final amount = TextEditingController();
  final reason = TextEditingController();

  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text('${l.t('adjustCredits')} — $email'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (currentBalance != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                '${l.t('currentBalance')}: $currentBalance',
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
            ),
          TextField(
            controller: amount,
            autofocus: true,
            keyboardType: const TextInputType.numberWithOptions(signed: true),
            textDirection: TextDirection.ltr,
            decoration: InputDecoration(
              labelText: '${l.t('amount')} (${l.t('credits')})',
              hintText: '100 / -100',
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: reason,
            minLines: 1,
            maxLines: 3,
            decoration: InputDecoration(
              labelText: l.t('reason'),
              helperText: l.t('reasonRequired'),
              helperMaxLines: 2,
            ),
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
  final value = int.tryParse(amount.text.trim());
  if (value == null || value == 0) {
    messenger.showSnackBar(SnackBar(content: Text(l.t('amountInvalid'))));
    return;
  }
  // The server enforces the same minimum; refusing here saves a round trip
  // and says which field is wrong.
  if (reason.text.trim().length < 5) {
    messenger.showSnackBar(SnackBar(content: Text(l.t('reasonRequired'))));
    return;
  }
  try {
    final balance = await repo.adjustCredits(
      userId: userId,
      credits: value,
      reason: reason.text.trim(),
    );
    messenger.showSnackBar(
      SnackBar(content: Text('${l.t('newBalance')}: $balance')),
    );
    onDone?.call();
  } catch (e) {
    messenger.showSnackBar(SnackBar(content: Text('$e')));
  }
}
