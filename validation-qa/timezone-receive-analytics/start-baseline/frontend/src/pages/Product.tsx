import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ShieldCheck, Sparkles, Eye, Droplets, Languages, ChevronDown, Mail, Check, ArrowRight,
  CircleDot, AlertTriangle, RefreshCw, FileText, Lock,
} from 'lucide-react'
import { useWallet } from '../lib/store'
import { ARC } from '../lib/wallet'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import { COMMUNITY } from '../lib/community'
import { Badge, Button, Card, CardHeader, LogoLockup, PageHeader, Segmented, T, inputCls } from '../components/wallet/ui'


/* ---------------- Waitlist ---------------- */
export function Waitlist({ compact = false }: { compact?: boolean }) {
  const [tr, lang] = useT()
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>(() => (localStorage.getItem('mk.waitlist') ? 'done' : 'idle'))
  const count = useQuery<{ count: number }>({ queryKey: ['waitlist'], queryFn: () => fetch(api('waitlist')).then((r) => r.json()), staleTime: 60_000 })
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())
  const submit = async () => {
    if (!valid) return
    setState('sending')
    try {
      const r = await fetch(api('waitlist'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email.trim(), lang }) })
      if (!r.ok) throw new Error()
      localStorage.setItem('mk.waitlist', '1'); setState('done'); count.refetch()
    } catch { setState('error') }
  }
  return (
    <div className={compact ? '' : 'mk-hero rounded-2xl border border-white/[0.08] p-5 sm:p-6'}>
      {!compact && <h3 className="text-[18px] font-bold">{tr('Join the waitlist')}</h3>}
      {!compact && <p className={`mt-1 text-[13.5px] ${T.sub}`}>{tr('Be the first to know when Makoto launches beyond the design preview.')}</p>}
      {state === 'done' ? (
        <div className="mt-4 flex items-center gap-2 text-[14px] font-semibold text-live"><Check size={16} /> {tr("You're on the list. We'll email you at launch.")}</div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); submit() }} className="mt-4 flex flex-col sm:flex-row gap-2">
          <label className="sr-only" htmlFor="mk-wl">Email</label>
          <input id="mk-wl" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" className={`${inputCls} h-11 flex-1`} />
          <Button variant="primary" size="md" className="h-11" disabled={!valid || state === 'sending'}><Mail size={15} /> {state === 'sending' ? tr('Sending…') : tr('Notify me')}</Button>
        </form>
      )}
      {state === 'error' && <p className="mt-2 text-[12.5px] text-rose-300">{tr("Couldn't save your email. Please try again.")}</p>}
      <p className={`mt-2 text-[11.5px] ${T.mute}`}>
        {count.data?.count ? `${count.data.count.toLocaleString()} ${tr('people already joined')} · ` : ''}{tr('We only use your email for launch updates.')}
      </p>
    </div>
  )
}

/* ---------------- About ---------------- */
const FAQ = [
  ['What is Makoto?', 'Makoto is an agent wallet for Arc. You describe what you want in plain language; Makoto prepares the details, and you review every step before your wallet authorizes anything.'],
  ['Is it safe? Does Makoto hold my funds?', 'Makoto never stores private keys and cannot move funds by itself. Transactions are authorized by your wallet. This version is a design preview on Arc Testnet and does not submit transactions.'],
  ['Does it cost money?', 'No. The preview runs on Arc Testnet. Test tokens are free from the Circle faucet and have no real value.'],
  ['Which wallets are supported?', 'Browser wallets such as OKX Wallet, Rabby and MetaMask. You can also watch any public address in read-only mode.'],
  ['How is Makoto different from other wallets?', 'Instead of hunting through menus, you ask. Makoto turns requests into clear, reviewable steps, and separates sample data from live data so nothing is misleading.'],
  ['What does "design preview" mean?', 'The UI includes previews. Monitors and daily read-only tasks are saved on the local backend and run while it is on. Financial actions still require your review and wallet signature.'],
]

