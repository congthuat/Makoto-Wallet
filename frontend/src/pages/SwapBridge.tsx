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
import { restoreStrategyInput, type StrategyRun } from '../migrated/strategyController'

function savedInput(protocol: StrategyRun['protocol'], mode: string, address: string | undefined, chainId: number | undefined) {
  try {
    if (mode !== 'connected' || !address || typeof localStorage === 'undefined') return undefined
    return restoreStrategyInput(localStorage, protocol, address, chainId)
  } catch { return undefined }
}

function TokenPill({ sym, onClick }: { sym: string; onClick?: () => void }) {
  const t = TOKENS.find((x) => x.sym === sym)!
  return (
    <button onClick={onClick} className="flex items-center gap-2 h-11 pl-1.5 pr-3 rounded-full bg-white/[0.07] border border-white/10 hover:bg-white/[0.12] shrink-0">
      <TokenIcon color={t.color} glyph={t.glyph} size={30} /><span className="font-semibold">{t.sym}</span>{onClick && <ChevronDown size={15} className={T.mute} />}
    </button>
  )
}

export function SwapPage() {
  const { mode, address, walletChainId } = useWallet()
  return <SwapForm key={`${mode}:${address?.toLowerCase()}:${walletChainId}`} />
}

function SwapForm() {
  const { holdings, prices, network, swapDraft, setSwapDraft, mask, notify, mode, address, walletChainId, refetchWallet } = useWallet()
  const [tr] = useT()
  const [restored] = useState(() => savedInput('swap', mode, address, walletChainId))
  const [from, setFrom] = useState<string>(restored?.kind === 'swap' ? restored.from : 'USDC')
  const [to, setTo] = useState<string>(restored?.kind === 'swap' ? restored.to : 'EURC')
  const [amount, setAmount] = useState(restored?.amount ?? '')
  const [slip, setSlip] = useState<'0.5%' | '1%' | '3%'>(restored?.kind === 'swap' ? restored.slip : '0.5%')
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
          {mode === 'connected' && address ? <LiveSwapControl account={address} from={from} to={to} amount={amount} slip={slip} onConfirmed={async () => { await refetchWallet() }} onComplete={() => { setAmount(''); setFrom('USDC'); setTo('EURC'); setSlip('0.5%') }} /> : <Button variant="primary" size="lg" className="w-full mt-4" disabled={!amt || !!err} onClick={() => { const review = prepareBrainReview(brainAction(), brainContext()); if (review.assessment.status === 'blocked') notify(tr(review.assessment.blockers[0] ?? 'Swap blocked by safety policy'), 'err'); else notify(tr('Safety review prepared — a fresh live quote and simulation are required before wallet confirmation')) }}>{err ?? tr(amt ? 'Review swap (preview)' : 'Enter an amount')}</Button>}
          <p className={`mt-2 text-[12px] text-center ${T.mute}`}>{tr(mode === 'connected' ? 'Reference prices above are estimates; the live XyloNet quote appears in review.' : 'Based on reference prices. You’ll see the final quote before signing.')}</p>
        </Card>
        <Card className="p-5">
          <div className="text-[14px] font-semibold">{tr('Why swap on Arc?')}</div>
          <ul className={`mt-3 space-y-3 text-[13px] ${T.sub}`}>
            <li className="flex gap-2.5"><Zap size={16} className="text-neon-300 shrink-0" /> {tr('Arc is designed for fast, deterministic finality.')}</li>
            <li className="flex gap-2.5"><Coins size={16} className="text-neon-300 shrink-0" /> {tr('Fees paid in USDC, so you never need a separate gas token.')}</li>
            <li className="flex gap-2.5"><BadgeCheck size={16} className="text-neon-300 shrink-0" /> {tr('Swap between native USDC and EURC — useful for payments and treasury.')}</li>
          </ul>
        </Card>
      </div>
    </>
  )
}

export function BridgePage() {
  const { mode, address, walletChainId } = useWallet()
  return <BridgeForm key={`${mode}:${address?.toLowerCase()}:${walletChainId}`} />
}

