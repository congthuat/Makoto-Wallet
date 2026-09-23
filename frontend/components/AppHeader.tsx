"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { WalletControl } from "./WalletControl";
import { LanguageMenu } from "./LanguageMenu";
import { MakotoTerrain } from "./MakotoTerrain";
import { arcTestnet } from "viem/chains";
import { useHydrated } from "@/hooks/useHydrated";
import { useWalletReadContext } from "@/hooks/useWalletAccount";
import { version } from "../package.json";
import { usePreferences } from "@/hooks/usePreferences";
import styles from "./AppHeader.module.css";

type HeaderIconName = "wallet" | "history" | "spark" | "help" | "feedback" | "activity" | "settings" | "network" | "language" | "theme" | "sun" | "address" | "faucet";
const navItems: ReadonlyArray<{ href: string; icon: HeaderIconName; en: string; vi: string }> = [
  { href: "/", icon: "wallet", en: "Dashboard", vi: "Tổng quan" },
  { href: "/#assets", icon: "wallet", en: "Wallet", vi: "Ví" },
  { href: "/agent", icon: "spark", en: "Agent", vi: "Trợ lý" },
];

function HeaderIcon({ name, className }: { name: HeaderIconName; className: string }) {
  const glyphs: Record<HeaderIconName, ReactNode> = {
    wallet: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M16 10h5v5h-5a2.5 2.5 0 0 1 0-5Z" /><path d="M5 6V5a2 2 0 0 1 2-2h10" /><circle cx="16.5" cy="12.5" r=".5" /></>,
    history: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2M3.5 7.5V3.5h4" /></>,
    spark: <><path d="m12 3 1.8 6.2L20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8L12 3Z" /><path d="m19 3 .6 2.4L22 6l-2.4.6L19 9l-.6-2.4L16 6l2.4-.6L19 3Z" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.8 9a2.4 2.4 0 1 1 4 1.8c-1.2.8-1.8 1.3-1.8 2.7" /><circle cx="12" cy="17" r=".6" /></>,
    feedback: <><path d="M4 5.5h16v11H9l-5 4v-15Z" /><path d="M8 9h8M8 13h5" /></>,
    activity: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v3M22 12h-3M12 22v-3M2 12h3" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1v.1h-4v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1-.4h-.1v-4H3a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1v-.1h4V3a1.7 1.7 0 0 0 1.1 1.6 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.12.36.33.7.6 1 .27.27.62.48 1 .6h.1v4H21a1.7 1.7 0 0 0-1.6.4Z" /></>,
    network: <><circle cx="6" cy="7" r="2" /><circle cx="18" cy="7" r="2" /><circle cx="12" cy="18" r="2" /><path d="m7.7 8.1 3.2 7.8M16.3 8.1l-3.2 7.8M8 7h8" /></>,
    language: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></>,
    theme: <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z" />,
    sun: <><circle cx="12" cy="12" r="3.5" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" /></>,
    address: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18M7 14h4" /><circle cx="17" cy="14" r="1" /></>,
    faucet: <><path d="M12 2.8S6.5 9.1 6.5 13.6a5.5 5.5 0 0 0 11 0C17.5 9.1 12 2.8 12 2.8Z" /><path d="M9.5 14.5a2.6 2.6 0 0 0 2.6 2.6" /></>,
  };
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{glyphs[name]}</svg>;
}

