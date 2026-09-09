import 'package:flutter_test/flutter_test.dart';
import 'package:lonora_admin/embedded_admin.dart';

void main() {
  const chrome =
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128.0.0.0 Mobile Safari/537.36';
  const desktop =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36';

  test('a normal browser on /admin-app/ is not embedded', () {
    expect(
      isEmbeddedAdminApp(
        uri: Uri.parse('https://aichart.lork.cloud/admin-app/'),
        userAgent: desktop,
      ),
      isFalse,
    );
    expect(
      isEmbeddedAdminApp(
        uri: Uri.parse('https://aichart.lork.cloud/admin-app/'),
        userAgent: chrome,
      ),
      isFalse,
    );
  });

  test('?app=1 marks the Android APK session', () {
    expect(
      isEmbeddedAdminApp(
        uri: Uri.parse('https://aichart.lork.cloud/admin-app/?app=1'),
        userAgent: chrome,
      ),
      isTrue,
    );
  });

  test('hash routing #app=1 or #/?app=1 is also embedded', () {
    expect(
      isEmbeddedAdminApp(
        uri: Uri.parse('https://aichart.lork.cloud/admin-app/#app=1'),
        userAgent: desktop,
      ),
      isTrue,
    );
    expect(
      isEmbeddedAdminApp(
        uri: Uri.parse('https://aichart.lork.cloud/admin-app/#/?app=1'),
        userAgent: desktop,
      ),
      isTrue,
    );
  });

  test('LonoraAdmin user-agent is a second signal without the query flag', () {
    expect(
      isEmbeddedAdminApp(
        uri: Uri.parse('https://aichart.lork.cloud/admin-app/'),
        userAgent: '$chrome $lonoraAdminUserAgentToken',
      ),
      isTrue,
    );
  });

  test('unrelated query or fragment does not hide the card', () {
    expect(
      isEmbeddedAdminApp(
        uri: Uri.parse('https://aichart.lork.cloud/admin-app/?foo=1'),
        userAgent: desktop,
      ),
      isFalse,
    );
    expect(
      isEmbeddedAdminApp(
        uri: Uri.parse('https://aichart.lork.cloud/admin-app/#/overview'),
        userAgent: desktop,
      ),
      isFalse,
    );
  });
}
