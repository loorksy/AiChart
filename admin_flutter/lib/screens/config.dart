import 'package:flutter/material.dart';

import '../api/models.dart';
import '../api/repository.dart';
import '../i18n.dart';
import 'shell.dart';

/// Platform keys and settings — every credential and switch the platform
/// runs on. Groups mirror the server's own field metadata, so a field added
/// there appears here without a change in this file. Secrets show a masked
/// value and are only sent when the admin typed a replacement, which is why
/// an empty box means "keep what is stored" rather than "clear it".
class ConfigScreen extends StatefulWidget {
  final AdminRepository repo;
  const ConfigScreen({super.key, required this.repo});

  @override
  State<ConfigScreen> createState() => _ConfigScreenState();
}

class _ConfigScreenState extends State<ConfigScreen> {
  late Future<List<ConfigField>> _future;
  final Map<String, String> _draft = {};
  final Map<String, bool> _toggleDraft = {};
  bool _saving = false;

  static const _groupOrder = ['ai', 'markets', 'telegram', 'ops', 'core'];
  static const _groupTitles = {
    'ai': {'ar': 'الذكاء الاصطناعي', 'en': 'AI providers'},
    'markets': {'ar': 'بيانات السوق', 'en': 'Market data'},
    'telegram': {'ar': 'تليجرام', 'en': 'Telegram'},
    'ops': {'ar': 'التشغيل', 'en': 'Operations'},
    'core': {'ar': 'النواة', 'en': 'Core'},
  };

  /// Model fields are not admin decisions on this platform: the END USER
  /// picks from the curated multimodal trios (OpenAI/Claude). The keys
  /// stay; the model dropdowns/text fields go.
  static const _hiddenModelKeys = {
    'AI_MODEL',
    'ANTHROPIC_MODEL',
    'AI_QUICK_MODEL',
    'ANTHROPIC_QUICK_MODEL',
    // Owned by the Providers destination: a free-text copy here would let
    // an operator type a provider that does not exist.
    'AI_PROVIDER',
  };

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    _draft.clear();
    _toggleDraft.clear();
    _future = widget.repo.configFields();
    setState(() {});
  }

  Future<void> _save() async {
    final l = L.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final patch = <String, dynamic>{};
    for (final e in _draft.entries) {
      if (e.value.trim().isNotEmpty) patch[e.key] = e.value.trim();
    }
    patch.addAll(_toggleDraft);
    if (patch.isEmpty) return;

    setState(() => _saving = true);
    try {
      await widget.repo.saveConfig(patch);
      messenger.showSnackBar(SnackBar(content: Text(l.t('saved'))));
      _load();
    } catch (e) {
      messenger
          .showSnackBar(SnackBar(content: Text('${l.t('saveFailed')} $e')));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = L.of(context);
    return AsyncBody<List<ConfigField>>(
      future: _future,
      onRetry: _load,
      builder: (context, allFields) {
        final fields = allFields
            .where((f) => !_hiddenModelKeys.contains(f.key))
            .toList();
        final configured = fields.where((f) => f.configured).length;
        final pending = _draft.values.where((v) => v.trim().isNotEmpty).length +
            _toggleDraft.length;
        return Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      l.t('config'),
                      style: Theme.of(context)
                          .textTheme
                          .titleLarge
                          ?.copyWith(fontWeight: FontWeight.w800),
                    ),
                  ),
                  Text(
                    '$configured/${fields.length} ${l.t('configuredCount')}',
                    style: TextStyle(
                      fontSize: 12,
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(width: 12),
                  FilledButton(
                    onPressed: _saving || pending == 0 ? null : _save,
                    child: _saving
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2))
                        : Text('${l.t('save')}${pending > 0 ? ' ($pending)' : ''}'),
                  ),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
                children: [
                  for (final group in _groupOrder)
                    if (fields.any((f) => f.group == group))
                      _GroupCard(
                        title: _groupTitles[group]![l.ar ? 'ar' : 'en']!,
                        note: group == 'ai' ? l.t('aiKeysOnlyNote') : null,
                        fields:
                            fields.where((f) => f.group == group).toList(),
                        draft: _draft,
                        toggleDraft: _toggleDraft,
                        onChanged: () => setState(() {}),
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

class _GroupCard extends StatelessWidget {
  final String title;
  final String? note;
  final List<ConfigField> fields;
  final Map<String, String> draft;
  final Map<String, bool> toggleDraft;
  final VoidCallback onChanged;

  const _GroupCard({
    required this.title,
    this.note,
    required this.fields,
    required this.draft,
    required this.toggleDraft,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final l = L.of(context);
    final scheme = Theme.of(context).colorScheme;
    final configured = fields.where((f) => f.configured).length;

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ExpansionTile(
        shape: const Border(),
        title: Row(
          children: [
            Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(width: 8),
            Chip(
              label: Text('$configured/${fields.length}',
                  textDirection: TextDirection.ltr),
              visualDensity: VisualDensity.compact,
            ),
          ],
        ),
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        children: [
          if (note != null)
            Container(
              width: double.infinity,
              margin: const EdgeInsets.only(bottom: 12),
              padding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: scheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                note!,
                style:
                    TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
              ),
            ),
          for (final f in fields) ...[
            if (f.type == 'toggle')
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(l.ar ? f.label : f.labelEn,
                    style: const TextStyle(fontSize: 14)),
                subtitle: Text(f.key,
                    textDirection: TextDirection.ltr,
                    style: TextStyle(
                        fontSize: 11, color: scheme.onSurfaceVariant)),
                value: toggleDraft[f.key] ?? (f.value == '1'),
                onChanged: (v) {
                  toggleDraft[f.key] = v;
                  onChanged();
                },
              )
            else
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: TextField(
                  textDirection: TextDirection.ltr,
                  obscureText: false,
                  decoration: InputDecoration(
                    labelText: l.ar ? f.label : f.labelEn,
                    helperText: f.secret
                        ? (f.configured
                            ? '${f.masked ?? '•••'} — ${l.t('secretKept')}'
                            : null)
                        : (f.source == 'env' ? '.env' : null),
                    helperStyle: TextStyle(
                        fontSize: 11, color: scheme.onSurfaceVariant),
                    hintText: f.secret
                        ? (f.placeholder ?? '')
                        : (f.value ?? f.placeholder ?? ''),
                    suffixIcon: f.configured
                        ? const Icon(Icons.check_circle,
                            size: 18, color: Color(0xFF16A34A))
                        : null,
                  ),
                  onChanged: (v) {
                    draft[f.key] = v;
                    onChanged();
                  },
                ),
              ),
          ],
        ],
      ),
    );
  }
}
