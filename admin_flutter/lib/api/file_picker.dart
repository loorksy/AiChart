/// The device file chooser, resolved per platform.
///
/// The web implementation drives the browser's own `<input type="file">`
/// through `package:web`; the stub stands in wherever `dart:js_interop` does
/// not exist — notably the Dart VM, which is where `flutter test` runs. Without
/// this split the whole test suite failed to compile.
library;

export 'picked_file.dart';
export 'file_picker_stub.dart'
    if (dart.library.js_interop) 'file_picker_web.dart';
