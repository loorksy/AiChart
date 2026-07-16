"use client";

import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { useLocale } from "@/components/LocaleProvider";
import {
  Brain,
  TrendingUp,
  Zap,
  Shield,
  Activity,
  BarChart3,
  MessageSquareText,
  Scale,
} from "lucide-react";

interface BentoItem {
  id: string;
  colSpan?: 2 | 3 | 4 | 6;
  title: string;
  description: string;
  icon: React.ReactNode;
  status?: string;
  tags?: string[];
  meta?: string;
  bigStat?: { value: string; label: string };
  hasPersistentHover?: boolean;
}

function BentoCard({
  item,
  index,
  mounted,
  colSpanClass,
  isRtl,
}: {
  item: BentoItem;
  index: number;
  mounted: boolean;
  colSpanClass: Record<number, string>;
  isRtl: boolean;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = card.getBoundingClientRect();
      setMousePosition({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    };

    card.addEventListener("mousemove", handleMouseMove);
    return () => card.removeEventListener("mousemove", handleMouseMove);
  }, []);

  return (
    <motion.div
      ref={cardRef}
      initial={{ opacity: 0, y: 20 }}
      animate={mounted ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      className={cn(
        "glass-card group relative overflow-hidden p-6 transition-all duration-300",
        "hover:-translate-y-1 hover:border-primary/35",
        colSpanClass[item.colSpan || 2],
        item.hasPersistentHover && "-translate-y-1 border-primary/35",
      )}
      style={{
        "--mouse-x": `${mousePosition.x}px`,
        "--mouse-y": `${mousePosition.y}px`,
      } as React.CSSProperties}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300",
          item.hasPersistentHover ? "opacity-100" : "group-hover:opacity-100",
        )}
        style={{
          background:
            "radial-gradient(400px circle at var(--mouse-x) var(--mouse-y), color-mix(in srgb, var(--primary) 12%, transparent), transparent 40%)",
        }}
      />

      <div
        className={cn(
          "absolute inset-0 opacity-0 transition-opacity duration-300",
          item.hasPersistentHover ? "opacity-100" : "group-hover:opacity-100",
        )}
        style={{
          backgroundImage:
            "radial-gradient(circle at center, rgba(255,255,255,0.015) 1px, transparent 1px)",
          backgroundSize: "16px 16px",
        }}
      />

      <div className="relative z-10 flex h-full flex-col justify-between">
        <div>
          <div className="mb-4 flex items-start justify-between">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary transition-all duration-300">
              {item.icon}
            </div>
            {item.status && (
              <span className="rounded-lg border border-border bg-muted/40 px-2 py-0.5 font-mono text-[10px] tracking-wider text-muted-foreground">
                {item.status}
              </span>
            )}
          </div>

          {item.bigStat && (
            <div className="mb-4">
              <div className="mb-0.5 text-4xl font-bold tracking-tight text-primary">
                {item.bigStat.value}
              </div>
              <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                {item.bigStat.label}
              </div>
            </div>
          )}

          <div className="mb-4">
            <h3 className="mb-1.5 flex items-center gap-2 text-base font-semibold text-foreground">
              {item.title}
              {item.meta && (
                <span className="font-mono text-[10px] text-muted-foreground/70">
                  {item.meta}
                </span>
              )}
            </h3>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {item.description}
            </p>
          </div>
        </div>

        {item.tags && (
          <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
            {item.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-md border border-primary/20 bg-primary/5 px-2 py-0.5 font-mono text-[9px] tracking-wider text-primary"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div
        className={cn(
          "pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300",
          item.hasPersistentHover ? "opacity-100" : "group-hover:opacity-100",
        )}
        style={{
          background: `linear-gradient(${isRtl ? "270deg" : "90deg"}, color-mix(in srgb, var(--primary) 20%, transparent), transparent)`,
          maskImage:
            "linear-gradient(to bottom, transparent, black 20%, black 80%, transparent)",
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent, black 20%, black 80%, transparent)",
        }}
      />
    </motion.div>
  );
}

export function LandingFeatures() {
  const { locale } = useLocale();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isRtl = locale === "ar";

  const getBentoItems = (): BentoItem[] => [
    {
      id: "1",
      colSpan: 3,
      title: isRtl ? "قرار ذكاء واحد" : "One AI Decision",
      description: isRtl
        ? "يحلّل AiChart سياق الشارت ويصدر قراراً واضحاً واحداً: BUY أو SELL أو WAIT، مع الأسباب ومستوى الثقة."
        : "AiChart analyzes the chart context and returns one clear decision: BUY, SELL, or WAIT, with reasons and confidence.",
      icon: <Brain className="w-5 h-5" />,
      status: isRtl ? "مرجعي" : "Canonical",
      tags: isRtl ? ["قرار", "أسباب", "ثقة"] : ["Decision", "Reasons", "Confidence"],
      meta: "Scalping",
      hasPersistentHover: true,
      bigStat: { value: "1", label: isRtl ? "سلطة القرار" : "Decision authority" },
    },
    {
      id: "2",
      colSpan: 3,
      title: isRtl ? "اتصالات MetaTrader 5" : "MetaTrader 5 Connectors",
      description: isRtl
        ? "اربط حساب MetaTrader 5 عبر EA أو MetaApi، ثم نفّذ القرار بعد موافقتك واجتياز فحوص الاتصال والسعر."
        : "Connect MetaTrader 5 through EA or MetaApi, then execute after your approval and connection and price checks.",
      icon: <TrendingUp className="w-5 h-5" />,
      status: isRtl ? "متاح" : "Available",
      tags: isRtl ? ["MT5", "EA", "MetaApi"] : ["MT5", "EA", "MetaApi"],
      meta: isRtl ? "فوركس" : "Forex",
    },
    {
      id: "3",
      colSpan: 2,
      title: isRtl ? "مساحة عمل موحّدة" : "Unified Workspace",
      description: isRtl
        ? "الشارت والمحادثة والرسومات وسجل التوصيات في سياق واحد يمكنك مراجعته قبل أي تنفيذ."
        : "Chart, chat, drawings, and recommendation history stay in one reviewable context before execution.",
      icon: <MessageSquareText className="w-5 h-5" />,
      tags: isRtl ? ["شارت", "محادثة"] : ["Chart", "Chat"],
      meta: isRtl ? "سياق واحد" : "One context",
    },
    {
      id: "4",
      colSpan: 2,
      title: isRtl ? "إدارة المخاطر" : "Risk Management",
      description: isRtl
        ? "إعداد Risk per Trade يحدّد حجم الصفقة فقط وفق Equity ووقف الخسارة، ولا يغيّر رأي السوق."
        : "Risk per Trade sizes the position from equity and stop distance only; it never changes the market opinion.",
      icon: <Scale className="w-5 h-5" />,
      status: isRtl ? "محدود" : "Bounded",
      tags: isRtl ? ["حجم_الصفقة", "مخاطرة"] : ["Position size", "Risk"],
    },
    {
      id: "5",
      colSpan: 2,
      title: isRtl ? "سياق سوق حديث" : "Fresh Market Context",
      description: isRtl
        ? "يستخدم التحليل بيانات الشارت والسعر والحساب المتاحة لحظة الطلب، مع توضيح النقص بدلاً من اختلاق يقين."
        : "Analysis uses the chart, price, and account context available at request time, and exposes missing context instead of inventing certainty.",
      icon: <Activity className="w-5 h-5" />,
      tags: isRtl ? ["بيانات", "شفافية"] : ["Data", "Transparency"],
      meta: isRtl ? "عند الطلب" : "On request",
    },
    {
      id: "6",
      colSpan: 3,
      title: isRtl ? "أداء موثّق" : "Tracked Performance",
      description: isRtl
        ? "تُحفظ التوصيات ونتائجها لبناء إحصاءات تاريخية قابلة للمراجعة؛ الأداء السابق ليس وعداً للمستقبل."
        : "Recommendations and outcomes build reviewable historical statistics; past performance is never a promise of future results.",
      icon: <BarChart3 className="w-5 h-5" />,
      status: isRtl ? "تاريخي" : "Historical",
      tags: isRtl ? ["إحصاءات", "نتائج", "مراجعة"] : ["Statistics", "Outcomes", "Review"],
      meta: isRtl ? "بدون ضمان" : "No guarantee",
    },
    {
      id: "7",
      colSpan: 3,
      title: isRtl ? "حماية التنفيذ" : "Execution Safety",
      description: isRtl
        ? "المصادقة والموافقة الصريحة وفحص السعر الحديث ومنع تكرار الطلب تحمي التنفيذ من دون تعديل القرار التحليلي."
        : "Authentication, explicit confirmation, fresh-price checks, and idempotency protect execution without altering the analysis decision.",
      icon: <Shield className="w-5 h-5" />,
      tags: isRtl ? ["موافقة", "سعر_حديث", "منع_التكرار"] : ["Approval", "Fresh price", "Idempotency"],
      meta: isRtl ? "قبل التنفيذ" : "Pre-execution",
    },
  ];

  const colSpanClass: Record<number, string> = {
    2: "md:col-span-2",
    3: "md:col-span-3",
    4: "md:col-span-4",
    6: "md:col-span-6",
  };

  return (
    <section id="features" className="relative overflow-hidden border-t border-border/60 py-16 sm:py-24">
      <div className="absolute inset-0 -z-10">
        <div className="absolute inset-x-0 top-0 mx-auto h-[320px] w-[640px] rounded-full bg-primary/8 blur-[100px]" />
      </div>

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={mounted ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="mb-12 text-center"
        >
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/5 px-3 py-1 backdrop-blur-sm">
            <Zap className="h-3.5 w-3.5 text-primary" />
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {isRtl ? "مجموعة الميزات الممتازة" : "PREMIUM TRADING SUITE"}
            </span>
          </div>
          <h2 className="mb-4 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {isRtl ? "مزايا المنصة والحلول الذكية" : "Next-Gen Trading Platform"}
          </h2>
          <p className="mx-auto max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {isRtl
              ? "استخدم مساعد تداول واحداً يجمع المحادثة والشارت والاتصال بحسابك في تجربة واضحة."
              : "Use one trading assistant that combines chat, chart, and account connectivity in a clear experience."}
          </p>
        </motion.div>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
          {getBentoItems().map((item, index) => (
            <BentoCard
              key={item.id}
              item={item}
              index={index}
              mounted={mounted}
              colSpanClass={colSpanClass}
              isRtl={isRtl}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
