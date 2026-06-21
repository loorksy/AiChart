import { SurfaceCard } from "@/components/ui/shell";
import { useLocale } from "@/components/LocaleProvider";

export function LandingFeatures() {
  const { locale } = useLocale();

  const title = locale === "ar" ? "مزايا المنصة" : "Platform Features";

  const getFeatures = () => [
    {
      title: "Claude MCP",
      desc: locale === "ar"
        ? "أدوات تداول مباشرة داخل محادثة Claude — بدون واجهة معقدة."
        : "Direct trading tools right inside Claude chat — no complex interfaces.",
    },
    {
      title: "Risk Guard",
      desc: locale === "ar"
        ? "حدود رأس المال، وسقف الصفقات، وستوب لوز لحماية الرصيد."
        : "Capital limits, position caps, and stop loss parameter safeguards.",
    },
    {
      title: "Binance + MT5",
      desc: locale === "ar"
        ? "تداول العملات المشفرة (سبوت وفيوتشرز) وتداول الفوركس والمعادن."
        : "Trade crypto (Spot & Futures) and foreign exchange or metals.",
    },
    {
      title: "Telegram",
      desc: locale === "ar"
        ? "تنبيهات فورية وإرسال تقارير الأداء المالي للمشغّل."
        : "Instant notifications and financial performance reports.",
    },
    {
      title: "ديمو / حقيقي",
      desc: locale === "ar"
        ? "تداول تجريبي متاح بالكامل (تستنت) قبل تشغيل الصفقات الحقيقية."
        : "Fully available demo trading (testnet) before executing real positions.",
    },
    {
      title: "صلاحية ممتدة",
      desc: locale === "ar"
        ? "تحكم إداري كامل وإمكانية تجديد وتفعيل الصلاحيات من لوحة المشرف."
        : "Full administrative control and access renewal via the dashboard.",
    },
  ];

  return (
    <section id="features" className="border-t border-border bg-card/30 py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="mb-10 text-center text-2xl font-bold sm:text-3xl text-foreground">
          {title}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {getFeatures().map((f) => (
            <SurfaceCard key={f.title} className="h-full border border-border/80 bg-card/50 shadow-sm">
              <h3 className="font-semibold text-primary">{f.title}</h3>
              <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
            </SurfaceCard>
          ))}
        </div>
      </div>
    </section>
  );
}
