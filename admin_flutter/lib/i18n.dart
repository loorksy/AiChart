import 'package:flutter/material.dart';

/// Minimal string table for the admin app — Arabic first, English second,
/// mirroring the platform's bilingual admin console.
class L {
  final Locale locale;
  const L(this.locale);

  bool get ar => locale.languageCode == 'ar';

  static L of(BuildContext context) =>
      Localizations.of<L>(context, L) ?? const L(Locale('ar'));

  String t(String key) => (_strings[key] ?? const {})[ar ? 'ar' : 'en'] ?? key;

  static const supported = [Locale('ar'), Locale('en')];

  static const Map<String, Map<String, String>> _strings = {
    'appTitle': {'ar': 'لونورا — الإدارة', 'en': 'Lonora — Admin'},
    'login': {'ar': 'تسجيل الدخول', 'en': 'Sign in'},
    'email': {'ar': 'البريد الإلكتروني', 'en': 'Email'},
    'password': {'ar': 'كلمة المرور', 'en': 'Password'},
    'loginFailed': {
      'ar': 'فشل تسجيل الدخول — تحقق من البيانات.',
      'en': 'Sign-in failed — check your credentials.'
    },
    'adminOnly': {
      'ar': 'هذه اللوحة لمشرفي المنصة فقط.',
      'en': 'This console is for platform admins only.'
    },
    'logout': {'ar': 'تسجيل الخروج', 'en': 'Sign out'},
    'overview': {'ar': 'نظرة عامة', 'en': 'Overview'},
    'users': {'ar': 'المستخدمون', 'en': 'Users'},
    'subscriptions': {'ar': 'الاشتراكات', 'en': 'Subscriptions'},
    'billing': {'ar': 'الفوترة', 'en': 'Billing'},
    'config': {'ar': 'المفاتيح والإعدادات', 'en': 'Keys & Config'},
    'support': {'ar': 'الدعم', 'en': 'Support'},
    'health': {'ar': 'صحة النظام', 'en': 'System health'},
    'retry': {'ar': 'إعادة المحاولة', 'en': 'Retry'},
    'refresh': {'ar': 'تحديث', 'en': 'Refresh'},
    'save': {'ar': 'حفظ', 'en': 'Save'},
    'saved': {'ar': 'تم الحفظ.', 'en': 'Saved.'},
    'saveFailed': {'ar': 'تعذّر الحفظ.', 'en': 'Save failed.'},
    'loadFailed': {
      'ar': 'تعذّر تحميل البيانات.',
      'en': 'Failed to load data.'
    },
    'search': {'ar': 'بحث…', 'en': 'Search…'},
    'status': {'ar': 'الحالة', 'en': 'Status'},
    'role': {'ar': 'الدور', 'en': 'Role'},
    'active': {'ar': 'نشط', 'en': 'Active'},
    'pending': {'ar': 'بانتظار الموافقة', 'en': 'Pending'},
    'disabled': {'ar': 'موقوف', 'en': 'Disabled'},
    'admin': {'ar': 'مشرف', 'en': 'Admin'},
    'user': {'ar': 'مستخدم', 'en': 'User'},
    'approve': {'ar': 'اعتماد', 'en': 'Approve'},
    'disable': {'ar': 'إيقاف', 'en': 'Disable'},
    'enable': {'ar': 'تفعيل', 'en': 'Enable'},
    'noResults': {'ar': 'لا نتائج.', 'en': 'No results.'},
    'configuredCount': {'ar': 'مفتاح مُعدّ', 'en': 'configured'},
    'secretKept': {
      'ar': 'اتركه فارغاً للإبقاء على القيمة الحالية.',
      'en': 'Leave blank to keep the current value.'
    },
    'totalUsers': {'ar': 'إجمالي المستخدمين', 'en': 'Total users'},
    'activeSubscriptions': {
      'ar': 'اشتراكات نشطة',
      'en': 'Active subscriptions'
    },
    'openTickets': {'ar': 'تذاكر مفتوحة', 'en': 'Open tickets'},
    'revenue': {'ar': 'الإيراد', 'en': 'Revenue'},
    'cost': {'ar': 'التكلفة', 'en': 'Cost'},
    'profit': {'ar': 'الربح', 'en': 'Profit'},
    'plan': {'ar': 'الباقة', 'en': 'Plan'},
    'credits': {'ar': 'الرصيد', 'en': 'Credits'},
    'adjustCredits': {'ar': 'تعديل الرصيد', 'en': 'Adjust credits'},
    'amount': {'ar': 'المقدار', 'en': 'Amount'},
    'reason': {'ar': 'السبب', 'en': 'Reason'},
    'apply': {'ar': 'تطبيق', 'en': 'Apply'},
    'theme': {'ar': 'المظهر', 'en': 'Theme'},
    'language': {'ar': 'English', 'en': 'العربية'},
    'sessionExpired': {
      'ar': 'انتهت الجلسة — سجّل الدخول مجدداً.',
      'en': 'Session expired — sign in again.'
    },
    'ticketOpen': {'ar': 'مفتوحة', 'en': 'Open'},
    'ticketClosed': {'ar': 'مغلقة', 'en': 'Closed'},
    'db': {'ar': 'قاعدة البيانات', 'en': 'Database'},
    'redis': {'ar': 'Redis', 'en': 'Redis'},
    'commit': {'ar': 'الإصدار', 'en': 'Commit'},
    'lastSeen': {'ar': 'آخر ظهور', 'en': 'Last seen'},
    'createdAt': {'ar': 'تاريخ الإنشاء', 'en': 'Created'},
    'details': {'ar': 'التفاصيل', 'en': 'Details'},
    'close': {'ar': 'إغلاق', 'en': 'Close'},
  };
}

class LDelegate extends LocalizationsDelegate<L> {
  const LDelegate();

  @override
  bool isSupported(Locale locale) =>
      L.supported.any((l) => l.languageCode == locale.languageCode);

  @override
  Future<L> load(Locale locale) async => L(locale);

  @override
  bool shouldReload(covariant LocalizationsDelegate<L> old) => false;
}
