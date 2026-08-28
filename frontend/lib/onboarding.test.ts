import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { arcTestnet } from "viem/chains";
import {
  appKitViewForPath,
  appKitViewForCreateMethod,
  parseOnboardingIntent,
  shouldShowWalletReady,
  walletKindFromConnector,
} from "./onboarding.ts";
import { en } from "../i18n/en.ts";
import { vi } from "../i18n/vi.ts";

const wagmiSource = readFileSync(new URL("./wagmi.ts", import.meta.url), "utf8");

test("new and existing wallet paths open distinct AppKit views", () => {
  assert.equal(appKitViewForPath("create"), "Connect");
  assert.equal(appKitViewForPath("existing"), "AllWallets");
});

test("Email and Google choices both preserve the supported AppKit create flow", () => {
  assert.equal(appKitViewForCreateMethod("email"), "Connect");
  assert.equal(appKitViewForCreateMethod("google"), "Connect");
});

test("only the installed AppKit AUTH connector is treated as embedded", () => {
  assert.equal(walletKindFromConnector("AUTH"), "embedded");
  assert.equal(walletKindFromConnector("auth"), "embedded");
  assert.equal(walletKindFromConnector("injected"), "external");
  assert.equal(walletKindFromConnector(undefined), "external");
});

test("wallet-ready state requires a create intent and connected embedded wallet", () => {
  assert.equal(shouldShowWalletReady("create", true, "AUTH"), true);
  assert.equal(shouldShowWalletReady("existing", true, "AUTH"), false);
  assert.equal(shouldShowWalletReady("create", true, "walletConnect"), false);
  assert.equal(shouldShowWalletReady("create", false, "AUTH"), false);
});

test("onboarding intent parsing rejects stale or malformed values", () => {
  assert.equal(parseOnboardingIntent("create"), "create");
  assert.equal(parseOnboardingIntent("existing"), "existing");
  assert.equal(parseOnboardingIntent("unknown"), undefined);
  assert.equal(parseOnboardingIntent(null), undefined);
});

test("onboarding keeps official Arc as default and permits the Unified Balance source network", () => {
  assert.equal(arcTestnet.id, 5042002);
  assert.equal(arcTestnet.testnet, true);
  assert.match(wagmiSource, /configuredArcTestnet\s*=\s*\{[\s\S]*?\.\.\.arcTestnet/);
  assert.match(wagmiSource, /supportedNetworks[^=]*=\s*\[configuredArcTestnet, baseSepolia\]/);
  assert.match(wagmiSource, /defaultNetwork:\s*configuredArcTestnet/);
});

test("English and Vietnamese onboarding labels cover both paths and success", () => {
  for (const translations of [en, vi]) {
    assert.ok(translations["onboarding.createWallet"]);
    assert.ok(translations["onboarding.connectExisting"]);
    assert.ok(translations["onboarding.walletReady"]);
    assert.ok(translations["onboarding.noPrivateKeyStorage"]);
    assert.ok(translations["onboarding.continueEmail"]);
    assert.ok(translations["onboarding.continueGoogle"]);
    assert.ok(translations["onboarding.emailStep3"]);
  }
  assert.equal(en["onboarding.createWallet"], "Create Wallet");
  assert.equal(vi["onboarding.createWallet"], "Tạo ví");
  assert.equal(en["onboarding.createHelp"], "Use Email or Google.");
  assert.equal(vi["onboarding.createHelp"], "Dùng Email hoặc Google.");
  assert.match(en["onboarding.emailGuide"], /press the arrow button/);
  assert.match(vi["onboarding.emailGuide"], /bấm nút mũi tên/);
});
