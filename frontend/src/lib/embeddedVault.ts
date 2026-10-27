/**
 * Makoto embedded wallet vault — same model as MetaMask's local vault.
 * - The 12/24-word recovery phrase (BIP39) is generated IN THE BROWSER.
 * - It is encrypted IN THE BROWSER with the user's wallet password:
 *   PBKDF2-SHA256 (600k iterations) → AES-256-GCM, bound to the Google account id (AAD).
 * - Only that ciphertext is sent to the Makoto server. Password and phrase never leave the device.
 * - Address derivation: BIP44 m/44'/60'/0'/0/0, identical to OKX, MetaMask and Trust.
 */
import { generateMnemonic, english, mnemonicToAccount } from 'viem/accounts'
import { validateMnemonic } from '@scure/bip39'

export type VaultWords = 12 | 24
export type EncryptedVault = { v: 1; kdf: 'pbkdf2-sha256'; iterations: number; salt: string; iv: string; ciphertext: string; words: VaultWords }

export const VAULT_ITERATIONS = 600_000
export const MIN_PASSWORD_LENGTH = 8

const toB64 = (bytes: Uint8Array) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s) }
const fromB64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
const utf8 = new TextEncoder()

export function createRecoveryPhrase(words: VaultWords = 12): string {
  return generateMnemonic(english, words === 24 ? 256 : 128)
}

/** Normalise user input (spacing / case) and check the BIP39 checksum. */
export function normalizePhrase(input: string): string { return input.trim().toLowerCase().split(/\s+/).join(' ') }
export function isValidPhrase(input: string): boolean {
  const phrase = normalizePhrase(input)
  const count = phrase.split(' ').length
  return (count === 12 || count === 24) && validateMnemonic(phrase, english)
}

export function addressFromPhrase(phrase: string): `0x${string}` {
  return mnemonicToAccount(normalizePhrase(phrase)).address
}

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return 'Use at least 8 characters.'
  if (/^(.)\1+$/.test(password) || /^(?:12345678|password|qwerty12|11111111)$/i.test(password)) return 'This password is too easy to guess.'
  return null
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', utf8.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

/** Encrypt the phrase for backup. `accountId` (Google sub) is bound as AES-GCM additional data. */
export async function encryptPhrase(phrase: string, password: string, accountId: string, iterations = VAULT_ITERATIONS): Promise<EncryptedVault> {
  const normalized = normalizePhrase(phrase)
  if (!isValidPhrase(normalized)) throw new Error('Invalid recovery phrase.')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt, iterations)
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: utf8.encode(`makoto-vault:v1:${accountId}`) }, key, utf8.encode(normalized)))
  return { v: 1, kdf: 'pbkdf2-sha256', iterations, salt: toB64(salt), iv: toB64(iv), ciphertext: toB64(ciphertext), words: normalized.split(' ').length === 24 ? 24 : 12 }
}

/** Wrong password (or a vault from another account) fails AES-GCM authentication. */
export async function decryptPhrase(vault: EncryptedVault, password: string, accountId: string): Promise<string> {
  if (vault?.v !== 1 || vault.kdf !== 'pbkdf2-sha256') throw new Error('Unsupported backup format.')
  const key = await deriveKey(password, fromB64(vault.salt), vault.iterations)
  let plain: ArrayBuffer
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(vault.iv) as BufferSource, additionalData: utf8.encode(`makoto-vault:v1:${accountId}`) }, key, fromB64(vault.ciphertext) as BufferSource)
  } catch {
    throw new Error('Wrong wallet password.')
  }
  const phrase = new TextDecoder().decode(plain)
  if (!isValidPhrase(phrase)) throw new Error('Backup is damaged.')
  return phrase
}
