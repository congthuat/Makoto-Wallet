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

test("7J shared header uses the Makoto wordmark with decorative terrain", () => {
  assert.match(header, /aria-label="Makoto Wallet"/);
  assert.match(header, /<strong>MAKOTO<\/strong><small>WALLET<\/small>/);
  assert.match(header, /<MakotoTerrain/);
  assert.doesNotMatch(header, /agent-logo|lettermark|new-logo/i);
});

test("classic dashboard keeps the Agent hero, command strip, assets, status, and activity surfaces", () => {
  assert.match(overview, /agentHero[\s\S]*className=\{styles\.actions\}[\s\S]*id="assets"[\s\S]*wallet-status-title[\s\S]*id="activity"/);
  assert.match(dashboard, /<ConnectedOverview/);
  assert.match(dashboard, /id="dashboard-agent-question"/);
});

test("primary command order starts Send Receive Swap and retains Bridge", () => {
  assert.match(overview, /\["send", "receive", "swap", "bridge"\]/);
  assert.match(overview, /disabled=\{!onArc\}/);
  assert.match(dashboard, /onAction=\{\(next\) =>/);
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

test("classic Agent title and retained labeled composer remain localized", () => {
  assert.match(overview, /<h1 id="dashboard-agent-title"><em>\{t\("overview.agentTitle"\)\}<\/em><\/h1>/);
  assert.match(en, /"overview.agentTitle": "Agent"/);
  assert.match(vi, /"overview.agentTitle": "Trợ lý"/);
  assert.doesNotMatch(overview, /Makoto Agent|Read & prepare only\. You confirm\./);
  assert.match(dashboard, /<label htmlFor="dashboard-agent-question">\{t\("agentDashboard.inputLabel"\)\}/);
});

test("classic Agent stays readable and keyboard-focusable", () => {
  assert.match(overviewCss, /\.agentBody \.messages p/);
  assert.match(overviewCss, /--classic-text/);
  assert.match(overviewCss, /:focus-visible/);
  assert.doesNotMatch(overviewCss, /\.agent\s*\{[^}]*position:\s*(?:absolute|fixed)/);
});

test("classic Overview restores the Makoto Agent artwork and restrained motion", () => {
  assert.match(overview, /agent-hero-v2|agentAtmosphere|agentParticle|agentOrbit/);
  assert.match(overviewCss, /@keyframes agentFloat/);
});

test("classic prompt rail is replaced by a localized composer suggestion popover", () => {
  assert.match(overview, /\{props.children\}/);
  assert.match(dashboard, /agentSuggestionGroups\.map/);
  assert.match(dashboard, /className=\{overviewStyles\.suggestionTrigger\}/);
  assert.match(dashboard, /selectAgentSuggestion\(prompt\)/);
  assert.doesNotMatch(dashboard, /className=\{overviewStyles\.suggestions\}/);
  assert.doesNotMatch(overviewCss, /agentSlot > \.suggestions/);
});

test("7D primary actions are separate from the optional Agent and secondary tools", () => {
  const start=overview.indexOf("className={styles.actions}");
  const commands=overview.slice(start, overview.indexOf("</section>",start));
  assert.match(commands, /"send", "receive", "swap", "bridge"/);
  assert.doesNotMatch(commands, /\/savings|\/pay|\/unified-balance|askAgent|submitAgent/);
  assert.ok(start < overview.indexOf("className={styles.portfolioGrid}"));
});

test("primary navigation presents Dashboard Wallet and Agent with ordered utility links", () => {
  const items = header.slice(header.indexOf("const navItems"), header.indexOf("];", header.indexOf("const navItems")) + 2);
  for (const label of ["Dashboard", "Wallet", "Agent", "Trợ lý"]) assert.match(items, new RegExp(label));
  assert.match(items, /href: "\/agent"/);
  for (const label of ["Tools", "Pay", "Makoto Vault", "Send", "Receive", "Swap", "Bridge"]) assert.doesNotMatch(items, new RegExp(label));
  assert.match(header, /href="\/settings#security"/);
  assert.match(header, /href="\/settings#help"/);
  assert.match(header, /href="https:\/\/docs\.google\.com\/forms/);
  assert.match(header, /"Feedback"/);
  assert.ok(header.indexOf('name="feedback"') < header.indexOf('href="/settings#security"'));
});

test("final classic refinements keep truthful status and richer activity presentation", () => {
  assert.match(overview, /data-status-kind="network"/);
  assert.match(overviewCss, /\.statusBar span \{[^}]*width: 100%/);
  assert.match(overview, /<ActivityIcon kind=/);
  for (const kind of ["send", "receive", "swap", "bridge"]) assert.match(overview, new RegExp(`${kind}:`));
  assert.match(overview, /overview\.sourceConfirmed/);
  assert.match(overview, /activityStatus/);
  assert.match(overview, /: "₿"/);
  assert.match(overviewCss, /\.assetLogoFallback[^}]*#f5a623/);
});

test("final detail polish simplifies headings and restores the classic activity row anatomy", () => {
  const assets = overview.slice(overview.indexOf('id="assets"'), overview.indexOf('className={styles.statusCard}'));
  const activity = overview.slice(overview.indexOf('id="activity"'), overview.indexOf("function ActionIcon"));
  assert.match(assets, /<h2 id="assets-title">/);
  assert.doesNotMatch(assets.slice(0, assets.indexOf("</header>")), /sectionEyebrow/);
  assert.match(activity, /<h2 id="recent-activity-title">\{t\("walletHome.activity"\)\}<\/h2>/);
  assert.doesNotMatch(activity, /sectionEyebrow|LEDGER|SỔ HOẠT ĐỘNG/);
  assert.match(activity, /<ActivityIcon[\s\S]*activityContext[\s\S]*activityStatus[\s\S]*activityLinks/);
  assert.match(activity, /activityLabel\(item\)[\s\S]*formatAssetAmount\(item\.amount/);
  assert.match(activity, /item\.kind === "bridge" \? t\("overview.sourceConfirmed"\) : t\("overview.confirmed"\)/);
  assert.match(overviewCss, /\.agentHeroCopy h1 \{[^}]*min-height: 50px[^}]*padding: 10px 17px[^}]*font: 750 24px\/1/);
  assert.match(overviewCss, /\.assetLogoFallback::before \{[^}]*width: 35px[^}]*height: 35px/);
  assert.match(overviewCss, /\.activity li \{[^}]*grid-template-columns: 42px minmax\(0, 1fr\) minmax\(124px, \.34fr\) minmax\(128px, auto\)/);
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

test("7J light information panels share semantic tokens inside both shell themes", () => {
  assert.match(overviewCss, /:global\(html\[data-theme="light"\]\)/);
  assert.match(overviewCss, /var\(--classic-surface\)/);
  assert.match(overviewCss, /var\(--classic-border\)/);
});

test("7D preserves account and history context without a blanket Protected meter", () => {
  assert.match(overview, /props.address/);
  assert.match(overview, /props.walletKind/);
  assert.match(overview, /props.chainId/);
  assert.match(overview, /overview.historyPartial/);
  assert.match(overview, /overview.historyUnavailable/);
  assert.doesNotMatch(dashboard, /securityStatus|walletStatusBar/);
});

test("disconnected dashboard contains only the editorial landing hero", () => {
  const disconnectedStart = dashboard.indexOf(") : !connected ? (");
  const disconnected = dashboard.slice(disconnectedStart, dashboard.indexOf("<ConnectedOverview", disconnectedStart));
  for (const removed of ["DisconnectedDestinations", "My Assets", "View assets", "View activity", "disconnectedDestination"]) {
    assert.doesNotMatch(disconnected, new RegExp(removed));
  }
  assert.match(disconnected, /walletHome\.landingTitle/);
  assert.match(disconnected, /walletHome\.landingCapabilities/);
  assert.match(disconnected, /walletHome\.landingSafety/);
  assert.match(disconnected, /onboarding\.createWallet/);
  assert.match(disconnected, /onboarding\.connectExisting/);
  assert.doesNotMatch(disconnected, /onboarding\.title/);
});

test("existing-wallet option shares the header connection-green token family", () => {
  assert.match(css, /--connect-card-surface:color-mix\(in srgb,var\(--connect-action\) 11%,var\(--mw-surface\)\)/);
  assert.match(css, /\.connectExistingButton\{[\s\S]*border-color:var\(--connect-card-border\);[\s\S]*color:var\(--connect-card-text\);[\s\S]*background:var\(--connect-card-surface\)/);
  assert.match(css, /\.connectExistingButton:hover:not\(:disabled\)[^}]*var\(--connect-action\)[^}]*var\(--connect-card-surface-hover\)/);
  assert.match(css, /\.connectExistingButton:focus-visible\{outline:3px solid color-mix\(in srgb,var\(--connect-action\)/);
  assert.match(css, /\.createWalletButton\{border-color:var\(--action-primary\);background:var\(--action-primary\)/);
});

test("composer suggestions stay presentation-only and do not invoke the Agent automatically", () => {
  const selection = dashboard.slice(dashboard.indexOf("function selectAgentSuggestion"), dashboard.indexOf("function moveSuggestionFocus"));
  assert.match(selection, /setAgentInput\(prompt\)/);
  assert.doesNotMatch(selection, /askAgent|submitAgent|recordSuggestionUsage/);
});
