import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync(new URL("../components/WalletDashboard.tsx", import.meta.url), "utf8");
const header = readFileSync(new URL("../components/AppHeader.tsx", import.meta.url), "utf8");
const agentPage = readFileSync(new URL("../components/MakotoAgentPage.tsx", import.meta.url), "utf8");
const agentHook = readFileSync(new URL("../hooks/useMakotoAgent.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../components/MakotoWallet.module.css", import.meta.url), "utf8");
const en = readFileSync(new URL("../i18n/en.ts", import.meta.url), "utf8");
const vi = readFileSync(new URL("../i18n/vi.ts", import.meta.url), "utf8");

test("dashboard preserves the production Makoto logo asset", () => {
  assert.match(dashboard, /\/makoto\/logo-pro-v2\.png/);
  assert.doesNotMatch(dashboard, /agent-logo|lettermark|new-logo/i);
});

test("Agent hero is the first connected dashboard section", () => {
  assert.ok(dashboard.indexOf("styles.agentHero") < dashboard.indexOf("styles.portfolioGrid"));
  assert.match(dashboard, /id="dashboard-agent-title"/);
  assert.match(dashboard, /id="dashboard-agent-question"/);
});

test("primary command order starts Send Receive Swap and retains Bridge", () => {
  const commands = dashboard.slice(dashboard.indexOf("styles.agentCommands"), dashboard.indexOf("styles.agentSecondaryCommands"));
  const order = [commands.indexOf('setAction("send")'), commands.indexOf('setAction("receive")'), commands.indexOf('setAction("swap")'), commands.indexOf('setAction("bridge")')];
  assert.ok(order.every((value) => value >= 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test("Quick Actions reuse existing dashboard flow state", () => {
  assert.match(dashboard, /action === "send"[\s\S]*<SendFlow/);
  assert.match(dashboard, /action === "receive"[\s\S]*<ReceivePanel/);
  assert.match(dashboard, /action === "swap" \|\| action === "bridge"[\s\S]*<SwapPanel/);
  assert.match(dashboard, /initialMode=\{action\}/);
});

test("Agent page and dashboard share one planner hook", () => {
  assert.match(agentPage, /useMakotoAgent\(snapshot/);
  assert.match(dashboard, /useMakotoAgent\(agentSnapshot/);
  assert.match(agentHook, /answerAgentRequest\(snapshot/);
  assert.equal((agentHook.match(/answerAgentRequest/g) ?? []).length, 2);
});

test("Agent preparation remains a draft handoff with no wallet execution", () => {
  assert.match(agentPage, /prepareAgentActionHandoff/);
  assert.match(agentPage, /storeAgentHandoff/);
  assert.doesNotMatch(agentHook, /writeContract|sendTransaction|signMessage|eth_sendTransaction/);
  assert.doesNotMatch(dashboard.slice(dashboard.indexOf("styles.agentHero"), dashboard.indexOf("styles.dashboardGrid")), /writeContract|sendTransaction|signMessage/);
});

test("hero copy is localized in English and Vietnamese", () => {
  const heroCopy = dashboard.slice(dashboard.indexOf("styles.agentHeroCopy"), dashboard.indexOf("styles.agentInteraction"));
  assert.match(heroCopy, /<h1 id="dashboard-agent-title">\{t\("agentDashboard\.title"\)\}<\/h1>/);
  assert.doesNotMatch(heroCopy, /agentEyebrow|agentTagline|agentSupport|MAKOTO AGENT|ARC TESTNET/);
  assert.match(en, /"agentDashboard\.title": "Makoto Agent"/);
  assert.match(en, /"agentDashboard\.tagline": "Your wallet copilot on Arc\."/);
  assert.match(en, /"agentDashboard\.support": "Check balances, activity, and network status\."/);
  assert.match(vi, /"agentDashboard\.title": "Makoto Agent"/);
  assert.match(vi, /"agentDashboard\.tagline": "Trợ lý ví của bạn trên Arc\."/);
  assert.match(vi, /"agentDashboard\.support": "Xem số dư, hoạt động và trạng thái mạng\."/);
  assert.match(en, /Ask Makoto Agent anything/);
  assert.match(vi, /Hỏi Makoto Agent bất cứ điều gì/);
});

test("Agent character asset and animation are restrained with explicit reduced motion", () => {
  const heroCss = css.slice(css.indexOf("/* Agent-centered dashboard */"));
  assert.match(dashboard, /\/makoto\/agent-hero-v2\.png/);
  for (const name of ["agentFloat", "agentAura", "agentOrbit", "agentGlow", "agentParticleDrift"]) assert.match(css, new RegExp(`@keyframes ${name}`));
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)[\s\S]*\.agentCharacter[\s\S]*animation:none!important/);
  assert.doesNotMatch(heroCss, /canvas|WebGL|video/);
});

test("ranked suggestions use a right-side speech-bubble rail and shortcuts remain centered", () => {
  const stage = dashboard.slice(dashboard.indexOf("styles.agentOrbitStage"), dashboard.indexOf("styles.agentHeroCopy"));
  assert.match(stage, /styles\.agentAtmosphere/);
  assert.match(stage, /styles\.agentAmbientSuggestions/);
  assert.match(css, /\.agentOrbitStage\{grid-area:visual;position:relative/);
  assert.match(css, /\.agentOrbitStage::after\{content:"";position:absolute;top:50%;left:50%/);
  assert.match(css, /\.agentAmbientSuggestions button::before\{content:"";position:absolute;top:50%;left:-9px/);
  assert.match(css, /@media\(min-width:1101px\)[\s\S]*\.agentAmbientSuggestions\{top:50%;right:-112px;bottom:auto;left:auto;width:248px;height:auto;display:flex;flex-direction:column/);
  assert.match(css, /\.agentAmbientSuggestions button:nth-child\(1\)\{width:100%;min-height:68px/);
  assert.match(css, /\.agentAmbientSuggestions button:nth-child\(2\)\{width:88%;min-height:60px/);
  assert.match(css, /\.agentAmbientSuggestions button:nth-child\(3\)\{width:76%;min-height:52px/);
  assert.match(css, /\.quickActionsPanel \.agentCommands\{grid-area:auto;place-self:center;width:min\(100%,568px\);grid-template-columns:repeat\(4,minmax\(118px,133px\)\);justify-content:center;margin-inline:auto/);
});

test("Quick Actions are a distinct sibling section containing only the four core wallet actions", () => {
  const heroStart = dashboard.indexOf("styles.agentHero");
  const heroEnd = dashboard.indexOf("</section>", heroStart);
  const quickActionsStart = dashboard.indexOf("styles.quickActionsPanel");
  assert.ok(heroStart >= 0 && heroEnd > heroStart && quickActionsStart > heroEnd);
  assert.doesNotMatch(dashboard.slice(heroStart, heroEnd), /styles\.agentCommands|setAction\(\"(?:send|receive|swap|bridge)\"\)/);
  const commands = dashboard.slice(dashboard.indexOf("styles.agentCommands"), dashboard.indexOf("</section>", dashboard.indexOf("styles.agentCommands")));
  for (const action of ["send", "receive", "swap", "bridge"]) assert.match(commands, new RegExp(`setAction\\(\\"${action}\\"\\)`));
  assert.doesNotMatch(commands, /WALLET SHORTCUTS|Quick Actions|Start a wallet task/);
  assert.doesNotMatch(commands, /Makoto Vault|Security Center|Recent Activity|\/pay|\/savings/);
  assert.doesNotMatch(dashboard, /styles\.agentSecondaryCommands/);
});

test("primary navigation contains only Dashboard and Wallet with Settings in utilities", () => {
  const items = header.slice(header.indexOf("const navItems"), header.indexOf("];", header.indexOf("const navItems")) + 2);
  for (const label of ["Dashboard", "Wallet"]) assert.match(items, new RegExp(label));
  for (const label of ["Security Center", "Tools", "Pay", "Makoto Vault", "Makoto Agent", "Activity", "Send", "Receive", "Swap", "Bridge"]) assert.doesNotMatch(items, new RegExp(label));
  assert.match(header, /href="\/settings#security"[^>]*>[\s\S]*"Settings"/);
  assert.match(header, /"Feedback"/);
  assert.match(header, /"Help & Support"/);
});

test("Feedback opens the exact Makoto form safely in a new tab", () => {
  assert.match(header, /href="https:\/\/docs\.google\.com\/forms\/d\/e\/1FAIpQLSfH_cQv0Gkxy604YcpVHpitSfoWbF5_ud3f5WG_Jc4d7A6nVg\/viewform"/);
  assert.match(header, /target="_blank"/);
  assert.match(header, /rel="noopener noreferrer"/);
  assert.match(header, /locale === "vi" \? "Phản hồi" : "Feedback"/);
});

test("desktop sidebar uses one continuous surface with a subtle utility divider", () => {
  assert.match(css, /\.brand,\.nav\{border-color:var\(--mw-sidebar-border,var\(--border-subtle\)\);background:var\(--mw-sidebar\)\}/);
  assert.match(css, /html\[data-theme="dark"\][^}]*\.page\{--mw-sidebar:#080717;--mw-sidebar-border:rgba\(151,112,229,\.22\)\}/);
  assert.match(css, /\.brand\{border-color:var\(--mw-sidebar-border,var\(--border-subtle\)\)\}/);
  assert.match(css, /\.nav\{padding-inline:12px;border-color:var\(--mw-sidebar-border,var\(--border-subtle\)\);gap:3px\}/);
  assert.match(css, /\.settingsNavItem\{margin-top:auto!important;border-top:0!important\}/);
  assert.match(css, /\.settingsNavItem::after/);
  assert.match(css, /\.feedbackNavItem,\.helpNavItem\{[^}]+background:transparent!important/);
});

test("dark disconnected surfaces reuse the Agent dashboard violet-black family", () => {
  assert.match(css, /--mw-page-base: #080717/);
  assert.match(css, /--mw-surface: rgba\(12, 10, 29, \.98\)/);
  assert.match(css, /--mw-surface-muted: #110b27/);
  assert.match(css, /--mw-border: rgba\(146, 105, 231, \.28\)/);
  assert.match(css, /html\[data-theme="dark"\]\) \.disconnectedArt\{border-left-color:var\(--mw-divider\);background:radial-gradient/);
});

test("light mode scopes Agent and dashboard surfaces to semantic light tokens", () => {
  assert.match(css, /html\[data-theme="light"\]\) \.agentHero\{border-color:rgba\(104,65,216,\.2\);background:/);
  assert.match(css, /html\[data-theme="light"\]\) \.quickActionsPanel\{border-color:var\(--mw-border\);background:/);
  assert.match(css, /html\[data-theme="light"\]\) \.portfolioGrid \.dashboardCard/);
  assert.match(css, /html\[data-theme="light"\]\) \.lowerGrid \.activityCard/);
});

test("dashboard retains wallet shortcuts, Assets, Wallet Status and Recent Activity below the Hero", () => {
  const connected = dashboard.slice(dashboard.indexOf("styles.agentHero"), dashboard.indexOf("<footer"));
  assert.match(connected, /\? "Tài sản" : "Assets"/);
  assert.match(connected, /Wallet Status/);
  assert.match(connected, /walletHome\.activity/);
  assert.match(connected, /styles\.quickActionsPanel/);
  for (const removed of ["Makoto Tools", "Savings position", "Unified Balance", "networkCard"]) assert.doesNotMatch(connected, new RegExp(removed));
});

test("disconnected dashboard contains only the connection hero", () => {
  const disconnected = dashboard.slice(dashboard.indexOf(") : !connected ? ("), dashboard.indexOf(") : showWalletReady"));
  for (const removed of ["DisconnectedDestinations", "My Assets", "View assets", "View activity", "disconnectedDestination"]) {
    assert.doesNotMatch(disconnected, new RegExp(removed));
  }
  assert.match(disconnected, /walletHome\.connectTitle/);
  assert.match(disconnected, /onboarding\.createWallet/);
  assert.match(disconnected, /onboarding\.connectExisting/);
  assert.match(disconnected, /onboarding\.noPrivateKeyStorage/);
});

test("existing-wallet option shares the header connection-green token family", () => {
  assert.match(css, /--connect-card-surface:color-mix\(in srgb,var\(--connect-action\) 11%,var\(--mw-surface\)\)/);
  assert.match(css, /\.connectExistingButton\{[\s\S]*border-color:var\(--connect-card-border\);[\s\S]*color:var\(--connect-card-text\);[\s\S]*background:var\(--connect-card-surface\)/);
  assert.match(css, /\.connectExistingButton:hover:not\(:disabled\)[^}]*var\(--connect-action\)[^}]*var\(--connect-card-surface-hover\)/);
  assert.match(css, /\.connectExistingButton:focus-visible\{outline:3px solid color-mix\(in srgb,var\(--connect-action\)/);
  assert.match(css, /\.createWalletButton\{border-color:var\(--action-primary\);background:var\(--action-primary\)/);
});

test("adaptive suggestions are wallet and chain scoped", () => {
  assert.match(dashboard, /suggestionStorageKey\(connection\.address, chain\.providerChainId\)/);
  assert.match(dashboard, /rankAgentSuggestions/);
  assert.match(dashboard, /recordSuggestionUsage/);
});
