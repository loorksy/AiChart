"use client";

import Link from "next/link";
import { Globe, ShieldCheck } from "lucide-react";
import { useLocale } from "@/components/LocaleProvider";
import { LonoraLogo } from "@/components/LonoraLogo";
import { BRAND_NAME } from "@/lib/brand";

export function LandingFooter() {
  const { t, locale } = useLocale();

  return (
    <footer className="border-t border-border/80 bg-background/50 py-12 px-4 backdrop-blur-md">
      <div className="mx-auto max-w-6xl space-y-10">
        
        {/* Top Section - Multi-Column */}
        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          
          {/* Column 1: Brand Info */}
          <div className="space-y-4">
            <Link href="/" className="flex items-center gap-2">
              <LonoraLogo size={24} showName nameClassName="text-base font-bold tracking-tight text-foreground" />
            </Link>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-xs">
              {locale === "ar"
                ? "منصة التداول الذكية المعتمدة على وكلاء الذكاء الاصطناعي لمراقبة الأسواق وتنفيذ الصفقات بأعلى كفاءة وأمان عبر MetaTrader 5."
                : "The intelligent AI-powered trading platform designed to monitor markets and execute trades with peak efficiency and safety on MetaTrader 5."}
            </p>
          </div>

          {/* Column 2: Company & Legal */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider">
              {locale === "ar" ? "الشركة والقانون" : "Company & Legal"}
            </h4>
            <ul className="space-y-2 text-xs">
              <li>
                <Link href="/p/privacy-policy" className="text-muted-foreground hover:text-primary transition-colors">
                  {locale === "ar" ? "سياسة الخصوصية" : "Privacy Policy"}
                </Link>
              </li>
              <li>
                <Link href="/p/terms-of-service" className="text-muted-foreground hover:text-primary transition-colors">
                  {locale === "ar" ? "الشروط والأحكام" : "Terms of Service"}
                </Link>
              </li>
              <li>
                <Link href="/p/user-agreement" className="text-muted-foreground hover:text-primary transition-colors">
                  {locale === "ar" ? "اتفاقية الاستخدام" : "User Agreement"}
                </Link>
              </li>
              <li>
                <Link href="/p/risk-disclosure" className="text-muted-foreground hover:text-primary transition-colors">
                  {locale === "ar" ? "إخلاء المسؤولية عن المخاطر" : "Risk Disclosure"}
                </Link>
              </li>
            </ul>
          </div>

          {/* Column 3: Resources & Community */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider">
              {locale === "ar" ? "المصادر والمجتمع" : "Resources & Community"}
            </h4>
            <ul className="space-y-2 text-xs">
              <li>
                <Link href="/p/about-us" className="text-muted-foreground hover:text-primary transition-colors">
                  {locale === "ar" ? "من نحن" : "About Us"}
                </Link>
              </li>
              <li>
                <Link href="/p/blog" className="text-muted-foreground hover:text-primary transition-colors">
                  {locale === "ar" ? "المدونة الرسمية" : "Official Blog"}
                </Link>
              </li>
              <li>
                <Link href="/p/contact-us" className="text-muted-foreground hover:text-primary transition-colors">
                  {locale === "ar" ? "تواصل معنا" : "Contact Us"}
                </Link>
              </li>
              <li>
                <a
                  href="https://discord.gg"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-primary transition-colors"
                >
                  Discord Community
                </a>
              </li>
              <li>
                <a
                  href="https://reddit.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-primary transition-colors"
                >
                  Reddit Community
                </a>
              </li>
            </ul>
          </div>

        </div>

        {/* Middle Section - Risk Disclaimer Disclaimer block */}
        <div className="rounded-xl border border-border bg-card/30 p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
            <span>{locale === "ar" ? "إخلاء مسؤولية المخاطر للتداول" : "Trading Risk Disclosure Disclaimer"}</span>
          </div>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            {locale === "ar"
              ? "تحذير: ينطوي التداول في الأسواق المالية والرافعة المالية (مثل صفقات الفيوتشرز) على مستويات عالية من المخاطر وقد يؤدي إلى خسارة كامل رأس المال. الأداء التاريخي لأي مؤشر أو بوت أو أداة لا يضمن ولا يتنبأ بالأداء المستقبلي. المنصة لا تقدم استشارات استثمارية."
              : "Warning: Trading in financial markets and utilizing leverage (e.g. Futures trading) involves high levels of risk and may result in the complete loss of capital. Historical performance of any indicator, bot, or tool does not guarantee or predict future performance. The platform does not provide investment advice."}
          </p>
        </div>

        {/* Bottom Section - Copyright */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 border-t border-border/40 text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} {BRAND_NAME}. {locale === "ar" ? "جميع الحقوق محفوظة." : "All rights reserved."}</p>
          <div className="flex items-center gap-1.5 font-medium text-foreground">
            <Globe className="h-3.5 w-3.5 text-primary" />
            <span>{locale === "ar" ? "العربية (RTL)" : "English (LTR)"}</span>
          </div>
        </div>

      </div>
    </footer>
  );
}
