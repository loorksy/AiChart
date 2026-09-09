import 'package:web/web.dart' as web;

/// Trigger a browser download / navigation without adding url_launcher.
void openExternalUrl(String url) {
  final a = web.HTMLAnchorElement()
    ..href = url
    ..rel = 'noopener'
    ..target = '_blank';
  if (url.endsWith('.apk')) {
    a.download = 'lonora-admin.apk';
  }
  a.click();
}
