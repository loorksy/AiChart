import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hasPlatformAccess } from "@/lib/platformAccess";
import { BRAND_NAME, BRAND_URL } from "@/lib/brand";
import LandingPage from "@/components/landing/LandingPage";

export const metadata: Metadata = {
  title: {
    absolute: `${BRAND_NAME} — شارت ومحادثة ذكية للتداول | AI Chart and Trading Conversation`,
  },
  description:
    "Lonora combines a live chart and an intelligent trading conversation, then prepares clear trade scenarios for review before MetaTrader execution. Analyze. Discuss. Execute with clarity.",
  alternates: {
    canonical: BRAND_URL,
  },
  openGraph: {
    title: `${BRAND_NAME} — AI Chart and Trading Conversation`,
    description:
      "A focused AI trading workspace: live chart, conversation, recommendations, and MetaTrader execution after your approval.",
    url: BRAND_URL,
    siteName: BRAND_NAME,
    type: "website",
    locale: "ar_SA",
    alternateLocale: ["en_US"],
    images: [{ url: "/icon-512.png", width: 512, height: 512, alt: BRAND_NAME }],
  },
  twitter: {
    card: "summary",
    title: `${BRAND_NAME} — AI Chart and Trading Conversation`,
    description:
      "Analyze the market, discuss the setup, and execute with clarity through MetaTrader after approval.",
    images: ["/icon-512.png"],
  },
};

export default async function Home() {
  const user = await getCurrentUser();
  if (user) {
    if (user.role !== "admin" && !hasPlatformAccess(user)) {
      redirect("/awaiting-approval");
    }
    redirect("/workspace");
  }

  return <LandingPage />;
}
