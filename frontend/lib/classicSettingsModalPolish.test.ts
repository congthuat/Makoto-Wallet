import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const settings = read("../components/SettingsPage.tsx");
const settingsCss = read("../components/SettingsFoundation.module.css");
const globals = read("../app/globals.css");
const onboardingCss = read("../components/NativeWalletOnboarding.module.css");
const bridge = read("../components/CctpBridgeFlow.tsx");

test("Settings treats a locked local wallet as known read identity", () => {
  assert.match(settings, /const walletKnown = Boolean\(wallet\.address\) && wallet\.status !== "unavailable"/);
  assert.match(settings, /deriveNetworkSafety\(walletKnown, wallet\.isArc\)/);
  assert.match(settings, /Wallet identity[\s\S]*Address[\s\S]*Wallet state[\s\S]*Execution/);
  assert.match(settings, /localWallet && !walletUnlocked[\s\S]*Local wallet locked/);
  assert.match(settings, /Unlock required for signing\. Public reads remain available\./);
  assert.doesNotMatch(settings, /deriveNetworkSafety\(wallet\.status === "connected"/);
});

test("Settings keeps wallet lock, execution readiness, and App Lock distinct", () => {
  assert.match(settings, /const executionState = !walletKnown[\s\S]*Unlock required/);
  assert.match(settings, /const appLockState = !appLock\.initialized[\s\S]*appLock\.enabled[\s\S]*Not enabled/);
  assert.doesNotMatch(settings, /const appLockState = localWallet/);
});

test("Settings groups status, safety, privacy, preferences, and support compactly", () => {
  assert.match(settings, /Ví & Mạng[\s\S]*Wallet & Network[\s\S]*Wallet identity[\s\S]*Network safety/);
  assert.match(settings, /Security \/ Privacy[\s\S]*Preferences[\s\S]*Help & Support/);
  assert.match(settingsCss, /\.statusColumns\s*\{[^}]*grid-template-columns:\s*repeat\(2/s);
  assert.match(settingsCss, /\.settingsChoices label:has\(input:checked\)/);
  assert.match(settings, /SettingsCard title=\{vi \? "Bảo mật \/ Quyền riêng tư" : "Security \/ Privacy"\} className=\{styles\.securityCard\}/);
  assert.match(settingsCss, /@media \(min-width: 901px\)[\s\S]*\.securityCard[\s\S]*\.preferenceGroups/);
  assert.match(settingsCss, /@media \(max-width: 620px\)[\s\S]*\.helpTopics, \.helpLinks\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test("wallet action modal families share Classic tokens without obscuring focus or QR contrast", () => {
  assert.match(globals, /html\[data-theme="dark"\][\s\S]*\.create-modal\.wallet-action-modal[\s\S]*--mk-surface-primary:\s*rgba\(12, 10, 29, \.98\)/);
  assert.match(globals, /\.create-modal\.wallet-action-modal:focus-visible\s*\{\s*outline:\s*none/);
  assert.match(globals, /\.receive-qr-card\s*\{[\s\S]*background:\s*#fff/);
  assert.match(globals, /@media \(max-width: 767px\)[\s\S]*\.create-modal\.wallet-action-modal\s*\{[\s\S]*border-radius:\s*var\(--lc-radius-dialog\)/);
  assert.doesNotMatch(onboardingCss, /gradient|backdrop-filter/i);
});

test("Direct CCTP presentation exposes route context while retaining the locked signing guard", () => {
  assert.match(bridge, /className="bridge-context-grid"[\s\S]*Circle CCTP V2[\s\S]*Wallet status/);
  assert.match(bridge, /Local wallet locked: fee reads and Review preparation remain available; signing is blocked\./);
});
