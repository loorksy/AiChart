import { BRAND_DOMAIN, BRAND_NAME } from "@/lib/brand";

export const metadata = {
  title: "سياسة الخصوصية — Lonora",
  description: "كيف تتعامل Lonora مع بياناتك عبر المنصة وتكاملات الذكاء الاصطناعي.",
};

/** Privacy policy — required for the ChatGPT Apps store listing. */
export default function PrivacyPage() {
  return (
    <main dir="rtl" className="mx-auto max-w-3xl bg-background px-6 py-14 text-foreground">
      <h1 className="mb-6 text-2xl font-bold text-foreground">سياسة الخصوصية</h1>
      <p className="mb-4 text-sm leading-7 text-muted-foreground">
        آخر تحديث: يوليو 2026 — تنطبق هذه السياسة على منصة {BRAND_NAME}
        {" "}({BRAND_DOMAIN}) وتكاملاتها مع مساعدي الذكاء الاصطناعي (Claude،
        ChatGPT) عبر موصل آمن.
      </p>
      <section className="space-y-5 text-sm leading-7 text-foreground/90">
        <div>
          <h2 className="mb-1 font-semibold text-foreground">البيانات التي نجمعها</h2>
          <p>
            بيانات الحساب (البريد الإلكتروني، اسم المستخدم)، إعدادات التداول،
            التوصيات والرسومات المحفوظة على شارتاتك، وسجلّ استخدام أدوات
            التحليل. مفاتيح الوسطاء (MetaTrader) تُخزَّن مشفَّرة ولا
            تُشارَك مع أي طرف ثالث.
          </p>
        </div>
        <div>
          <h2 className="mb-1 font-semibold text-foreground">
            التكامل مع مساعدي الذكاء الاصطناعي
          </h2>
          <p>
            عند ربط حسابك بـ Claude أو ChatGPT عبر الموصل، يُمنح المساعد وصولاً
            بحدود حسابك فقط (أسعار، شارتات، صفقاتك، رصيدك) بعد تسجيل دخولك
            وموافقتك عبر OAuth. يمكنك إلغاء الوصول في أي وقت من إعدادات
            المساعد أو من صفحة الاتصالات في المنصة.
          </p>
        </div>
        <div>
          <h2 className="mb-1 font-semibold text-foreground">أوامر التداول</h2>
          <p>
            أي أمر تنفيذ (فتح/إغلاق/تعديل صفقة) يمر عبر ضوابط إدارة المخاطر
            الخاصة بك ووضع الموافقة الذي تحدده. المنصة لا تنفّذ صفقات دون
            صلاحية صريحة منك.
          </p>
        </div>
        <div>
          <h2 className="mb-1 font-semibold text-foreground">مشاركة البيانات</h2>
          <p>
            لا نبيع بياناتك. تُستخدم خدمات طرف ثالث لتشغيل المنصة فقط: مزوّد
            نماذج الذكاء الاصطناعي (لتحليل السوق)، وخدمة MetaApi السحابية التي
            تصل حساب MetaTrader الخاص بك (المصدر الوحيد للأسعار المعروضة على
            شارتك وقرارات التداول الحية)، ومزوّد بيانات OANDA الذي نستخدمه
            داخلياً كمرجع سعري لأغراض تحليلية فقط — يشمل ذلك اختبار
            الاستراتيجيات وأدوات المراقبة وتحليلات الوكيل الكمّي والمستويات
            التي تقترحها — ولا يظهر أبداً على شارتك ولا يُستخدم في تنفيذ
            صفقاتك، ووسيطك عبر جسر MetaTrader الذي تُشغّله أنت.
          </p>
        </div>
        <div>
          <h2 className="mb-1 font-semibold text-foreground">حقوقك</h2>
          <p>
            يمكنك طلب حذف حسابك وبياناتك كاملةً بمراسلتنا. للدعم والاستفسارات:
            loorksy@gmail.com
          </p>
        </div>
      </section>
    </main>
  );
}
