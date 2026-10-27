/**
 * WalletConnect (Reown) pairing for phone wallet apps. The dapp never holds keys:
 * the wallet app approves the session and every request; Makoto only relays
 * JSON-RPC through the encrypted WalletConnect relay.
 */
import type { BrowserWallet, Eip1193, WalletKind } from './walletProviders.ts'
import { setExternalWallet, preferredWalletSource } from './walletProviders.ts'

/** Public project id from cloud.reown.com (safe in client code; restricted by domain allowlist). */
export const WALLETCONNECT_PROJECT_ID: string = (import.meta.env?.VITE_WALLETCONNECT_PROJECT_ID as string | undefined) || 'ac840b47c8005425a4b4f2cf7e14b63a'
export const walletConnectReady = () => /^[0-9a-f]{32}$/i.test(WALLETCONNECT_PROJECT_ID)

const ARC_CHAIN_ID = 5042002
const ARC_RPC = 'https://rpc.testnet.arc.io'

export type WcWallet = { kind: WalletKind; name: string; note?: string; native: string }

/**
 * Native deep links from the official WalletConnect wallet registry (explorer-api.walletconnect.com),
 * formatted like Reown AppKit: `${native}wc?uri=…`. Each button targets one specific app on both
 * Android and iOS, so the phone never hands the pairing to a different default wallet.
 */
export const WC_WALLETS: WcWallet[] = [
  { kind: 'okx', name: 'OKX', note: 'App sàn OKX', native: 'okex://main' },
  { kind: 'okx', name: 'OKX Wallet', note: 'App ví OKX riêng', native: 'okxwallet://main' },
  { kind: 'binance', name: 'Binance Wallet', native: 'bnc://app.binance.com/cedefi/' },
  { kind: 'metamask', name: 'MetaMask', native: 'metamask://' },
  { kind: 'trust', name: 'Trust Wallet', native: 'trust://' },
  { kind: 'bitget', name: 'Bitget Wallet', native: 'bitkeep://' },
]

/** AppKit's formatNativeUrl: ensure the scheme ends in "://" or "/", then append wc?uri=. */
export function wcNativeLink(native: string, uri: string): string {
  let base = native
  if (!base.includes('://')) base = `${base.replace(/[/:]/g, '')}://`
  if (!base.endsWith('/')) base = `${base}/`
  return `${base}wc?uri=${encodeURIComponent(uri)}`
}
export const wcWalletId = (wallet: WcWallet) => `${wallet.kind}:${wallet.native}`

const isMobile = () => typeof navigator !== 'undefined' && (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)))
const LAST_WALLET_KEY = 'mk.wc.wallet.v1'

/** Methods that need the user's attention in the wallet app; on phones we bring the app forward for them. */
const USER_METHODS = new Set(['eth_sendTransaction', 'personal_sign', 'eth_sign', 'eth_signTypedData', 'eth_signTypedData_v4', 'wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_watchAsset'])

type WcProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<any>
  connect: (opts: Record<string, unknown>) => Promise<unknown>
  disconnect: () => Promise<void>
  setDefaultChain: (chain: string) => void
  session?: { topic: string; peer?: { metadata?: { name?: string } }; namespaces?: Record<string, { chains?: string[] }> }
  on: (event: string, cb: (...args: any[]) => void) => void
  removeListener: (event: string, cb: (...args: any[]) => void) => void
}

const WC_METHODS = ['eth_sendTransaction', 'personal_sign', 'eth_signTypedData_v4', 'wallet_switchEthereumChain', 'wallet_addEthereumChain']
const WC_EVENTS = ['chainChanged', 'accountsChanged']

let providerPromise: Promise<WcProvider> | null = null
function loadProvider(): Promise<WcProvider> {
  if (!walletConnectReady()) return Promise.reject(new Error('WalletConnect is not configured yet.'))
  providerPromise ??= import('@walletconnect/universal-provider').then(({ default: UniversalProvider }) => {
    const origin = typeof window === 'undefined' ? 'https://makotowallet.xyz' : window.location.origin
    return UniversalProvider.init({
      projectId: WALLETCONNECT_PROJECT_ID,
      metadata: {
        name: 'Makoto Wallet',
        description: 'AI agent wallet for stablecoins on Arc',
        url: origin,
        icons: [`${origin}/icon-512.png`],
        redirect: { universal: origin },
      },
    }) as Promise<WcProvider>
  }).catch((error) => { providerPromise = null; throw error })
  return providerPromise
}

