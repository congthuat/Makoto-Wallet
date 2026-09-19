"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { WalletControl } from "./WalletControl";
import { LanguageMenu } from "./LanguageMenu";
import { usePreferences } from "@/hooks/usePreferences";
import styles from "./AppHeader.module.css";

type HeaderIconName = "wallet" | "activity" | "settings" | "network" | "language" | "theme" | "sun" | "address";
const navItems: ReadonlyArray<{ href: string; icon: HeaderIconName; en: string; vi: string }> = [
  { href: "/", icon: "wallet", en: "Overview", vi: "Tổng quan" },
  { href: "/#activity", icon: "activity", en: "Activity", vi: "Hoạt động" },
  { href: "/agent", icon: "activity", en: "Agent", vi: "Trợ lý" },
  { href: "/settings#security", icon: "settings", en: "Settings", vi: "Cài đặt" },
  { href: "/settings#help", icon: "activity", en: "Help & Support", vi: "Trợ giúp" },
];

function HeaderIcon({ name, className }: { name: HeaderIconName; className: string }) {
  const glyphs: Record<HeaderIconName, ReactNode> = {
    wallet: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M16 10h5v5h-5a2.5 2.5 0 0 1 0-5Z" /><path d="M5 6V5a2 2 0 0 1 2-2h10" /><circle cx="16.5" cy="12.5" r=".5" /></>,
    activity: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v3M22 12h-3M12 22v-3M2 12h3" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1v.1h-4v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1-.4h-.1v-4H3a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1v-.1h4V3a1.7 1.7 0 0 0 1.1 1.6 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.12.36.33.7.6 1 .27.27.62.48 1 .6h.1v4H21a1.7 1.7 0 0 0-1.6.4Z" /></>,
    network: <><circle cx="6" cy="7" r="2" /><circle cx="18" cy="7" r="2" /><circle cx="12" cy="18" r="2" /><path d="m7.7 8.1 3.2 7.8M16.3 8.1l-3.2 7.8M8 7h8" /></>,
    language: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></>,
    theme: <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z" />,
    sun: <><circle cx="12" cy="12" r="3.5" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" /></>,
    address: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18M7 14h4" /><circle cx="17" cy="14" r="1" /></>,
  };
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{glyphs[name]}</svg>;
}

export function AppHeader() {
  const { locale, theme, setTheme, t } = usePreferences();
  const pathname = usePathname();
  const [hash, setHash] = useState("");
  useEffect(() => { const updateHash = () => setHash(window.location.hash); updateHash(); window.addEventListener("hashchange", updateHash); return () => window.removeEventListener("hashchange", updateHash); }, [pathname]);
  function isActive(href: string) { const [route, fragment] = href.split("#"); if (!fragment) return pathname === route && !hash; return pathname === route && (hash === `#${fragment}` || (href === "/settings#security" && !hash)); }
  function toggleTheme() { if (theme === "light") return setTheme("dark"); if (theme === "dark") return setTheme("light"); setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "light" : "dark"); }
  const toggleLabel = theme === "light" ? t("preferences.switchDark") : theme === "dark" ? t("preferences.switchLight") : t("preferences.systemMode");

  return <header className={styles.header}>
    <div className={styles.topRow}>
      <Link className={styles.brand} href="/" aria-label="Makoto Wallet"><Image src="/makoto/logo-pro-v2.png" width={52} height={52} alt="" className={styles.brandLogo} priority /><span className={styles.brandWords}><strong>Makoto</strong><small>WALLET</small></span></Link>
      <div className={styles.headerActions}>
        <span className={styles.networkPill} role="status"><HeaderIcon name="network" className={`${styles.pillGlyph} ${styles.networkGlyph}`} /><span>Arc Testnet</span></span>
        <LanguageMenu icon={<HeaderIcon name="language" className={`${styles.pillGlyph} ${styles.languageGlyph}`} />} />
        <button className={styles.themeButton} type="button" onClick={toggleTheme} aria-label={toggleLabel} title={toggleLabel}><HeaderIcon name={theme === "dark" ? "sun" : "theme"} className={`${styles.pillGlyph} ${styles.themeGlyph}`} /></button>
        <div className={styles.walletControlWrap}><HeaderIcon name="address" className={`${styles.pillGlyph} ${styles.addressGlyph}`} /><WalletControl /></div>
      </div>
    </div>
    <nav className={styles.nav} aria-label={locale === "vi" ? "Điều hướng chính" : "Primary navigation"}>
      {navItems.map((item) => <Link key={item.en} className={`${styles.navLink} ${isActive(item.href) ? styles.navActive : ""}`.trim()} href={item.href} aria-current={isActive(item.href) ? "page" : undefined} onNavigate={() => setHash(item.href.includes("#") ? `#${item.href.split("#")[1]}` : "")}><HeaderIcon name={item.icon} className={styles.headerGlyph} /><span>{locale === "vi" ? item.vi : item.en}</span></Link>)}
      <a className={styles.feedbackLink} href="https://docs.google.com/forms/d/e/1FAIpQLSfH_cQv0Gkxy604YcpVHpitSfoWbF5_ud3f5WG_Jc4d7A6nVg/viewform" target="_blank" rel="noopener noreferrer"><HeaderIcon name="activity" className={styles.headerGlyph} /><span>{locale === "vi" ? "Phản hồi" : "Feedback"}</span></a>
    </nav>
  </header>;
}
