/**
 * Makoto embedded wallet ("Sign in with Google").
 * - The key exists only in this tab's memory after the user unlocks with their wallet password.
 * - Every signature (transaction, message, typed data) first opens Makoto's approval screen;
 *   nothing is signed without an explicit "Approve" click. The Agent can never approve.
 * - Read calls go straight to the Arc RPC.
 */
import { createWalletClient, defineChain, http, hexToString, isHex, type Hex } from 'viem'
import type { HDAccount } from 'viem/accounts'
import type { BrowserWallet, Eip1193 } from './walletProviders.ts'
import { setExternalWallet } from './walletProviders.ts'
import type { EncryptedVault } from './embeddedVault.ts'

/** Key-derivation code (BIP39 wordlist, HD keys) loads only when someone uses the Google wallet. */
const vaultLib = () => import('./embeddedVault.ts')
const accountsLib = () => import('viem/accounts')

const ARC_ID = 5042002
const ARC_HEX = '0x4cef52'
const ARC_RPC = 'https://rpc.testnet.arc.io'
export const arcChain = defineChain({
  id: ARC_ID, name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] } },
  blockExplorers: { default: { name: 'ArcScan', url: 'https://testnet.arcscan.app' } },
})

/* ---------------- approval queue (UI subscribes) ---------------- */
export type ApprovalRequest =
  | { id: number; kind: 'transaction'; from: string; tx: { to?: string; data?: Hex; value?: bigint; gas?: bigint; maxFeePerGas?: bigint; gasPrice?: bigint } }
  | { id: number; kind: 'message'; from: string; message: string; raw: Hex | string }
  | { id: number; kind: 'typed'; from: string; typed: { domain?: Record<string, unknown>; primaryType?: string; message?: unknown } }

type Pending = { request: ApprovalRequest; resolve: (ok: boolean) => void }
let queue: Pending[] = []
let nextId = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())
export const subscribeApprovals = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const currentApproval = (): ApprovalRequest | null => queue[0]?.request ?? null
export function answerApproval(id: number, approved: boolean) {
  const item = queue.find((entry) => entry.request.id === id)
  if (!item) return
  queue = queue.filter((entry) => entry !== item)
  item.resolve(approved)
  emit()
}
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never
function askApproval(request: DistributiveOmit<ApprovalRequest, 'id'>): Promise<boolean> {
  return new Promise((resolve) => { queue = [...queue, { request: { ...request, id: nextId++ } as ApprovalRequest, resolve }]; emit() })
}
const rejected = () => Object.assign(new Error('User rejected the request.'), { code: 4001 })

/* ---------------- session ---------------- */
export type EmbeddedSession = { sub: string; email: string; address: `0x${string}`; words: 12 | 24 }
let session: (EmbeddedSession & { account: HDAccount }) | null = null
const CACHE_KEY = 'mk.embedded.v1'
type Cached = { sub: string; email: string; address: string; vault: EncryptedVault }

