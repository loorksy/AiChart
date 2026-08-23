import 'dart:async';
import 'dart:js_interop';

import 'package:web/web.dart' as web;

import 'picked_file.dart';

/// Open the browser's own file chooser and return what was picked.
///
/// The console used to ask the operator to paste base64 or a `data:` URL into
/// a text box — which is not something anyone can do with a photo on a phone,
/// and was the reason ad images were effectively un-uploadable in practice.
///
/// No package is needed: this is the platform's `<input type="file">`, driven
/// through `package:web`. `accept` is a convenience for the chooser dialog and
/// nothing more — the SERVER decides what is really allowed, by magic bytes
/// and byte count, and ignores the filename and the Content-Type entirely.
///
/// Returns null when the operator cancels.
Future<PickedFile?> pickImageFile({
  required List<String> accept,
}) async {
  final input = web.HTMLInputElement()
    ..type = 'file'
    ..accept = accept.join(',')
    ..multiple = false;

  final completer = Completer<PickedFile?>();

  // 'cancel' fires in modern browsers when the dialog is dismissed; without it
  // a cancelled pick would leave the caller awaiting forever.
  input.onchange = (web.Event _) {
    final files = input.files;
    if (files == null || files.length == 0) {
      if (!completer.isCompleted) completer.complete(null);
      return;
    }
    final file = files.item(0);
    if (file == null) {
      if (!completer.isCompleted) completer.complete(null);
      return;
    }
    file.arrayBuffer().toDart.then((buffer) {
      if (completer.isCompleted) return;
      completer.complete(
        PickedFile(
          bytes: buffer.toDart.asUint8List(),
          name: file.name,
          mimeType: file.type,
        ),
      );
    }).catchError((Object _) {
      if (!completer.isCompleted) completer.complete(null);
    });
  }.toJS;

  input.oncancel = (web.Event _) {
    if (!completer.isCompleted) completer.complete(null);
  }.toJS;

  input.click();
  return completer.future;
}
