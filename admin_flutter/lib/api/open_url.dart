/// Open a same-origin URL in the browser (APK download, etc.).
///
/// Web uses `package:web`. The stub exists so `flutter test` on the Dart VM
/// still compiles — same split as `file_picker.dart`.
library;

export 'open_url_stub.dart'
    if (dart.library.js_interop) 'open_url_web.dart';
