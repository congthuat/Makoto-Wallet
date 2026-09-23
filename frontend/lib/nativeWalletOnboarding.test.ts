import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("../components/NativeWalletOnboarding.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../components/NativeWalletOnboarding.module.css", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../components/WalletDashboard.tsx", import.meta.url), "utf8");
const wagmi = readFileSync(new URL("./wagmi.ts", import.meta.url), "utf8");

test("Create Wallet opens the native flow while external Connect Wallet remains AppKit-backed", () => {
  assert.match(dashboard, /<NativeWalletOnboarding onClose=\{dismiss\}/);
  assert.match(dashboard, /beginOnboarding\("existing"\)/);
  assert.match(dashboard, /appKit\.open\(\{ view: appKitViewForPath\(path\) \}\)/);
  assert.doesNotMatch(dashboard, /beginCreateWallet|appKitViewForCreateMethod|continueEmail|continueGoogle/);
  assert.match(wagmi, /connectors: \[injected/);
});

test("create flow requires acknowledgement and an in-memory three-word verification challenge", () => {
  assert.match(component, /generateLocalWallet\(\)/);
  assert.match(component, /disabled=\{!canContinueRecoveryPhrase\(acknowledged\)\}/);
  assert.match(component, /createRecoveryChallenge\(\)/);
  assert.match(component, /verifyRecoveryChallenge\(secret\.mnemonic, challenge, answers\)/);
  assert.match(component, /setAnswers\(\{\}\)/);
});

test("password confirmation gates encryption and only the V1 keystore is saved", () => {
  assert.match(component, /validateWalletPassword\(password, confirmation\)/);
  assert.match(component, /encryptLocalWallet\(secret, password\)/);
  assert.match(component, /saveLocalWalletKeystore\(keystore\)/);
  assert.match(component, /setPassword\(""\)/);
  assert.match(component, /setConfirmation\(""\)/);
  assert.doesNotMatch(component, /setItem\(|localStorage|sessionStorage/);
});

test("restore validates 12 words and shows the deterministic address before encryption", () => {
  assert.match(component, /validateLocalWalletMnemonic\(phraseInput\)/);
  assert.match(component, /restoreLocalWallet\(phraseInput\)/);
  assert.match(component, /setPhraseInput\(""\)/);
  assert.match(component, /stage === "restore-confirm"/);
  assert.match(component, /secret\.address/);
});

test("existing wallet detection blocks silent overwrite and deletion requires confirmation", () => {
  assert.match(component, /loadLocalWalletKeystore\(\)/);
  assert.match(component, /hasLocalWalletKeystoreRecord\(\)/);
  assert.match(component, /canPersistLocalWallet\(hasRecord, replacementConfirmed\)/);
  assert.match(component, /onboarding\.existingUnreadable/);
  assert.match(component, /disabled=\{!confirmationChecked\} onClick=\{confirmReplacement\}/);
  assert.match(component, /disabled=\{!confirmationChecked\} onClick=\{confirmDelete\}/);
  assert.match(component, /deleteLocalWallet\(\)/);
});

test("reload remains locked and unlock is explicit", () => {
  assert.match(component, /stage: hasRecord \? "existing" as const : "intro" as const/);
  assert.match(component, /onboarding\.locked/);
  assert.match(component, /await localWallet\.unlock\(password\)/);
  assert.match(component, /stage === "unlock"/);
  assert.match(component, /localWallet\.lock\(\)/);
  assert.doesNotMatch(component, /useExternalWalletExecutionAdapter|useSendTransaction|useWriteContract|signTransaction|sendTransaction/);
});

test("successful async unlock closes without reusing a stale React event", () => {
  assert.match(component, /await localWallet\.unlock\(password\);[\s\S]*onClose\(\);/);
  assert.doesNotMatch(component, /onClose\(event\)/);
  assert.doesNotMatch(component, /event\.currentTarget/);
});

test("runtime onboarding has no logging, URL, analytics, clipboard, or direct secret persistence", () => {
  assert.doesNotMatch(component, /console\.|URLSearchParams|location\.|history\.|analytics|clipboard|document\.cookie/);
  assert.doesNotMatch(component, /privateKey|entropy|mnemonicToAccount/);
  assert.doesNotMatch(component, /throw new Error\([^\n]*(?:phraseInput|secret\.mnemonic|password)/);
});

test("native wallet modal uses Makoto theme tokens and responsive phrase grids without horizontal overflow", () => {
  assert.match(css, /var\(--mk-surface-primary\)/);
  assert.match(css, /var\(--mk-accent-primary\)/);
  assert.match(css, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(max-width:520px\)[\s\S]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(max-width:390px\)[\s\S]*overflow-x:hidden/);
  assert.match(css, /\.progress ol\{[^}]*repeat\(auto-fit,minmax\(0,1fr\)\)/);
  assert.match(css, /\.infoNote\{/);
  assert.match(component, /onboarding\.passwordAppLock/);
  assert.match(component, /aria-describedby=\{error \? "verification-error" : undefined\}/);
});
