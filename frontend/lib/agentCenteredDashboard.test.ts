import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync(new URL("../components/WalletDashboard.tsx", import.meta.url), "utf8");
const overview = readFileSync(new URL("../components/ConnectedOverview.tsx", import.meta.url), "utf8");
const overviewCss = readFileSync(new URL("../components/ConnectedOverview.module.css", import.meta.url), "utf8");
const header = readFileSync(new URL("../components/AppHeader.tsx", import.meta.url), "utf8");
const agentPage = readFileSync(new URL("../components/MakotoAgentPage.tsx", import.meta.url), "utf8");
const agentHook = readFileSync(new URL("../hooks/useMakotoAgent.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../components/MakotoWallet.module.css", import.meta.url), "utf8");
const en = readFileSync(new URL("../i18n/en.ts", import.meta.url), "utf8");
const vi = readFileSync(new URL("../i18n/vi.ts", import.meta.url), "utf8");

test("shared header preserves the production Makoto logo asset", () => {
  assert.match(header, /\/makoto\/logo-pro-v2\.png/);
  assert.doesNotMatch(header, /agent-logo|lettermark|new-logo/i);
});

test("7D holdings precede activity and secondary Agent content", () => {
  assert.match(overview, /holdings-title[\s\S]*id="assets"[\s\S]*id="activity"[\s\S]*dashboard-agent-title/);
  assert.match(dashboard, /<ConnectedOverview/);
  assert.match(dashboard, /id="dashboard-agent-question"/);
});

test("primary command order starts Send Receive Swap and retains Bridge", () => {
  assert.match(overview, /\["send", "receive", "swap", "bridge"\]/);
  assert.match(overview, /disabled=\{!onArc\} onClick=\{\(\) => props.onAction\(action\)\}/);
  assert.match(dashboard, /onAction=\{setAction\}/);
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
  assert.doesNotMatch(dashboard.slice(dashboard.indexOf("<ConnectedOverview"), dashboard.indexOf("</ConnectedOverview>")), /writeContract|sendTransaction|signMessage/);
});

test("7D Agent title is a secondary localized heading with a retained labeled composer", () => {
  assert.match(overview, /<h2 id="dashboard-agent-title">\{t\("agentDashboard.title"\)\}/);
  assert.match(en, /"agentDashboard.title": "Makoto Agent"/);
  assert.match(vi, /"agentDashboard.title": "Makoto Agent"/);
  assert.match(dashboard, /<label htmlFor="dashboard-agent-question">\{t\("agentDashboard.inputLabel"\)\}/);
});

test("7D compact Agent uses the same semantic text and control tokens", () => {
  assert.match(overviewCss, /\.agent p \{ font-size: var\(--lc-support-size\)/);
  assert.match(overviewCss, /var\(--lc-text\)/);
  assert.match(overviewCss, /var\(--lc-radius-control\)/);
  assert.doesNotMatch(overviewCss, /position: absolute|position: fixed/);
});

test("7D operational Overview contains no decorative Agent art or motion", () => {
  assert.doesNotMatch(dashboard, /agent-hero-v2|agentAtmosphere|agentParticle|agentOrbit/);
  assert.doesNotMatch(overviewCss, /@keyframes|animation:|gradient/);
});

test("7D ranked suggestions remain optional, wrapping and connected to the existing planner", () => {
  assert.match(overview, /<details><summary>\{t\("overview.prepareAction"\)\}<\/summary>\{props.children\}/);
  assert.match(dashboard, /agentSuggestions.map/);
  assert.match(dashboard, /selectAgentSuggestion\(suggestion.id, prompt\)/);
  assert.match(overviewCss, /\.suggestions \{ display: flex; flex-wrap: wrap/);
});

test("7D primary actions are separate from the optional Agent and secondary tools", () => {
  const start=overview.indexOf("className={styles.actions}");
  const commands=overview.slice(start, overview.indexOf("</section>",start));
  assert.match(commands, /"send", "receive", "swap", "bridge"/);
  assert.doesNotMatch(commands, /\/savings|\/pay|\/unified-balance|askAgent|submitAgent/);
  assert.ok(start < overview.indexOf("className={styles.agent}"));
});

test("primary navigation presents localized Overview, Agent, Settings, and Help destinations", () => {
  const items = header.slice(header.indexOf("const navItems"), header.indexOf("];", header.indexOf("const navItems")) + 2);
  for (const label of ["Overview", "Agent", "Settings", "Help & Support"]) assert.match(items, new RegExp(label));
  for (const label of ["Dashboard", "Wallet", "Tools", "Pay", "Makoto Vault", "Activity", "Send", "Receive", "Swap", "Bridge"]) assert.doesNotMatch(items, new RegExp(label));
  assert.match(header, /href: "\/agent"/);
  assert.match(header, /href="https:\/\/docs\.google\.com\/forms/);
  assert.match(header, /"Feedback"/);
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

test("7D both themes resolve through existing Ledger Calm tokens", () => {
  assert.match(overviewCss, /background: var\(--lc-surface\)/);
  assert.match(overviewCss, /color: var\(--lc-text\)/);
  assert.match(overviewCss, /var\(--lc-separator\)/);
  assert.doesNotMatch(overviewCss, /data-theme|#[0-9a-f]{6}/i);
});

test("7D preserves account and history context without a blanket Protected meter", () => {
  assert.match(overview, /overview.accountDetails/);
  assert.match(overview, /props.chainId/);
  assert.match(overview, /overview.historyPartial/);
  assert.match(overview, /overview.historyUnavailable/);
  assert.doesNotMatch(dashboard, /securityStatus|walletStatusBar/);
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
