import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDownUp, ChevronDown, Info, Route, Settings2, Flame, BadgeCheck, Coins, ArrowRight, Clock, Zap } from 'lucide-react'
import { formatUnits } from 'viem'
import { useWallet } from '../lib/store'
import { ARC, TOKENS, fmtAmt, usd } from '../lib/wallet'
import { Badge, Button, Card, PageHeader, Segmented, T, TokenIcon } from '../components/wallet/ui'
import { useT } from '../lib/i18n'
import { consumeBrainHandoff } from '../brain/handoff'
import { useDismissibleOverlay } from '../lib/useDismissibleOverlay'
import { prepareBrainReview } from '../brain/policy'
import type { BrainPreparation } from '../brain/types'
import { LiveSwapControl } from '../components/LiveSwapControl'
import { LiveCctpControl, type LiveQuote } from '../components/LiveCctpControl'
import { universalBridgeAvailability } from '../migrated/universalBridge'

function TokenPill({ sym, onClick }: { sym: string; onClick?: () => void }) {
  const t = TOKENS.find((x) => x.sym === sym)!
  return (
    <button onClick={onClick} className="flex items-center gap-2 h-11 pl-1.5 pr-3 rounded-full bg-white/[0.07] border border-white/10 hover:bg-white/[0.12] shrink-0">
      <TokenIcon color={t.color} glyph={t.glyph} size={30} /><span className="font-semibold">{t.sym}</span>{onClick && <ChevronDown size={15} className={T.mute} />}
    </button>
  )
}

