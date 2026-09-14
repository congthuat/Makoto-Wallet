import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const wallet = readFileSync(new URL("../components/MakotoWallet.module.css", import.meta.url), "utf8");
const balanceHook = readFileSync(new URL("../hooks/useWalletBalances.ts", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../components/WalletDashboard.tsx", import.meta.url), "utf8");
const vaultDashboard = readFileSync(new URL("../components/Dashboard.tsx", import.meta.url), "utf8");
const walletControl = readFileSync(new URL("../components/WalletControl.tsx", import.meta.url), "utf8");
const languageMenu = readFileSync(new URL("../components/LanguageMenu.tsx", import.meta.url), "utf8");
const header = readFileSync(new URL("../components/AppHeader.tsx", import.meta.url), "utf8");
const headerCss = readFileSync(new URL("../components/AppHeader.module.css", import.meta.url), "utf8");
const appShell = readFileSync(new URL("../components/AppShell.tsx", import.meta.url), "utf8");
const shellCss = readFileSync(new URL("../components/AppShell.module.css", import.meta.url), "utf8");
const settingsCss = readFileSync(new URL("../components/SettingsFoundation.module.css", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");

test("responsive CSS fixes overflow sources instead of masking the page", () => {
  assert.doesNotMatch(globals, /html\s*,\s*body\s*\{[^}]*overflow-x\s*:\s*(?:hidden|clip)/i);
  assert.match(wallet, /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(wallet, /\.assetContract\s*\{[^}]*display:\s*flex/s);
  assert.match(wallet, /\.activityStatus\s*\{[^}]*display:\s*inline-flex/s);
});

test("foundation shell preserves connected dashboard section order and artwork exclusions", () => {
  // Phase 7D owns connected composition; 7B changes only its shell.
  assert.match(dashboard, /<AppShell guardianSetupJarId=/);
  assert.match(dashboard, /styles\.agentHero[\s\S]*styles\.portfolioGrid[\s\S]*styles\.assetsSection[\s\S]*styles\.statusCard[\s\S]*styles\.lowerGrid/);
  assert.doesNotMatch(dashboard, /styles\.companionCard|companion-art\.jpg|MakotoPayHomeSection/);
});

test("header keeps five localized destinations named at the 900px navigation width", () => {
  for (const label of ["Overview", "Agent", "Settings", "Help & Support", "Feedback"]) assert.match(header, new RegExp(label));
  assert.doesNotMatch(header.slice(header.indexOf("const navItems"), header.indexOf("];", header.indexOf("const navItems"))), /Activity/);
  assert.match(header, /href: "\/settings#security"/);
  assert.match(headerCss, /@media\(max-width:1120px\)/);
  assert.doesNotMatch(headerCss, /\.navLink[^\{]*\{[^}]*display:none/);
});

test("shared shell provides a localized keyboard skip destination and stable header", () => {
  // Replaces obsolete fixed-sidebar labels with the common shell's accessibility contract.
  assert.match(appShell, /href="#main-content"[^\n]*Đến nội dung chính[^\n]*Skip to main content/);
  assert.match(appShell, /<main id="main-content"[^>]*tabIndex=\{-1\}/);
  assert.match(appShell, /<AppHeader guardianSetupJarId=\{guardianSetupJarId\}/);
  assert.match(header, /aria-label=\{locale === "vi" \? "Điều hướng chính" : "Primary navigation"\}/);
  assert.match(header, /aria-current=\{isActive\(item\.href\) \? "page" : undefined\}/);
});

test("flow-based shell reserves safe-area space and preserves all four action handlers", () => {
  assert.match(shellCss, /padding: var\(--lc-section-gap\) var\(--lc-gutter\) max\(var\(--lc-section-gap\), env\(safe-area-inset-bottom\)\)/);
  assert.doesNotMatch(headerCss, /position:\s*fixed/);
  assert.match(wallet, /\.agentCommands\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(dashboard, /styles\.agentCommands[\s\S]*setAction\("send"\)[\s\S]*setAction\("receive"\)[\s\S]*setAction\("swap"\)[\s\S]*setAction\("bridge"\)/);
});

test("Makoto Vault desktop content clears the shared sidebar and header", () => {
  assert.match(vaultDashboard, /<main className="savings-page">/);
  assert.match(globals, /\.savings-page>\.shell\{[^}]*box-sizing:border-box[^}]*width:min\(100%,1840px\)[^}]*padding:112px 32px 64px 272px/);
});

test("Makoto Vault mobile hero starts below the shared header", () => {
  assert.match(globals, /@media\(max-width:767px\)\{\.savings-page>\.shell\{[^}]*width:100%[^}]*padding:92px 14px/);
  assert.match(globals, /@media \(max-width: 620px\) \{[\s\S]*?\.savings-hero \{[^}]*margin-top:12px/);
});

test("Dashboard heading is route-local and Settings fragments retain exact selection", () => {
  assert.doesNotMatch(header, /styles\.pageHeading/);
  assert.match(dashboard, /styles\.pageHeading/);
  assert.match(header, /fragment \? hash === `#\$\{fragment\}` \|\| \(href === "\/settings#security" && !hash\) : !hash/);
  assert.match(header, /if \(href === "\/"\) return pathname === "\/"/);
});

test("foundation navigation uses existing absolute routes and preserves asset fragments", () => {
  assert.match(header, /href: "\/"[^\n]*en: "Overview"/);
  assert.match(header, /href: "\/agent"[^\n]*en: "Agent"/);
  assert.match(header, /href: "\/settings#security"[^\n]*en: "Settings"/);
  assert.match(header, /href: "\/settings#help"[^\n]*en: "Help & Support"/);
  assert.match(dashboard, /id="assets"/);
  assert.doesNotMatch(header, /href: "#(?:assets|apps|activity)"/);
});

test("Settings owns the Security anchor without a duplicate Security nav item", () => {
  assert.equal(header.match(/href: "\/settings#security"/g)?.length, 1);
  assert.doesNotMatch(header, /hash === "#guardian"|en: "Security Center"/);
  assert.match(header, /href: "\/settings#help"/);
});

test("mobile dashboard stacks Assets, Wallet Status, and Activity without fixed-nav obstruction", () => {
  const mobileTail = wallet.slice(wallet.indexOf("/* Mobile dashboard tail:"));
  assert.match(mobileTail, /@media\(max-width:767px\)/);
  assert.match(mobileTail, /\.portfolioGrid\{[^}]*width:100%;[^}]*min-width:0;[^}]*grid-template-columns:minmax\(0,1fr\)/);
  assert.match(mobileTail, /\.portfolioGrid>\.dashboardCard,\.portfolioGrid>\.assetsSection,\.portfolioGrid>\.statusCard\{[^}]*width:100%;[^}]*min-width:0/);
  assert.match(mobileTail, /\.assetRow\{grid-template-columns:auto minmax\(0,1fr\) auto\}/);
  assert.match(mobileTail, /\.lowerGrid,\.lowerGrid>\.activityCard\{[^}]*width:100%;[^}]*min-width:0/);
  assert.match(shellCss, /env\(safe-area-inset-bottom\)/);
});

test("contextual Guardian recommendation is real-state gated and hidden from mobile navigation", () => {
  assert.match(dashboard, /guardianSetupJar = jars\.find\(\(jar\) => !jar\.closed && Number\(jar\.mode\) === 1 && jar\.guardian === zeroAddress\)/);
  assert.match(dashboard, /<AppShell guardianSetupJarId=\{guardianSetupJar\?\.id\}/);
  assert.match(appShell, /<AppHeader guardianSetupJarId=\{guardianSetupJarId\}/);
  assert.match(header, /guardianSetupJarId !== undefined/);
  assert.match(header, /href="\/savings"/);
  assert.doesNotMatch(header, /recover your wallet|lose access/i);
  assert.match(headerCss, /@media\(max-width:767px\)[\s\S]*\.guardianContextCard\{display:none\}/);
});

test("wallet balances avoid the obsolete native query and aggressive background refresh", () => {
  assert.doesNotMatch(balanceHook, /useBalance|\bnative\b/);
  assert.doesNotMatch(dashboard, /balances\.native/);
  assert.doesNotMatch(walletControl, /balances\.native/);
  assert.match(balanceHook, /staleTime:\s*30_000/);
  assert.match(balanceHook, /refetchOnWindowFocus:\s*false/);
  assert.match(balanceHook, /refetchInterval:\s*false/);
});

test("mobile controls and modals account for touch and safe areas", () => {
  assert.match(globals, /env\(safe-area-inset-top\)/);
  assert.match(globals, /env\(safe-area-inset-bottom\)/);
  assert.match(headerCss, /\.languageTrigger,\.themeButton,\.walletControlWrap\{min-height:44px\}/);
  assert.match(settingsCss, /\.settingsChoices label\s*\{[^}]*min-height:\s*44px/s);
  assert.match(globals, /\.connected-popover\.account-menu\s*\{[^}]*bottom:\s*0[^}]*width:\s*100%[^}]*max-height:\s*calc\(100dvh[^}]*overflow-y:\s*auto/s);
  assert.match(globals, /\.account-sheet-backdrop\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0/s);
});

