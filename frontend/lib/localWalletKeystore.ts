import { validateMnemonic as validateBip39Mnemonic } from "@scure/bip39";
import { getAddress, isAddress, type Address } from "viem";
import { english, generateMnemonic, mnemonicToAccount, type HDAccount } from "viem/accounts";
import { createLocalMakotoWalletAccount, type LocalMakotoWalletAccount } from "./walletAccount.ts";

export const LOCAL_WALLET_DERIVATION_PATH = "m/44'/60'/0'/0/0" as const;
export const LOCAL_WALLET_KEYSTORE_STORAGE_KEY = "makoto.localWallet.keystore.v1";
export const LOCAL_WALLET_SIGNAL_STORAGE_KEY = "makoto.localWallet.signal.v1";
export const LOCAL_WALLET_KEYSTORE_VERSION = 1 as const;
export const LOCAL_WALLET_PBKDF2_ITERATIONS = 600_000;
export const LOCAL_WALLET_MINIMUM_PASSWORD_LENGTH = 8;

const AES_KEY_LENGTH = 256 as const;
const AES_GCM_TAG_LENGTH = 128 as const;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type MakotoKeystoreV1 = Readonly<{
  version: typeof LOCAL_WALLET_KEYSTORE_VERSION;
  account: Readonly<{
    address: Address;
    derivationPath: typeof LOCAL_WALLET_DERIVATION_PATH;
  }>;
  crypto: Readonly<{
    cipher: "AES-256-GCM";
    ciphertext: string;
    iv: string;
    tagLength: typeof AES_GCM_TAG_LENGTH;
    salt: string;
    kdf: "PBKDF2-HMAC-SHA256";
    kdfParams: Readonly<{
      hash: "SHA-256";
      iterations: typeof LOCAL_WALLET_PBKDF2_ITERATIONS;
      keyLength: typeof AES_KEY_LENGTH;
    }>;
  }>;
  createdAt: string;
}>;

export type LocalWalletSecretMaterial = Readonly<{
  mnemonic: string;
  address: Address;
  derivationPath: typeof LOCAL_WALLET_DERIVATION_PATH;
}>;

export type LockedLocalWalletState = Readonly<{
  status: "locked";
  wallet: LocalMakotoWalletAccount;
}>;

export type UnlockedLocalWalletState = Readonly<{
  status: "unlocked";
  wallet: LocalMakotoWalletAccount;
  secret: LocalWalletSecretMaterial;
  account: HDAccount;
}>;

export type UnavailableLocalWalletState = Readonly<{
  status: "unavailable";
  wallet: LocalMakotoWalletAccount;
}>;

export type LocalWalletRuntimeState = LockedLocalWalletState | UnlockedLocalWalletState | UnavailableLocalWalletState;
export type LocalWalletStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type LocalWalletUnlockFailureCode =
  | "KEYSTORE_NOT_FOUND"
  | "INVALID_KEYSTORE_FORMAT"
  | "UNSUPPORTED_VERSION"
  | "INVALID_KDF_PARAMETERS"
  | "DECRYPT_AUTH_FAILED"
  | "INVALID_DECRYPTED_PAYLOAD"
  | "INVALID_MNEMONIC"
  | "DERIVED_ADDRESS_MISMATCH"
  | "RUNTIME_STATE_ERROR";

/** Safe diagnostic classification; the production UI intentionally keeps one generic message. */
export class LocalWalletUnlockError extends Error {
  readonly code: LocalWalletUnlockFailureCode;
  constructor(code: LocalWalletUnlockFailureCode) {
    super("Unable to unlock local wallet.");
    this.name = "LocalWalletUnlockError";
    this.code = code;
  }
}

type CryptoOptions = Readonly<{
  cryptoApi?: Crypto;
  now?: () => number;
}>;

export function validateLocalWalletMnemonic(value: string): boolean {
  const normalized = normalizeMnemonic(value);
  return normalized.split(" ").length === 12 && validateBip39Mnemonic(normalized, english);
}

export function generateLocalWallet(): LocalWalletSecretMaterial {
  return restoreLocalWallet(generateMnemonic(english, 128));
}

export function restoreLocalWallet(value: string): LocalWalletSecretMaterial {
  const mnemonic = normalizeMnemonic(value);
  if (!validateLocalWalletMnemonic(mnemonic)) throw new Error("Invalid 12-word recovery phrase.");
  const account = deriveAccount(mnemonic);
  return Object.freeze({ mnemonic, address: account.address, derivationPath: LOCAL_WALLET_DERIVATION_PATH });
}

