import 'package:flutter/material.dart';

import '../api/models.dart';
import '../api/repository.dart';
import '../i18n.dart';

/// Which AI provider the platform is pointed at, and how each one is doing.
///
/// The rule this card enforces in the UI is the operator's rule in code:
/// **the platform never switches provider by itself.** There is no automatic
/// failover, so when one provider's account runs dry the platform says so and
/// stops — it does not quietly answer from the other one. Choosing is the
/// operator's decision alone, made here.
///
/// The per-provider row exists because of a real incident: a provider's
/// credit ran out, the failure read as "the AI is down" with no account
/// named, and the wrong provider got topped up. Active / key present / last
/// success / last failure makes that unambiguous.
class ProvidersCard extends StatefulWidget {
  final AdminRepository repo;

  /// Called after the active provider changes, so the config screen can
  /// reload the key fields alongside it.
  final VoidCallback onChanged;

  const ProvidersCard({
    super.key,
    required this.repo,
    required this.onChanged,
  });

  @override
  State<ProvidersCard> createState() => _ProvidersCardState();
}

class _ProvidersCardState extends State<ProvidersCard> {
  ProviderOverview? _data;
  AgentModelStatus? _agent;
  Object? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await widget.repo.providers();
      // Best-effort: the MCP model line is informational, so a failure there
      // must not blank out the provider status this card exists for.
      AgentModelStatus? agent;
      try {
        agent = await widget.repo.agentModelStatus();
      } catch (_) {
        agent = null;
      }
      if (!mounted) return;
      setState(() {
        _data = data;
        _agent = agent;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e);
    }
  }

  Future<void> _activate(String id) async {
    final l = L.of(context);
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    try {
      // AI_PROVIDER is an ordinary platform-config field: saving it takes
      // effect on the next call, with no restart.
      await widget.repo.saveConfig({'AI_PROVIDER': id});
      messenger.showSnackBar(SnackBar(content: Text(l.t('providerSwitched'))));
      await _load();
      widget.onChanged();
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('${l.t('saveFailed')} $e')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = L.of(context);
    final scheme = Theme.of(context).colorScheme;
    final data = _data;

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    l.t('activeProvider'),
                    style: const TextStyle(
                        fontWeight: FontWeight.w800, fontSize: 15),
                  ),
                ),
                IconButton(
                  tooltip: l.t('refresh'),
                  icon: const Icon(Icons.refresh, size: 20),
                  onPressed: _busy ? null : _load,
                ),
              ],
            ),
            Text(
              l.t('providerNote'),
              style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: 12),
            if (data == null && _error == null)
              const Center(child: Padding(
                padding: EdgeInsets.all(12),
                child: CircularProgressIndicator(),
              ))
            else if (data == null)
              Text('${l.t('loadFailed')} $_error',
                  style: TextStyle(color: scheme.error))
            else ...[
              DropdownButtonFormField<String>(
                initialValue: data.active.isEmpty ? null : data.active,
                decoration: InputDecoration(
                  labelText: 'AI_PROVIDER',
                  isDense: true,
                  helperText: l.t('providerPickHint'),
                  helperMaxLines: 3,
                ),
                items: [
                  for (final p in data.providers)
                    DropdownMenuItem(value: p.id, child: Text(p.label)),
                ],
                onChanged: _busy
                    ? null
                    : (v) {
                        if (v != null && v != data.active) _activate(v);
                      },
              ),
              const SizedBox(height: 12),
              for (final p in data.providers) _providerRow(p),
              if (_agent != null) ...[
                const Divider(height: 24),
                Text(
                  '${l.t('mcpModel')}: ${_agent!.platformModel}',
                  textDirection: TextDirection.ltr,
                  style: const TextStyle(fontSize: 12),
                ),
              ],
              const SizedBox(height: 8),
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: TextButton.icon(
                  onPressed: _busy ? null : _modelCatalogue,
                  icon: const Icon(Icons.checklist, size: 18),
                  label: Text(l.t('verifyKey')),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _providerRow(ProviderStatus p) {
    final l = L.of(context);
    final scheme = Theme.of(context).colorScheme;
    // A failure AFTER the last success is the state that matters: it means
    // the provider is failing right now, not that it failed once last month.
    final failing = p.lastFailureAt != null &&
        (p.lastSuccessAt == null || p.lastFailureAt! > p.lastSuccessAt!);
    final tone = !p.keyConfigured
        ? scheme.onSurfaceVariant
        : failing
            ? scheme.error
            : const Color(0xFF16A34A);

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            !p.keyConfigured
                ? Icons.key_off_outlined
                : failing
                    ? Icons.error_outline
                    : Icons.check_circle_outline,
            size: 18,
            color: tone,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(p.label,
                        style: const TextStyle(fontWeight: FontWeight.w600)),
                    if (p.active) ...[
                      const SizedBox(width: 6),
                      Chip(
                        label: Text(l.t('active')),
                        visualDensity: VisualDensity.compact,
                        padding: EdgeInsets.zero,
                      ),
                    ],
                  ],
                ),
                Text(
                  p.keyConfigured
                      ? '${p.keyField} ✓'
                      : '${p.keyField} — ${l.t('keyMissing')}',
                  textDirection: TextDirection.ltr,
                  style:
                      TextStyle(fontSize: 11, color: scheme.onSurfaceVariant),
                ),
                if (p.model != null)
                  Text(
                    p.model!,
                    textDirection: TextDirection.ltr,
                    style: TextStyle(
                        fontSize: 11, color: scheme.onSurfaceVariant),
                  ),
                if (failing)
                  Text(
                    '${l.t('lastFailure')}: ${p.lastFailureCode ?? '—'} · '
                    '${_ago(p.lastFailureAt!)}',
                    style: TextStyle(fontSize: 11, color: scheme.error),
                  )
                else if (p.lastSuccessAt != null)
                  Text(
                    '${l.t('lastSuccess')}: ${_ago(p.lastSuccessAt!)}',
                    style: TextStyle(
                        fontSize: 11, color: scheme.onSurfaceVariant),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Lists the curated models for the active provider. The server proves the
  /// stored key against the provider's own endpoint first, so an error here
  /// IS the verdict on the key.
  Future<void> _modelCatalogue() async {
    final l = L.of(context);
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    try {
      final catalogue = await widget.repo.modelCatalogue();
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text('${l.t('models')} — ${catalogue.provider}'),
          content: SizedBox(
            width: 380,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final m in catalogue.models)
                  ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(
                      m.id == catalogue.defaultModel
                          ? Icons.radio_button_checked
                          : Icons.radio_button_unchecked,
                      size: 18,
                    ),
                    title: Text(m.label),
                    subtitle: Text(m.id,
                        textDirection: TextDirection.ltr,
                        style: const TextStyle(fontSize: 11)),
                  ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(l.t('close')),
            ),
          ],
        ),
      );
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _ago(int ms) {
    final d = DateTime.fromMillisecondsSinceEpoch(ms);
    final diff = DateTime.now().difference(d);
    if (diff.inMinutes < 60) return '${diff.inMinutes}m';
    if (diff.inHours < 48) return '${diff.inHours}h';
    return '${diff.inDays}d';
  }
}