export function SwapPage() {
  const { holdings, prices, network, swapDraft, setSwapDraft, mask, notify, mode, address, walletChainId, refetchWallet } = useWallet()
  const [tr] = useT()
  const [from, setFrom] = useState('USDC')
  const [to, setTo] = useState('EURC')
  const [amount, setAmount] = useState('')
  const [slip, setSlip] = useState<'0.5%' | '1%' | '3%'>('0.5%')
  const [showSet, setShowSet] = useState(false)
  const settingsTriggerRef = useRef<HTMLButtonElement>(null)
  const settingsPanelRef = useRef<HTMLDivElement>(null)
  const closeSettings = useCallback(() => setShowSet(false), [])
  useDismissibleOverlay(showSet, settingsTriggerRef, settingsPanelRef, closeSettings)

  useEffect(() => {
    if (!swapDraft) return
    if (swapDraft.from) setFrom(swapDraft.from)
    if (swapDraft.to) setTo(swapDraft.to)
    if (swapDraft.amount) setAmount(swapDraft.amount)
    setSwapDraft(null)
  }, [swapDraft, setSwapDraft])

  useEffect(() => {
    if (mode !== 'connected' || !address || typeof sessionStorage === 'undefined') return
    const handoff = consumeBrainHandoff(sessionStorage, address)
    if (!handoff || handoff.action !== 'swap') return
    if (handoff.asset) setFrom(handoff.asset)
    if (handoff.outputAsset) setTo(handoff.outputAsset)
    if (handoff.amount) setAmount(handoff.amount)
  }, [mode, address])

  const key = (s: string) => TOKENS.find((t) => t.sym === s)!.priceKey
  const pf = prices?.[key(from)]?.price
  const pt = prices?.[key(to)]?.price
  const rate = pf && pt ? pf / pt : undefined
  const amt = Number(amount) || 0
  const out = rate ? amt * rate * (1 - 0.0004) : undefined // ~0.04% pool fee on stable pools
  const minOut = out != null ? out * (1 - parseFloat(slip) / 100) : undefined
  const bal = holdings.find((h) => h.verified && h.symbol === from)?.balance ?? 0
  const balTo = holdings.find((h) => h.verified && h.symbol === to)?.balance ?? 0
  const err = amt > bal ? tr('Insufficient {asset}').replace('{asset}', from) : null
  const impact = !amt ? '—' : amt * (pf ?? 1) < 10000 ? '<0.01%' : `~${Math.min(5, (amt * (pf ?? 1)) / 1e6).toFixed(2)}%`
  const flip = () => { setFrom(to); setTo(from); setAmount(out ? out.toFixed(4) : '') }
  const cycle = (cur: string, other: string) => { const opts = TOKENS.map((t) => t.sym).filter((s) => s !== other); return opts[(opts.indexOf(cur) + 1) % opts.length] }
  const brainAction = (): BrainPreparation => ({ kind: 'swap', rawUserText: 'Manual Swap flow', asset: from, outputAsset: to, amount: amount || undefined })
  const brainContext = () => ({ connected: mode === 'connected', account: mode === 'connected' ? address : undefined, chainId: walletChainId, balances: Object.fromEntries(holdings.filter((x) => x.verified).map((x) => [x.symbol, x.balance])) })

  return (
    <>
      <PageHeader eyebrow="Trade" title="Swap" desc="Exchange Circle stablecoins on Arc with fees paid in USDC." />
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,480px)_1fr] gap-5 items-start">
        <Card className="p-4 sm:p-5 mk-in">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2"><Segmented value={tr('Market')} options={[tr('Market')] as const} onChange={() => {}} size="sm" /><Badge tone="warn">{tr('Preview estimate')}</Badge></div>
            <button ref={settingsTriggerRef} onClick={() => setShowSet(!showSet)} aria-expanded={showSet} aria-controls="mk-swap-settings" className={`p-2 rounded-lg ${T.sub} hover:text-white hover:bg-white/10`} aria-label={tr('Swap settings')}><Settings2 size={17} /></button>
          </div>
          {showSet && (
            <div ref={settingsPanelRef} id="mk-swap-settings" className="mb-3 p-3 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-between text-[13px]">
              <span className={T.sub}>{tr('Max slippage')}</span><Segmented value={slip} options={['0.5%', '1%', '3%'] as const} onChange={(value) => { setSlip(value); closeSettings() }} size="sm" />
            </div>
          )}
          <div className="mk-field-shell rounded-2xl bg-black/30 border border-white/[0.08] p-4">
            <div className={`flex justify-between text-[12px] ${T.mute}`}><span>{tr('You pay')}</span><span>{tr('Balance')} {mask(fmtAmt(bal, 4))} <button onClick={() => setAmount(String(bal))} className="ml-1 font-bold text-neon-300">{tr('MAX')}</button></span></div>
            <div className="mt-2 flex items-center gap-3">
              <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="0" className="flex-1 min-w-0 bg-transparent outline-none text-[30px] font-bold tabular-nums placeholder:text-white/20" />
              <TokenPill sym={from} onClick={() => setFrom(cycle(from, to))} />
            </div>
            <div className={`mt-1 text-[12px] tabular-nums ${T.mute}`}>{pf && amt ? `≈ ${usd(amt * pf)}` : '\u00a0'}</div>
          </div>
          <div className="relative h-2">
            <button onClick={flip} className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 top-1/2 w-10 h-10 rounded-xl bg-[#18181e] border-4 border-[#121219] flex items-center justify-center hover:text-neon-300 hover:rotate-180 transition-transform duration-300" aria-label={tr('Flip')}><ArrowDownUp size={16} /></button>
          </div>
          <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-4">
            <div className={`flex justify-between text-[12px] ${T.mute}`}><span>{tr('Estimated output')}</span><span>{tr('Balance')} {mask(fmtAmt(balTo, 4))}</span></div>
            <div className="mt-2 flex items-center gap-3">
              <div className="flex-1 min-w-0 text-[30px] font-bold tabular-nums truncate">{out ? fmtAmt(out, 4) : <span className="text-white/20">0</span>}</div>
              <TokenPill sym={to} onClick={() => setTo(cycle(to, from))} />
            </div>
            <div className={`mt-1 text-[12px] tabular-nums ${T.mute}`}>{pt && out ? `≈ ${usd(out * pt)}` : '\u00a0'}</div>
          </div>
          {rate && (
            <div className="mt-3 rounded-2xl border border-white/[0.06] p-3.5 text-[13px] space-y-2">
              <div className="flex justify-between"><span className={T.mute}>{tr('Estimated output')}</span><span className="tabular-nums font-semibold">{out ? `${fmtAmt(out, 4)} ${to}` : '—'}</span></div>
              <div className="flex justify-between"><span className={T.mute}>{tr('Rate (reference)')}</span><span className="tabular-nums">1 {from} = {fmtAmt(rate, rate > 100 ? 2 : 6)} {to}</span></div>
              <div className="flex justify-between"><span className={T.mute}>{tr('Price impact (est.)')}</span><span className="tabular-nums">{impact}</span></div>
              <div className="flex justify-between"><span className={T.mute}>{tr('Min. received')}</span><span className="tabular-nums">{minOut ? `${fmtAmt(minOut, 4)} ${to}` : '—'}</span></div>
              <div className="flex justify-between"><span className={T.mute}>{tr('Pool fee (est.)')}</span><span>~0.04%</span></div>
              <div className="flex justify-between"><span className={T.mute}>{tr('Est. network fee')}</span><span className="tabular-nums">{network ? `~${(network.tokenTransferFeeUsdc * 3).toFixed(4)} USDC` : tr('Unavailable')}</span></div>
              <div className="flex justify-between"><span className={`${T.mute} inline-flex items-center gap-1`}><Route size={13} /> {tr('Route (preview)')}</span><span>{tr('Arc StableSwap pool')}</span></div>
            </div>
          )}
          {mode === 'connected' && address ? <LiveSwapControl account={address} from={from} to={to} amount={amount} slip={slip} onConfirmed={async () => { await refetchWallet() }} /> : <Button variant="primary" size="lg" className="w-full mt-4" disabled={!amt || !!err} onClick={() => { const review = prepareBrainReview(brainAction(), brainContext()); if (review.assessment.status === 'blocked') notify(tr(review.assessment.blockers[0] ?? 'Swap blocked by safety policy'), 'err'); else notify(tr('Safety review prepared — a fresh live quote and simulation are required before wallet confirmation')) }}>{err ?? tr(amt ? 'Review swap (preview)' : 'Enter an amount')}</Button>}
          <p className={`mt-2 text-[12px] text-center ${T.mute}`}>{tr(mode === 'connected' ? 'Reference prices above are estimates; the live XyloNet quote appears in review.' : 'Based on reference prices. You’ll see the final quote before signing.')}</p>
        </Card>
        <Card className="p-5">
          <div className="text-[14px] font-semibold">{tr('Why swap on Arc?')}</div>
          <ul className={`mt-3 space-y-3 text-[13px] ${T.sub}`}>
            <li className="flex gap-2.5"><Zap size={16} className="text-neon-300 shrink-0" /> {tr('Arc is designed for fast, deterministic finality.')}</li>
            <li className="flex gap-2.5"><Coins size={16} className="text-neon-300 shrink-0" /> {tr('Fees paid in USDC, so you never need a separate gas token.')}</li>
            <li className="flex gap-2.5"><BadgeCheck size={16} className="text-neon-300 shrink-0" /> {tr('Native USDC ⇄ EURC FX — ideal for payments and treasury.')}</li>
          </ul>
          {rate && from !== 'cirBTC' && to !== 'cirBTC' && (
            <div className="mt-5 rounded-xl bg-white/[0.03] p-3 text-[12px]">
              <div className={T.mute}>{tr('FX reference (estimate)')}</div>
              <div className="mt-1 text-[18px] font-bold tabular-nums">1 {from} = {fmtAmt(rate, 4)} {to}</div>
            </div>
          )}
        </Card>
      </div>
    </>
  )
}

