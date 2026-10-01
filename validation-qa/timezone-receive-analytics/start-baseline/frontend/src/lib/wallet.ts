// Arc Testnet constants, types, formatters and injected-wallet helpers
import { commitBrowserProvider, getProvider, hasBrowserProvider, type BrowserWallet, type Eip1193 } from './walletProviders.ts'
export { getProvider } from './walletProviders.ts'

export const ARC = {
  chainId: 5042002,
  chainHex: '0x4cef52',
  name: 'Arc Testnet',
  rpc: 'https://rpc.testnet.arc.network',
  explorer: 'https://testnet.arcscan.app',
  faucet: 'https://faucet.circle.com',
}

export type Point = [number, number]
export type PriceInfo = {
  price?: number
  change24h?: number
  change7d?: number
  history?: Point[]
  provider?: string
  providerAssetId?: string
  source?: string
  status?: 'FRESH' | 'STALE' | 'UNAVAILABLE'
  observedAt?: string
  providerUpdatedAt?: string
  error?: string
  staleReason?: string
}
export type Prices = Record<string, PriceInfo | undefined>

export type TokenMeta = { sym: string; name: string; address: string; decimals: number; priceKey: string; color: string; glyph: string }

export const TOKENS: TokenMeta[] = [
  { sym: 'USDC', name: 'USD Coin', address: '0x3600000000000000000000000000000000000000', decimals: 6, priceKey: 'USDC', color: '#2775CA', glyph: '$' },
  { sym: 'EURC', name: 'Euro Coin', address: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a', decimals: 6, priceKey: 'EURC', color: '#7B61FF', glyph: '€' },
  { sym: 'cirBTC', name: 'Circle Wrapped Bitcoin', address: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF', decimals: 8, priceKey: 'BTC', color: '#F7931A', glyph: '₿' },
]
export const tokenBySym = (s: string) => TOKENS.find((t) => t.sym === s)

export type Holding = {
  symbol: string
  name: string
  address: string
  decimals: number
  balance: number
  verified: boolean
  color: string
  glyph: string
  priceKey?: string
  price?: number
  value?: number
  change24h?: number
  history?: Point[]
}

export type Tx = {
  id: string
  hash?: string
  timestamp: number
  direction: 'in' | 'out'
  counterparty: string
  counterpartyName?: string | null
  symbol: string
  amount: number
  verified: boolean
  method?: string | null
  block?: number
  kind?: 'send' | 'receive' | 'swap' | 'bridge'
  status: 'completed' | 'submitted' | 'pending' | 'failed' | 'unknown' | 'user_rejected'
  route?: string
  toSymbol?: string
  toAmount?: number
  fee?: number
}
export const txKind = (t: Tx) => t.kind ?? (t.direction === 'in' ? 'receive' : 'send')

export type WalletApi = {
  address: string
  chainId?: number
  observedAt?: string
  txCount: number | null
  tokens: { symbol: string; name: string; address: string; decimals: number; balance: number; verified: boolean; rawBalance?: string; rawDecimals?: number }[]
  activity: {
    hash: string; logIndex: number; block: number; timestamp: string; direction: 'in' | 'out'
    from: string; to: string; fromName: string | null; toName: string | null; method: string | null
    symbol: string; tokenAddress: string; amount: number; verified: boolean
  }[]
}

export type NetworkInfo = {
  chainId: number; blockNumber: number; gasPriceGwei: number
  transferFeeUsdc: number; tokenTransferFeeUsdc: number; rpcLatencyMs: number; updatedAt: number
}

export type Contact = { name: string; address: string }

// DEMO wallet — sample data for design preview, used until a wallet is connected / watched
export const DEMO_ADDRESS = '0x1629…586B'
export const DEMO_BALANCES: Record<string, number> = { USDC: 94.506457, EURC: 82.8626, cirBTC: 0.0004 }
const demoTs = new Date('2026-09-24T18:21:00').getTime()
export const DEMO_ACTIVITY: Tx[] = [
  { id: 'd6', timestamp: demoTs + 5 * 3600_000, direction: 'out', counterparty: '0x3600…Bridge', counterpartyName: 'Circle CCTP', symbol: 'USDC', amount: 10, verified: true, kind: 'bridge', status: 'pending', route: 'Arc Testnet → Base Sepolia' },
  { id: 'd5', timestamp: demoTs + 3 * 3600_000, direction: 'out', counterparty: '0x9aE1…44c0', symbol: 'USDC', amount: 5, verified: true, kind: 'send', status: 'failed', fee: 0.0021 },
  { id: 'd4', timestamp: demoTs + 1 * 3600_000, direction: 'out', counterparty: '0x5f1A…Swap', counterpartyName: 'Arc Swap', symbol: 'USDC', amount: 12, verified: true, kind: 'swap', status: 'completed', toSymbol: 'EURC', toAmount: 10.31, route: 'USDC → EURC', fee: 0.0034 },
  { id: 'd1', timestamp: demoTs, direction: 'in', counterparty: '0x3C33…752D', symbol: 'cirBTC', amount: 0.0001, verified: true, kind: 'receive', status: 'completed' },
  { id: 'd2', timestamp: demoTs, direction: 'in', counterparty: '0x70E3…Af8e', symbol: 'EURC', amount: 20, verified: true, kind: 'receive', status: 'completed' },
  { id: 'd3', timestamp: demoTs, direction: 'in', counterparty: '0x70E3…Af8e', symbol: 'USDC', amount: 20, verified: true, kind: 'receive', status: 'completed' },
]

/* ---------------- formatters ---------------- */

export const usd = (n: number, d = 2) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: d, maximumFractionDigits: d })
export const fmtAmt = (n: number, max = 6) => n.toLocaleString('en-US', { maximumFractionDigits: max })
export const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
export const short = (a: string) => (a.length > 14 && a.startsWith('0x') ? `${a.slice(0, 6)}…${a.slice(-4)}` : a)
export const isAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a.trim())
export const explorerTx = (h: string) => `${ARC.explorer}/tx/${h}`
export const explorerAddr = (a: string) => `${ARC.explorer}/address/${a}`
export const explorerToken = (a: string) => `${ARC.explorer}/token/${a}`

