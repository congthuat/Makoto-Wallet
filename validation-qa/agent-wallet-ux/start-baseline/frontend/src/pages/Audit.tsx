import { CheckCircle2, CircleDashed, Circle, ArrowRight } from 'lucide-react'
import { useWallet, type Page } from '../lib/store'
import { Badge, Card, PageHeader, T } from '../components/wallet/ui'
import { ScoreRing } from '../components/wallet/charts'

type Status = 'done' | 'partial' | 'todo'
type Item = { t: string; d: string; before: Status; now: Status; page?: Page }

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: 'Alphio-style agent experience',
    items: [
      { t: 'Agent-first home (Ask / Monitor / Automate)', d: 'One prompt box drives chat, monitoring rules and recurring reports', before: 'todo', now: 'done', page: 'home' },
      { t: 'Plain-language Tasks', d: 'Arc token balance monitors and daily read-only summaries with persistent status and alert history', before: 'todo', now: 'done', page: 'tasks' },
      { t: 'Whale Wallet Monitor & Live Trade Feed', d: 'Largest and latest USDC/EURC transfers streamed from Arc blocks', before: 'todo', now: 'done', page: 'home' },
      { t: 'Fear & Greed + Top holders', d: 'Market sentiment gauge and largest USDC wallets on Arc', before: 'todo', now: 'done', page: 'home' },
      { t: 'Total / 24h P&L cards & colour schemes', d: 'Neon Total card, purple P&L card, 7 switchable themes', before: 'todo', now: 'done' },
      { t: 'Server-side 24/7 runner + Telegram/email', d: 'Tasks keep running when the tab is closed', before: 'todo', now: 'todo' },
      { t: 'Copy strategies / leaderboard', d: 'Follow top Arc wallets and mirror their moves', before: 'todo', now: 'todo' },
    ],
  },
  {
    title: 'Core wallet',
    items: [
      { t: 'Real wallet connection', d: 'Connect OKX / Rabby / MetaMask, auto-add Arc Testnet, react to account changes', before: 'partial', now: 'done', page: 'settings' },
      { t: 'Watch-only mode', d: 'Paste any address to view real balances & history read-only', before: 'todo', now: 'done' },
      { t: 'Live balances & activity', d: 'Loaded from Arc explorer instead of hard-coded values', before: 'todo', now: 'done', page: 'activity' },
      { t: 'Send flow with review step', d: 'Validation, MAX, USDC fee, review screen, wallet signing, confirmation tracker', before: 'todo', now: 'done', page: 'send' },
      { t: 'Receive with QR code', d: 'QR, copy/share, wrong-network warning', before: 'todo', now: 'done' },
      { t: 'Swap USDC ⇄ EURC', d: 'Preview estimate, slippage, min. received, route — execution not connected', before: 'todo', now: 'partial', page: 'swap' },
      { t: 'Bridge via CCTP', d: 'Deposit/withdraw UI, fast vs standard, step explainer — execution still to be wired', before: 'todo', now: 'partial', page: 'bridge' },
    ],
  },
  {
    title: 'Safety & trust',
    items: [
      { t: 'Spam / impersonation token filter', d: 'Only verified Circle contracts are priced; fake “cirBTC” etc. hidden', before: 'todo', now: 'done', page: 'assets' },
      { t: 'Safe-send checks', d: 'Invalid address, token-contract address, first-time recipient, self-send', before: 'todo', now: 'done', page: 'send' },
      { t: 'Large-transfer confirmation', d: 'Extra checkbox for transfers ≥ $100', before: 'todo', now: 'done' },
      { t: 'App Lock with PIN + auto-lock', d: 'Hashed PIN on device, lock screen, inactivity timer', before: 'partial', now: 'done', page: 'settings' },
      { t: 'Privacy mode', d: 'Hide balances everywhere with one tap', before: 'todo', now: 'done' },
      { t: 'Transaction simulation', d: 'Preview balance changes before signing (e.g. via eth_call / Tenderly)', before: 'todo', now: 'todo' },
    ],
  },
  {
    title: 'Insight & productivity',
    items: [
      { t: 'Portfolio value chart', d: '24H / 7D with hover tooltip', before: 'todo', now: 'done' },
      { t: 'Price, 24h change & sparkline per asset', d: 'Live market prices', before: 'todo', now: 'done' },
      { t: 'Activity filters, search & CSV export', d: 'Group by day, direction/token filters, export for accounting', before: 'todo', now: 'done', page: 'activity' },
      { t: 'Transaction detail view', d: 'Block, confirmations, hash copy, explorer link, save contact', before: 'todo', now: 'done' },
      { t: 'Address book', d: 'Named contacts used in Send and Activity', before: 'todo', now: 'done', page: 'settings' },
      { t: 'Live Arc network status', d: 'Block height, USDC gas fee, RPC latency', before: 'todo', now: 'done' },
      { t: 'Agent that prepares actions', d: 'Command-based: balance, swap quote, send draft, activity, gas — LLM still to connect', before: 'partial', now: 'partial', page: 'agent' },
      { t: 'Push / email notifications', d: 'Real alerts for incoming transfers (needs backend job)', before: 'todo', now: 'todo' },
    ],
  },
  {
    title: 'Experience & reach',
    items: [
      { t: 'Mobile bottom navigation', d: 'Thumb-friendly tab bar, bottom-sheet modals', before: 'todo', now: 'done' },
      { t: 'Loading skeletons & empty states', d: 'No blank or jumping layouts', before: 'todo', now: 'done' },
      { t: 'Toasts & feedback on every action', d: 'Copy, save, connect, errors', before: 'partial', now: 'done' },
      { t: 'Keyboard shortcuts', d: '“/” focuses search, Esc closes dialogs', before: 'todo', now: 'done' },
      { t: 'Multi-language (EN / VI)', d: 'Language switch exists but content is English only', before: 'partial', now: 'todo' },
      { t: 'Light theme', d: 'Theme toggle not implemented yet', before: 'partial', now: 'todo' },
    ],
  },
]

