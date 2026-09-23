import { LOCAL_WALLET_MINIMUM_PASSWORD_LENGTH } from "./localWalletKeystore.ts";

export type OnboardingPath = "existing";
export type WalletKind = "embedded" | "external";
export type WalletPasswordError = "too-short" | "mismatch";

const RECOVERY_WORD_COUNT = 12;
const RECOVERY_CHALLENGE_SIZE = 3;

/** External connection remains an AppKit wallet-picker path. */
export function appKitViewForPath(path: OnboardingPath) {
  void path;
  return "AllWallets" as const;
}

/** Existing Reown AUTH sessions remain identifiable, but creation no longer routes through AUTH. */
export function walletKindFromConnector(connectorId: string | undefined): WalletKind {
  return connectorId?.toUpperCase() === "AUTH" ? "embedded" : "external";
}

export function canContinueRecoveryPhrase(acknowledged: boolean): boolean {
  return acknowledged;
}

export function createRecoveryChallenge(
  wordCount = RECOVERY_WORD_COUNT,
  cryptoApi: Pick<Crypto, "getRandomValues"> = globalThis.crypto,
): readonly number[] {
  if (!Number.isSafeInteger(wordCount) || wordCount < RECOVERY_CHALLENGE_SIZE) {
    throw new Error("Recovery challenge requires at least three words.");
  }
  const positions = new Set<number>();
  const largestUnbiasedValue = Math.floor(0x1_0000_0000 / wordCount) * wordCount;
  while (positions.size < RECOVERY_CHALLENGE_SIZE) {
    const random = cryptoApi.getRandomValues(new Uint32Array(1))[0];
    if (random < largestUnbiasedValue) positions.add((random % wordCount) + 1);
  }
  return Object.freeze([...positions].sort((left, right) => left - right));
}

export function verifyRecoveryChallenge(
  phrase: string,
  positions: readonly number[],
  answers: Readonly<Record<number, string>>,
): boolean {
  const words = normalizePhrase(phrase).split(" ");
  if (words.length !== RECOVERY_WORD_COUNT || positions.length !== RECOVERY_CHALLENGE_SIZE || new Set(positions).size !== positions.length) return false;
  return positions.every((position) => position >= 1 && position <= words.length && normalizeWord(answers[position] ?? "") === words[position - 1]);
}

export function validateWalletPassword(password: string, confirmation: string): WalletPasswordError | undefined {
  if (password.length < LOCAL_WALLET_MINIMUM_PASSWORD_LENGTH) return "too-short";
  if (password !== confirmation) return "mismatch";
  return undefined;
}

export function canPersistLocalWallet(hasExistingWallet: boolean, replacementConfirmed: boolean): boolean {
  return !hasExistingWallet || replacementConfirmed;
}

function normalizePhrase(value: string): string {
  return value.normalize("NFKD").trim().toLowerCase().split(/\s+/u).join(" ");
}

function normalizeWord(value: string): string {
  return value.normalize("NFKD").trim().toLowerCase();
}
