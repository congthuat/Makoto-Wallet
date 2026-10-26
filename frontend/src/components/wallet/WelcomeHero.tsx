import { useState } from 'react'
import { ArrowRight, KeyRound, ShieldCheck, Sparkles, Wallet } from 'lucide-react'
import { useWallet } from '../../lib/store'
import { useT } from '../../lib/i18n'
import { Button, T } from './ui'
import { ConnectModal } from './shared'

/** First-visit hero shown only while the user browses sample data (demo mode). */
export function WelcomeHero() {
  const { go } = useWallet()
  const [tr] = useT()
  const [connectOpen, setConnectOpen] = useState(false)
  const points = [
    { icon: KeyRound, t: 'Non-custodial — your keys stay in your wallet' },
    { icon: ShieldCheck, t: 'Every transaction is reviewed and signed by you' },
    { icon: Sparkles, t: 'An AI agent that explains before it acts' },
  ]
  return (
    <section className="mk-hero mk-in relative overflow-hidden rounded-2xl border border-white/[0.08] px-5 py-7 sm:px-8 sm:py-9" data-welcome-hero>
      <div className="relative z-10 grid lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-6 items-center">
        <div>
          <span className="inline-flex items-center gap-2 h-7 px-3 rounded-full border border-white/[0.1] bg-white/[0.03] text-[12px] font-medium text-[#c8ffbe]">
            <span className="w-1.5 h-1.5 rounded-full bg-neon-500" aria-hidden /> {tr('Stablecoin wallet for Arc')}
          </span>
          <h2 className="mt-4 text-[28px] sm:text-[38px] leading-[1.08] font-bold">
            {tr('Pay, send and manage USDC')} <span className="text-neon-300">{tr('by simply asking.')}</span>
          </h2>
          <p className={`mt-3 max-w-[560px] text-[14.5px] leading-6 ${T.sub}`}>{tr('Makoto turns plain language into clear, reviewable transactions — you stay in control of every signature.')}</p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button variant="primary" size="lg" onClick={() => setConnectOpen(true)}><Wallet size={16} /> {tr('Connect wallet')}</Button>
            <Button size="lg" onClick={() => go('trust')}>{tr('How it stays safe')} <ArrowRight size={16} /></Button>
          </div>
          <p className={`mt-3 text-[12px] ${T.mute}`}>{tr('Exploring with sample data below. Nothing here is a real balance.')}</p>
        </div>
        <ul className="space-y-2.5">
          {points.map(({ icon: Icon, t }) => (
            <li key={t} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
              <span className="w-8 h-8 rounded-lg bg-neon-500/12 text-neon-300 flex items-center justify-center shrink-0"><Icon size={16} /></span>
              <span className="text-[13.5px] font-medium">{tr(t)}</span>
            </li>
          ))}
        </ul>
      </div>
      <ConnectModal open={connectOpen} onClose={() => setConnectOpen(false)} />
    </section>
  )
}