export function AboutPage() {
  const { go } = useWallet()
  const [tr] = useT()
  const [open, setOpen] = useState<number | null>(0)
  const features = [
    { icon: Sparkles, t: 'Ask in plain language', d: 'Send, swap, bridge or check your portfolio by simply asking.' },
    { icon: ShieldCheck, t: 'You stay in control', d: 'Review parameters, then the transaction, then sign in your own wallet — three separate steps.' },
    { icon: Eye, t: 'Honest data', d: 'Sample and live data are always labelled. No fake numbers.' },
    { icon: Droplets, t: 'Built for Arc', d: 'USDC as gas, fast finality, and direct access to the Circle testnet faucet.' },
    { icon: Languages, t: '5 languages', d: 'English, Vietnamese, Chinese, Japanese and Korean — light and dark mode.' },
  ]
  return (
    <div className="space-y-6">
      <section className="mk-agent relative overflow-hidden rounded-2xl border border-white/[0.08] px-5 py-12 sm:px-10 sm:py-16 text-center mk-in">
        <div className="relative z-10 mx-auto max-w-[720px] flex flex-col items-center">
          <LogoLockup size={44} />
          <h1 className="mt-6 text-[30px] sm:text-[44px] leading-[1.1] font-extrabold tracking-[-0.025em]" style={{ fontFamily: 'Montserrat, sans-serif' }}>
            {tr('The wallet you can')} <span className="mk-headline bg-gradient-to-r from-[#b6ff9f] via-neon-500 to-[#4fbf4a] bg-clip-text text-transparent">{tr('just ask.')}</span>
          </h1>
          <p className={`mt-4 text-[15px] ${T.sub}`}>{tr('Makoto is an agent wallet for Arc — ask in plain language, review every step, and authorize with your own wallet.')}</p>
          <div className="mt-7 flex flex-wrap justify-center gap-2">
            <Button variant="primary" size="lg" onClick={() => go('home')}>{tr('Try the preview')} <ArrowRight size={16} /></Button>
            <Button size="lg" onClick={() => go('faucet')}><Droplets size={16} /> {tr('Get test tokens')}</Button>
          </div>
          <div className="mt-5"><Badge>{tr('Design preview · Arc Testnet')}</Badge></div>
        </div>
      </section>

      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {features.map(({ icon: Icon, t, d }) => (
          <Card key={t} className="p-4 mk-in">
            <span className="w-9 h-9 rounded-xl bg-neon-500/15 text-neon-300 flex items-center justify-center"><Icon size={17} /></span>
            <div className="mt-3 text-[14px] font-semibold">{tr(t)}</div>
            <div className={`mt-1 text-[12.5px] ${T.sub}`}>{tr(d)}</div>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-5 items-start">
        <Card className="mk-in">
          <CardHeader title="Frequently asked questions" />
          <div className="px-3 pb-3">
            {FAQ.map(([q, a], i) => (
              <div key={q} className="border-t border-white/[0.06] first:border-t-0">
                <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} className="w-full flex items-center justify-between gap-3 px-2 py-3.5 text-left text-[14px] font-semibold">
                  {tr(q)} <ChevronDown size={16} className={`shrink-0 ${T.mute} transition ${open === i ? 'rotate-180' : ''}`} />
                </button>
                {open === i && <p className={`px-2 pb-4 text-[13.5px] leading-relaxed ${T.sub}`}>{tr(a)}</p>}
              </div>
            ))}
          </div>
        </Card>
        <div className="space-y-5">
          <Waitlist />
          <Card className="p-5 mk-in">
            <div className="text-[14px] font-semibold">{tr('Community')}</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {COMMUNITY.map(({ icon: Icon, label, href }) => (
                <a key={label} href={href} target="_blank" rel="noreferrer" className="h-10 px-3 rounded-xl border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] inline-flex items-center gap-2 text-[13px] font-medium"><Icon size={15} className="text-neon-300" /> {tr(label)}</a>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

/* ---------------- Legal ---------------- */
const TERMS = [
  ['Preview software', 'Makoto is provided as a design preview on Arc Testnet, "as is", without warranties. Features may change or be removed.'],
  ['No financial advice', 'Nothing in Makoto is financial, investment or legal advice. Prices and estimates are for reference only.'],
  ['Testnet only', 'Test tokens have no monetary value. Do not send mainnet assets to testnet addresses.'],
  ['Your wallet, your responsibility', 'You are responsible for your wallet, keys and any transaction you authorize. Makoto cannot reverse transactions.'],
  ['Acceptable use', 'Do not use Makoto for unlawful activity or to interfere with the service or the Arc network.'],
]
const PRIVACY = [
  ['What we store on your device', 'Settings, language, theme, contacts and feedback are saved in your browser. Task definitions, run results and task notifications are saved by the local backend.'],
  ['What we never collect', 'Private keys, seed phrases or signatures. Makoto never asks for them.'],
  ['Public blockchain data', 'When you connect or watch an address, Makoto reads public balances and transfers from the Arc explorer and RPC.'],
  ['Waitlist email', 'If you join the waitlist, we store your email and language only to send launch updates. You can ask us to delete it at any time.'],
  ['Third parties', 'Market prices come from a data provider; wallet connection uses your browser wallet extension. Each has its own privacy policy.'],
]
export function LegalPage() {
  const [tr] = useT()
  const [tab, setTab] = useState<'Terms' | 'Privacy'>('Terms')
  const list = tab === 'Terms' ? TERMS : PRIVACY
  return (
    <>
      <PageHeader eyebrow="Legal" title={tab === 'Terms' ? 'Terms of use' : 'Privacy policy'} desc="Last updated: September 2026" right={<Segmented value={tab} options={['Terms', 'Privacy'] as const} onChange={setTab} />} />
      <Card className="max-w-[820px] mk-in">
        <ol className="p-5 sm:p-6 space-y-5">
          {list.map(([h, b], i) => (
            <li key={h} className="flex gap-3">
              <span className="w-7 h-7 rounded-lg bg-neon-500/15 text-neon-300 text-[12px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
              <div><h2 className="text-[15px] font-semibold">{tr(h)}</h2><p className={`mt-1 text-[13.5px] leading-relaxed ${T.sub}`}>{tr(b)}</p></div>
            </li>
          ))}
        </ol>
        <div className={`px-6 pb-5 text-[12px] flex items-center gap-2 ${T.mute}`}>{tab === 'Terms' ? <FileText size={13} /> : <Lock size={13} />} {tr('Questions? Use Feedback in the menu.')}</div>
      </Card>
    </>
  )
}

/* ---------------- Changelog ---------------- */
const CHANGES: { v: string; date: string; tag: string; items: string[] }[] = [
  { v: 'Preview 1.4', date: '2026-09-26', tag: 'New', items: ['About page with FAQ and waitlist', 'Command palette (Ctrl + K)', 'Share portfolio as image', 'Terms, Privacy, Changelog and Status pages', 'Full translation in 5 languages'] },
  { v: 'Preview 1.3', date: '2026-09-25', tag: 'New', items: ['Light and dark mode', 'Language switcher in the header', 'New Makoto logo'] },
  { v: 'Preview 1.2', date: '2026-09-24', tag: 'New', items: ['Arc Testnet faucet page', 'Vietnamese, Chinese, Japanese and Korean', 'Redesigned Agent hero'] },
  { v: 'Preview 1.1', date: '2026-09-23', tag: 'Improved', items: ['Agent uses fixed sample scenarios', 'Send shows preview states — no transaction submitted', 'Clear labels for sample vs live data', 'App Lock marked as coming soon'] },
]
export function ChangelogPage() {
  const [tr] = useT()
  return (
    <>
      <PageHeader eyebrow="Product" title="Changelog" desc="What's new in Makoto." />
      <div className="max-w-[820px] space-y-4">
        {CHANGES.map((c) => (
          <Card key={c.v} className="p-5 mk-in">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[16px] font-bold">{c.v}</h2>
              <Badge tone={c.tag === 'New' ? 'live' : undefined}>{tr(c.tag)}</Badge>
              <span className={`ml-auto text-[12px] font-num ${T.mute}`}>{c.date}</span>
            </div>
            <ul className="mt-3 space-y-1.5">
              {c.items.map((it) => <li key={it} className={`flex gap-2 text-[13.5px] ${T.sub}`}><CircleDot size={12} className="text-neon-300 mt-1 shrink-0" /> {tr(it)}</li>)}
            </ul>
          </Card>
        ))}
      </div>
    </>
  )
}

/* ---------------- Status ---------------- */
export function StatusPage() {
  const { network, networkError, prices } = useWallet()
  const [tr] = useT()
  const feed = useQuery({ queryKey: ['status-sentiment'], queryFn: () => fetch(api('sentiment')).then((r) => { if (!r.ok) throw new Error(); return r.json() }), staleTime: 60_000, retry: 1 })
  const rows = [
    { name: 'Arc Testnet network', ok: !networkError && !!network, loading: !network && !networkError, detail: network ? `${tr('Block')} #${network.blockNumber.toLocaleString()} · ${network.rpcLatencyMs} ms` : '' },
    { name: 'Market prices', ok: !!prices, loading: !prices, detail: prices ? 'USDC · EURC · BTC' : '' },
    { name: 'Market sentiment', ok: feed.isSuccess, loading: feed.isLoading, detail: '' },
    { name: 'Circle faucet', ok: true, loading: false, detail: tr('External · faucet.circle.com') },
  ]
  const allOk = rows.every((r) => r.ok)
  return (
    <>
      <PageHeader eyebrow="System" title="Status" desc="Live health of the services Makoto depends on." />
      <div className="max-w-[820px] space-y-4">
        <Card className={`p-5 mk-in flex items-center gap-3 ${allOk ? '' : ''}`}>
          {allOk ? <span className="w-10 h-10 rounded-full bg-live/15 text-live flex items-center justify-center"><Check size={20} /></span> : <span className="w-10 h-10 rounded-full bg-amber-400/15 text-amber-300 flex items-center justify-center"><AlertTriangle size={19} /></span>}
          <div className="flex-1">
            <div className="text-[16px] font-bold">{tr(allOk ? 'All systems operational' : 'Some services are degraded')}</div>
            <div className={`text-[12.5px] ${T.mute}`}>{tr('Checked from your browser just now')}</div>
          </div>
          <Button size="sm" onClick={() => window.location.reload()} aria-label={tr('Refresh')}><RefreshCw size={13} /></Button>
        </Card>
        <Card className="mk-in divide-y divide-white/[0.06]">
          {rows.map((r) => (
            <div key={r.name} className="flex items-center gap-3 px-5 py-4">
              <span className={`w-2.5 h-2.5 rounded-full ${r.loading ? 'bg-white/30' : r.ok ? 'bg-live' : 'bg-rose-400'}`} />
              <div className="flex-1 min-w-0"><div className="text-[14px] font-medium">{tr(r.name)}</div>{r.detail && <div className={`text-[12px] font-num truncate ${T.mute}`}>{r.detail}</div>}</div>
              <span className={`text-[12.5px] font-semibold ${r.loading ? T.mute : r.ok ? 'text-live' : 'text-rose-300'}`}>{tr(r.loading ? 'Checking…' : r.ok ? 'Operational' : 'Unavailable')}</span>
            </div>
          ))}
        </Card>
        <p className={`text-[12px] ${T.mute}`}>{tr('Network')}: {ARC.name} · Chain ID {ARC.chainId}</p>
      </div>
    </>
  )
}
