import 'dart:convert';

import 'package:http/http.dart' as http;

/// Thrown for non-2xx responses; carries the server's error message when the
/// body was JSON with an `error` field (the platform's error convention).
class ApiException implements Exception {
  final int status;
  final String message;
  ApiException(this.status, this.message);

  bool get unauthorized => status == 401 || status == 403;

  @override
  String toString() => 'ApiException($status): $message';
}

/// Same-origin JSON client. On Flutter web the browser attaches the session
/// cookie that POST /api/auth/login sets, so no token plumbing is needed —
/// exactly like the web console.
class ApiClient {
  /// Empty in production (same origin). Overridable for local development,
  /// e.g. `flutter run --dart-define=API_BASE=https://aichart.lork.cloud`.
  static const _base = String.fromEnvironment('API_BASE');

  final http.Client _http = http.Client();

  Uri _uri(String path, [Map<String, String>? query]) {
    final uri = Uri.parse('$_base$path');
    return query == null ? uri : uri.replace(queryParameters: query);
  }

  Future<Map<String, dynamic>> getJson(String path,
      {Map<String, String>? query}) async {
    final res = await _http.get(_uri(path, query),
        headers: {'accept': 'application/json'});
    return _decode(res);
  }

  Future<Map<String, dynamic>> sendJson(
    String method,
    String path,
    Object body,
  ) async {
    final req = http.Request(method, _uri(path))
      ..headers['content-type'] = 'application/json'
      ..headers['accept'] = 'application/json'
      ..body = jsonEncode(body);
    final res = await http.Response.fromStream(await _http.send(req));
    return _decode(res);
  }

  Map<String, dynamic> _decode(http.Response res) {
    Map<String, dynamic>? json;
    try {
      final decoded = jsonDecode(utf8.decode(res.bodyBytes));
      if (decoded is Map<String, dynamic>) json = decoded;
    } catch (_) {
      // Non-JSON body — fall through to the status check.
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      final message = (json?['error'] ?? json?['message'] ?? res.reasonPhrase)
          .toString();
      throw ApiException(res.statusCode, message);
    }
    return json ?? const {};
  }
}
