import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Manrope } from "next/font/google";
import localFont from "next/font/local";
import { Providers } from "./providers";
import "./globals.css";
import { LEGACY_LOCALE_COOKIE, LEGACY_THEME_COOKIE, MAKOTO_LOCALE_COOKIE, MAKOTO_THEME_COOKIE, resolvePreference } from "@/lib/preferences";

const manrope = Manrope({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-ui",
  display: "swap",
});

const robotoCondensed = localFont({
  src: "./fonts/RobotoCondensed-Variable.ttf",
  variable: "--font-vi-display",
  display: "swap",
  preload: false,
  weight: "100 900",
  style: "normal",
});

export async function generateMetadata(): Promise<Metadata> {
  const store = await cookies();
  const locale = resolvePreference(store.get(MAKOTO_LOCALE_COOKIE)?.value, store.get(LEGACY_LOCALE_COOKIE)?.value, ["en", "vi"] as const, "en");
  const title = locale === "vi" ? "Makoto Wallet — Ví mini cho Arc" : "Makoto Wallet — Mini wallet for Arc";
  const description = locale === "vi"
    ? "Ví không lưu ký trên Arc Testnet cho USDC và EURC, với Gửi, Nhận, Hoán đổi, Chuyển chuỗi và chuẩn bị thao tác có Makoto Agent."
    : "A non-custodial Arc Testnet wallet for USDC and EURC with Send, Receive, Swap, Bridge, and Makoto Agent preparation.";
  return {
    metadataBase: new URL("https://makoto-wallet.vercel.app"), title, description,
    alternates: { canonical: "/" },
    applicationName: "Makoto Wallet",
    icons: { icon: "/makoto/logo-pro-v2.png", apple: "/makoto/logo-pro-v2.png" },
    openGraph: { type: "website", url: "/", siteName: "Makoto Wallet", title, description, images: [{ url: "/makoto/logo-pro-v2.png", alt: "Makoto Wallet" }] },
    twitter: { card: "summary", title, description, images: ["/makoto/logo-pro-v2.png"] },
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const locale = resolvePreference(cookieStore.get(MAKOTO_LOCALE_COOKIE)?.value, cookieStore.get(LEGACY_LOCALE_COOKIE)?.value, ["en", "vi"] as const, "en");
  const theme = resolvePreference(cookieStore.get(MAKOTO_THEME_COOKIE)?.value, cookieStore.get(LEGACY_THEME_COOKIE)?.value, ["light", "dark", "system"] as const, "system");
  return (
    <html lang={locale} data-theme={theme}>
      <body className={`${manrope.variable} ${robotoCondensed.variable}`}>
        <Providers initialLocale={locale} initialTheme={theme}>{children}</Providers>
      </body>
    </html>
  );
}
