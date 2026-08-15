import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'api/client.dart';
import 'api/models.dart';
import 'api/repository.dart';
import 'i18n.dart';
import 'screens/login.dart';
import 'screens/shell.dart';
import 'theme.dart';

void main() {
  runApp(const LonoraAdminApp());
}

class LonoraAdminApp extends StatefulWidget {
  const LonoraAdminApp({super.key});

  @override
  State<LonoraAdminApp> createState() => _LonoraAdminAppState();
}

class _LonoraAdminAppState extends State<LonoraAdminApp> {
  final AdminRepository repo = AdminRepository(ApiClient());

  ThemeMode _mode = ThemeMode.dark;
  Locale _locale = const Locale('ar');
  SessionUser? _user;
  bool _booting = true;

  @override
  void initState() {
    super.initState();
    _restoreSession();
  }

  Future<void> _restoreSession() async {
    try {
      final user = await repo.currentUser();
      if (user != null && user.role == 'admin') {
        setState(() => _user = user);
      }
    } catch (_) {
      // No session — the login screen handles it.
    } finally {
      if (mounted) setState(() => _booting = false);
    }
  }

  void _onLoggedIn(SessionUser user) => setState(() => _user = user);

  Future<void> _onLogout() async {
    try {
      await repo.logout();
    } finally {
      if (mounted) setState(() => _user = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Lonora Admin',
      debugShowCheckedModeBanner: false,
      themeMode: _mode,
      theme: lonoraTheme(Brightness.light),
      darkTheme: lonoraTheme(Brightness.dark),
      locale: _locale,
      supportedLocales: L.supported,
      localizationsDelegates: const [
        LDelegate(),
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: _booting
          ? const Scaffold(body: Center(child: CircularProgressIndicator()))
          : _user == null
              ? LoginScreen(repo: repo, onLoggedIn: _onLoggedIn)
              : AdminShell(
                  repo: repo,
                  user: _user!,
                  onLogout: _onLogout,
                  themeMode: _mode,
                  onToggleTheme: () => setState(() => _mode =
                      _mode == ThemeMode.dark
                          ? ThemeMode.light
                          : ThemeMode.dark),
                  onToggleLocale: () => setState(() => _locale =
                      _locale.languageCode == 'ar'
                          ? const Locale('en')
                          : const Locale('ar')),
                ),
    );
  }
}
