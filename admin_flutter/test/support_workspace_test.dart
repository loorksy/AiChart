import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lonora_admin/api/client.dart';
import 'package:lonora_admin/api/file_picker.dart';
import 'package:lonora_admin/api/models.dart';
import 'package:lonora_admin/api/repository.dart';
import 'package:lonora_admin/i18n.dart';
import 'package:lonora_admin/screens/support.dart';

/// The support desk is a workspace, not a popup over a list.
///
/// The previous screen opened `showDialog` for every ticket. That is what
/// the APK screenshots showed, and it is what this file forbids: a thread
/// is a pane (wide) or a full screen (narrow), never a modal.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('the support source no longer opens a ticket in a dialog', () {
    final source = File('lib/screens/support.dart').readAsStringSync();
    expect(source, isNot(contains('showDialog')));
    expect(source, isNot(contains('Dialog(')));
    expect(source, contains('support-thread'));
    expect(source, contains('support-empty'));
    expect(source, contains('support-back'));
    expect(source, contains('wideBreakpoint'));
  });

  testWidgets('wide: tapping a row opens the pane, not a popup', (tester) async {
    tester.view.physicalSize = const Size(1200, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_app(_FakeSupportRepo()));
    await tester.pump();
    await tester.pump();

    expect(find.byKey(const Key('support-empty')), findsOneWidget);
    expect(find.byType(Dialog), findsNothing);

    await tester.tap(find.text('trader@example.com'));
    await tester.pump();
    await tester.pump();

    expect(find.byKey(const Key('support-thread')), findsOneWidget);
    expect(find.byKey(const Key('support-inbox')), findsOneWidget);
    expect(find.byType(Dialog), findsNothing);
    expect(find.text('the chart will not load'), findsOneWidget);
    expect(find.text('here is the setting'), findsOneWidget);
    expect(find.textContaining('__lonora_rating_request__'), findsNothing);
  });

  testWidgets('narrow: the thread is a full screen with a back chevron',
      (tester) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_app(_FakeSupportRepo()));
    await tester.pump();
    await tester.pump();

    expect(find.byKey(const Key('support-inbox')), findsOneWidget);
    expect(find.byKey(const Key('support-thread')), findsNothing);
    expect(find.byKey(const Key('support-empty')), findsNothing);

    await tester.tap(find.text('trader@example.com'));
    await tester.pump();
    await tester.pump();

    expect(find.byKey(const Key('support-thread')), findsOneWidget);
    expect(find.byKey(const Key('support-inbox')), findsNothing);
    expect(find.byKey(const Key('support-back')), findsOneWidget);
    expect(find.byType(Dialog), findsNothing);

    await tester.tap(find.byKey(const Key('support-back')));
    await tester.pump();
    await tester.pump();

    expect(find.byKey(const Key('support-inbox')), findsOneWidget);
    expect(find.byKey(const Key('support-thread')), findsNothing);
  });

  testWidgets('in_progress conversations read as open, not closed', (tester) async {
    tester.view.physicalSize = const Size(1200, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_app(_FakeSupportRepo()));
    await tester.pump();
    await tester.pump();

    const ar = L(Locale('ar'));
    expect(
      find.textContaining('#4 · ${ar.t('ticketOpen')}'),
      findsOneWidget,
    );
  });
}

Widget _app(AdminRepository repo) {
  return MaterialApp(
    locale: const Locale('ar'),
    supportedLocales: L.supported,
    localizationsDelegates: const [
      LDelegate(),
      GlobalMaterialLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
      GlobalCupertinoLocalizations.delegate,
    ],
    home: Scaffold(body: SupportScreen(repo: repo)),
  );
}

class _FakeSupportRepo extends AdminRepository {
  _FakeSupportRepo() : super(_NoopClient());

  static final _inbox = SupportInbox(
    tickets: [
      TicketRow(
        id: 4,
        userId: 3,
        subject: 'support',
        status: 'in_progress',
        needsHuman: true,
        createdAt: 1786990000000,
        updatedAt: 1787000000000,
        userEmail: 'trader@example.com',
      ),
    ],
    unread: const {4: 1},
    unreadTotal: 1,
  );

  static final _thread = TicketThread(
    ticket: TicketRow(
      id: 4,
      userId: 3,
      subject: 'support',
      status: 'in_progress',
      needsHuman: true,
      createdAt: 1786990000000,
      updatedAt: 1787000000000,
      userEmail: 'trader@example.com',
      ratingRequestedAt: 1787000003000,
    ),
    messages: [
      MessageRow(
        id: 11,
        author: 'user',
        body: 'the chart will not load',
        createdAt: 1787000000000,
      ),
      MessageRow(
        id: 12,
        author: 'admin',
        body: 'here is the setting',
        createdAt: 1787000002000,
      ),
      MessageRow(
        id: 13,
        author: 'admin',
        body: MessageRow.ratingRequestBody,
        createdAt: 1787000003000,
      ),
    ],
  );

  @override
  Future<SupportInbox> supportInbox({String? status}) async => _inbox;

  @override
  Future<TicketThread> ticket(int id) async => _thread;

  @override
  Future<void> replyTicket(int id, String body, {PickedFile? attachment}) async {}

  @override
  Future<void> closeTicket(int id) async {}

  @override
  Future<void> reopenTicket(int id) async {}

  @override
  Future<void> requestSupportRating(int id) async {}

  @override
  Future<Uint8List> supportAttachment(String storedName) async => Uint8List(0);
}

/// The fake never talks to the network; the parent still wants a client.
class _NoopClient extends ApiClient {}