const CHAINS = [
  { name: 'Ethereum Sepolia', short: 'ETH', color: '#627EEA', std: '~13–19 min', fast: '~20 s' },
  { name: 'Base Sepolia', short: 'BASE', color: '#0052FF', std: '~13–19 min', fast: '~8 s' },
  { name: 'Arbitrum Sepolia', short: 'ARB', color: '#28A0F0', std: '~13–19 min', fast: '~8 s' },
  { name: 'Avalanche Fuji', short: 'AVAX', color: '#E84142', std: '~8 s', fast: '~8 s' },
  { name: 'OP Sepolia', short: 'OP', color: '#FF0420', std: '~13–19 min', fast: '~8 s' },
]

export function BridgePage() {
  const { holdings, mask, swapDraft, setSwapDraft, notify, mode, address, walletChainId, refetchWallet } = useWallet()
  const [tr, lang] = useT()
  const say = (en: string, vn: string) => lang === 'vi' ? vn : tr(en)
  const [dir, setDir] = useState<'in' | 'out'>('out')
  const [chain, setChain] = useState(CHAINS[1])
  const [speed, setSpeed] = useState<'Fast' | 'Standard'>('Fast')
  const [amount, setAmount] = useState('')
  const [liveQuote, setLiveQuote] = useState<LiveQuote>()
  useEffect(() => {
    if (!swapDraft) return
    if (swapDraft.dest) { const c = CHAINS.find((x) => x.name.toLowerCase().includes(swapDraft.dest!.toLowerCase().split(' ')[0])); if (c) setChain(c) }
    if (swapDraft.amount) setAmount(swapDraft.amount)
    setDir('out')
    setSwapDraft(null)
  }, [swapDraft, setSwapDraft])
  useEffect(() => setLiveQuote(undefined), [address, amount, speed, chain.name, dir])
  useEffect(() => {
    if (mode !== 'connected' || !address || typeof sessionStorage === 'undefined') return
    const handoff = consumeBrainHandoff(sessionStorage, address)
    if (!handoff || handoff.action !== 'bridge') return
    if (handoff.destinationChain) { const c = CHAINS.find((x) => x.name.toLowerCase().includes(handoff.destinationChain!.toLowerCase().split(' ')[0])); if (c) setChain(c) }
    if (handoff.amount) setAmount(handoff.amount)
    setDir(handoff.sourceChain?.startsWith('Arc') === false ? 'in' : 'out')
  }, [mode, address])
  const bal = holdings.find((h) => h.symbol === 'USDC')?.balance ?? 0
  const amt = Number(amount) || 0
  const fastFee = speed === 'Fast' ? amt * 0.0001 : 0
  const src = dir === 'in' ? chain.name : ARC.name
  const dst = dir === 'in' ? ARC.name : chain.name
  const directCctp = mode === 'connected' && !!address && dir === 'out' && chain.name === 'Base Sepolia'
  const universalBlocked = mode === 'connected' && !directCctp ? universalBridgeAvailability() : undefined
  const brainAction = (): BrainPreparation => ({ kind: 'bridge', rawUserText: 'Manual Bridge flow', asset: 'USDC', amount: amount || undefined, sourceChain: src, destinationChain: dst })
  const brainContext = () => ({ connected: mode === 'connected', account: mode === 'connected' ? address : undefined, chainId: walletChainId, balances: Object.fromEntries(holdings.filter((x) => x.verified).map((x) => [x.symbol, x.balance])) })

  const ChainBox = ({ label, name, pick }: { label: string; name: string; pick: boolean }) => {
    const c = CHAINS.find((x) => x.name === name)
    return (
      <div className="flex-1 rounded-2xl bg-black/30 border border-white/[0.08] p-3.5 min-w-0">
        <div className={`text-[12px] ${T.mute}`}>{label}</div>
        {pick ? (
          <select value={chain.name} onChange={(e) => setChain(CHAINS.find((x) => x.name === e.target.value)!)} className="mt-1 w-full bg-transparent min-w-0 font-semibold text-[14px] outline-none">
            {CHAINS.map((x) => <option key={x.name} className="bg-[#18181e]">{x.name}</option>)}
          </select>
        ) : (
          <div className="mt-1 font-semibold text-[14px] flex items-center gap-2">
            <span className="w-5 h-5 rounded-full text-[9px] font-black flex items-center justify-center" style={{ background: c?.color ?? '#8efe7e' }}>{c ? c.short[0] : 'A'}</span> {name}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <PageHeader eyebrow="Cross-chain" title="Bridge USDC" desc="Move native USDC between Arc and other testnets with Circle CCTP — burn on one chain, mint on the other. No wrapped tokens." />
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,520px)_1fr] gap-5 items-start">
        <Card className="p-5 mk-in space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap"><Segmented value={dir === 'out' ? 'From Arc' : 'To Arc'} options={['From Arc', 'To Arc'] as const} onChange={(v) => setDir(v === 'To Arc' ? 'in' : 'out')} size="sm" /><Badge tone="warn">{directCctp ? say(liveQuote ? 'Official Circle quote' : 'Live quote required', liveQuote ? 'Báo giá chính thức của Circle' : 'Cần báo giá trực tiếp') : tr('Preview estimate')}</Badge></div>
          <div className="flex items-center gap-2">
            <ChainBox label={tr('From')} name={src} pick={dir === 'in'} />
            <ArrowRight size={18} className={`${T.mute} shrink-0`} />
            <ChainBox label={tr('To')} name={dst} pick={dir === 'out'} />
          </div>
          <div className="mk-field-shell rounded-2xl bg-black/30 border border-white/[0.08] p-4">
            <div className={`flex justify-between text-[12px] ${T.mute}`}><span>{tr('Amount')}</span>{dir === 'out' && <span>{tr('Balance')} {mask(fmtAmt(bal, 4))} USDC</span>}</div>
            <div className="mt-2 flex items-center gap-3">
              <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="0" className="flex-1 min-w-0 bg-transparent outline-none text-[30px] font-bold tabular-nums placeholder:text-white/20" />
              <TokenPill sym="USDC" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(['Fast', 'Standard'] as const).map((s) => (
              <button key={s} onClick={() => setSpeed(s)} className={`p-3 rounded-2xl border text-left transition ${speed === s ? 'border-white/20 bg-white/[0.08]' : 'border-white/[0.08] hover:bg-white/[0.04]'}`}>
                <div className="flex items-center gap-1.5 text-[14px] font-semibold">{s === 'Fast' ? <Zap size={14} className="text-neon-300" /> : <Clock size={14} className={T.mute} />} {tr(s)}</div>
                <div className={`text-[12px] mt-0.5 ${T.mute}`}>{s === 'Fast' ? `${tr(chain.fast)} · ${tr('small fee')}` : `${tr(chain.std)} · ${tr('no fee')}`}</div>
              </button>
            ))}
          </div>
          <div className="rounded-2xl border border-white/[0.06] p-3.5 text-[13px] space-y-2">
            <div className="flex justify-between"><span className={T.mute}>{directCctp ? say('Receive floor', 'Mức nhận tối thiểu') : tr('You receive')}</span><span className="tabular-nums font-semibold">{directCctp ? liveQuote ? `${formatUnits(liveQuote.expectedReceive, 6)} USDC` : say('Get a live quote below', 'Lấy báo giá trực tiếp bên dưới') : amt ? `${fmtAmt(amt - fastFee, 4)} USDC` : '—'}</span></div>
            <div className="flex justify-between"><span className={T.mute}>{directCctp ? say('Circle maximum fee', 'Phí tối đa của Circle') : tr('Fast transfer fee (est.)')}</span><span className="tabular-nums">{directCctp ? liveQuote ? `${formatUnits(liveQuote.maxFee, 6)} USDC` : say('Shown after Circle quote', 'Hiển thị sau khi nhận báo giá Circle') : speed === 'Fast' ? `~${fmtAmt(fastFee, 4)} USDC` : tr('Free')}</span></div>
            <div className="flex justify-between gap-3"><span className={`${T.mute} inline-flex items-center gap-1`}><Route size={13} /> {tr('Route (preview)')}</span><span className="text-right">{src} → {dst} · Circle CCTP</span></div>
            <div className="flex justify-between"><span className={T.mute}>{directCctp ? say('Selected transfer speed', 'Tốc độ chuyển đã chọn') : tr('Estimated arrival')}</span><span>{directCctp ? tr(speed) : tr(speed === 'Fast' ? chain.fast : chain.std)}</span></div>
          </div>
          {universalBlocked && <p role="status" className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-[12px] text-amber-200">{tr('Universal Bridge is unavailable: the provider cannot expose separately reviewed wallet steps for this route.')}</p>}
          {directCctp && address
            ? <LiveCctpControl account={address} amount={amount} transferSpeed={speed === 'Fast' ? 'FAST' : 'SLOW'} onQuoteChange={setLiveQuote} onSourceConfirmed={async () => { await refetchWallet() }} />
            : <Button variant="primary" size="lg" className="w-full" disabled={!!universalBlocked || !amt || (dir === 'out' && amt > bal)} onClick={() => { const review = prepareBrainReview(brainAction(), brainContext()); if (review.assessment.status === 'blocked') notify(tr(review.assessment.blockers[0] ?? 'Bridge blocked by safety policy'), 'err'); else notify(tr('Safety review prepared — route evidence and destination confirmation remain required before completion')) }}>{universalBlocked ? tr('Universal Bridge unavailable') : tr(amt ? (dir === 'out' && amt > bal ? 'Insufficient USDC' : 'Review bridge (preview)') : 'Enter an amount')}</Button>}
          <p className={`text-[12px] text-center ${T.mute}`}>{tr('Final route and details are confirmed before you sign in your wallet.')}</p>
        </Card>
        <Card className="p-5">
          <div className="text-[14px] font-semibold">{tr('How it works')}</div>
          <ol className="mt-4 space-y-4">
            {[
              { icon: Flame, t: tr('Burn on {chain}').replace('{chain}', src), d: tr('USDC is burned by the CCTP contract — you authorize it in your wallet.') },
              { icon: BadgeCheck, t: tr('Circle attestation'), d: `${tr('Circle signs a proof of the burn')} (${tr(speed === 'Fast' ? chain.fast : chain.std)}).` },
              { icon: Coins, t: tr('Mint on {chain}').replace('{chain}', dst), d: tr('Native USDC is minted to your address on the destination chain.') },
            ].map(({ icon: Icon, t, d }, i) => (
              <li key={t} className="flex gap-3">
                <span className="w-8 h-8 rounded-xl bg-neon-500/15 text-neon-300 flex items-center justify-center shrink-0"><Icon size={16} /></span>
                <div><div className="text-[14px] font-semibold">{i + 1}. {t}</div><div className={`text-[13px] ${T.sub}`}>{d}</div></div>
              </li>
            ))}
          </ol>
          <div className="mt-5 p-3 rounded-xl bg-white/[0.03] text-[12px] flex gap-2"><Info size={14} className="text-neon-300 shrink-0 mt-0.5" /><span className={T.sub}>{tr('When bridging is connected, pending transfers will appear in Activity so you can close the tab safely.')}</span></div>
        </Card>
      </div>
    </>
  )
}
