import type { Metadata } from "next";
import { Cairo, Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/ThemeProvider";
import { LocaleProvider } from "@/components/LocaleProvider";
import "./globals.css";

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

import { BRAND_NAME, BRAND_TAGLINE_AR } from "@/lib/brand";

export const metadata: Metadata = {
  title: `${BRAND_NAME} — ${BRAND_TAGLINE_AR}`,
  description:
    "منصة تداول ذكية، يتحدث فيها كل متداول مع وكيل خبير يراقب السوق ويتحرك عند الفرصة المناسبة فقط.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${cairo.variable} ${fraunces.variable} ${inter.variable} ${jetbrainsMono.variable} dark h-full antialiased`}
      style={{ colorScheme: "dark" }}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background">
        <LocaleProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}

