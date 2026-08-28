import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const detail = read("../components/JarDetail.tsx");
const dashboard = read("../components/WalletDashboard.tsx");
const settings = read("../components/SettingsPage.tsx");
const header = read("../components/AppHeader.tsx");
const languageMenu = read("../components/LanguageMenu.tsx");
const mobileTopUp = read("../components/MobileTopUpDemo.tsx");
const globals = read("../app/globals.css");
const walletCss = read("../components/MakotoWallet.module.css");

test("Jar detail valid and error states share route-local desktop and mobile shell clearance", () => {
  assert.equal(detail.match(/<main className="jar-detail-page">/g)?.length, 2);
  assert.match(globals, /\.jar-detail-page>\.shell\{[^}]*padding:112px 32px 64px 272px/);
  assert.match(globals, /@media\(max-width:767px\)\{\.jar-detail-page>\.shell\{[^}]*padding:92px 14px/);
  assert.match(detail, /OwnerDepositFlow[\s\S]*SharedContributionFlow[\s\S]*OwnerWithdrawalFlow/);
});

test("Vault shell clearance regressions remain intact", () => {
  const vault = read("../components/Dashboard.tsx");
  assert.match(vault, /<main className="savings-page">/);
  assert.match(globals, /\.savings-page>\.shell\{[^}]*padding:112px 32px 64px 272px/);
  assert.match(globals, /@media\(max-width:767px\)\{\.savings-page>\.shell\{[^}]*padding:92px 14px/);
});

test("connected dashboard fragments remain while disconnected destinations stay removed", () => {
  assert.match(dashboard, /id="assets"/);
  assert.match(dashboard, /id="activity"/);
  assert.doesNotMatch(header.slice(header.indexOf("const navItems"), header.indexOf("];", header.indexOf("const navItems"))), /#apps|#activity/);
  assert.doesNotMatch(dashboard, /function DisconnectedDestinations|Connect to view assets|Connect to view activity/);
});

test("Security stays compact and exposes only wallet, network, privacy, alerts and preferences", () => {
  assert.match(settings, /id="security"[\s\S]*Wallet and network status\.[\s\S]*securityOverview/);
  assert.match(settings, /Connected wallet[\s\S]*Network safety[\s\S]*Privacy[\s\S]*Appearance[\s\S]*Language/);
  assert.match(settings, /visibleAlerts\.length > 0/);
  assert.match(settings, /settingsPreferenceReset/);
  assert.doesNotMatch(settings, /id="(?:guardian|help)"|Guardian & recovery protection|Makoto Wallet help|AppLockSettings|SUPPORTED_ASSETS/);
  assert.match(settings, /window\.addEventListener\("hashchange", settleSettingsFragment\)/);
  assert.match(walletCss, /\.hashDestination[^}]*scroll-margin-top:92px/);
});

test("Settings Security and Help fragment navigation expose active aria-current destinations", () => {
  assert.match(header, /isActive\("\/settings#help"\) \? styles\.navActive/);
  assert.match(header, /aria-current=\{isActive\("\/settings#help"\) \? "page" : undefined\}/);
  assert.match(header, /href="\/settings#security"[^>]*aria-current=\{isActive\("\/settings#security"\) \? "page" : undefined\}/);
  assert.match(header, /fragment \? hash === `#\$\{fragment\}` : !hash/);
  assert.match(header, /onNavigate=\{\(\) => setHash\(item\.href\.includes\("#"\)/);
  assert.match(header, /onNavigate=\{\(\) => setHash\("#help"\)\}/);
});

test("Phase 11 interactive accents use contrast-safe scoped colors", () => {
  assert.match(walletCss, /\.settingsLink,\.settingsAsset a\{color:#6841d8\}/);
  assert.match(walletCss, /html\[data-theme="dark"\][^}]*\.settingsLink[\s\S]*color:#a995ff/);
  assert.match(walletCss, /\.settingsReset button,\.appLockCard \.settingsActions button:first-child\{[^}]*background:#6b46d8/);
  assert.match(globals, /\.address-controls button[^}]*background: #6b46d8/);
  assert.match(globals, /\.savings-page \.address-panel \.eyebrow\{color:#d7d0ff\}/);
  assert.match(walletCss, /\.settingsHero>p,\.settingsSectionHeading>p\{color:#6841d8\}/);
  assert.match(walletCss, /@media\(max-width:767px\)\{\.nav a\{color:#b8c1d6\}\.nav a\.navActive\{color:#fff\}/);
  assert.match(languageMenu, /aria-label=\{`\$\{t\("preferences\.language"\)\} \(\$\{locale\.toUpperCase\(\)\}\)`\}/);
});

test("narrow-phone navigation keeps Dashboard Wallet and Settings", () => {
  assert.match(header, /mobileEn: "Home"[\s\S]*mobileEn: "Wallet"/);
  assert.match(header, /href="\/settings#security"[\s\S]*"Cài đặt" : "Settings"/);
  assert.doesNotMatch(header, /mobileEn: "Security"|en: "Security Center"/);
  assert.match(walletCss, /@media\(max-width:767px\)[\s\S]*\.nav\{grid-template-columns:repeat\(3,1fr\)\}/);
  return;
  assert.match(walletCss, /@media\(max-width:767px\)[\s\S]*?\.nav\{[^}]*grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(header, /mobileEn: "Home"[\s\S]*mobileEn: "Tools"[\s\S]*mobileEn: "Pay"[\s\S]*mobileEn: "Vault"[\s\S]*mobileEn: "Security"/);
});

test("Mobile Top-Up phone field has a stable form identifier", () => {
  assert.match(mobileTopUp, /<input id="mobile-topup-phone" name="phone"/);
  assert.match(mobileTopUp, /mobile-topup\.svg" alt="" width=\{150\} height=\{150\} loading="eager"/);
});