export function getLocalWalletAddress(value: string): Address {
  return restoreLocalWallet(value).address;
}

export async function encryptLocalWallet(
  secret: LocalWalletSecretMaterial,
  password: string,
  options: CryptoOptions = {},
): Promise<MakotoKeystoreV1> {
  assertPassword(password);
  const restored = restoreLocalWallet(secret.mnemonic);
  if (restored.address !== getAddress(secret.address) || secret.derivationPath !== LOCAL_WALLET_DERIVATION_PATH) {
    throw new Error("Local wallet secret does not match its account metadata.");
  }

  const cryptoApi = options.cryptoApi ?? globalThis.crypto;
  const salt = cryptoApi.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = cryptoApi.getRandomValues(new Uint8Array(IV_LENGTH));
  const createdAt = new Date((options.now ?? Date.now)()).toISOString();
  const header = createKeystoreHeader(restored.address, salt, iv, createdAt);
  const key = await deriveEncryptionKey(password, salt, cryptoApi);
  const plaintext = encoder.encode(JSON.stringify({ version: 1, mnemonic: restored.mnemonic }));
  try {
    const encrypted = await cryptoApi.subtle.encrypt(
      { name: "AES-GCM", iv: toBufferSource(iv), additionalData: toBufferSource(keystoreAdditionalData(header)), tagLength: AES_GCM_TAG_LENGTH },
      key,
      toBufferSource(plaintext),
    );
    return Object.freeze({
      ...header,
      crypto: Object.freeze({ ...header.crypto, ciphertext: bytesToBase64(new Uint8Array(encrypted)) }),
    });
  } finally {
    plaintext.fill(0);
  }
}

export async function decryptLocalWallet(
  keystore: MakotoKeystoreV1,
  password: string,
  cryptoApi: Crypto = globalThis.crypto,
): Promise<LocalWalletSecretMaterial> {
  assertPassword(password);
  const validated = parseMakotoKeystore(JSON.stringify(keystore));
  if (!validated) throw new LocalWalletUnlockError(classifyInvalidKeystore(keystore));

  let decrypted: Uint8Array;
  try {
    const salt = base64ToBytes(validated.crypto.salt);
    const iv = base64ToBytes(validated.crypto.iv);
    const ciphertext = base64ToBytes(validated.crypto.ciphertext);
    const key = await deriveEncryptionKey(password, salt, cryptoApi);
    decrypted = new Uint8Array(await cryptoApi.subtle.decrypt(
      { name: "AES-GCM", iv: toBufferSource(iv), additionalData: toBufferSource(keystoreAdditionalData(validated)), tagLength: validated.crypto.tagLength },
      key,
      toBufferSource(ciphertext),
    ));
  } catch {
    throw new LocalWalletUnlockError("DECRYPT_AUTH_FAILED");
  }
  try {
    let payload: unknown;
    try { payload = JSON.parse(decoder.decode(decrypted)) as unknown; }
    catch { throw new LocalWalletUnlockError("INVALID_DECRYPTED_PAYLOAD"); }
    if (!isRecord(payload) || payload.version !== 1 || typeof payload.mnemonic !== "string") throw new LocalWalletUnlockError("INVALID_DECRYPTED_PAYLOAD");
    let secret: LocalWalletSecretMaterial;
    try { secret = restoreLocalWallet(payload.mnemonic); }
    catch { throw new LocalWalletUnlockError("INVALID_MNEMONIC"); }
    if (secret.address !== validated.account.address) throw new LocalWalletUnlockError("DERIVED_ADDRESS_MISMATCH");
    return secret;
  } finally {
    decrypted.fill(0);
  }
}

export function saveLocalWalletKeystore(keystore: MakotoKeystoreV1, storage?: LocalWalletStorage): void {
  const validated = parseMakotoKeystore(JSON.stringify(keystore));
  if (!validated) throw new Error("Invalid local wallet keystore.");
  requireStorage(storage).setItem(LOCAL_WALLET_KEYSTORE_STORAGE_KEY, JSON.stringify(validated));
}

export function loadLocalWalletKeystore(storage?: LocalWalletStorage): MakotoKeystoreV1 | undefined {
  const resolved = optionalStorage(storage);
  if (!resolved) return undefined;
  return parseMakotoKeystore(resolved.getItem(LOCAL_WALLET_KEYSTORE_STORAGE_KEY));
}

