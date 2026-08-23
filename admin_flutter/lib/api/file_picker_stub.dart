import 'picked_file.dart';

/// Non-web builds have no browser file chooser.
///
/// The console ships as `flutter build web`, so this exists for one reason:
/// `flutter test` runs on the Dart VM, where `dart:js_interop` does not
/// exist, and importing the web picker there fails the whole suite before a
/// single test runs. A picker that returns null is honest on a platform that
/// cannot pick.
Future<PickedFile?> pickImageFile({required List<String> accept}) async => null;
