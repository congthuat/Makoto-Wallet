import { Wallet } from 'lucide-react'
import { useState } from 'react'
import type { BrowserWallet, WalletKind } from '../../lib/walletProviders'

/** Announced icons stay in an image context; SVG markup never enters the DOM. */
export function WalletProviderIcon({ kind, wallet }: { kind: WalletKind; wallet?: BrowserWallet }) {
  const [brokenAnnouncement, setBrokenAnnouncement] = useState(false)
  if (wallet?.icon && !brokenAnnouncement) return <img src={wallet.icon} onError={() => setBrokenAnnouncement(true)} width={40} height={40} alt="" className="w-10 h-10 rounded-xl object-contain shrink-0" />
  if (kind === 'okx') return <span aria-hidden className="w-10 h-10 rounded-xl bg-black flex items-center justify-center font-black text-[#fff] text-[13px] shrink-0">OKX</span>
  // Checked into public/wallets from MetaMask's official extension repository
  // and RabbyHub's official brand asset repository. No remote image requests.
  if (kind === 'metamask' || kind === 'rabby') return <img src={`${import.meta.env.BASE_URL}wallets/${kind}.svg`} width={40} height={40} alt="" className="w-10 h-10 rounded-xl object-contain shrink-0" />
  return <span aria-hidden className="w-10 h-10 rounded-xl bg-white/[0.06] flex items-center justify-center shrink-0"><Wallet size={21} /></span>
}
