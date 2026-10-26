/**
 * Browser wallets Makoto lists in the connect dialog. Presentation only:
 * detection still comes from EIP-6963 announcements / injected providers, and
 * rdns is never treated as proof of identity. Install links are the wallets'
 * official download pages.
 */
export type CatalogWalletKind = 'metamask' | 'okx' | 'rabby' | 'coinbase' | 'trust' | 'bitget' | 'phantom' | 'rainbow' | 'zerion' | 'brave'

export type CatalogWallet = Readonly<{
  kind: CatalogWalletKind
  name: string
  /** EIP-6963 reverse-DNS identifiers this wallet announces. */
  rdns: readonly string[]
  installUrl: string
  /** Monogram tile used when the wallet is not installed (no remote images). */
  mono: Readonly<{ text: string; bg: string; fg: string }>
}>

export const WALLET_CATALOG: readonly CatalogWallet[] = Object.freeze([
  { kind: 'metamask', name: 'MetaMask', rdns: ['io.metamask', 'io.metamask.flask'], installUrl: 'https://metamask.io/download/', mono: { text: 'M', bg: '#F6851B', fg: '#fff' } },
  { kind: 'okx', name: 'OKX Wallet', rdns: ['com.okex.wallet', 'com.okx.wallet'], installUrl: 'https://www.okx.com/web3', mono: { text: 'OKX', bg: '#000', fg: '#fff' } },
  { kind: 'rabby', name: 'Rabby', rdns: ['io.rabby'], installUrl: 'https://rabby.io/', mono: { text: 'R', bg: '#7084FF', fg: '#fff' } },
  { kind: 'coinbase', name: 'Coinbase Wallet', rdns: ['com.coinbase.wallet'], installUrl: 'https://www.coinbase.com/wallet/downloads', mono: { text: 'C', bg: '#0052FF', fg: '#fff' } },
  { kind: 'trust', name: 'Trust Wallet', rdns: ['com.trustwallet.app'], installUrl: 'https://trustwallet.com/browser-extension', mono: { text: 'T', bg: '#0500FF', fg: '#fff' } },
  { kind: 'bitget', name: 'Bitget Wallet', rdns: ['com.bitget.web3'], installUrl: 'https://web3.bitget.com/en/wallet-download', mono: { text: 'BG', bg: '#00F0FF', fg: '#0b0b10' } },
  { kind: 'phantom', name: 'Phantom', rdns: ['app.phantom'], installUrl: 'https://phantom.com/download', mono: { text: 'P', bg: '#AB9FF2', fg: '#1c1c1c' } },
  { kind: 'rainbow', name: 'Rainbow', rdns: ['me.rainbow'], installUrl: 'https://rainbow.me/extension', mono: { text: 'R', bg: '#174299', fg: '#fff' } },
  { kind: 'zerion', name: 'Zerion', rdns: ['io.zerion.wallet'], installUrl: 'https://zerion.io/download', mono: { text: 'Z', bg: '#2962EF', fg: '#fff' } },
  { kind: 'brave', name: 'Brave Wallet', rdns: ['com.brave.wallet'], installUrl: 'https://brave.com/wallet/', mono: { text: 'B', bg: '#FB542B', fg: '#fff' } },
])

const BY_RDNS = new Map(WALLET_CATALOG.flatMap((wallet) => wallet.rdns.map((rdns) => [rdns, wallet.kind] as const)))

export function catalogKindForRdns(rdns: string | undefined): CatalogWalletKind | undefined {
  return rdns ? BY_RDNS.get(rdns.toLowerCase()) : undefined
}

export function catalogWallet(kind: string): CatalogWallet | undefined {
  return WALLET_CATALOG.find((wallet) => wallet.kind === kind)
}
