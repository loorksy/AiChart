export const metadata = {
  title: "سياسة الخصوصية — AiChart",
  description: "كيف تتعامل AiChart مع بياناتك عبر المنصة وتكاملات الذكاء الاصطناعي.",
};

/** Privacy policy — required for the ChatGPT Apps store listing. */
export default function PrivacyPage() {
  return (
    <main dir="rtl" className="mx-auto max-w-3xl px-6 py-14 text-slate-200">
      <h1 className="mb-6 text-2xl font-bold text-white">سياسة الخصوصية</h1>
      <p className="mb-4 text-sm leading-7 text-slate-400">
        آخر تحديث: يوليو 2026 — تنطبق هذه السياسة على منصة AiChart
        (aichart.lork.cloud) وتكاملاتها مع مساعدي الذكاء الاصطناعي (Claude،
        ChatGPT) عبر بروتوكول MCP.
      </p>
      <section className="space-y-5 text-sm leading-7">
        <div>
          <h2 className="mb-1 font-semibold text-white">البيانات التي نجمعها</h2>
          <p>
            بيانات الحساب (البريد الإلكتروني، اسم المستخدم)، إعدادات التداول،
            التوصيات والرسومات المحفوظة على شارتاتك، وسجلّ استخدام أدوات
            التحليل. مفاتيح الوسطاء (MetaTrader) تُخزَّن مشفَّرة ولا
            تُشارَك مع أي طرف ثالث.
          </p>
        </div>
        <div>
          <h2 className="mb-1 font-semibold text-white">
            التكامل مع مساعدي الذكاء الاصطناعي
          </h2>
          <p>
            عند ربط حسابك بـ Claude أو ChatGPT عبر MCP، يُمنح المساعد وصولاً
            بحدود حسابك فقط (أسعار، شارتات، صفقاتك، رصيدك) بعد تسجيل دخولك
            وموافقتك عبر OAuth. يمكنك إلغاء الوصول في أي وقت من إعدادات
            المساعد أو من صفحة الاتصالات في المنصة.
          </p>
        </div>
        <div>
          <h2 className="mb-1 font-semibold text-white">أوامر التداول</h2>
          <p>
            أي أمر تنفيذ (فتح/إغلاق/تعديل صفقة) يمر عبر ضوابط إدارة المخاطر
            الخاصة بك ووضع الموافقة الذي تحدده. المنصة لا تنفّذ صفقات دون
            صلاحية صريحة منك.
          </p>
        </div>
        <div>
          <h2 className="mb-1 font-semibold text-white">مشاركة البيانات</h2>
          <p>
            لا نبيع بياناتك. تُستخدم خدمات طرف ثالث لتشغيل المنصة فقط: مزوّد
            نماذج الذكاء الاصطناعي (لتحليل السوق)، ومزوّدو بيانات الأسعار
            (OANDA/منصة الكريبتو)، ووسيطك عبر جسر MetaTrader الذي تُشغّله أنت.
          </p>
        </div>
        <div>
          <h2 className="mb-1 font-semibold text-white">حقوقك</h2>
          <p>
            يمكنك طلب حذف حسابك وبياناتك كاملةً بمراسلتنا. للدعم والاستفسارات:
            loorksy@gmail.com
          </p>
        </div>
      </section>
    </main>
  );
}
