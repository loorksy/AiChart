import type { Metadata, Viewport } from "next";
import { Cairo, Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/ThemeProvider";
import { LocaleProvider } from "@/components/LocaleProvider";
import { SkipLink } from "@/components/SkipLink";
import { CookieConsent } from "@/components/CookieConsent";
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

import { BRAND_NAME, BRAND_TAGLINE_AR, BRAND_URL } from "@/lib/brand";

export const metadata: Metadata = {
  metadataBase: new URL(BRAND_URL),
  title: `${BRAND_NAME} — ${BRAND_TAGLINE_AR}`,
  description:
    "منصة تداول ذكية، يتحدث فيها كل متداول مع وكيل خبير يراقب السوق ويتحرك عند الفرصة المناسبة فقط.",
  applicationName: BRAND_NAME,
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
    { media: "(prefers-color-scheme: light)", color: "#f7f7f8" },
  ],
};

/** Runs before paint to avoid wrong-theme flash (matches ThemeProvider storage key). */
const THEME_BOOT_SCRIPT = `(function(){try{var k='aichart-theme';var s=localStorage.getItem(k);var d=document.documentElement;var dark=true;if(s==='light')dark=false;else if(s==='system')dark=window.matchMedia('(prefers-color-scheme: dark)').matches;else if(s==='dark')dark=true;d.classList.toggle('dark',dark);d.style.colorScheme=dark?'dark':'light';}catch(e){}})();`;

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
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-background">
        <LocaleProvider>
          <ThemeProvider>
            <SkipLink />
            <div
              id="main-content"
              tabIndex={-1}
              className="flex min-h-full flex-1 flex-col outline-none"
            >
              {children}
            </div>
            <CookieConsent />
          </ThemeProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