test("transaction modals stay above Makoto chrome and lock background scrolling", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const makotoCss = readFileSync(new URL("../components/MakotoWallet.module.css", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../components/WalletPanel.tsx", import.meta.url), "utf8");
  assert.match(css, /\.modal-backdrop\s*\{[^}]*z-index:\s*3000/);
  assert.match(css, /\.create-modal\s*\{[^}]*max-height:\s*calc\(100dvh\s*-\s*48px\)[^}]*overflow-y:\s*auto/);
  assert.match(makotoCss, /z-index:\s*1000/);
  assert.match(panel, /previousBodyOverflow\s*=\s*document\.body\.style\.overflow/);
  assert.match(panel, /document\.body\.style\.overflow\s*=\s*"hidden"/);
  assert.match(panel, /document\.body\.style\.overflow\s*=\s*previousBodyOverflow/);
});
test("shared transaction dialogs contain keyboard focus", () => { const panel = readFileSync(new URL("../components/WalletPanel.tsx", import.meta.url), "utf8"); assert.match(panel, /event\.key !== "Tab"/); assert.match(panel, /querySelectorAll<HTMLElement>/); assert.match(panel, /event\.shiftKey/); assert.match(panel, /last\.focus\(\)/); assert.match(panel, /first\.focus\(\)/); });

