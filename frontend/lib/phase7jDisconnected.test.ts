import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const layout = read("../app/layout.tsx");
const dashboard = read("../components/WalletDashboard.tsx");
const shell = read("../components/AppShell.tsx");
const shellCss = read("../components/AppShell.module.css");
const header = read("../components/AppHeader.tsx");
const headerCss = read("../components/AppHeader.module.css");
const landingCss = read("../components/OverviewFoundation.module.css");
const en = read("../i18n/en.ts");
const vi = read("../i18n/vi.ts");

test("7J disconnected state switches to a dedicated shell without changing connected navigation", () => {
  assert.match(shell, /useConnection\(\)/);
  assert.match(shell, /useHydrated\(\)/);
  assert.match(shell, /data-shell-mode=\{shellMode\}/);
  assert.match(shellCss, /\.disconnectedShell \.content\s*\{[^}]*margin-left:\s*0/);
  assert.match(header, /styles\.connectedHeader/);
  assert.match(header, /styles\.disconnectedHeader/);
  assert.match(header, /className=\{styles\.topBrand\}/);
  assert.match(headerCss, /\.disconnectedHeader \.sidebar\s*\{\s*display:\s*none/);
  assert.match(headerCss, /\.disconnectedHeader \.topRow\s*\{\s*margin-left:\s*0/);
  assert.match(headerCss, /\.disconnectedHeader \.topBrand\s*\{\s*display:\s*block/);
  assert.match(headerCss, /:global\(html\[data-theme="light"\]\) \.disconnectedHeader \.topRow/);
  assert.match(headerCss, /\.agentShortcut\s*\{[^}]*display:\s*flex/);
});

test("7J landing hero keeps one primary action and preserves real onboarding paths", () => {
  const disconnectedStart = dashboard.indexOf(") : !connected ? (");
  const disconnected = dashboard.slice(disconnectedStart, dashboard.indexOf("<ConnectedOverview", disconnectedStart));
  assert.match(disconnected, /aria-labelledby="landing-title"/);
  assert.match(disconnected, /role="list" aria-label=\{t\("walletHome\.landingCapabilitiesLabel"\)\}/);
  assert.match(disconnected, /<span role="listitem"/);
  assert.match(disconnected, /landingActions/);
  assert.match(disconnected, /className=\{foundation\.primaryAction\}/);
  assert.match(disconnected, /beginOnboarding\("existing"\)/);
  assert.match(disconnected, /setCreateGuideOpen\(true\)/);
  assert.match(disconnected, /<MakotoTerrain \/>/);
  assert.match(disconnected, /landingValues/);
  assert.match(disconnected, /vietnameseValues/);
  assert.doesNotMatch(disconnected, /onboarding\.title/);
});

test("7J landing presentation uses the blue monolith, light/dark variants, and mobile reflow", () => {
  assert.match(landingCss, /font:\s*900 clamp\(54px, 6vw, 96px\)\/\.86 Impact/);
  assert.match(layout, /import localFont from "next\/font\/local"/);
  assert.match(layout, /src: "\.\/fonts\/RobotoCondensed-Variable\.ttf"/);
  assert.match(layout, /variable: "--font-vi-display"/);
  assert.match(landingCss, /\.vietnamese h1 \{[\s\S]*font-family: var\(--font-vi-display\), var\(--font-ui\)/);
  const vietnameseRule = landingCss.match(/\.vietnamese h1 \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(vietnameseRule, /Arial Narrow/);
  assert.match(landingCss, /\.vietnamese h1 \{[\s\S]*font-weight: 900/);
  assert.match(landingCss, /\.vietnamese h1 \{[\s\S]*line-height: 1\.02/);
  assert.match(landingCss, /\.vietnamese \.disconnectedIntro \{ max-width: 420px; line-height: 1\.62; \}/);
  assert.match(landingCss, /\.vietnameseValues \.landingValue strong \{[\s\S]*font-size: 12px/);
  assert.match(landingCss, /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(landingCss, /background:\s*linear-gradient\(112deg, #08131d/);
  assert.match(landingCss, /:global\(html\[data-theme="light"\]\) \.disconnected/);
  assert.match(landingCss, /@media \(max-width: 767px\)/);
  assert.match(landingCss, /\.landingValues \{ grid-template-columns: 1fr; \}/);
  assert.match(landingCss, /\.disconnectedArt svg \{[^}]*width: min\(100%, 620px\)/);
});

test("7J landing copy is localized and avoids the old mixed-language capability string", () => {
  for (const dictionary of [en, vi]) {
    for (const key of ["landingKicker", "landingTitle", "landingCopy", "landingCapabilities", "landingSafety", "landingValuesLabel", "landingNonCustodialCopy", "landingArcCopy", "landingBuilderCopy"]) {
      assert.match(dictionary, new RegExp(`walletHome\\.${key}`));
    }
  }
  assert.match(en, /"walletHome\.landingTitle": "A MORE\\nOPEN\\nFINANCIAL\\nSYSTEM\."/);
  assert.match(vi, /"walletHome\.landingTitle": "MỘT HỆ TÀI CHÍNH\\nCỞI MỞ HƠN\."/);
  assert.doesNotMatch(dashboard, /Hoán đổi · Bridge/);
});
