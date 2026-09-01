import { BRAND_DOMAIN, BRAND_NAME } from "@/lib/brand";
import { DISPLAY_NAME_AR } from "@/lib/gold";
import { SEO_CONTACT_EMAIL, pageMetadata } from "@/lib/seo";
import {
  PUBLIC_MAIN_PAD,
  PublicChrome,
} from "@/components/landing/PublicChrome";
import { cn } from "@/lib/utils";

export const metadata = pageMetadata("privacy");

/** Privacy policy — required for the ChatGPT Apps store listing. */
export default function PrivacyPage() {
  return (
    <PublicChrome skipTargetId="privacy-main" showFooter>
      <main
        id="privacy-main"
        tabIndex={-1}
        dir="rtl"
        className={cn(PUBLIC_MAIN_PAD, "mx-auto max-w-3xl")}
      >
        <h1 className="mb-6 text-2xl font-bold text-white">سياسة الخصوصية</h1>
        <p className="mb-4 text-sm leading-7 text-white/60">
          آخر تحديث: أغسطس 2026 — تنطبق هذه السياسة على منصة {BRAND_NAME}
          {" "}({BRAND_DOMAIN}). {BRAND_NAME} مساحة تحليل وتوصيات ل{DISPLAY_NAME_AR}
          فقط: شارت حي ومحادثة ذكية. المنصة لا تنفّذ صفقات ولا تحتفظ بحساب وسيط.
        </p>
        <section className="space-y-5 text-sm leading-7 text-white/80">
          <div>
            <h2 className="mb-1 font-semibold text-white">البيانات التي نجمعها</h2>
            <p>
              بيانات الحساب (البريد الإلكتروني، اسم المستخدم)، محادثات الوكيل،
              التوصيات والرسومات المحفوظة على الشارت، وسجلّ استخدام أدوات التحليل.
              لا نطلب بيانات دخول وسيط لأن المنصة لا تفتح ولا تعدّل ولا تغلق صفقات.
            </p>
          </div>
          <div>
            <h2 className="mb-1 font-semibold text-white">
              التكامل مع مساعدي الذكاء الاصطناعي
            </h2>
            <p>
              عند استخدام الوكيل داخل المنصة، أو عند ربط حسابك بـ Claude أو ChatGPT
              عبر الموصل، يُمنح المساعد وصولاً بحدود حسابك فقط (سياق التحليل
              والتوصيات) بعد تسجيل دخولك وموافقتك. يمكنك إلغاء الوصول في أي وقت
              من إعدادات المساعد أو من المنصة.
            </p>
          </div>
          <div>
            <h2 className="mb-1 font-semibold text-white">التوصيات وليس التنفيذ</h2>
            <p>
              {BRAND_NAME} تصدر بطاقات توصية للمراجعة (دخول ووقف وهدف). أي قرار
              تداول وتنفيذه يتم خارج المنصة وعلى مسؤوليتك. لا يوجد مسار يرسل أمراً
              إلى وسيط.
            </p>
          </div>
          <div>
            <h2 className="mb-1 font-semibold text-white">مشاركة البيانات</h2>
            <p>
              لا نبيع بياناتك. تُستخدم خدمات طرف ثالث لتشغيل المنصة فقط: مزوّد
              نماذج الذكاء الاصطناعي لتحليل السوق، ومصدر أسعار المنصة لقراءة
              السوق. لا نشارك بياناتك لتنفيذ صفقات.
            </p>
          </div>
          <div>
            <h2 className="mb-1 font-semibold text-white">حقوقك</h2>
            <p>
              يمكنك طلب حذف حسابك وبياناتك كاملةً بمراسلتنا. للدعم والاستفسارات:{" "}
              {SEO_CONTACT_EMAIL}
            </p>
          </div>
        </section>
      </main>
    </PublicChrome>
  );
}
