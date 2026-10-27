import type { WalletKind } from './walletProviders'

/** Phones cannot run wallet extensions; a wallet app's built-in browser injects the provider instead. */
export const isMobileBrowser = () => typeof navigator !== 'undefined'
  && (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)))

/** Official "open this website inside the wallet app" links. They only open a URL; nothing is signed. */
export function walletAppLinks(url: string): { kind: WalletKind; name: string; href: string }[] {
  const okxDeepLink = `okx://wallet/dapp/url?dappUrl=${encodeURIComponent(url)}`
  return [
    { kind: 'okx', name: 'OKX Wallet', href: `https://www.okx.com/download?deeplink=${encodeURIComponent(okxDeepLink)}` },
    { kind: 'metamask', name: 'MetaMask', href: `https://metamask.app.link/dapp/${url.replace(/^https?:\/\//, '')}` },
    { kind: 'trust', name: 'Trust Wallet', href: `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(url)}` },
    { kind: 'coinbase', name: 'Coinbase Wallet', href: `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url)}` },
  ]
}
