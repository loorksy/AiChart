import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../api/file_picker.dart';
import '../api/models.dart';
import '../api/repository.dart';
import '../i18n.dart';
import 'shell.dart';

/// In-app promo campaigns: a few slides shown to a chosen audience inside a
/// date window.
///
/// The audience is evaluated server-side per viewer, so "subscribers" cannot
/// leak to a Free account by a client mistake. Images are uploaded first and
/// referenced by the path the server returns — the server checks the file's
/// MAGIC BYTES and size, so a renamed executable is refused whatever the
/// extension claims.
class AdsScreen extends StatefulWidget {
  final AdminRepository repo;
  const AdsScreen({super.key, required this.repo});

  @override
  State<AdsScreen> createState() => _AdsScreenState();
}

class _AdsScreenState extends State<AdsScreen> {
  late Future<List<AdCampaign>> _future;
  bool _busy = false;

  static const _audiences = [
    'all',
    'subscribers',
    'non_subscribers',
    'trial',
  ];

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    _future = widget.repo.ads();
    setState(() {});
  }

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

  @override
  Widget build(BuildContext context) {
    final l = L.of(context);
    return Scaffold(
      body: AsyncBody<List<AdCampaign>>(
        future: _future,
        onRetry: _load,
        builder: (context, ads) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (ads.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 24),
                child: Center(child: Text(l.t('noAds'))),
              ),
            for (final ad in ads) _adCard(ad),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _busy ? null : _composeDialog,
        icon: const Icon(Icons.add),
        label: Text(l.t('newAd')),
      ),
    );
  }

  Widget _adCard(AdCampaign ad) {
    final l = L.of(context);
    final scheme = Theme.of(context).colorScheme;
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Chip(
                  label: Text(l.t('audience_${ad.audience}')),
                  visualDensity: VisualDensity.compact,
                ),
                const Spacer(),
                Switch(
                  value: ad.active,
                  onChanged: _busy
                      ? null
                      : (v) =>
                          _run(() => widget.repo.updateAd(ad.id, active: v)),
                ),
                IconButton(
                  tooltip: l.t('delete'),
                  icon: Icon(Icons.delete_outline, size: 20, color: scheme.error),
                  onPressed: _busy ? null : () => _confirmDelete(ad),
                ),
              ],
            ),
            if (ad.startsAt != null || ad.endsAt != null)
              Text(
                '${_day(ad.startsAt)} → ${_day(ad.endsAt)}',
                textDirection: TextDirection.ltr,
                style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
              ),
            const SizedBox(height: 8),
            for (var i = 0; i < ad.slides.length; i++)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${i + 1}. ',
                        style: TextStyle(color: scheme.onSurfaceVariant)),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if (ad.slides[i].text != null)
                            Text(ad.slides[i].text!),
                          if (ad.slides[i].imagePath != null)
                            Text(
                              ad.slides[i].imagePath!,
                              textDirection: TextDirection.ltr,
                              style: TextStyle(
                                  fontSize: 11,
                                  color: scheme.onSurfaceVariant),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _confirmDelete(AdCampaign ad) async {
    final l = L.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        content: Text(l.t('confirmDelete')),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(l.t('close')),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(l.t('delete')),
          ),
        ],
      ),
    );
    if (ok == true) await _run(() => widget.repo.deleteAd(ad.id));
  }

  Future<void> _composeDialog() async {
    final l = L.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final slides = <AdSlide>[AdSlide(text: '')];
    // What was picked, per slide, so the operator SEES the picture before
    // saving instead of a stored filename appearing under the text field.
    final previews = <int, Uint8List>{};
    final uploaded = <int, AdImageUpload>{};
    var audience = 'all';
    DateTime? starts;
    DateTime? ends;

    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) {
          Future<void> attach(int index) async {
            // The device's own file chooser. This used to ask the operator to
            // paste base64 or a data URL into a text box — unusable with a
            // photo on a phone, which is why ad images never got uploaded.
            final limits = await widget.repo.adUploadLimits().catchError(
                  (_) => AdUploadLimits(
                    maxBytes: 2 * 1024 * 1024,
                    accepted: const ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
                  ),
                );
            final picked = await pickImageFile(accept: limits.accepted);
            if (picked == null) return;
            // A courtesy check so the operator hears about an oversize file
            // before waiting for the upload. The SERVER is what enforces it.
            if (picked.sizeBytes > limits.maxBytes) {
              messenger.showSnackBar(SnackBar(
                content: Text(
                  '${l.t('imageTooLarge')} ${(limits.maxBytes / 1024 / 1024).toStringAsFixed(1)}MB',
                ),
              ));
              return;
            }
            // Show it immediately; the upload result confirms it afterwards.
            setDialogState(() => previews[index] = picked.bytes);
            try {
              final result = await widget.repo.uploadAdImage(
                bytes: picked.bytes,
                filename: picked.name,
                mimeType: picked.mimeType,
              );
              setDialogState(() {
                slides[index] =
                    AdSlide(text: slides[index].text, imagePath: result.imagePath);
                uploaded[index] = result;
              });
            } catch (e) {
              setDialogState(() => previews.remove(index));
              messenger.showSnackBar(
                  SnackBar(content: Text(_uploadError(l, e))));
            }
          }

          return AlertDialog(
            title: Text(l.t('newAd')),
            content: SizedBox(
              width: 460,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    DropdownButtonFormField<String>(
                      initialValue: audience,
                      decoration:
                          InputDecoration(labelText: l.t('audience')),
                      items: [
                        for (final a in _audiences)
                          DropdownMenuItem(
                              value: a, child: Text(l.t('audience_$a'))),
                      ],
                      onChanged: (v) =>
                          setDialogState(() => audience = v ?? 'all'),
                    ),
                    const SizedBox(height: 12),
                    for (var i = 0; i < slides.length; i++)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                        _slidePreview(context, previews[i], uploaded[i]),
                        Row(
                          children: [
                            Expanded(
                              child: TextField(
                                decoration: InputDecoration(
                                  labelText: '${l.t('slide')} ${i + 1}',
                                      helperText: _slideHelper(l, slides[i], uploaded[i]),
                                  helperStyle:
                                      const TextStyle(fontSize: 11),
                                ),
                                maxLines: 2,
                                onChanged: (v) => slides[i] = AdSlide(
                                    text: v, imagePath: slides[i].imagePath),
                              ),
                            ),
                            IconButton(
                              tooltip: l.t('attachImage'),
                              icon: const Icon(Icons.image_outlined),
                              onPressed: () => attach(i),
                            ),
                            if (previews[i] != null || slides[i].imagePath != null)
                              IconButton(
                                tooltip: l.t('removeImage'),
                                icon: const Icon(Icons.hide_image_outlined),
                                onPressed: () => setDialogState(() {
                                  previews.remove(i);
                                  uploaded.remove(i);
                                  slides[i] = AdSlide(text: slides[i].text);
                                }),
                              ),
                            if (slides.length > 1)
                              IconButton(
                                icon: const Icon(Icons.remove_circle_outline),
                                onPressed: () => setDialogState(() {
                                  slides.removeAt(i);
                                  previews.remove(i);
                                  uploaded.remove(i);
                                }),
                              ),
                          ],
                        ),
                          ],
                        ),
                      ),
                    if (slides.length < 10)
                      Align(
                        alignment: AlignmentDirectional.centerStart,
                        child: TextButton.icon(
                          onPressed: () => setDialogState(
                              () => slides.add(AdSlide(text: ''))),
                          icon: const Icon(Icons.add),
                          label: Text(l.t('addSlide')),
                        ),
                      ),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton(
                            onPressed: () async {
                              final picked = await _pickDate(context);
                              if (picked != null) {
                                setDialogState(() => starts = picked);
                              }
                            },
                            child: Text(starts == null
                                ? l.t('startsAt')
                                : _day(starts!.millisecondsSinceEpoch)),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: OutlinedButton(
                            onPressed: () async {
                              final picked = await _pickDate(context);
                              if (picked != null) {
                                setDialogState(() => ends = picked);
                              }
                            },
                            child: Text(ends == null
                                ? l.t('endsAt')
                                : _day(ends!.millisecondsSinceEpoch)),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
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
          );
        },
      ),
    );

    if (saved != true) return;
    final filled = slides
        .where((s) =>
            (s.text != null && s.text!.trim().isNotEmpty) ||
            (s.imagePath != null && s.imagePath!.isNotEmpty))
        .toList();
    if (filled.isEmpty) {
      messenger.showSnackBar(SnackBar(content: Text(l.t('adNeedsSlide'))));
      return;
    }
    await _run(() => widget.repo.createAd(
          slides: filled,
          audience: audience,
          startsAt: starts?.millisecondsSinceEpoch,
          endsAt: ends?.millisecondsSinceEpoch,
        ));
  }

  /// A picture the operator can SEE before publishing, plus what the server
  /// measured about it. The dialog used to show only a stored filename.
  Widget _slidePreview(BuildContext context, Uint8List? bytes, AdImageUpload? info) {
    if (bytes == null) return const SizedBox.shrink();
    final l = L.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(6),
            // Image.memory animates a GIF or an animated WebP natively, so the
            // preview moves exactly as the published ad will.
            child: Image.memory(
              bytes,
              width: 96,
              height: 96,
              fit: BoxFit.cover,
              errorBuilder: (_, _, _) => const SizedBox(
                width: 96,
                height: 96,
                child: Icon(Icons.broken_image_outlined),
              ),
            ),
          ),
          const SizedBox(width: 10),
          if (info != null)
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${info.ext.toUpperCase()} · ${(info.bytes / 1024).round()} KB',
                    textDirection: TextDirection.ltr,
                    style: const TextStyle(fontSize: 11),
                  ),
                  // Measured from the bytes, not inferred from the format.
                  if (info.animated)
                    Text(
                      l.t('imageAnimated'),
                      style: const TextStyle(fontSize: 11),
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  String? _slideHelper(L l, AdSlide slide, AdImageUpload? info) {
    if (slide.imagePath == null) return null;
    if (info == null) return slide.imagePath;
    return '${slide.imagePath} · ${info.ext.toUpperCase()}'
        '${info.animated ? " · ${l.t('imageAnimated')}" : ""}';
  }

  /// The server's refusal, in words. It used to print the raw exception.
  String _uploadError(L l, Object error) {
    final text = '$error';
    if (text.contains('too_large') || text.contains('413')) {
      return l.t('imageTooLarge');
    }
    if (text.contains('unsupported_type') || text.contains('415')) {
      return l.t('imageWrongType');
    }
    return '${l.t('uploadFailed')} $text';
  }

  Future<DateTime?> _pickDate(BuildContext context) {
    final now = DateTime.now();
    return showDatePicker(
      context: context,
      initialDate: now,
      firstDate: now.subtract(const Duration(days: 30)),
      lastDate: now.add(const Duration(days: 365 * 2)),
    );
  }

  String _day(int? ms) {
    if (ms == null) return '—';
    final d = DateTime.fromMillisecondsSinceEpoch(ms);
    return '${d.year}-${d.month.toString().padLeft(2, '0')}-'
        '${d.day.toString().padLeft(2, '0')}';
  }
}
