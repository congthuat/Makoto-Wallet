import { Wallet } from 'lucide-react'
import { useState } from 'react'
import type { BrowserWallet, WalletKind } from '../../lib/walletProviders'
import { catalogWallet } from '../../lib/walletCatalog'

/** Announced icons stay in an image context; SVG markup never enters the DOM. */
export function WalletProviderIcon({ kind, wallet }: { kind: WalletKind; wallet?: BrowserWallet }) {
  const [brokenAnnouncement, setBrokenAnnouncement] = useState(false)
  if (wallet?.icon && !brokenAnnouncement) return <img src={wallet.icon} onError={() => setBrokenAnnouncement(true)} width={40} height={40} alt="" className="w-10 h-10 rounded-xl object-contain shrink-0" />
  if (kind === 'binance') return <span aria-hidden className="w-10 h-10 rounded-xl bg-[#F0B90B] flex items-center justify-center font-black text-[#181A20] text-[15px] shrink-0">B</span>
  if (kind === 'walletconnect') return <span aria-hidden className="w-10 h-10 rounded-xl bg-[#3B99FC] flex items-center justify-center font-black text-white text-[12px] shrink-0">WC</span>
  if (kind === 'okx') return <span aria-hidden className="w-10 h-10 rounded-xl bg-black flex items-center justify-center font-black text-[#fff] text-[13px] shrink-0">OKX</span>
  // Checked into public/wallets from MetaMask's official extension repository
  // and RabbyHub's official brand asset repository. No remote image requests.
  if (kind === 'metamask' || kind === 'rabby') return <img src={`${import.meta.env.BASE_URL}wallets/${kind}.svg`} width={40} height={40} alt="" className="w-10 h-10 rounded-xl object-contain shrink-0" />
  const mono = catalogWallet(kind)?.mono
  if (mono) return <span aria-hidden style={{ background: mono.bg, color: mono.fg }} className={`w-10 h-10 rounded-xl flex items-center justify-center font-black shrink-0 ${mono.text.length > 2 ? 'text-[12px]' : 'text-[15px]'}`}>{mono.text}</span>
  return <span aria-hidden className="w-10 h-10 rounded-xl bg-white/[0.06] flex items-center justify-center shrink-0"><Wallet size={21} /></span>
}
