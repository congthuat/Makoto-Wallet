import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { test } from "node:test";
import {
  LOCAL_WALLET_DERIVATION_PATH,
  LOCAL_WALLET_KEYSTORE_STORAGE_KEY,
  LOCAL_WALLET_SIGNAL_STORAGE_KEY,
  LOCAL_WALLET_PBKDF2_ITERATIONS,
  LocalWalletUnlockError,
  decryptLocalWallet,
  deleteLocalWallet,
  encryptLocalWallet,
  generateLocalWallet,
  getLocalWalletAddress,
  hasLocalWallet,
  hasLocalWalletKeystoreRecord,
  isLocalWalletLifecycleStorageKey,
  loadLocalWalletKeystore,
  loadLocalWalletRuntimeState,
  lockLocalWallet,
  restoreLocalWallet,
  saveLocalWalletKeystore,
  unlockLocalWallet,
  validateLocalWalletMnemonic,
  type MakotoKeystoreV1,
} from "./localWalletKeystore.ts";

const cryptoApi = webcrypto as unknown as Crypto;
const vector = "test test test test test test test test test test test junk";
const vectorAddress = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const password = "correct horse battery staple";

test("generation returns different valid 12-word BIP-39 wallets", () => {
  const first = generateLocalWallet();
  const second = generateLocalWallet();
  assert.equal(first.mnemonic.split(" ").length, 12);
  assert.equal(validateLocalWalletMnemonic(first.mnemonic), true);
  assert.match(first.address, /^0x[0-9a-fA-F]{40}$/);
  assert.notEqual(first.mnemonic, second.mnemonic);
  assert.notEqual(first.address, second.address);
});

test("derivation is deterministic and uses the first Ethereum account path", () => {
  const first = restoreLocalWallet(vector);
  const second = restoreLocalWallet(vector);
  assert.equal(first.address, vectorAddress);
  assert.equal(second.address, vectorAddress);
  assert.equal(getLocalWalletAddress(vector), vectorAddress);
  assert.equal(first.derivationPath, "m/44'/60'/0'/0/0");
  assert.equal(LOCAL_WALLET_DERIVATION_PATH, "m/44'/60'/0'/0/0");
});

test("restore rejects invalid and non-12-word recovery phrases", () => {
  assert.equal(validateLocalWalletMnemonic(vector), true);
  assert.equal(validateLocalWalletMnemonic("test ".repeat(12).trim()), false);
  assert.throws(() => restoreLocalWallet("not a valid recovery phrase"), /Invalid 12-word recovery phrase/);
});

test("AES-GCM keystore hides plaintext and decrypts only with the correct password", async () => {
  const secret = restoreLocalWallet(vector);
  const keystore = await encryptLocalWallet(secret, password, { cryptoApi, now: () => 1_700_000_000_000 });
  const serialized = JSON.stringify(keystore);
  assert.equal(serialized.includes(vector), false);
  assert.equal(serialized.includes("privateKey"), false);
  assert.equal(keystore.crypto.cipher, "AES-256-GCM");
  assert.equal(keystore.crypto.kdf, "PBKDF2-HMAC-SHA256");
  assert.equal(keystore.crypto.kdfParams.iterations, LOCAL_WALLET_PBKDF2_ITERATIONS);
  assert.deepEqual(await decryptLocalWallet(keystore, password, cryptoApi), secret);
  await assert.rejects(decryptLocalWallet(keystore, "incorrect password", cryptoApi), /Unable to unlock local wallet/);
});

test("ciphertext and authentication-tag changes fail authenticated decryption", async () => {
  const keystore = await encryptLocalWallet(restoreLocalWallet(vector), password, { cryptoApi });
  await assert.rejects(decryptLocalWallet(tamperCiphertext(keystore, 0), password, cryptoApi), /Unable to unlock local wallet/);
  await assert.rejects(decryptLocalWallet(tamperCiphertext(keystore, -1), password, cryptoApi), /Unable to unlock local wallet/);
});

test("authenticated safe metadata cannot be modified", async () => {
  const keystore = await encryptLocalWallet(restoreLocalWallet(vector), password, { cryptoApi });
  const modified = { ...keystore, createdAt: new Date(Date.parse(keystore.createdAt) + 1_000).toISOString() };
  await assert.rejects(decryptLocalWallet(modified, password, cryptoApi), /Unable to unlock local wallet/);
});

test("each encryption uses a unique salt and IV", async () => {
  const secret = restoreLocalWallet(vector);
  const first = await encryptLocalWallet(secret, password, { cryptoApi });
  const second = await encryptLocalWallet(secret, password, { cryptoApi });
  assert.notEqual(first.crypto.salt, second.crypto.salt);
  assert.notEqual(first.crypto.iv, second.crypto.iv);
  assert.notEqual(first.crypto.ciphertext, second.crypto.ciphertext);
});

test("storage persists only the encrypted keystore and delete removes it", async () => {
  const storage = new MemoryStorage();
  const keystore = await encryptLocalWallet(restoreLocalWallet(vector), password, { cryptoApi });
  saveLocalWalletKeystore(keystore, storage);
  const stored = storage.getItem(LOCAL_WALLET_KEYSTORE_STORAGE_KEY);
  assert.ok(stored);
  assert.equal(stored.includes(vector), false);
  assert.equal(stored.includes("privateKey"), false);
  assert.deepEqual(loadLocalWalletKeystore(storage), keystore);
  assert.equal(hasLocalWallet(storage), true);
  const deleted = deleteLocalWallet(storage);
  assert.equal(storage.getItem(LOCAL_WALLET_KEYSTORE_STORAGE_KEY), null);
  assert.equal(hasLocalWallet(storage), false);
  assert.equal(deleted.status, "unavailable");
});

