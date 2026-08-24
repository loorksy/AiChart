import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart' show MediaType;

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

/// Same-origin JSON client. The browser cookie from POST /api/auth/login is
/// the primary session; the JWT from that response is sent as Bearer so the
/// admin shell still works if the cookie is not visible to XHR (Flutter web).
class ApiClient {
  /// Empty in production (same origin). Overridable for local development,
  /// e.g. `flutter run --dart-define=API_BASE=https://aichart.lork.cloud`.
  static const _base = String.fromEnvironment('API_BASE');

  final http.Client _http = http.Client();

  /// JWT from /api/auth/login — optional; cookie session still works alone.
  String? bearerToken;

  Uri _uri(String path, [Map<String, String>? query]) {
    final uri = Uri.parse('$_base$path');
    return query == null ? uri : uri.replace(queryParameters: query);
  }

  Map<String, String> _headers({bool jsonBody = false}) => {
        'accept': 'application/json',
        if (jsonBody) 'content-type': 'application/json',
        if (bearerToken != null && bearerToken!.isNotEmpty)
          'authorization': 'Bearer $bearerToken',
      };

  Future<Map<String, dynamic>> getJson(String path,
      {Map<String, String>? query}) async {
    final res =
        await _http.get(_uri(path, query), headers: _headers());
    return _decode(res);
  }

  Future<Map<String, dynamic>> sendJson(
    String method,
    String path,
    Object body,
  ) async {
    final req = http.Request(method, _uri(path))
      ..headers.addAll(_headers(jsonBody: true))
      ..body = jsonEncode(body);
    final res = await http.Response.fromStream(await _http.send(req));
    return _decode(res);
  }

  /// Upload one file as `multipart/form-data`.
  ///
  /// The bytes go as bytes. The console used to make the operator paste a
  /// base64 string into a text field, which is unusable with a photo from a
  /// device — and the server still enforces every bound itself, so the
  /// filename and content type sent here are hints, not permissions.
  Future<Map<String, dynamic>> uploadFile(
    String path, {
    required Uint8List bytes,
    required String filename,
    String field = 'file',
    String? mimeType,
  }) async {
    final req = http.MultipartRequest('POST', _uri(path))
      ..headers.addAll(_headers())
      ..files.add(
        http.MultipartFile.fromBytes(
          field,
          bytes,
          filename: filename,
          contentType: mimeType != null && mimeType.contains('/')
              ? MediaType(mimeType.split('/').first, mimeType.split('/').last)
              : null,
        ),
      );
    final res = await http.Response.fromStream(await _http.send(req));
    return _decode(res);
  }

  /// Fetch raw bytes with the session attached.
  ///
  /// Support attachments are private files behind an authorization check, so
  /// they cannot be handed to `Image.network`: that issues a bare browser
  /// request with no Authorization header, and this console authenticates by
  /// Bearer token precisely because the cookie is not always visible to it.
  /// Fetching here and rendering from memory is what makes a private image
  /// actually appear.
  Future<Uint8List> getBytes(String path) async {
    final res = await _http.get(_uri(path), headers: _headers());
    if (res.statusCode >= 400) {
      throw ApiException(res.statusCode, 'HTTP ${res.statusCode}');
    }
    return res.bodyBytes;
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
