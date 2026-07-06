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
  Cpu,
  Bot,
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
  accentColor?: string;
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
        "group relative overflow-hidden rounded-2xl border border-white/5 bg-[#09090b]/80 backdrop-blur-xl p-6 transition-all duration-300",
        "hover:border-white/15 hover:shadow-[0_20px_60px_rgba(0,0,0,0.6)] hover:-translate-y-1",
        colSpanClass[item.colSpan || 2],
        item.hasPersistentHover && "border-white/15 shadow-[0_20px_60px_rgba(0,0,0,0.6)] -translate-y-1"
      )}
      style={{
        "--mouse-x": `${mousePosition.x}px`,
        "--mouse-y": `${mousePosition.y}px`,
      } as React.CSSProperties}
    >
      {/* Gradient Glow */}
      <div
        className={cn(
          "pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300",
          item.hasPersistentHover ? "opacity-100" : "group-hover:opacity-100"
        )}
        style={{
          background: `radial-gradient(400px circle at var(--mouse-x) var(--mouse-y), ${item.accentColor}10, transparent 40%)`,
        }}
      />

      {/* Dot Pattern */}
      <div
        className={cn(
          "absolute inset-0 opacity-0 transition-opacity duration-300",
          item.hasPersistentHover ? "opacity-100" : "group-hover:opacity-100"
        )}
        style={{
          backgroundImage:
            "radial-gradient(circle at center, rgba(255,255,255,0.015) 1px, transparent 1px)",
          backgroundSize: "16px 16px",
        }}
      />

      {/* Content */}
      <div className="relative z-10 flex flex-col h-full justify-between">
        <div>
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center border transition-all duration-300"
              style={{
                background: `${item.accentColor}12`,
                borderColor: `${item.accentColor}25`,
                color: item.accentColor,
              }}
            >
              {item.icon}
            </div>
            {item.status && (
              <span className="text-[10px] font-mono tracking-wider px-2 py-0.5 rounded-lg bg-white/5 text-white/60 border border-white/5">
                {item.status}
              </span>
            )}
          </div>

          {/* Big Stat */}
          {item.bigStat && (
            <div className="mb-4">
              <div
                className="text-4xl font-bold tracking-tight mb-0.5"
                style={{ color: item.accentColor }}
              >
                {item.bigStat.value}
              </div>
              <div className="text-[9px] font-mono tracking-wider text-white/40 uppercase">
                {item.bigStat.label}
              </div>
            </div>
          )}

          {/* Title & Description */}
          <div className="mb-4">
            <h3 className="text-base font-semibold text-white mb-1.5 flex items-center gap-2">
              {item.title}
              {item.meta && (
                <span className="text-[10px] font-mono text-white/30">
                  {item.meta}
                </span>
              )}
            </h3>
            <p className="text-xs text-white/50 leading-relaxed">
              {item.description}
            </p>
          </div>
        </div>

        {/* Tags */}
        {item.tags && (
          <div className="flex flex-wrap gap-1.5 mt-auto pt-2">
            {item.tags.map((tag) => (
              <span
                key={tag}
                className="text-[9px] font-mono tracking-wider px-2 py-0.5 rounded-md border transition-all duration-200"
                style={{
                  color: item.accentColor,
                  background: `${item.accentColor}08`,
                  borderColor: `${item.accentColor}15`,
                }}
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Border Glow */}
      <div
        className={cn(
          "absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 pointer-events-none",
          item.hasPersistentHover ? "opacity-100" : "group-hover:opacity-100"
        )}
        style={{
          background: `linear-gradient(${isRtl ? "270deg" : "90deg"}, ${item.accentColor}25, transparent)`,
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
      title: isRtl ? "ربط كلاود MCP" : "Claude MCP Integration",
      description: isRtl
        ? "تحليل ذكي متطور للسوق باستخدام بروتوكول Claude Model Context للحصول على رؤى تداول فورية وتحليلات تنبؤية."
        : "Advanced AI-powered market analysis using Claude's Model Context Protocol for real-time trading insights and predictive analytics.",
      icon: <Brain className="w-5 h-5" />,
      status: isRtl ? "مباشر" : "Live",
      tags: isRtl ? ["ذكاء_اصطناعي", "MCP", "تحليل"] : ["AI", "MCP", "Analysis"],
      meta: "v3.2.1",
      hasPersistentHover: true,
      accentColor: "#8b5cf6",
      bigStat: { value: "99.7%", label: isRtl ? "الدقة" : "Accuracy" },
    },
    {
      id: "2",
      colSpan: 3,
      title: isRtl ? "اتصالات MetaTrader 5" : "MetaTrader 5 Connectors",
      description: isRtl
        ? "ربط وتكامل سلس مع MetaTrader 5 عبر EA أو MetaApi. نفّذ الصفقات بزمن استجابة منخفض."
        : "Seamless MetaTrader 5 integration via EA or MetaApi. Execute trades with low latency.",
      icon: <TrendingUp className="w-5 h-5" />,
      status: isRtl ? "نشط" : "Active",
      tags: isRtl ? ["MT5", "EA", "MetaApi"] : ["MT5", "EA", "MetaApi"],
      meta: isRtl ? "فوركس" : "Forex",
      accentColor: "#f59e0b",
    },
    {
      id: "3",
      colSpan: 2,
      title: isRtl ? "الوكلاء المستقلون" : "Autonomous Agents",
      description: isRtl
        ? "روبوتات تداول ذاتية التعلم تتكيف مع ظروف السوق المتغيرة في الوقت الفعلي."
        : "Self-learning trading bots that adapt to market conditions in real-time.",
      icon: <Bot className="w-5 h-5" />,
      tags: isRtl ? ["أتمتة", "تعلم_الآلة"] : ["Automation", "ML"],
      meta: "24/7",
      accentColor: "#10b981",
    },
    {
      id: "4",
      colSpan: 2,
      title: isRtl ? "إدارة المخاطر" : "Risk Management",
      description: isRtl
        ? "حماية متقدمة للمحفظة الاستثمارية باستخدام خوارزميات تحديد حجم الصفقات ووقف الخسارة الديناميكي."
        : "Advanced portfolio protection with dynamic stop-loss and position sizing algorithms.",
      icon: <Shield className="w-5 h-5" />,
      status: isRtl ? "محمي" : "Protected",
      tags: isRtl ? ["أمان", "مخاطر"] : ["Security", "Risk"],
      accentColor: "#ef4444",
    },
    {
      id: "5",
      colSpan: 2,
      title: isRtl ? "التحليلات الفورية" : "Real-time Analytics",
      description: isRtl
        ? "معالجة بيانات السوق الحية بزمن استجابة يقل عن الثانية مع النمذجة التنبؤية."
        : "Live market data processing with sub-second latency and predictive modeling.",
      icon: <Activity className="w-5 h-5" />,
      tags: isRtl ? ["بيانات", "بث"] : ["Data", "Streaming"],
      meta: "< 100ms",
      accentColor: "#06b6d4",
    },
    {
      id: "6",
      colSpan: 3,
      title: isRtl ? "مؤشرات الأداء" : "Performance Metrics",
      description: isRtl
        ? "لوحة تحليلات تداول شاملة مع تتبع الأرباح والخسائر ونسب النجاح ورؤى تحسين الاستراتيجية."
        : "Comprehensive trading analytics dashboard with P&L tracking, win rates, and strategy optimization insights.",
      icon: <BarChart3 className="w-5 h-5" />,
      status: isRtl ? "مراقبة" : "Monitoring",
      tags: isRtl ? ["تحليلات", "تقارير", "أداء"] : ["Analytics", "Reports", "KPI"],
      meta: isRtl ? "مباشر" : "Live",
      accentColor: "#3b82f6",
    },
    {
      id: "7",
      colSpan: 3,
      title: isRtl ? "محرك الشبكة العصبية" : "Neural Network Engine",
      description: isRtl
        ? "نماذج تعلم عميق مدربة على البيانات التاريخية لتحديد الأنماط وتحسين استراتيجيات التداول عبر ظروف السوق المختلفة."
        : "Deep learning models trained on historical data to identify patterns and optimize trading strategies across market conditions.",
      icon: <Cpu className="w-5 h-5" />,
      tags: isRtl ? ["ذكاء_اصطناعي", "تعلم_عميق"] : ["AI", "Deep Learning"],
      meta: isRtl ? "تسريع GPU" : "GPU Accelerated",
      accentColor: "#ec4899",
    },
  ];

  const colSpanClass: Record<number, string> = {
    2: "md:col-span-2",
    3: "md:col-span-3",
    4: "md:col-span-4",
    6: "md:col-span-6",
  };

  return (
    <section id="features" className="relative border-t border-white/5 bg-[#030303] py-16 sm:py-24 overflow-hidden">
      {/* Background radial glow */}
      <div className="absolute inset-0 -z-10">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(139, 92, 246, 0.08), transparent 60%), radial-gradient(ellipse 60% 80% at 10% 80%, rgba(59, 130, 246, 0.05), transparent 70%)",
          }}
        />
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.03) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={mounted ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-white/10 bg-white/5 backdrop-blur-sm mb-4">
            <Zap className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
            <span className="text-[10px] font-mono tracking-wider text-white/70 uppercase">
              {isRtl ? "مجموعة الميزات الممتازة" : "PREMIUM TRADING SUITE"}
            </span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4 bg-gradient-to-br from-white via-white to-white/40 bg-clip-text text-transparent">
            {isRtl ? "مزايا المنصة والحلول الذكية" : "Next-Gen Trading Platform"}
          </h2>
          <p className="text-sm text-white/50 max-w-2xl mx-auto leading-relaxed">
            {isRtl
              ? "استفد من قوة وكلاء التداول الموجهين بالذكاء الاصطناعي مع ربط Claude MCP المتقدم والتنفيذ الفوري بين المنصات."
              : "Harness the power of AI-driven trading agents with Claude MCP integration, multi-exchange connectivity, and autonomous execution."}
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