export function hasLocalWallet(storage?: LocalWalletStorage): boolean {
  return loadLocalWalletKeystore(storage) !== undefined;
}

export function hasLocalWalletKeystoreRecord(storage?: LocalWalletStorage): boolean {
  return optionalStorage(storage)?.getItem(LOCAL_WALLET_KEYSTORE_STORAGE_KEY) !== null;
}

export function isLocalWalletLifecycleStorageKey(key: string | null) {
  return key === LOCAL_WALLET_KEYSTORE_STORAGE_KEY || key === LOCAL_WALLET_SIGNAL_STORAGE_KEY;
}

export function deleteLocalWallet(storage?: LocalWalletStorage): UnavailableLocalWalletState {
  optionalStorage(storage)?.removeItem(LOCAL_WALLET_KEYSTORE_STORAGE_KEY);
  return unavailableState();
}

/** Loading persisted metadata never decrypts it and therefore always starts locked. */
export function loadLocalWalletRuntimeState(storage?: LocalWalletStorage): LocalWalletRuntimeState {
  const keystore = loadLocalWalletKeystore(storage);
  return keystore ? lockedState(keystore.account.address) : unavailableState();
}

export async function unlockLocalWallet(
  keystore: MakotoKeystoreV1,
  password: string,
  cryptoApi: Crypto = globalThis.crypto,
): Promise<UnlockedLocalWalletState> {
  const secret = await decryptLocalWallet(keystore, password, cryptoApi);
  try {
    return Object.freeze({
      status: "unlocked" as const,
      wallet: createLocalMakotoWalletAccount({ address: secret.address, status: "connected" }),
      secret,
      account: deriveAccount(secret.mnemonic),
    });
  } catch {
    throw new LocalWalletUnlockError("RUNTIME_STATE_ERROR");
  }
}

/**
 * Returns a new metadata-only state so callers can replace their reference to
 * decrypted material. JavaScript cannot guarantee physical memory zeroization.
 */
export function lockLocalWallet(state: LocalWalletRuntimeState): LocalWalletRuntimeState {
  return state.wallet.address ? lockedState(state.wallet.address) : unavailableState();
}

export function parseMakotoKeystore(raw: string | null): MakotoKeystoreV1 | undefined {
  try {
    const value: unknown = raw ? JSON.parse(raw) : undefined;
    if (!isRecord(value) || value.version !== 1 || !isRecord(value.account) || !isRecord(value.crypto)) return undefined;
    const account = value.account;
    const cryptoRecord = value.crypto;
    const kdfParams = cryptoRecord.kdfParams;
    if (
      typeof account.address !== "string" || !isAddress(account.address) || account.derivationPath !== LOCAL_WALLET_DERIVATION_PATH ||
      cryptoRecord.cipher !== "AES-256-GCM" || typeof cryptoRecord.ciphertext !== "string" || typeof cryptoRecord.iv !== "string" ||
      cryptoRecord.tagLength !== AES_GCM_TAG_LENGTH || typeof cryptoRecord.salt !== "string" || cryptoRecord.kdf !== "PBKDF2-HMAC-SHA256" ||
      !isRecord(kdfParams) || kdfParams.hash !== "SHA-256" || kdfParams.iterations !== LOCAL_WALLET_PBKDF2_ITERATIONS || kdfParams.keyLength !== AES_KEY_LENGTH ||
      typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))
    ) return undefined;
    if (base64ToBytes(cryptoRecord.salt).length !== SALT_LENGTH || base64ToBytes(cryptoRecord.iv).length !== IV_LENGTH || base64ToBytes(cryptoRecord.ciphertext).length <= AES_GCM_TAG_LENGTH / 8) return undefined;
    return Object.freeze({
      version: 1,
      account: Object.freeze({ address: getAddress(account.address), derivationPath: LOCAL_WALLET_DERIVATION_PATH }),
      crypto: Object.freeze({
        cipher: "AES-256-GCM",
        ciphertext: cryptoRecord.ciphertext,
        iv: cryptoRecord.iv,
        tagLength: AES_GCM_TAG_LENGTH,
        salt: cryptoRecord.salt,
        kdf: "PBKDF2-HMAC-SHA256",
        kdfParams: Object.freeze({ hash: "SHA-256", iterations: LOCAL_WALLET_PBKDF2_ITERATIONS, keyLength: AES_KEY_LENGTH }),
      }),
      createdAt: value.createdAt,
    });
  } catch {
    return undefined;
  }
}

