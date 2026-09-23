import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { arcTestnet } from "viem/chains";
import {
  appKitViewForPath,
  canContinueRecoveryPhrase,
  canPersistLocalWallet,
  createRecoveryChallenge,
  validateWalletPassword,
  verifyRecoveryChallenge,
  walletKindFromConnector,
} from "./onboarding.ts";
import { en } from "../i18n/en.ts";
import { vi } from "../i18n/vi.ts";

const wagmiSource = readFileSync(new URL("./wagmi.ts", import.meta.url), "utf8");
const phrase = "test test test test test test test test test test test junk";

test("external Connect Wallet continues to use the AppKit wallet picker", () => {
  assert.equal(appKitViewForPath("existing"), "AllWallets");
});

test("existing Reown connector identity remains compatible", () => {
  assert.equal(walletKindFromConnector("AUTH"), "embedded");
  assert.equal(walletKindFromConnector("auth"), "embedded");
  assert.equal(walletKindFromConnector("injected"), "external");
  assert.equal(walletKindFromConnector(undefined), "external");
});

test("backup acknowledgement is mandatory", () => {
  assert.equal(canContinueRecoveryPhrase(false), false);
  assert.equal(canContinueRecoveryPhrase(true), true);
});

test("recovery challenge selects three unique valid positions", () => {
  const positions = createRecoveryChallenge();
  assert.equal(positions.length, 3);
  assert.equal(new Set(positions).size, 3);
  assert.equal(positions.every((position) => position >= 1 && position <= 12), true);
});

test("recovery challenge rejects incorrect answers and accepts normalized correct answers", () => {
  const positions = [3, 7, 12] as const;
  assert.equal(verifyRecoveryChallenge(phrase, positions, { 3: "test", 7: "wrong", 12: "junk" }), false);
  assert.equal(verifyRecoveryChallenge(phrase, positions, { 3: " TEST ", 7: "test", 12: "junk" }), true);
});

test("wallet password validation follows the Phase 2 minimum and requires a match", () => {
  assert.equal(validateWalletPassword("123456", "123456"), "too-short");
  assert.equal(validateWalletPassword("correct horse", "different"), "mismatch");
  assert.equal(validateWalletPassword("correct horse", "correct horse"), undefined);
});

test("an existing wallet cannot be overwritten without explicit replacement confirmation", () => {
  assert.equal(canPersistLocalWallet(false, false), true);
  assert.equal(canPersistLocalWallet(true, false), false);
  assert.equal(canPersistLocalWallet(true, true), true);
});

test("onboarding keeps official Arc as default and permits the Unified Balance source network", () => {
  assert.equal(arcTestnet.id, 5042002);
  assert.equal(arcTestnet.testnet, true);
  assert.match(wagmiSource, /configuredArcTestnet\s*=\s*\{[\s\S]*?\.\.\.arcTestnet/);
  assert.match(wagmiSource, /supportedNetworks[^=]*=\s*\[configuredArcTestnet, baseSepolia\]/);
  assert.match(wagmiSource, /defaultNetwork:\s*configuredArcTestnet/);
});

test("English and Vietnamese cover every native wallet stage without Email or Google copy", () => {
  const keys = [
    "createWallet", "connectExisting", "recoveryPhrase", "importWallet", "verifyBackup", "walletPassword",
    "walletCreated", "localWalletFound", "unlock", "deleteWallet", "restoreAddress", "locked",
  ] as const;
  for (const translations of [en, vi]) for (const key of keys) assert.ok(translations[`onboarding.${key}`]);
  assert.equal(en["onboarding.createWallet"], "Create Wallet");
  assert.equal(vi["onboarding.createWallet"], "Tạo ví");
  for (const translations of [en, vi]) {
    const onboardingCopy = Object.entries(translations).filter(([key]) => key.startsWith("onboarding.")).map(([, value]) => value).join(" ");
    assert.doesNotMatch(onboardingCopy, /Email|Google|Reown/i);
  }
});