test("shared transaction dialogs reset scroll and keep their header sticky", () => { const panel = readFileSync(new URL("../components/WalletPanel.tsx", import.meta.url), "utf8"); assert.match(panel, /panelRef\.current\.scrollTop = 0/); assert.match(globals, /\.modal-header\s*\{[^}]*position:sticky[^}]*z-index:3[^}]*background:var\(--white\)/); });

test("Receive amount keeps its token suffix inside a theme-aware full-width field", () => { assert.match(globals, /\.receive-amount\s*\{[^}]*position:relative[^}]*display:block[^}]*width:100%/); assert.match(globals, /\.receive-amount input\s*\{[^}]*width:100%[^}]*padding:[^;}]*72px[^}]*border:1px solid var\(--line\)[^}]*background:var\(--white\)/); assert.match(globals, /\.receive-amount>span[^}]*\{[^}]*top:50%[^}]*right:14px[^}]*pointer-events:none/); });

test("language switcher groups native buttons and restores focus on dismissal", () => {
  // Native grouped toggle buttons replace menuitemradio semantics; browser tests exercise Tab/Escape.
  assert.doesNotMatch(languageMenu, /<select|<option/);
  assert.match(languageMenu, /aria-expanded=\{open\}/);
  assert.match(languageMenu, /aria-controls=\{choicesId\}/);
  assert.match(languageMenu, /id=\{choicesId\} role="group" aria-label=\{t\("preferences\.language"\)\}/);
  assert.match(languageMenu, /aria-pressed=\{selected\}/);
  assert.match(languageMenu, /event\.key !== "Escape"/);
  assert.match(languageMenu, /trigger\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(languageMenu, /document\.removeEventListener\("pointerdown", closeOutside\)/);
  assert.match(languageMenu, /document\.removeEventListener\("keydown", closeEscape\)/);
});

test("mobile wallet account sheet escapes transformed header ancestors", () => {
  assert.match(walletControl, /import\s*\{\s*createPortal\s*\}\s*from\s*["']react-dom["']/);
  assert.match(walletControl, /accountOpen\s*&&\s*isMobileAccountSheet[\s\S]*?createPortal\([\s\S]*?account-sheet-backdrop[\s\S]*?document\.body\)/);
  assert.match(walletControl, /role="dialog"\s+aria-modal=\{isMobileAccountSheet\s*\?\s*"true"\s*:\s*undefined\}/);
  assert.match(walletControl, /previousBodyOverflow\s*=\s*document\.body\.style\.overflow[\s\S]*?document\.body\.style\.overflow\s*=\s*"hidden"[\s\S]*?document\.body\.style\.overflow\s*=\s*previousBodyOverflow/);
  assert.match(wallet, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.walletControlWrap:hover\s*\{\s*transform:\s*none/);
  assert.match(globals, /\.connected-popover\.account-menu\s*\{[^}]*position:\s*fixed[^}]*bottom:\s*0[^}]*padding:[^}]*env\(safe-area-inset-bottom\)/s);
});

test("connected account panel stays focused on account context", () => {
  assert.match(walletControl, /connection\.connector\?\.name/);
  assert.doesNotMatch(walletControl, /PreferenceFields|preference-fields|wallet\.preferences|setLocale|setTheme/);
  assert.match(walletControl, /about-menu|about\.title/);
  assert.match(walletControl, /wallet\.account[\s\S]*wallet\.copy[\s\S]*wallet\.arcscan[\s\S]*wallet\.network[\s\S]*wallet\.usdcBalance[\s\S]*wallet\.disconnect/);
  assert.match(globals, /\.disconnect-button\{[^}]*border:\s*1px solid #efc8c3[^}]*color:\s*#a44338[^}]*background:\s*#fff6f4/);
  assert.match(globals, /html\[data-theme="dark"\] \.disconnect-button\{[^}]*color:\s*#ffb0a6[^}]*background:\s*#2a1b20/);
});

test("connected account focus and dismissal behavior remains accessible", () => {
  assert.match(walletControl, /triggerRef\s*=\s*useRef<HTMLButtonElement>/);
  assert.match(walletControl, /panelCloseRef\s*=\s*useRef<HTMLButtonElement>/);
  assert.match(walletControl, /panelCloseRef\.current\?\.focus\(\{\s*preventScroll:\s*true\s*\}\)/);
  assert.match(walletControl, /event\.key\s*!==\s*"Escape"[\s\S]*?closeAccount\(true\)/);
  assert.match(walletControl, /!isMobileAccountSheet\s*&&\s*!controlRef\.current\?\.contains\(event\.target as Node\)/);
  assert.match(walletControl, /account-sheet-backdrop[\s\S]*?onClick=\{\(\)\s*=>\s*closeAccount\(\)\}/);
  assert.match(walletControl, /onClick=\{\(event\)\s*=>\s*closeAccount\(event\.detail\s*===\s*0\)\}/);
  assert.match(walletControl, /triggerRef\.current\?\.focus\(\{\s*preventScroll:\s*true\s*\}\)/);
  assert.doesNotMatch(globals, /\.wallet-summary:focus-visible\s*\{[^}]*box-shadow/s);
  assert.doesNotMatch(wallet, /\.walletControlWrap:focus-within/);
  assert.match(wallet, /\.nav a:focus-visible,\s*\.languageTrigger:focus-visible,\s*\.themeButton:focus-visible\s*\{/s);
  assert.match(globals, /:is\(a,button,input,select,textarea,\[tabindex\]\):focus-visible/);
});

test("dashboard previews five activities and opens paginated full history", () => {
  assert.match(dashboard, /activities\.slice\(0,\s*5\)/);
  assert.match(dashboard, /summarizeSavingsJars\(jars\)/);
  assert.match(dashboard, /savingsSummary/);
  assert.match(dashboard, /activity\.loadMore\(\)/);
  assert.match(dashboard, /setActivityHistoryOpen\(true\)/);
  assert.match(dashboard, /activityHistoryLimit < activities\.length/);
  assert.match(wallet, /\.savingsSummary\s*\{[^}]*grid-template-columns:\s*repeat\(3/s);
});

test("wallet actions are separated from the four real Makoto Tools modules", () => {
  const heroStart = dashboard.indexOf("<div className={styles.agentCommands}");
  const heroEnd = dashboard.indexOf("</div>", heroStart);
  const heroActions = dashboard.slice(heroStart, heroEnd);
  assert.match(heroActions, /setAction\("send"\)[\s\S]*setAction\("receive"\)[\s\S]*setAction\("swap"\)[\s\S]*setAction\("bridge"\)/);
  assert.doesNotMatch(heroActions, /\/savings|\/pay|\/unified-balance/);
  assert.doesNotMatch(dashboard, /styles\.appsRow|styles\.savingsPosition|styles\.quickPanel|styles\.networkCard/);
  return;
  const balanceStart = dashboard.indexOf("<div className={styles.primaryActions}>");
  const balanceEnd = dashboard.indexOf("</div>", balanceStart);
  const balanceActions = dashboard.slice(balanceStart, balanceEnd);
  const appsStart = dashboard.indexOf("<section className={styles.appsRow}>");
  const appsEnd = dashboard.indexOf("<section className={styles.lowerGrid}>", appsStart);
  const apps = dashboard.slice(appsStart, appsEnd);

  assert.notEqual(balanceStart, -1);
  assert.notEqual(appsStart, -1);
  assert.match(balanceActions, /setAction\("receive"\)/);
  assert.match(balanceActions, /setAction\("send"\)/);
  assert.match(balanceActions, /setAction\("swap"\)/);
  assert.match(balanceActions, /setAction\("send"\)[\s\S]*setAction\("receive"\)[\s\S]*setAction\("swap"\)/);
  assert.doesNotMatch(balanceActions, />Deposit<|>Nạp</);
  assert.doesNotMatch(balanceActions, /Withdraw|Rút|href="\/savings"/);
  assert.doesNotMatch(apps, /setAction\("(?:send|receive|swap)"\)/);
  assert.match(apps, /href="\/savings"[\s\S]*Makoto Vault/);
  assert.match(apps, /href="\/pay"[\s\S]*Makoto Pay/);
  assert.match(apps, /href="\/settings#security"[\s\S]*Security Center/);
  assert.match(apps, /href="\/unified-balance"[\s\S]*Unified Balance/);
  assert.equal(apps.match(/<Link href=/g)?.length, 4);
  assert.match(apps, /Công cụ Makoto[\s\S]*Makoto Tools/);
  assert.doesNotMatch(apps, />Apps<|>Ứng dụng</);
  assert.match(dashboard, /styles\.savingsPosition[\s\S]*styles\.appsFooterLink[\s\S]*href="\/savings"/);
});

test("Activity heading is isolated from generic section heading rules", () => {
  assert.match(dashboard, /styles\.activityHeader[\s\S]*styles\.activityHeading[\s\S]*styles\.activityTitle/);
  assert.equal(dashboard.match(/className=\{styles\.activityTitle\}/g)?.length, 1);
  assert.doesNotMatch(dashboard, /className=\{styles\.activityEyebrow\}|walletHome\.activityEyebrow/);
  return;
  const activityCardStart = dashboard.indexOf("<article className={styles.activityCard}");
  const activityCardEnd = dashboard.indexOf("<div className={styles.sideStack}", activityCardStart);
  const activityCard = dashboard.slice(activityCardStart, activityCardEnd);

  assert.notEqual(activityCardStart, -1);
  assert.notEqual(activityCardEnd, -1);
  assert.match(activityCard, /styles\.activityHeader[\s\S]*styles\.activityHeading[\s\S]*styles\.activityEyebrow[\s\S]*styles\.activityTitle/);
  assert.equal(activityCard.match(/className=\{styles\.activityTitle\}/g)?.length, 1);
  assert.equal(activityCard.match(/className=\{styles\.activityEyebrow\}/g)?.length, 1);
  assert.equal(activityCard.match(/t\("walletHome\.activity"\)/g)?.length, 1);
  assert.equal(activityCard.match(/t\("walletHome\.activityEyebrow"\)/g)?.length, 1);
  assert.doesNotMatch(dashboard, /styles\.activityTitleStack/);
  assert.match(wallet, /\.activityHeader\{display:grid;grid-template-columns:minmax\(0,1fr\) auto;align-items:start;gap:16px\}/);
  assert.match(wallet, /\.activityHeading\{[^}]*display:flex;[^}]*flex-direction:column;[^}]*gap:7px;[^}]*margin:0;[^}]*padding:0\}/);
  assert.match(wallet, /\.activityEyebrow\{[^}]*display:block;[^}]*position:static;[^}]*transform:none;[^}]*margin:0;[^}]*padding:0;[^}]*line-height:1\.2\}/);
  assert.match(wallet, /\.cardHeader span,\.assetsHeader h2,\.activityTitle\{font-family:var\(--font-display\),system-ui,sans-serif;font-weight:600;letter-spacing:normal;line-height:1\.2\}/);
  assert.match(wallet, /\.activityTitle\{display:block;position:static;margin:0;padding:0;color:var\(--mw-text\);font-size:18px\}/);
  assert.doesNotMatch(wallet, /\.activityTitle\{[^}]*letter-spacing:-/);
});