function BridgeForm() {
  const { holdings, mask, swapDraft, setSwapDraft, notify, mode, address, walletChainId, refetchWallet } = useWallet()
  const [tr, lang] = useT()
  const say = (en: string, vn: string) => lang === 'vi' ? vn : tr(en)
  const [restored] = useState(() => savedInput('cctp', mode, address, walletChainId))
  const [speed, setSpeed] = useState<'Fast' | 'Standard'>(restored?.kind === 'cctp' && restored.transferSpeed === 'SLOW' ? 'Standard' : 'Fast')
  const [amount, setAmount] = useState(restored?.amount ?? '')
  const [routeBlocked, setRouteBlocked] = useState(false)
  const [liveQuote, setLiveQuote] = useState<LiveQuote>()
  useEffect(() => {
    if (!swapDraft) return
    const supported = !swapDraft.dest || /^Base(?: Sepolia)?$/i.test(swapDraft.dest)
    setRouteBlocked(!supported)
    if (supported && swapDraft.amount) setAmount(swapDraft.amount)
    setSwapDraft(null)
  }, [swapDraft, setSwapDraft])
  useEffect(() => setLiveQuote(undefined), [address, amount, speed])
  useEffect(() => {
    if (mode !== 'connected' || !address || typeof sessionStorage === 'undefined') return
    const handoff = consumeBrainHandoff(sessionStorage, address)
    if (!handoff || handoff.action !== 'bridge') return
    const supported = (!handoff.sourceChain || handoff.sourceChain === ARC.name)
      && (!handoff.destinationChain || handoff.destinationChain === 'Base Sepolia')
      && (!handoff.asset || handoff.asset === 'USDC')
    setRouteBlocked(!supported)
    if (supported && handoff.amount) setAmount(handoff.amount)
  }, [mode, address])
  const bal = holdings.find((h) => h.symbol === 'USDC')?.balance ?? 0
  const amt = Number(amount) || 0
  const src = ARC.name
  const dst = 'Base Sepolia'
  const directCctp = mode === 'connected' && !!address
  const brainAction = (): BrainPreparation => ({ kind: 'bridge', rawUserText: 'Manual Bridge flow', asset: 'USDC', amount: amount || undefined, sourceChain: src, destinationChain: dst })
  const brainContext = () => ({ connected: mode === 'connected', account: mode === 'connected' ? address : undefined, chainId: walletChainId, balances: Object.fromEntries(holdings.filter((x) => x.verified).map((x) => [x.symbol, x.balance])) })

  const ChainBox = ({ label, name }: { label: string; name: string }) => {
    return (
      <div className="flex-1 rounded-2xl bg-black/30 border border-white/[0.08] p-3.5 min-w-0">
        <div className={`text-[12px] ${T.mute}`}>{label}</div>
        <div className="mt-1 font-semibold text-[14px] flex items-center gap-2">
          <span aria-hidden="true" className="h-5 px-1.5 rounded-md text-[8.5px] font-black flex items-center justify-center shrink-0 text-[#0b0b10]" style={{ background: name === src ? '#8efe7e' : '#7aa7ff' }}>{name === src ? 'ARC' : 'BASE'}</span> {name}
        </div>
      </div>
    )
  }

  return (
    <>
      <PageHeader eyebrow="Cross-chain" title="Bridge USDC" desc={say('Currently supported test route: Arc Testnet → Base Sepolia · Circle CCTP v2 · USDC only.', 'Tuyến thử nghiệm hiện được hỗ trợ: Arc Testnet → Base Sepolia · Circle CCTP v2 · Chỉ USDC.')} />
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,520px)_1fr] gap-5 items-start">
        <Card className="p-5 mk-in space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap"><span className="font-semibold text-[13px]">Circle CCTP v2 · {say('USDC only', 'Chỉ USDC')}</span><Badge tone="warn">{say(liveQuote ? 'Official Circle quote' : 'Live quote required', liveQuote ? 'Báo giá chính thức của Circle' : 'Cần báo giá trực tiếp')}</Badge></div>
          <div className="flex items-center gap-2">
            <ChainBox label={tr('From')} name={src} />
            <ArrowRight size={18} className={`${T.mute} shrink-0`} />
            <ChainBox label={tr('To')} name={dst} />
          </div>
          <div className="mk-field-shell rounded-2xl bg-black/30 border border-white/[0.08] p-4">
            <div className={`flex justify-between text-[12px] ${T.mute}`}><span>{tr('Amount')}</span><span>{tr('Balance')} {mask(fmtAmt(bal, 4))} USDC</span></div>
            <div className="mt-2 flex items-center gap-3">
              <input aria-label={tr('Amount')} value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.]/g, '')); setRouteBlocked(false) }} inputMode="decimal" placeholder="0" className="flex-1 min-w-0 bg-transparent outline-none text-[30px] font-bold tabular-nums placeholder:text-white/20" />
              <TokenPill sym="USDC" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(['Fast', 'Standard'] as const).map((s) => (
              <button key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)} className={`p-3 rounded-2xl border text-left transition ${speed === s ? 'border-white/20 bg-white/[0.08]' : 'border-white/[0.08] hover:bg-white/[0.04]'}`}>
                <div className="flex items-center gap-1.5 text-[14px] font-semibold">{s === 'Fast' ? <Zap size={14} className="text-neon-300" /> : <Clock size={14} className={T.mute} />} {tr(s)}</div>
                <div className={`text-[12px] mt-0.5 ${T.mute}`}>{say('Fees from live Circle quote', 'Phí theo báo giá Circle')}</div>
              </button>
            ))}
          </div>
          <div className="rounded-2xl border border-white/[0.06] p-3.5 text-[13px] space-y-2">
            <div className="flex justify-between gap-3"><span className={T.mute}>{say('Receive floor', 'Mức nhận tối thiểu')}</span><span className="tabular-nums font-semibold text-right">{liveQuote ? `${formatUnits(liveQuote.expectedReceive, 6)} USDC` : say('Get a live quote below', 'Lấy báo giá trực tiếp bên dưới')}</span></div>
            <div className="flex justify-between gap-3"><span className={T.mute}>{say('Circle maximum fee', 'Phí tối đa của Circle')}</span><span className="tabular-nums text-right">{liveQuote ? `${formatUnits(liveQuote.maxFee, 6)} USDC` : say('Shown after Circle quote', 'Hiển thị sau khi nhận báo giá Circle')}</span></div>
            <div className="flex justify-between gap-3"><span className={`${T.mute} inline-flex items-center gap-1`}><Route size={13} /> {say('Supported test route', 'Tuyến thử nghiệm hỗ trợ')}</span><span className="text-right">{src} → {dst}</span></div>
            <div className="flex justify-between"><span className={T.mute}>{say('Selected transfer speed', 'Tốc độ chuyển đã chọn')}</span><span>{tr(speed)}</span></div>
          </div>
          {routeBlocked && <p role="status" className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-[12px] text-amber-200">{say('Only Arc Testnet → Base Sepolia USDC is supported. Enter an amount to prepare this route.', 'Chỉ hỗ trợ USDC từ Arc Testnet → Base Sepolia. Nhập số tiền để chuẩn bị tuyến này.')}</p>}
          {directCctp && address
            ? <LiveCctpControl account={address} amount={routeBlocked ? '' : amount} transferSpeed={speed === 'Fast' ? 'FAST' : 'SLOW'} onQuoteChange={setLiveQuote} onSourceConfirmed={async () => { await refetchWallet() }} onComplete={() => { setAmount(''); setSpeed('Fast') }} />
            : <Button variant="primary" size="lg" className="w-full" disabled={routeBlocked || !amt || amt > bal} onClick={() => { const review = prepareBrainReview(brainAction(), brainContext()); if (review.assessment.status === 'blocked') notify(tr(review.assessment.blockers[0] ?? 'Bridge blocked by safety policy'), 'err'); else notify(tr('Safety review prepared — route evidence and destination confirmation remain required before completion')) }}>{tr(amt ? (amt > bal ? 'Insufficient USDC' : 'Review bridge (preview)') : 'Enter an amount')}</Button>}
          <p className={`text-[12px] text-center ${T.mute}`}>{tr('Final route and details are confirmed before you sign in your wallet.')}</p>
        </Card>
        <Card className="p-5">
          <div className="text-[14px] font-semibold">{tr('How it works')}</div>
          <ol className="mt-4 space-y-4">
            {[
              { icon: Info, t: say('Review / approval if required', 'Xem lại / phê duyệt nếu cần'), d: say('Review the quote and any exact USDC approval separately before confirming in your wallet.', 'Xem lại báo giá và phê duyệt USDC chính xác riêng trước khi xác nhận trong ví.') },
              { icon: Flame, t: tr('Burn on {chain}').replace('{chain}', src), d: tr('USDC is burned (removed) on the source chain by the CCTP contract and re-minted on the destination — you authorize it in your wallet.') },
              { icon: BadgeCheck, t: say('Circle attestation / forwarding', 'Chứng thực / chuyển tiếp Circle'), d: say('Circle attests to the burn and forwards the mint to Base Sepolia.', 'Circle chứng thực lệnh đốt và chuyển tiếp lệnh tạo USDC tới Base Sepolia.') },
              { icon: Coins, t: say('Destination confirmation on Base Sepolia', 'Xác nhận đích trên Base Sepolia'), d: say('Completion requires a verified Base receipt and matching USDC transfer to your address.', 'Chỉ hoàn tất khi có biên nhận Base được xác minh và giao dịch chuyển USDC phù hợp tới địa chỉ của bạn.') },
            ].map(({ icon: Icon, t, d }, i) => (
              <li key={t} className="flex gap-3">
                <span className="w-8 h-8 rounded-xl bg-neon-500/15 text-neon-300 flex items-center justify-center shrink-0"><Icon size={16} /></span>
                <div><div className="text-[14px] font-semibold">{i + 1}. {t}</div><div className={`text-[13px] ${T.sub}`}>{d}</div></div>
              </li>
            ))}
          </ol>
          <div className="mt-5 p-3 rounded-xl bg-white/[0.03] text-[12px] flex gap-2"><Info size={14} className="text-neon-300 shrink-0 mt-0.5" /><span className={T.sub}>{tr('Pending transfers appear in Activity, so you can safely close this tab and check later.')}</span></div>
        </Card>
      </div>
    </>
  )
}
