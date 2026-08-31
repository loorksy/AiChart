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

  /// Every key the table defines. Exposed for the test that scans the source
  /// for `t('…')` literals: a key the code asks for and the table lacks is a
  /// test failure, never a silent fallback to the raw key on screen.
  static Iterable<String> get keys => _strings.keys;

  /// The languages a key must be present in. A key with only one of them is
  /// as broken as a missing key.
  static const localeCodes = ['ar', 'en'];

  static bool has(String key, String code) =>
      (_strings[key] ?? const {})[code] != null;

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
    'billing': {'ar': 'الفوترة', 'en': 'Billing'},
    'config': {'ar': 'المفاتيح والإعدادات', 'en': 'Keys & Config'},
    'allowNewRegistrations': {
      'ar': 'السماح بتسجيل مستخدمين جدد',
      'en': 'Allow new registrations'
    },
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
    'active': {'ar': 'نشط', 'en': 'Active'},
    'pending': {'ar': 'بانتظار الموافقة', 'en': 'Pending'},
    'disabled': {'ar': 'موقوف', 'en': 'Disabled'},
    'admin': {'ar': 'مشرف', 'en': 'Admin'},
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
    'admins': {'ar': 'المشرفون', 'en': 'Admins'},
    'addAdmin': {'ar': 'إضافة مشرف', 'en': 'Add admin'},
    'demoteAdmin': {'ar': 'إزالة الإشراف', 'en': 'Remove admin'},
    'you': {'ar': 'أنت', 'en': 'You'},
    'role_owner': {'ar': 'مالك — كل الصلاحيات', 'en': 'Owner — all permissions'},
    'role_support': {'ar': 'دعم — قراءة المستخدمين والتذاكر', 'en': 'Support — users read + tickets'},
    'role_user_manager': {
      'ar': 'إدارة مستخدمين — مستخدمون وفوترة وتذاكر',
      'en': 'User manager — users, billing read, tickets'
    },
    'role_content_manager': {'ar': 'محتوى — تحرير الصفحات', 'en': 'Content — pages'},
    'role_finance': {'ar': 'مالية — فوترة وأرباح', 'en': 'Finance — billing + profit'},
    'activatePlan': {'ar': 'تفعيل الباقة', 'en': 'Activate plan'},
    'months': {'ar': 'عدد الأشهر', 'en': 'Months'},
    'gift': {'ar': 'هدية (بدون إيراد)', 'en': 'Gift (no revenue)'},
    'suspendPlan': {'ar': 'إيقاف الباقة', 'en': 'Suspend plan'},
    'planActivated': {'ar': 'فُعّلت الباقة.', 'en': 'Plan activated.'},
    'aiKeysOnlyNote': {
      'ar':
          'المفاتيح فقط تُضبط هنا — المستخدم يختار نموذجه من المحادثة: '
              '3 نماذج OpenAI و3 نماذج Claude متعددة الوسائط.',
      'en':
          'Keys only — each user picks their own model in chat: '
              '3 multimodal OpenAI models and 3 multimodal Claude models.'
    },
    'language': {'ar': 'English', 'en': 'العربية'},
    'unread': {'ar': 'غير مقروءة', 'en': 'Unread'},
    'attachFile': {'ar': 'إرفاق ملف', 'en': 'Attach a file'},
    'attachment': {'ar': 'مرفق', 'en': 'Attachment'},
    'attachmentFailed': {
      'ar': 'تعذّر عرض المرفق.',
      'en': 'The attachment could not be shown.'
    },
    'writeMessage': {'ar': 'اكتب رسالة…', 'en': 'Write a message…'},
    'ticketOpen': {'ar': 'مفتوحة', 'en': 'Open'},
    'ticketClosed': {'ar': 'مغلقة', 'en': 'Closed'},
    'close': {'ar': 'إغلاق', 'en': 'Close'},
    'confirm': {'ar': 'تأكيد', 'en': 'Confirm'},
    'delete': {'ar': 'حذف', 'en': 'Delete'},
    'confirmDelete': {
      'ar': 'هل تريد الحذف؟ لا يمكن التراجع.',
      'en': 'Delete this? It cannot be undone.'
    },
    'archive': {'ar': 'أرشفة', 'en': 'Archive'},
    'archived': {'ar': 'مؤرشف', 'en': 'Archived'},
    'value': {'ar': 'القيمة', 'en': 'Value'},
    'startsAt': {'ar': 'يبدأ', 'en': 'Starts'},
    'endsAt': {'ar': 'ينتهي', 'en': 'Ends'},
    'free': {'ar': 'مجاني', 'en': 'Free'},
    'usage': {'ar': 'الاستهلاك', 'en': 'Usage'},

    // ── Navigation ────────────────────────────────────────────────
    'pricing': {'ar': 'التسعير', 'en': 'Pricing'},
    'ads': {'ar': 'الإعلانات', 'en': 'Ads'},
    'providers': {'ar': 'المزوّدون', 'en': 'Providers'},
    'operations': {'ar': 'التشغيل', 'en': 'Operations'},

    // ── Pricing ───────────────────────────────────────────────────
    'planPrice': {'ar': 'سعر الاشتراك', 'en': 'Subscription price'},
    'planPriceNote': {
      'ar': 'نشر السعر يكتب سطراً جديداً ولا يعدّل القديم — من اشترك '
          'يبقى على الشروط التي اشتراها.',
      'en': 'Publishing writes a NEW row and never edits the old one — '
          'subscribers keep the terms they bought.'
    },
    'noPrice': {'ar': 'لا سعر منشور بعد.', 'en': 'No price published yet.'},
    'priceUsd': {'ar': 'السعر (دولار)', 'en': 'Price (USD)'},
    'creditsPerCycle': {'ar': 'كريدت لكل دورة', 'en': 'Credits per cycle'},
    'cycleDays': {'ar': 'أيام الدورة', 'en': 'Cycle days'},
    'publishPrice': {'ar': 'نشر السعر', 'en': 'Publish price'},
    'creditPrices': {'ar': 'أسعار العمليات', 'en': 'Operation prices'},
    'creditPricesNote': {
      'ar': 'كم كريدت تكلّف كل عملية. صفر = مجانية.',
      'en': 'What each operation costs in credits. Zero = free.'
    },
    'op_recommendation': {'ar': 'توصية', 'en': 'Recommendation'},
    'op_chat_turn': {'ar': 'رسالة محادثة', 'en': 'Chat turn'},
    'op_mt5_link': {'ar': 'ربط MT5', 'en': 'MT5 link'},
    'accountLimits': {'ar': 'حدود الحساب', 'en': 'Account limits'},
    'signupGrant': {'ar': 'منحة التسجيل (كريدت)', 'en': 'Signup grant'},
    'signupGrantNote': {
      'ar': 'الرصيد الذي يُمنح للحساب الجديد مرة واحدة إلى الأبد. تغييره '
          'يسري على الحسابات الجديدة فقط، ولا يُمنح حساب مرتين.',
      'en': 'The balance a NEW account is handed once, forever. A change '
          'applies to new accounts only, and no account is granted twice.'
    },
    'minRr': {'ar': 'أدنى عائد:مخاطرة ×100', 'en': 'Min reward:risk ×100'},
    'minRrNote': {
      'ar': '250 = 2.5:1 على الهدف الأول. الوكيل يرفض نشر خطة دونه. '
          'صفر = بلا حدّ.',
      'en': '250 = 2.5:1 on the FIRST target. The agent refuses to publish '
          'a plan below it. Zero = no floor.'
    },
    'lowBalance': {'ar': 'تنبيه انخفاض الرصيد', 'en': 'Low-balance warning'},
    'expiryWarn': {'ar': 'تنبيه قرب الانتهاء (يوم)', 'en': 'Expiry warning (days)'},
    'calculator': {'ar': 'الحاسبة', 'en': 'Calculator'},
    'calculatorNote': {
      'ar': 'عرض فقط — لا تكتب شيئاً.',
      'en': 'Display only — it writes nothing.'
    },
    'calculatorEmpty': {
      'ar': 'أدخل سعراً وعدد كريدت لعرض الحساب.',
      'en': 'Enter a price and a credit count to see the maths.'
    },
    'perCredit': {'ar': 'تكلفة الكريدت', 'en': 'Per credit'},
    'recsPerCycle': {'ar': 'توصيات لكل دورة', 'en': 'Recommendations / cycle'},
    'recCost': {'ar': 'تكلفة التوصية', 'en': 'Recommendation cost'},
    'topupPacks': {'ar': 'باقات التعبئة', 'en': 'Top-up packs'},
    'packsNote': {
      'ar': 'الباقات تُؤرشف ولا تُحذف — الشراء المفتوح يحمل شروطه المثبتة. '
          'وهي للمشتركين فقط.',
      'en': 'Packs archive, never vanish — an open checkout carries its own '
          'pinned terms. They are sold to live subscribers only.'
    },
    'addPack': {'ar': 'إضافة باقة', 'en': 'Add pack'},
    'offers': {'ar': 'العروض', 'en': 'Offers'},
    'offersNote': {
      'ar': 'العرض يسري على عمليات الشراء التي تُفتح داخل نافذته فقط — '
          'لا أثر رجعي.',
      'en': 'An offer applies only to checkouts opened inside its window — '
          'never retroactively.'
    },
    'percent': {'ar': 'نسبة %', 'en': 'Percent'},
    'fixedAmount': {'ar': 'مبلغ ثابت (دولار)', 'en': 'Fixed (USD)'},
    'addOffer': {'ar': 'إضافة عرض', 'en': 'Add offer'},
    'stripeOn': {'ar': 'الدفع مُفعّل', 'en': 'Payments configured'},
    'stripeOff': {'ar': 'الدفع غير مُعدّ', 'en': 'Payments not configured'},
    'stripeHint': {
      'ar': 'التفعيل يدوي من شاشة الفوترة حتى يُربط مزوّد الدفع.',
      'en': 'Activation is manual from the billing screen until a payment '
          'provider is wired up.'
    },
    'dangerZone': {'ar': 'منطقة خطرة', 'en': 'Danger zone'},
    'resetAccounts': {
      'ar': 'تصفير كل الحسابات',
      'en': 'Reset every account'
    },
    'resetNote': {
      'ar': 'يعيد كل حساب غير إداري إلى المجاني: بلا اشتراك ولا رصيد ولا '
          'سجلّ، ثم يُصرف له المنحة الحالية كحساب جديد.',
      'en': 'Puts every non-admin account back to Free: no subscription, no '
          'balance, no ledger — then hands it the current welcome grant.'
    },
    'resetWarning': {
      'ar': 'هذا يمحو أرصدة كل المستخدمين وسجلّهم. اكتب RESET للتأكيد.',
      'en': 'This erases every user balance and ledger. Type RESET to confirm.'
    },
    'resetNotConfirmed': {
      'ar': 'لم تُكتب كلمة التأكيد.',
      'en': 'The confirmation phrase was not typed.'
    },

    // ── Credits ───────────────────────────────────────────────────
    'currentBalance': {'ar': 'الرصيد الحالي', 'en': 'Current balance'},
    'newBalance': {'ar': 'الرصيد الجديد', 'en': 'New balance'},
    'reasonRequired': {
      'ar': 'السبب إلزامي (5 أحرف فأكثر) ويُكتب في السجلّ مع المبلغ.',
      'en': 'A reason is required (5+ chars) and is written to the ledger '
          'with the amount.'
    },
    'amountInvalid': {
      'ar': 'أدخل عدداً صحيحاً غير صفري.',
      'en': 'Enter a non-zero whole number.'
    },
    'restoreFree': {'ar': 'إعادة إلى المجاني', 'en': 'Back to Free'},

    // ── Model prices ──────────────────────────────────────────────
    'modelPrices': {'ar': 'أسعار النماذج', 'en': 'Model prices'},
    'modelPricesNote': {
      'ar': 'ما يكلّفنا المليون توكن. يُقرأ عند كل نداء — التعديل يسري فوراً.',
      'en': 'What a million tokens costs us. Read per call — an edit applies '
          'immediately.'
    },
    'inputPerM': {'ar': 'دخل / مليون', 'en': 'Input / M'},
    'outputPerM': {'ar': 'خرج / مليون', 'en': 'Output / M'},

    // ── Providers ─────────────────────────────────────────────────
    'activeProvider': {'ar': 'مزوّد الذكاء النشط', 'en': 'Active AI provider'},
    'providerNote': {
      'ar': 'المنصة لا تبدّل المزوّد من تلقاء نفسها أبداً: عند فشل مزوّد '
          'تتوقف وتُسمّيه، ولا تُجيب من الآخر بصمت.',
      'en': 'The platform never switches provider by itself: when one fails '
          'it stops and names it, rather than quietly answering from the '
          'other.'
    },
    'providerPickHint': {
      'ar': 'الاختيار قرار المشغّل وحده، ويسري عند النداء التالي بلا إعادة '
          'تشغيل.',
      'en': 'The choice is the operator\'s alone, and takes effect on the '
          'next call with no restart.'
    },
    'providerSwitched': {'ar': 'تم تبديل المزوّد.', 'en': 'Provider switched.'},
    'keyMissing': {'ar': 'المفتاح غير مُعدّ', 'en': 'key missing'},
    'lastSuccess': {'ar': 'آخر نجاح', 'en': 'Last success'},
    'lastFailure': {'ar': 'آخر فشل', 'en': 'Last failure'},
    'mcpModel': {'ar': 'نموذج MCP', 'en': 'MCP model'},
    'verifyKey': {
      'ar': 'التحقق من المفتاح وعرض النماذج',
      'en': 'Verify key and list models'
    },
    'models': {'ar': 'النماذج', 'en': 'Models'},

    // ── Ads ───────────────────────────────────────────────────────
    'newAd': {'ar': 'إعلان جديد', 'en': 'New ad'},
    'noAds': {'ar': 'لا إعلانات.', 'en': 'No ads.'},
    'audience': {'ar': 'الجمهور', 'en': 'Audience'},
    'audience_all': {'ar': 'الجميع', 'en': 'Everyone'},
    'audience_subscribers': {'ar': 'المشتركون', 'en': 'Subscribers'},
    'audience_non_subscribers': {'ar': 'غير المشتركين', 'en': 'Non-subscribers'},
    'audience_trial': {'ar': 'الحسابات المجانية', 'en': 'Free accounts'},
    'slide': {'ar': 'شريحة', 'en': 'Slide'},
    'addSlide': {'ar': 'إضافة شريحة', 'en': 'Add slide'},
    'attachImage': {'ar': 'إرفاق صورة', 'en': 'Attach image'},
    'removeImage': {'ar': 'إزالة الصورة', 'en': 'Remove image'},
    'imageAnimated': {'ar': 'صورة متحرّكة', 'en': 'Animated'},
    'imageTooLarge': {
      'ar': 'الصورة أكبر من الحدّ المسموح.',
      'en': 'The image is over the size limit.'
    },
    'imageWrongType': {
      'ar': 'نوع الملف غير مقبول — PNG أو JPEG أو GIF أو WebP.',
      'en': 'Unsupported file type — PNG, JPEG, GIF or WebP.'
    },
    'uploadFailed': {'ar': 'تعذّر الرفع.', 'en': 'Upload failed.'},
    'adNeedsSlide': {
      'ar': 'الإعلان يحتاج شريحة واحدة على الأقل.',
      'en': 'An ad needs at least one slide.'
    },

    // ── Operations ────────────────────────────────────────────────
    'doctrineCounters': {'ar': 'عدّادات الالتزام', 'en': 'Doctrine counters'},
    'doctrineNote': {
      'ar': 'كل رقم هنا يعدّ خرقاً محتملاً لقواعد المنصة نفسها. الصفر هو '
          'الرقم الصحيح الوحيد.',
      'en': 'Each number counts a way the platform could have broken its own '
          'rules. Zero is the only good number.'
    },
    'auditTrail': {'ar': 'سجلّ الإجراءات', 'en': 'Audit trail'},
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
