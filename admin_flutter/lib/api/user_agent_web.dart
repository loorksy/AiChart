import 'package:web/web.dart' as web;

/// The page's navigator UA. The Android APK suffixes this with `LonoraAdmin`.
String browserUserAgent() => web.window.navigator.userAgent;
