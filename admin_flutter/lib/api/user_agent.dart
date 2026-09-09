/// Browser user-agent, resolved per platform.
///
/// Web reads `navigator.userAgent`. The stub keeps `flutter test` on the
/// Dart VM compiling — same split as `open_url.dart`.
library;

export 'user_agent_stub.dart'
    if (dart.library.js_interop) 'user_agent_web.dart';