function deriveAccount(mnemonic: string): HDAccount {
  return mnemonicToAccount(mnemonic, { path: LOCAL_WALLET_DERIVATION_PATH });
}

function normalizeMnemonic(value: string): string {
  return value.normalize("NFKD").trim().toLowerCase().split(/\s+/u).join(" ");
}

function assertPassword(password: string): void {
  if (password.length < LOCAL_WALLET_MINIMUM_PASSWORD_LENGTH) throw new Error("Keystore password must contain at least 8 characters.");
}

async function deriveEncryptionKey(password: string, salt: Uint8Array, cryptoApi: Crypto): Promise<CryptoKey> {
  const passwordBytes = encoder.encode(password);
  try {
    const material = await cryptoApi.subtle.importKey("raw", toBufferSource(passwordBytes), "PBKDF2", false, ["deriveKey"]);
    return cryptoApi.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt: toBufferSource(salt), iterations: LOCAL_WALLET_PBKDF2_ITERATIONS },
      material,
      { name: "AES-GCM", length: AES_KEY_LENGTH },
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    passwordBytes.fill(0);
  }
}

function createKeystoreHeader(address: Address, salt: Uint8Array, iv: Uint8Array, createdAt: string): Omit<MakotoKeystoreV1, "crypto"> & { crypto: Omit<MakotoKeystoreV1["crypto"], "ciphertext"> } {
  return {
    version: 1,
    account: { address, derivationPath: LOCAL_WALLET_DERIVATION_PATH },
    crypto: {
      cipher: "AES-256-GCM",
      iv: bytesToBase64(iv),
      tagLength: AES_GCM_TAG_LENGTH,
      salt: bytesToBase64(salt),
      kdf: "PBKDF2-HMAC-SHA256",
      kdfParams: { hash: "SHA-256", iterations: LOCAL_WALLET_PBKDF2_ITERATIONS, keyLength: AES_KEY_LENGTH },
    },
    createdAt,
  };
}

function keystoreAdditionalData(keystore: MakotoKeystoreV1 | ReturnType<typeof createKeystoreHeader>): Uint8Array {
  return encoder.encode(JSON.stringify({
    version: keystore.version,
    account: keystore.account,
    crypto: {
      cipher: keystore.crypto.cipher,
      iv: keystore.crypto.iv,
      tagLength: keystore.crypto.tagLength,
      salt: keystore.crypto.salt,
      kdf: keystore.crypto.kdf,
      kdfParams: keystore.crypto.kdfParams,
    },
    createdAt: keystore.createdAt,
  }));
}

function lockedState(address: Address): LockedLocalWalletState {
  return Object.freeze({ status: "locked" as const, wallet: createLocalMakotoWalletAccount({ address, status: "locked" }) });
}

function unavailableState(): UnavailableLocalWalletState {
  return Object.freeze({ status: "unavailable" as const, wallet: createLocalMakotoWalletAccount({ status: "unavailable" }) });
}

function optionalStorage(storage?: LocalWalletStorage): LocalWalletStorage | undefined {
  if (storage) return storage;
  return typeof window === "undefined" ? undefined : window.localStorage;
}

function requireStorage(storage?: LocalWalletStorage): LocalWalletStorage {
  const resolved = optionalStorage(storage);
  if (!resolved) throw new Error("Local wallet storage is unavailable.");
  return resolved;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function classifyInvalidKeystore(value: unknown): LocalWalletUnlockFailureCode {
  if (!isRecord(value)) return "INVALID_KEYSTORE_FORMAT";
  if (value.version !== LOCAL_WALLET_KEYSTORE_VERSION) return "UNSUPPORTED_VERSION";
  if (isRecord(value.crypto)) {
    const params = value.crypto.kdfParams;
    if (value.crypto.kdf !== "PBKDF2-HMAC-SHA256" || !isRecord(params) || params.hash !== "SHA-256" || params.iterations !== LOCAL_WALLET_PBKDF2_ITERATIONS || params.keyLength !== AES_KEY_LENGTH) {
      return "INVALID_KDF_PARAMETERS";
    }
  }
  return "INVALID_KEYSTORE_FORMAT";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) throw new Error("Invalid encoded data.");
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function toBufferSource(value: Uint8Array): ArrayBuffer {
  return Uint8Array.from(value).buffer;
}
