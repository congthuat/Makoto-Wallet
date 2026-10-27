import { Wallet } from 'lucide-react'
import { useState } from 'react'
import type { BrowserWallet, WalletKind } from '../../lib/walletProviders'
import { catalogWallet } from '../../lib/walletCatalog'

/**
 * Official wallet logos, checked into public/wallets. MetaMask and Rabby come from their brand
 * repositories; the others are each wallet's own listing image in the WalletConnect registry
 * (explorer-api.walletconnect.com). No remote image requests at runtime.
 */
const LOGO_FILES: Partial<Record<WalletKind | 'okxwallet', string>> = {
  metamask: 'metamask.svg', rabby: 'rabby.svg', walletconnect: 'walletconnect.svg',
  okx: 'okx.png', okxwallet: 'okxwallet.png', binance: 'binance.png', trust: 'trust.png', bitget: 'bitget.png',
  coinbase: 'coinbase.png', phantom: 'phantom.png', rainbow: 'rainbow.png', zerion: 'zerion.png', brave: 'brave.png',
}

/** Announced icons stay in an image context; SVG markup never enters the DOM. */
export function WalletProviderIcon({ kind, wallet, logo }: { kind: WalletKind; wallet?: BrowserWallet; logo?: 'okxwallet' }) {
  const [brokenAnnouncement, setBrokenAnnouncement] = useState(false)
  const [brokenLogo, setBrokenLogo] = useState(false)
  const cls = 'w-10 h-10 rounded-xl object-contain shrink-0 ring-1 ring-white/[0.08]'
  if (wallet?.icon && !brokenAnnouncement) return <img src={wallet.icon} onError={() => setBrokenAnnouncement(true)} width={40} height={40} alt="" className={cls} />
  const file = LOGO_FILES[logo ?? kind]
  if (file && !brokenLogo) return <img src={`${import.meta.env.BASE_URL}wallets/${file}`} onError={() => setBrokenLogo(true)} width={40} height={40} alt="" className={cls} />
  const mono = catalogWallet(kind)?.mono
  if (mono) return <span aria-hidden style={{ background: mono.bg, color: mono.fg }} className={`w-10 h-10 rounded-xl flex items-center justify-center font-black shrink-0 ${mono.text.length > 2 ? 'text-[12px]' : 'text-[15px]'}`}>{mono.text}</span>
  return <span aria-hidden className="w-10 h-10 rounded-xl bg-white/[0.06] flex items-center justify-center shrink-0"><Wallet size={21} /></span>
}
