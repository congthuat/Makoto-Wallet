import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const detail = read("../components/JarDetail.tsx");
const dashboard = read("../components/WalletDashboard.tsx");
const overview = read("../components/ConnectedOverview.tsx");
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

test("connected dashboard fragments remain while Activity stays anchored to the real Overview history", () => {
  assert.match(overview, /id="assets"/);
  assert.match(overview, /id="activity"/);
  assert.match(dashboard, /<ConnectedOverview/);
  assert.match(header.slice(header.indexOf("const navItems"), header.indexOf("];", header.indexOf("const navItems"))), /href: "\/\#activity"/);
  assert.doesNotMatch(dashboard, /function DisconnectedDestinations|Connect to view assets|Connect to view activity/);
});

test("Settings stays compact and Help exposes only real support resources", () => {
  assert.match(settings, /id="security"[\s\S]*Wallet, security, appearance, language and support\.[\s\S]*securityOverview/);
  assert.match(settings, /Connected wallet[\s\S]*Network safety[\s\S]*Privacy[\s\S]*Appearance[\s\S]*Language/);
  assert.match(settings, /visibleAlerts\.length > 0/);
  assert.match(settings, /settingsPreferenceReset/);
  assert.match(settings, /id="help"[\s\S]*Help & Support[\s\S]*docs\.arc\.io/);
  assert.match(settings, /ARC_EXPLORER_URL/);
  assert.doesNotMatch(settings, /id="guardian"|Guardian & recovery protection|Makoto Wallet help|AppLockSettings|SUPPORTED_ASSETS/);
  assert.match(settings, /window\.addEventListener\("hashchange", settleSettingsFragment\)/);
  assert.match(walletCss, /\.hashDestination[^}]*scroll-margin-top:92px/);
});

test("Settings Security and Help fragment navigation expose active aria-current destinations", () => {
  assert.match(header, /href: "\/settings#security"/);
  assert.match(header, /href: "\/settings#help"/);
  assert.match(header, /aria-current=\{isActive\(item\.href\) \? "page" : undefined\}/);
  assert.match(header, /hash === `#\$\{fragment\}` \|\| \(href === "\/settings#security" && !hash\)/);
  assert.match(header, /onNavigate=\{\(\) => setHash\(item\.href\.includes\("#"\)/);
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
  assert.match(languageMenu, /aria-pressed=\{selected\}/);
  assert.match(languageMenu, /trigger\.current\?\.focus/);
});

test("narrow-phone navigation keeps all six foundation destinations labeled", () => {
  // Deliberate presentation contract: wrapped links replace the fixed three-item bar.
  const headerCss = read("../components/AppHeader.module.css");
  assert.match(header, /<span>\{locale === "vi" \? item\.vi : item\.en\}<\/span>/);
  assert.match(header, /href: "\/\#activity"[^\n]*en: "Activity", vi: "Hoạt động"/);
  assert.match(header, /href: "\/settings#security",[^\n]*en: "Settings", vi: "Cài đặt"/);
  assert.doesNotMatch(header, /mobileEn: "Security"|en: "Security Center"/);
  assert.match(headerCss, /@media\s*\(max-width:\s*767px\)[\s\S]*\.nav\s*\{[^}]*flex-wrap:\s*wrap/);
  for (const selector of ["navLink", "feedbackLink"]) assert.match(headerCss, new RegExp(`\\.${selector}\\s*\\{[^}]*min-height:\\s*44px`));
});

test("Mobile Top-Up phone field has a stable form identifier", () => {
  assert.match(mobileTopUp, /<input id="mobile-topup-phone" name="phone"/);
  assert.match(mobileTopUp, /mobile-topup\.svg" alt="" width=\{150\} height=\{150\} loading="eager"/);
});
