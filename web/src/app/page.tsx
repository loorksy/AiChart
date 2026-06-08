import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function Home() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  const features = [
    {
      title: "وكيل خبير صبور",
      desc: "يراقب السوق على مدار الساعة، ولا يدخل صفقة إلا عند الفرصة المناسبة — لا تداول عشوائي.",
    },
    {
      title: "توصيات أو تنفيذ",
      desc: "اختر بين تلقّي توصيات فقط، أو تفويض الوكيل بالتنفيذ ضمن حدودك الصارمة.",
    },
    {
      title: "أمان أولاً",
      desc: "مفاتيح Binance مشفّرة، صلاحية السحب ممنوعة، وحدود المخاطر مفروضة برمجياً.",
    },
    {
      title: "إشعارات تليجرام",
      desc: "تنبيهات فورية عند كل صفقة أو خبر عاجل، مع موافقة الصفقات من تليجرام مباشرة.",
    },
  ];

  return (
    <main className="flex-1">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="text-2xl font-extrabold">
          Ai<span className="text-[var(--accent)]">Chart</span>
        </div>
        <nav className="flex gap-3">
          <Link href="/login" className="btn btn-secondary">
            تسجيل الدخول
          </Link>
          <Link href="/register" className="btn btn-primary">
            إنشاء حساب
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-6 pt-12 pb-16 text-center">
        <p className="mb-4 inline-block rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-1 text-sm text-[var(--muted)]">
          مدعوم بـ Binance Skills Hub و Claude
        </p>
        <h1 className="mx-auto max-w-3xl text-4xl font-extrabold leading-tight sm:text-5xl">
          منصة تداول ذكية، يقودها وكيل
          <span className="text-[var(--accent)]"> وكأنه خبير 100 سنة</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-[var(--muted)]">
          تحدّث مع الوكيل، اتفقا على الأسلوب، ودعه يراقب سوق Binance بصبر. يتحرّك
          فقط حين يرى فرصة حقيقية — صفقة أو توصية، حسب اختيارك.
        </p>
        <div className="mt-8 flex justify-center gap-4">
          <Link href="/register" className="btn btn-primary px-6 py-3 text-lg">
            ابدأ الآن
          </Link>
          <Link href="/login" className="btn btn-secondary px-6 py-3 text-lg">
            لدي حساب
          </Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-20 sm:grid-cols-2 lg:grid-cols-4">
        {features.map((f) => (
          <div key={f.title} className="card p-6">
            <h3 className="mb-2 text-lg font-bold">{f.title}</h3>
            <p className="text-sm text-[var(--muted)]">{f.desc}</p>
          </div>
        ))}
      </section>

      <footer className="border-t border-[var(--border)] px-6 py-6 text-center text-sm text-[var(--muted)]">
        AiChart — للأغراض التعليمية. التداول ينطوي على مخاطر. ابدأ دائماً ببيئة
        Testnet.
      </footer>
    </main>
  );
}