test("an unreadable record still occupies the keystore slot", () => {
  const storage = new MemoryStorage();
  storage.setItem(LOCAL_WALLET_KEYSTORE_STORAGE_KEY, "not-json");
  assert.equal(loadLocalWalletKeystore(storage), undefined);
  assert.equal(hasLocalWallet(storage), false);
  assert.equal(hasLocalWalletKeystoreRecord(storage), true);
});

test("cross-tab lifecycle synchronization accepts only safe wallet metadata keys", () => {
  assert.equal(isLocalWalletLifecycleStorageKey(LOCAL_WALLET_KEYSTORE_STORAGE_KEY), true);
  assert.equal(isLocalWalletLifecycleStorageKey(LOCAL_WALLET_SIGNAL_STORAGE_KEY), true);
  assert.equal(isLocalWalletLifecycleStorageKey("password"), false);
  assert.equal(isLocalWalletLifecycleStorageKey(null), false);
});

test("stored wallets load locked, unlock in memory, and lock drops secret/account references", async () => {
  const storage = new MemoryStorage();
  const keystore = await encryptLocalWallet(restoreLocalWallet(vector), password, { cryptoApi });
  saveLocalWalletKeystore(keystore, storage);
  const loaded = loadLocalWalletRuntimeState(storage);
  assert.equal(loaded.status, "locked");
  assert.equal("secret" in loaded, false);
  assert.equal("account" in loaded, false);
  assert.equal(loaded.wallet.kind, "local");
  assert.equal(loaded.wallet.status, "locked");

  const unlocked = await unlockLocalWallet(keystore, password, cryptoApi);
  assert.equal(unlocked.status, "unlocked");
  assert.equal(unlocked.wallet.status, "connected");
  assert.equal(unlocked.account.address, vectorAddress);

  const locked = lockLocalWallet(unlocked);
  assert.equal(locked.status, "locked");
  assert.equal("secret" in locked, false);
  assert.equal("account" in locked, false);
  assert.equal(locked.wallet.address, vectorAddress);
});

test("production persistence round-trip reloads locked and unlocks with the exact same password", async () => {
  const storage = new MemoryStorage();
  const exactPassword = "  M@koto wallet #1  ";
  const encrypted = await encryptLocalWallet(restoreLocalWallet(vector), exactPassword, { cryptoApi, now: () => 1_700_000_000_000 });
  saveLocalWalletKeystore(encrypted, storage);

  const reloadedState = loadLocalWalletRuntimeState(storage);
  const persisted = loadLocalWalletKeystore(storage);
  assert.equal(reloadedState.status, "locked");
  assert.equal(reloadedState.wallet.status, "locked");
  assert.ok(persisted);
  assert.equal(persisted.account.address, vectorAddress);
  assert.equal(persisted.crypto.kdfParams.iterations, 600_000);
  assert.equal(JSON.stringify(persisted).includes(vector), false);

  const unlocked = await unlockLocalWallet(persisted, exactPassword, cryptoApi);
  assert.equal(unlocked.status, "unlocked");
  assert.equal(unlocked.account.address, vectorAddress);
  await assert.rejects(unlockLocalWallet(persisted, exactPassword.trim(), cryptoApi), isUnlockFailure("DECRYPT_AUTH_FAILED"));
  await assert.rejects(unlockLocalWallet(persisted, "wrong password", cryptoApi), isUnlockFailure("DECRYPT_AUTH_FAILED"));
});

test("serialized address casing and authenticated metadata round-trip safely", async () => {
  const storage = new MemoryStorage();
  const exactPassword = "Symbols !@#$%^&*()";
  const encrypted = await encryptLocalWallet(restoreLocalWallet(vector), exactPassword, { cryptoApi, now: () => 1_700_000_000_000 });
  const serialized = JSON.parse(JSON.stringify(encrypted)) as MakotoKeystoreV1;
  storage.setItem(LOCAL_WALLET_KEYSTORE_STORAGE_KEY, JSON.stringify({ ...serialized, account: { ...serialized.account, address: serialized.account.address.toLowerCase() } }));
  const persisted = loadLocalWalletKeystore(storage);
  assert.ok(persisted);
  assert.equal(persisted.account.address, vectorAddress);
  assert.equal((await unlockLocalWallet(persisted, exactPassword, cryptoApi)).account.address, vectorAddress);

  await assert.rejects(decryptLocalWallet({ ...persisted, createdAt: new Date(Date.parse(persisted.createdAt) + 1_000).toISOString() }, exactPassword, cryptoApi), isUnlockFailure("DECRYPT_AUTH_FAILED"));
  await assert.rejects(decryptLocalWallet(tamperCiphertext(persisted, 0), exactPassword, cryptoApi), isUnlockFailure("DECRYPT_AUTH_FAILED"));
});

test("keystore password remains separate from the six-digit App Lock PIN", async () => {
  const secret = restoreLocalWallet(vector);
  await assert.rejects(encryptLocalWallet(secret, "123456", { cryptoApi }), /at least 8 characters/);
});

class MemoryStorage implements Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

function tamperCiphertext(keystore: MakotoKeystoreV1, index: number): MakotoKeystoreV1 {
  const bytes = Uint8Array.from(atob(keystore.crypto.ciphertext), (character) => character.charCodeAt(0));
  const target = index < 0 ? bytes.length + index : index;
  bytes[target] ^= 1;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { ...keystore, crypto: { ...keystore.crypto, ciphertext: btoa(binary) } };
}

function isUnlockFailure(code: LocalWalletUnlockError["code"]) {
  return (error: unknown) => error instanceof LocalWalletUnlockError && error.code === code;
}