const icon = (s: Status) => s === 'done' ? <CheckCircle2 size={16} className="text-live" /> : s === 'partial' ? <CircleDashed size={16} className="text-amber-300" /> : <Circle size={16} className="text-white/25" />
const label = { done: 'Done', partial: 'Partial', todo: 'To do' } as const
const tone = { done: 'ok', partial: 'warn', todo: 'default' } as const

export default function AuditPage() {
  const { go } = useWallet()
  const all = GROUPS.flatMap((g) => g.items)
  const score = (k: 'before' | 'now') => all.reduce((s, i) => s + (i[k] === 'done' ? 1 : i[k] === 'partial' ? 0.5 : 0), 0)
  const before = Math.round((score('before') / all.length) * 10)
  const now = Math.round((score('now') / all.length) * 10)
  return (
    <>
      <PageHeader eyebrow="Internal prototype documentation" title="UX audit" desc="Feature checklist compared with top wallets (Phantom, Rabby, Coinbase Wallet). Use it as a roadmap for Makoto on Arc." />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card className="p-5 flex items-center gap-4"><ScoreRing value={before} total={10} /><div><div className={`text-[12px] ${T.mute}`}>Original site</div><div className="text-[15px] font-semibold">Feature coverage</div></div></Card>
        <Card className="p-5 flex items-center gap-4"><ScoreRing value={now} total={10} /><div><div className={`text-[12px] ${T.mute}`}>This reference</div><div className="text-[15px] font-semibold">Feature coverage</div></div></Card>
        <Card className="p-5">
          <div className={`text-[12px] ${T.mute}`}>Next priorities</div>
          <ol className="mt-2 text-[13px] space-y-1 list-decimal list-inside">
            <li>Wire swap & CCTP bridge execution</li><li>Transaction simulation</li><li>Vietnamese + light theme</li>
          </ol>
        </Card>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {GROUPS.map((g) => (
          <Card key={g.title}>
            <div className="px-5 pt-5 pb-2 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">{g.title}</h2>
              <span className={`text-[12px] ${T.mute}`}>{g.items.filter((i) => i.now === 'done').length}/{g.items.length} done</span>
            </div>
            <ul className="px-2 pb-2">
              {g.items.map((i) => (
                <li key={i.t}>
                  <button disabled={!i.page} onClick={() => i.page && go(i.page)} className="w-full text-left flex items-start gap-3 px-3 py-3 rounded-xl enabled:hover:bg-white/[0.035] group">
                    <span className="mt-0.5">{icon(i.now)}</span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-2 flex-wrap text-[14px] font-medium">{i.t} <Badge tone={tone[i.now]}>{label[i.now]}</Badge>{i.before !== i.now && <span className={`text-[11px] ${T.mute}`}>was: {label[i.before]}</span>}</span>
                      <span className={`block text-[12px] mt-0.5 ${T.mute}`}>{i.d}</span>
                    </span>
                    {i.page && <ArrowRight size={14} className={`mt-1 ${T.mute} opacity-0 group-hover:opacity-100`} />}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </>
  )
}
