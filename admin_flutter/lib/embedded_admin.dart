import 'api/user_agent.dart';

/// Token the Android WebView appends to its Chromium user-agent.
const lonoraAdminUserAgentToken = 'LonoraAdmin';

/// True when this session is the Lonora admin APK, not a normal browser tab.
///
/// Either signal is enough:
/// - `?app=1` on the page URL (the APK loads `/admin-app/?app=1`)
/// - `#app=1` / `#…?app=1` if the host ever used hash routing
/// - user-agent contains [lonoraAdminUserAgentToken]
///
/// Chrome on `/admin-app/` (desktop or phone) has none of these, so the
/// Overview download card stays visible there.
bool isEmbeddedAdminApp({
  Uri? uri,
  String? userAgent,
}) {
  final resolved = uri ?? Uri.base;
  if (resolved.queryParameters['app'] == '1') return true;
  if (fragmentQueryParameters(resolved)['app'] == '1') return true;
  final ua = userAgent ?? browserUserAgent();
  return ua.contains(lonoraAdminUserAgentToken);
}

/// Query map taken from a URL fragment (`#app=1` or `#/path?app=1`).
Map<String, String> fragmentQueryParameters(Uri uri) {
  final fragment = uri.fragment;
  if (fragment.isEmpty) return const {};
  final q = fragment.indexOf('?');
  final raw = q >= 0 ? fragment.substring(q + 1) : fragment;
  if (raw.isEmpty || !raw.contains('=')) return const {};
  return Uri.splitQueryString(raw);
}
