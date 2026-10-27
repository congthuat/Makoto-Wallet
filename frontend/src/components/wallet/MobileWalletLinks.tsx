import { useState } from 'react'
import { Check, Copy, ExternalLink, Smartphone } from 'lucide-react'
import { WalletProviderIcon } from './WalletProviderIcon'
import { T } from './ui'
import { walletAppLinks } from '../../lib/walletAppLinks'

export function MobileWalletLinks({ vi }: { vi: boolean }) {
  const url = typeof window === 'undefined' ? 'https://makotowallet.xyz/' : window.location.href
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* clipboard unavailable */ }
  }
  return (
    <div className="mt-1 rounded-xl border border-neon-500/25 bg-neon-500/[0.04] p-3.5" data-mobile-wallet-links>
      <p className="flex items-center gap-2 text-[13.5px] font-semibold"><Smartphone size={15} className="text-neon-300" /> {vi ? 'Mở Makoto trong app ví' : 'Open Makoto in your wallet app'}</p>
      <p className={`mt-1 text-[12.5px] leading-5 ${T.sub}`}>
        {vi
          ? 'Trình duyệt điện thoại (Chrome, Safari, Cốc Cốc) không cài được ví. Bấm ví của bạn bên dưới — Makoto sẽ mở trong trình duyệt của app ví, rồi bấm "Kết nối ví" ở đó.'
          : 'Phone browsers (Chrome, Safari, Cốc Cốc) cannot run wallet extensions. Tap your wallet below — Makoto opens inside the wallet app’s browser; then tap "Connect wallet" there.'}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {walletAppLinks(url).map((link) => (
          <a key={link.kind} href={link.href} rel="noopener noreferrer" data-wallet-app={link.kind}
            className="flex items-center gap-2.5 p-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] transition">
            <span className="scale-[0.8] -m-1"><WalletProviderIcon kind={link.kind} /></span>
            <span className="min-w-0 flex-1 text-[13px] font-semibold truncate">{link.name}</span>
            <ExternalLink size={12} className={T.mute} aria-hidden />
          </a>
        ))}
      </div>
      <div className={`mt-3 text-[12px] leading-5 ${T.mute}`}>
        {vi ? 'Dùng ví khác (Binance, Bitget…)? Mở app ví → mục Trình duyệt / Khám phá → dán link này:' : 'Another wallet (Binance, Bitget…)? Open the wallet app → Browser / Discover → paste this link:'}
        <button type="button" onClick={() => void copy()} className="mt-1.5 w-full flex items-center gap-2 h-9 px-3 rounded-lg border border-white/[0.08] bg-white/[0.02] text-left">
          <span className="flex-1 truncate font-mono text-[12px]">{url}</span>
          {copied ? <Check size={14} className="text-live shrink-0" /> : <Copy size={14} className="shrink-0" />}
        </button>
      </div>
    </div>
  )
}