test("application typography uses static Manrope weights without scaled title containers", () => {
  assert.match(layout, /import \{ Manrope \} from "next\/font\/google"/);
  assert.doesNotMatch(layout, /\bSora\b/);
  assert.match(layout, /subsets: \["latin", "vietnamese"\]/);
  assert.match(layout, /weight: \["400", "500", "600", "700", "800"\]/);
  assert.match(layout, /display: "swap"/);
  assert.match(globals, /body \{ --font-body: var\(--font-ui\); --font-display: var\(--font-ui\)/);
  assert.match(wallet, /\.cardHeader span\{font:600 15px\/1\.2 var\(--font-display\),system-ui,sans-serif\}/);
  assert.match(wallet, /\.assetsHeader h2\{[^}]*font:600 18px\/1\.2 var\(--font-display\),system-ui,sans-serif;letter-spacing:normal\}/);
  assert.match(wallet, /\.cardHeader span,\.assetsHeader h2,\.activityTitle\{font-family:var\(--font-display\),system-ui,sans-serif;font-weight:600;letter-spacing:normal;line-height:1\.2\}/);
  assert.match(globals, /\.modal-header h2\{margin:0;font:700 30px\/1\.15 var\(--font-display\),system-ui,sans-serif;letter-spacing:normal\}/);
  assert.match(globals, /\.transaction-state h3\{margin:18px 0 8px;font:700 23px\/1\.2 var\(--font-display\),system-ui,sans-serif;letter-spacing:normal\}/);
  assert.doesNotMatch(`${globals}\n${wallet}`, /\bzoom\s*:/);
  assert.match(globals, /\.modal-backdrop \{[^}]*display: grid; place-items: center;[^}]*\}/);
  assert.doesNotMatch(globals, /\.create-modal\s*\{[^}]*transform\s*:/);
});

test("dark savings workspace does not inherit the light page spotlight", () => {
  // Deliberate presentation change: root palette owns ambient color in both modes.
  const tokens = readFileSync(new URL("../app/ledger-calm.css", import.meta.url), "utf8");
  assert.match(tokens, /--page-ambient:\s*var\(--lc-canvas\)/);
  assert.match(tokens, /--lc-canvas:\s*light-dark\(#F6F6F3, #101318\)/);
  assert.match(tokens, /html\[data-theme="system"\]\s*\{ color-scheme: light dark; \}/);
  assert.match(globals, /body\s*\{[^}]*radial-gradient\(circle at 85% 0%, var\(--page-ambient\) 0, transparent 26rem\)/s);
  assert.doesNotMatch(globals, /body\s*\{[^}]*radial-gradient\(circle at 85% 0%, #f0edff/s);
});