const approvedChains = (provider: WcProvider) => provider.session?.namespaces?.eip155?.chains ?? []
/** Prefer Arc as the default chain when the wallet approved it. */
const preferArc = (provider: WcProvider) => { if (approvedChains(provider).includes(`eip155:${ARC_CHAIN_ID}`)) provider.setDefaultChain(`eip155:${ARC_CHAIN_ID}`) }

function lastWallet(): WcWallet | undefined {
  try { const id = localStorage.getItem(LAST_WALLET_KEY); return WC_WALLETS.find((wallet) => wcWalletId(wallet) === id) } catch { return undefined }
}

/** Wrap the WalletConnect provider so signing requests reopen the paired wallet app on phones. */
function wrap(provider: WcProvider, wallet?: WcWallet): Eip1193 {
  return {
    request: (args) => {
      const pending = provider.request(args)
      // A switch to a chain the session already approved is handled locally — no need to leave the page.
      const approved = approvedChains(provider)
      const localSwitch = args.method === 'wallet_switchEthereumChain' && approved.includes(`eip155:${parseInt(String((args.params?.[0] as { chainId?: string } | undefined)?.chainId ?? '0'), 16)}`)
      if (USER_METHODS.has(args.method) && !localSwitch && isMobile() && typeof window !== 'undefined') {
        const target = wallet?.native
        if (target) setTimeout(() => { window.location.href = target }, 400)
      }
      return pending
    },
    on: (event, cb) => provider.on(event, cb),
    removeListener: (event, cb) => provider.removeListener(event, cb),
  }
}

function entryFor(provider: WcProvider, wallet?: WcWallet): BrowserWallet {
  const peer = provider.session?.peer?.metadata?.name
  return { id: 'walletconnect', kind: wallet?.kind ?? 'walletconnect', name: wallet?.name ?? peer ?? 'WalletConnect', source: 'walletconnect', provider: wrap(provider, wallet) }
}

/**
 * Pair with a phone wallet. `wallet` = deep-link into that app (phone); `onUri` = show a QR (desktop).
 * Resolves with a BrowserWallet that the normal connect flow (accounts + Arc network check) then uses.
 */
export async function pairWalletConnect(opts: { wallet?: WcWallet; onUri?: (uri: string) => void; signal?: AbortSignal }): Promise<BrowserWallet> {
  const provider = await loadProvider()
  if (provider.session) { try { await provider.disconnect() } catch { /* stale session */ } }
  const onDisplayUri = (uri: string) => {
    if (opts.onUri) opts.onUri(uri)
    else if (opts.wallet && typeof window !== 'undefined') window.location.href = wcNativeLink(opts.wallet.native, uri)
  }
  provider.on('display_uri', onDisplayUri)
  try {
    const aborted = new Promise<never>((_, reject) => opts.signal?.addEventListener('abort', () => reject(new DOMException('Wallet connection cancelled.', 'AbortError')), { once: true }))
    await Promise.race([provider.connect({
      optionalNamespaces: { eip155: { chains: [`eip155:${ARC_CHAIN_ID}`, 'eip155:1'], methods: WC_METHODS, events: WC_EVENTS, rpcMap: { [ARC_CHAIN_ID]: ARC_RPC } } },
    }), aborted])
    preferArc(provider)
  } finally {
    provider.removeListener('display_uri', onDisplayUri)
  }
  try { if (opts.wallet) localStorage.setItem(LAST_WALLET_KEY, wcWalletId(opts.wallet)); else localStorage.removeItem(LAST_WALLET_KEY) } catch { /* optional */ }
  const entry = entryFor(provider, opts.wallet)
  setExternalWallet(entry)
  provider.on('disconnect', () => setExternalWallet(null))
  return entry
}

/** On page load: if the last session was WalletConnect, restore it silently (no popup, no deep link). */
export async function restoreWalletConnect(): Promise<void> {
  if (!walletConnectReady() || preferredWalletSource() !== 'walletconnect') return
  try {
    const provider = await loadProvider()
    if (!provider.session) return
    preferArc(provider)
    setExternalWallet(entryFor(provider, lastWallet()))
    provider.on('disconnect', () => setExternalWallet(null))
  } catch { /* stays disconnected; user can pair again */ }
}

export async function disconnectWalletConnect(): Promise<void> {
  if (!providerPromise) return
  try { const provider = await providerPromise; if (provider.session) await provider.disconnect() } catch { /* already gone */ }
  setExternalWallet(null)
}