export const embeddedSession = (): EmbeddedSession | null => session && { sub: session.sub, email: session.email, address: session.address, words: session.words }
export function cachedEmbedded(): Cached | null {
  try { const value = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null'); return value?.sub && value?.vault ? value : null } catch { return null }
}
function cache(value: Cached | null) { try { if (value) localStorage.setItem(CACHE_KEY, JSON.stringify(value)); else localStorage.removeItem(CACHE_KEY) } catch { /* optional */ } }

async function rpc(method: string, params: unknown[] = []) {
  const response = await fetch(ARC_RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  const json = await response.json()
  if (json.error) throw Object.assign(new Error(json.error.message || 'RPC error'), { code: json.error.code })
  return json.result
}

const big = (value: unknown) => (typeof value === 'string' && /^0x[0-9a-f]*$/i.test(value) ? BigInt(value === '0x' ? 0 : value) : undefined)

function provider(): Eip1193 {
  const handlers = new Map<string, Set<(...args: any[]) => void>>()
  return {
    on: (event, cb) => { if (!handlers.has(event)) handlers.set(event, new Set()); handlers.get(event)!.add(cb) },
    removeListener: (event, cb) => { handlers.get(event)?.delete(cb) },
    request: async ({ method, params = [] }) => {
      const active = session
      if (!active) throw Object.assign(new Error('Makoto wallet is locked.'), { code: 4100 })
      const p = params as any[]
      switch (method) {
        case 'eth_requestAccounts': case 'eth_accounts': return [active.address]
        case 'eth_chainId': return ARC_HEX
        case 'net_version': return String(ARC_ID)
        case 'wallet_switchEthereumChain': case 'wallet_addEthereumChain': {
          const chainId = String(p?.[0]?.chainId ?? '').toLowerCase()
          if (chainId === ARC_HEX) return null
          throw Object.assign(new Error('Makoto wallet only supports Arc Testnet.'), { code: 4902 })
        }
        case 'eth_sendTransaction': {
          const raw = p?.[0] ?? {}
          if (raw.from && String(raw.from).toLowerCase() !== active.address.toLowerCase()) throw Object.assign(new Error('Unknown sender.'), { code: 4100 })
          const tx = { to: raw.to, data: raw.data ?? raw.input, value: big(raw.value), gas: big(raw.gas ?? raw.gasLimit), maxFeePerGas: big(raw.maxFeePerGas), maxPriorityFeePerGas: big(raw.maxPriorityFeePerGas), gasPrice: big(raw.gasPrice), nonce: raw.nonce ? Number(big(raw.nonce)) : undefined }
          if (!(await askApproval({ kind: 'transaction', from: active.address, tx }))) throw rejected()
          const client = createWalletClient({ account: active.account, chain: arcChain, transport: http(ARC_RPC) })
          const fees = tx.maxFeePerGas !== undefined ? { maxFeePerGas: tx.maxFeePerGas, maxPriorityFeePerGas: tx.maxPriorityFeePerGas } : tx.gasPrice !== undefined ? { gasPrice: tx.gasPrice } : {}
          return client.sendTransaction({ account: active.account, chain: arcChain, to: tx.to, data: tx.data, value: tx.value, gas: tx.gas, nonce: tx.nonce, ...fees } as any)
        }
        case 'personal_sign': {
          const [data, address] = isHex(p?.[0]) || !isHex(p?.[1]) ? [p?.[0], p?.[1]] : [p?.[1], p?.[0]]
          if (address && String(address).toLowerCase() !== active.address.toLowerCase()) throw Object.assign(new Error('Unknown signer.'), { code: 4100 })
          let text = String(data ?? '')
          if (isHex(data)) { try { text = hexToString(data) } catch { text = data } }
          if (!(await askApproval({ kind: 'message', from: active.address, message: text, raw: data }))) throw rejected()
          return active.account.signMessage({ message: isHex(data) ? { raw: data } : String(data) })
        }
        case 'eth_signTypedData_v4': case 'eth_signTypedData': {
          const typed = typeof p?.[1] === 'string' ? JSON.parse(p[1]) : p?.[1]
          if (String(p?.[0] ?? '').toLowerCase() !== active.address.toLowerCase()) throw Object.assign(new Error('Unknown signer.'), { code: 4100 })
          if (!(await askApproval({ kind: 'typed', from: active.address, typed }))) throw rejected()
          const { EIP712Domain: _domain, ...types } = typed.types ?? {}
          return active.account.signTypedData({ domain: typed.domain, types, primaryType: typed.primaryType, message: typed.message })
        }
        case 'eth_sign': case 'eth_signTransaction': case 'eth_sendRawTransaction':
          throw Object.assign(new Error(`${method} is not supported by Makoto wallet.`), { code: 4200 })
        default:
          return rpc(method, p)
      }
    },
  }
}

const entry: BrowserWallet = { id: 'embedded', kind: 'embedded', name: 'Makoto Wallet', source: 'embedded', provider: provider() }

/** Unlock with the wallet password; registers the provider so the normal connect flow can use it. */
export async function unlockEmbedded(input: { sub: string; email: string; address: string; vault: EncryptedVault; password: string }): Promise<BrowserWallet> {
  const [{ decryptPhrase }, { mnemonicToAccount }] = await Promise.all([vaultLib(), accountsLib()])
  const phrase = await decryptPhrase(input.vault, input.password, input.sub)
  const account = mnemonicToAccount(phrase)
  if (account.address.toLowerCase() !== input.address.toLowerCase()) throw new Error('Backup does not match this wallet.')
  session = { sub: input.sub, email: input.email, address: account.address, words: input.vault.words, account }
  cache({ sub: input.sub, email: input.email, address: account.address, vault: input.vault })
  setExternalWallet(entry)
  return entry
}

/** Create/import: encrypt locally, hand the ciphertext to `save`, then unlock. */
export async function storeNewEmbedded(input: { sub: string; email: string; phrase: string; password: string; save: (address: string, vault: EncryptedVault) => Promise<void> }): Promise<BrowserWallet> {
  const [{ encryptPhrase }, { mnemonicToAccount }] = await Promise.all([vaultLib(), accountsLib()])
  const vault = await encryptPhrase(input.phrase, input.password, input.sub)
  const address = mnemonicToAccount(input.phrase.trim().toLowerCase().split(/\s+/).join(' ')).address
  await input.save(address, vault)
  return unlockEmbedded({ sub: input.sub, email: input.email, address, vault, password: input.password })
}

/** Re-derive the phrase for a "Show recovery phrase" request (password re-check). */
export async function revealPhrase(password: string): Promise<string> {
  const cached = cachedEmbedded()
  if (!session || !cached) throw new Error('Unlock your Makoto wallet first.')
  const { decryptPhrase } = await vaultLib()
  return decryptPhrase(cached.vault, password, session.sub)
}

export function lockEmbedded(options: { forget?: boolean } = {}) {
  session = null
  queue.forEach((item) => item.resolve(false)); queue = []; emit()
  if (options.forget) cache(null)
  setExternalWallet(null)
}