export const dayLabel = (ts: number) => {
  const d = new Date(ts)
  const today = new Date()
  const y = new Date(); y.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
export const timeLabel = (ts: number) => new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
export const ago = (ts: number, locale = 'en') => {
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (locale === 'vi') {
    if (s < 60) return 'vừa xong'
    if (s < 3600) return `${Math.floor(s / 60)} phút trước`
    if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`
    return `${Math.floor(s / 86400)} ngày trước`
  }
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

/* ---------------- injected wallet (OKX / MetaMask / Rabby…) ---------------- */

export async function ensureArcNetwork(p: Eip1193) {
  try {
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ARC.chainHex }] })
  } catch (e: any) {
    if (e?.code === 4902 || /unrecognized|not added|unknown chain/i.test(e?.message ?? '')) {
      await p.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: ARC.chainHex,
          chainName: ARC.name,
          nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
          rpcUrls: [ARC.rpc],
          blockExplorerUrls: [ARC.explorer],
        }],
      })
      // Adding a chain does not guarantee that the wallet has selected it.
      await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ARC.chainHex }] })
    } else throw e
  }
}

export async function connectWallet(wallet?: BrowserWallet, signal?: AbortSignal): Promise<string> {
  const p = wallet?.provider ?? getProvider()
  if (!p) throw new Error('No wallet extension found. Install OKX Wallet, Rabby or MetaMask.')
  const checkCurrent = () => {
    if (signal?.aborted) throw new DOMException('Wallet connection cancelled.', 'AbortError')
    if (!hasBrowserProvider(p)) throw new Error('Wallet provider is no longer available.')
  }
  checkCurrent()
  const accounts: unknown = await p.request({ method: 'eth_requestAccounts' })
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || !isAddress(accounts[0])) throw new Error('No account returned')
  checkCurrent()
  await ensureArcNetwork(p)
  checkCurrent()
  const chainId = Number(await p.request({ method: 'eth_chainId' }))
  if (chainId !== ARC.chainId) throw new Error('Wallet is not on Arc Testnet.')
  const currentAccounts: unknown = await p.request({ method: 'eth_accounts' })
  if (!Array.isArray(currentAccounts) || typeof currentAccounts[0] !== 'string' || !isAddress(currentAccounts[0])) throw new Error('No account returned')
  if (currentAccounts[0].toLowerCase() !== accounts[0].toLowerCase()) throw new Error('Wallet account changed. Connect again.')
  checkCurrent()
  // Commit only after account/network readback succeeds. Rejection, cancellation
  // and unavailable evidence leave the previously selected provider untouched.
  commitBrowserProvider(p)
  return currentAccounts[0]
}

// Wallet connection requests accounts and switches to Arc. Task authentication
// separately requests a user-initiated SIWE message signature. Neither path
// grants the backend transaction-signing authority.