export function AppHeader() {
  const { locale, theme, setTheme, t } = usePreferences();
  const hydrated = useHydrated();
  const wallet = useWalletReadContext();
  const connected = hydrated && Boolean(wallet.address) && wallet.status !== "unavailable";
  const faucetAvailable = connected && wallet.isArc && wallet.providerChainId === arcTestnet.id;
  const networkLabel = !connected ? "Arc Testnet"
    : wallet.isArc ? "Arc Testnet"
    : wallet.providerChainId === undefined ? (locale === "vi" ? "Đang kiểm tra mạng" : "Checking network")
    : t("wallet.wrongNetwork");
  const pathname = usePathname();
  const [hash, setHash] = useState("");
  useEffect(() => { const updateHash = () => setHash(window.location.hash); updateHash(); window.addEventListener("hashchange", updateHash); return () => window.removeEventListener("hashchange", updateHash); }, [pathname]);
  function isActive(href: string) { const [route, fragment] = href.split("#"); if (!fragment) return pathname === route && !hash; return pathname === route && (hash === `#${fragment}` || (href === "/settings#security" && !hash)); }
  function toggleTheme() { if (theme === "light") return setTheme("dark"); if (theme === "dark") return setTheme("light"); setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "light" : "dark"); }
  const toggleLabel = theme === "light" ? t("preferences.switchDark") : theme === "dark" ? t("preferences.switchLight") : t("preferences.systemMode");

  return <header className={`${styles.header} ${connected ? styles.connectedHeader : styles.disconnectedHeader}`} data-connected={connected}>
    <aside className={styles.sidebar}>
      <Link className={styles.brand} href="/" aria-label="Makoto Wallet"><Image src="/makoto/logo-pro-v2.png" width={38} height={38} alt="" className={styles.brandLogo} priority /><span className={styles.brandWords}><strong>MAKOTO</strong><small>WALLET</small></span></Link>
      <p className={styles.manifesto}>{locale === "vi" ? <>SỞ HỮU<br />DỊCH CHUYỂN<br />KIẾN TẠO<br />VƯƠN XA</> : <>OWN<br />MOVE<br />BUILD<br />FURTHER</>}</p>
      <nav className={styles.nav} aria-label={locale === "vi" ? "Điều hướng chính" : "Primary navigation"}>
        <div className={styles.primaryNav}>{navItems.map((item) => <Link key={item.en} className={`${styles.navLink} ${isActive(item.href) ? styles.navActive : ""}`.trim()} href={item.href} aria-current={isActive(item.href) ? "page" : undefined} onNavigate={() => setHash(item.href.includes("#") ? `#${item.href.split("#")[1]}` : "")}><HeaderIcon name={item.icon} className={styles.headerGlyph} /><span>{locale === "vi" ? item.vi : item.en}</span></Link>)}</div>
        <div className={styles.utilityNav}>
          <a className={styles.navLink} href="https://docs.google.com/forms/d/e/1FAIpQLSfH_cQv0Gkxy604YcpVHpitSfoWbF5_ud3f5WG_Jc4d7A6nVg/viewform" target="_blank" rel="noopener noreferrer"><HeaderIcon name="feedback" className={styles.headerGlyph} /><span>{locale === "vi" ? "Phản hồi" : "Feedback"}</span></a>
          <Link className={`${styles.navLink} ${isActive("/settings#security") ? styles.navActive : ""}`.trim()} href="/settings#security" aria-current={isActive("/settings#security") ? "page" : undefined} onNavigate={() => setHash("#security")}><HeaderIcon name="settings" className={styles.headerGlyph} /><span>{locale === "vi" ? "Cài đặt" : "Settings"}</span></Link>
          <Link className={`${styles.navLink} ${isActive("/settings#help") ? styles.navActive : ""}`.trim()} href="/settings#help" aria-current={isActive("/settings#help") ? "page" : undefined} onNavigate={() => setHash("#help")}><HeaderIcon name="help" className={styles.headerGlyph} /><span>{locale === "vi" ? "Trợ giúp" : "Help & Support"}</span></Link>
        </div>
      </nav>
      <div className={styles.identity}><MakotoTerrain className={styles.terrain} /><strong>{locale === "vi" ? <>MỘT HỆ<br />TÀI CHÍNH<br />CỞI MỞ HƠN.</> : <>A MORE<br />OPEN<br />FINANCIAL<br />SYSTEM.</>}</strong><span>MAKOTO WALLET<br />ONCHAIN. FURTHER.</span></div>
      <div className={styles.version}>ARC TESTNET <span>v{version}</span></div>
    </aside>
    <div className={styles.topRow}>
      <Link className={styles.topBrand} href="/" aria-label="Makoto Wallet"><Image src="/makoto/logo-pro-v2.png" width={34} height={34} alt="" className={styles.brandLogo} /><span className={styles.brandWords}><strong>MAKOTO</strong><small>WALLET</small></span></Link>
      <span className={styles.networkPill} role="status"><i aria-hidden="true" data-verified={connected && wallet.isArc} />{networkLabel}</span>
      <Link href="/agent" className={styles.agentShortcut} aria-hidden="true" tabIndex={-1}><HeaderIcon name="activity" className={styles.pillGlyph} /><span>{locale === "vi" ? "Hỏi Makoto. Hiểu ví của bạn." : "Ask Makoto. Understand your wallet."}</span><span aria-hidden="true">↗</span></Link>
      {faucetAvailable && <a className={styles.faucetUtility} href="https://faucet.circle.com/" target="_blank" rel="noopener noreferrer" aria-label={t("header.faucetAriaLabel")} title={t("header.faucetTitle")}><HeaderIcon name="faucet" className={styles.pillGlyph} /><span>{t("header.faucet")}</span><span aria-hidden="true">↗</span></a>}
      <div className={styles.headerActions}>
        <LanguageMenu icon={<HeaderIcon name="language" className={styles.pillGlyph} />} />
        <button className={styles.themeButton} type="button" onClick={toggleTheme} aria-label={toggleLabel} title={toggleLabel}><HeaderIcon name={theme === "dark" ? "sun" : "theme"} className={styles.pillGlyph} /></button>
        <div className={styles.walletControlWrap}><HeaderIcon name="address" className={styles.addressGlyph} /><WalletControl /></div>
      </div>
    </div>
  </header>;
}
