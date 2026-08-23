import 'dart:typed_data';

/// A file the operator chose from their device.
class PickedFile {
  final Uint8List bytes;
  final String name;
  final String mimeType;

  const PickedFile({
    required this.bytes,
    required this.name,
    required this.mimeType,
  });

  int get sizeBytes => bytes.length;
}
