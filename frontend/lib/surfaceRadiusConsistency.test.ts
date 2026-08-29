import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../components/MakotoWallet.module.css", import.meta.url), "utf8");
const compact = css.replace(/\s+/g, "");

test("Makoto surfaces use the semantic large, nested, and control radius hierarchy", () => {
  assert.match(compact, /\.page\{--radius-surface-lg:18px;--radius-surface-md:16px;--radius-control:12px;/);
  assert.match(compact, /\.quickActionsPanel,\.disconnected,\.securityOverview\{border-radius:var\(--radius-surface-lg\)\}/);
  assert.match(compact, /\.settingsCard,\.createWalletButton,\.connectExistingButton\{border-radius:var\(--radius-surface-md\)\}/);
});

test("connected dashboard outer shells share the large surface radius without rounding data rows", () => {
  assert.match(compact, /\.portfolioGrid\.assetsSection\.dashboardCard,\.portfolioGrid\.statusCard,\.lowerGrid\.activityCard\{border-radius:var\(--radius-surface-lg\)\}/);
  assert.match(compact, /\.assetRow\{[^}]*border-radius:0/);
  assert.match(compact, /\.activityListli\{[^}]*border-radius:0/);
  assert.doesNotMatch(compact, /\.statusListdiv\{[^}]*border-radius:/);
});

test("mobile major shells resolve to the 16px semantic surface radius", () => {
  assert.match(compact, /@media\(max-width:767px\)\{\.quickActionsPanel,\.portfolioGrid\.assetsSection\.dashboardCard,\.portfolioGrid\.statusCard,\.lowerGrid\.activityCard,\.disconnected,\.securityOverview\{border-radius:var\(--radius-surface-md\)\}\}/);
});

test("security choices and navigation controls use the rectangular control radius", () => {
  assert.match(compact, /\.settingsChoiceslabel,\.settingsActionsbutton,\.settingsActionsa,\.settingsPreferenceResetbutton,\.nava,\.walletControlWrap:global\(\.connect-button\)\{border-radius:var\(--radius-control\)\}/);
});
