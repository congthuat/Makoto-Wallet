import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import {
  Wallet, History, Sparkles, ArrowLeftRight, Rainbow, Settings, HelpCircle, MessageSquareText,
  Search, Copy, ListChecks, PieChart, Eye, EyeOff, ArrowUpRight, ArrowDownLeft, Menu, X, Bell, Check, Home, LogOut, Droplets, Globe, ChevronDown, Sun, Moon, EyeOff as EyeOffIcon, Info, Command, AlertTriangle, Plus, Coins,
} from 'lucide-react'
import { WalletProvider, useWallet, type Page } from './lib/store'
import { useT, LANGS, setLang } from './lib/i18n'
import { taskDate, taskText } from './lib/taskText'
import { taskItemsForAccount } from './lib/tasks'
import { useTheme } from './lib/theme'
import { ARC, ago, fmtAmt, isAddress, short } from './lib/wallet'
import { useDismissibleOverlay } from './lib/useDismissibleOverlay'
import { Avatar, Badge, Button, LiveDot, Logo, LogoLockup, Modal, Skeleton, T } from './components/wallet/ui'
import { ConnectModal, ReceiveModal, TxDetailModal, copyText } from './components/wallet/shared'
import HomePage from './pages/Home'
import { COMMUNITY } from './lib/community'
const Dashboard = lazy(() => import('./pages/Dashboard'))
const AssetsPage = lazy(() => import('./pages/AssetsActivity').then((m) => ({ default: m.AssetsPage })))
const ActivityPage = lazy(() => import('./pages/AssetsActivity').then((m) => ({ default: m.ActivityPage })))
const SendPage = lazy(() => import('./pages/Send'))
const SwapPage = lazy(() => import('./pages/SwapBridge').then((m) => ({ default: m.SwapPage })))
const BridgePage = lazy(() => import('./pages/SwapBridge').then((m) => ({ default: m.BridgePage })))
const AgentPage = lazy(() => import('./pages/Agent'))
const SettingsPage = lazy(() => import('./pages/Settings'))
const AuditPage = lazy(() => import('./pages/Audit'))
const InsightsPage = lazy(() => import('./pages/Insights'))
const TasksPage = lazy(() => import('./pages/Tasks'))
const FaucetPage = lazy(() => import('./pages/Faucet'))
const AboutPage = lazy(() => import('./pages/Product').then((m) => ({ default: m.AboutPage })))
const LegalPage = lazy(() => import('./pages/Product').then((m) => ({ default: m.LegalPage })))
const ChangelogPage = lazy(() => import('./pages/Product').then((m) => ({ default: m.ChangelogPage })))
const StatusPage = lazy(() => import('./pages/Product').then((m) => ({ default: m.StatusPage })))
import CommandPalette from './components/CommandPalette'

const NAV: { group: string; items: { id: Page; icon: any; label: string }[] }[] = [
  { group: 'DISCOVER', items: [
    { id: 'home', icon: Home, label: 'Home' },
    { id: 'agent', icon: Sparkles, label: 'Agent' },
    { id: 'tasks', icon: ListChecks, label: 'Tasks' },
  ] },
  { group: 'WALLET', items: [
    { id: 'dashboard', icon: PieChart, label: 'Portfolio' },
    { id: 'assets', icon: Coins, label: 'Assets' },
    { id: 'activity', icon: History, label: 'Activity' },
  ] },
  { group: 'TRADE', items: [
    { id: 'send', icon: ArrowUpRight, label: 'Send' },
    { id: 'swap', icon: ArrowLeftRight, label: 'Swap' },
    { id: 'bridge', icon: Rainbow, label: 'Bridge' },
    { id: 'faucet', icon: Droplets, label: 'Faucet' },
  ] },
]

function FeedbackModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { notify } = useWallet()
  const [tr] = useT()
  const [v, setV] = useState('')
  const save = () => {
    const list = JSON.parse(localStorage.getItem('mk.feedback') ?? '[]')
    localStorage.setItem('mk.feedback', JSON.stringify([{ at: Date.now(), text: v.trim() }, ...list].slice(0, 20)))
    setV(''); onClose(); notify('Thanks — feedback saved on this device')
  }
  return (
    <Modal open={open} onClose={onClose} title={tr('Feedback')}>
      <p className={`text-[13px] ${T.sub}`}>{tr("What's working, what isn't? Notes are kept on this device for the team review.")}</p>
      <textarea value={v} onChange={(e) => setV(e.target.value)} rows={5} placeholder={tr('Tell us what you think…')} className="mt-3 w-full p-3 rounded-xl bg-black/30 border border-white/[0.08] text-[14px] resize-none" />
      <Button variant="primary" className="mt-3 w-full" disabled={!v.trim()} onClick={save}>{tr('Save feedback')}</Button>
    </Modal>
  )
}

function Sidebar({ onNavigate, onFeedback }: { onNavigate?: () => void; onFeedback: () => void }) {
  const { page, go, network, networkError, tasks, mode, address } = useWallet()
  const running = taskItemsForAccount(tasks, mode, address).filter((task) => task.status === 'ACTIVE').length
  const [tr] = useT()
  const cls = (active: boolean) => `group relative w-full flex items-center gap-3 h-9 px-3 rounded-lg text-[13.5px] font-medium transition ${active ? 'bg-white/[0.06] text-white' : `${T.sub} hover:bg-white/[0.03] hover:text-white`}`
  const Item = ({ id, icon: Icon, label }: { id: Page; icon: any; label: string }) => {
    const active = page === id || (id === 'dashboard' && page === 'insights' && false)
    return (
      <button onClick={() => { go(id); onNavigate?.() }} className={cls(active)}>
        {active && <span className="mk-ind absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-neon-400" />}
        <Icon size={17} className={active ? 'text-neon-300' : 'opacity-70 group-hover:opacity-100'} />
        {tr(label)}
        {id === 'tasks' && running > 0 && <span className="ml-auto min-w-5 h-5 px-1.5 rounded-full text-[10px] font-bold bg-white/[0.06] text-[#c8ffbe] flex items-center justify-center">{running}</span>}
      </button>
    )
  }
  return (
    <div className="flex flex-col h-full px-3 py-5 overflow-y-auto">
      <button onClick={() => { go('home'); onNavigate?.() }} className="flex items-center gap-2.5 px-2 h-10 text-left">
        <LogoLockup size={32} />
      </button>
      {NAV.map((g) => (
        <div key={g.group}>
          <div className={`mt-6 mb-1.5 px-3 text-[10.5px] font-semibold tracking-[0.14em] ${T.mute}`}>{tr(g.group)}</div>
          <nav className="space-y-0.5">{g.items.map((i) => <Item key={i.id} {...i} />)}</nav>
        </div>
      ))}
      <div className="mt-auto pt-6 space-y-2">
        <div className={`flex items-center gap-2 px-3 text-[12px] ${T.mute}`}>
          <LiveDot off={networkError} />
          <span className="truncate">{networkError ? tr('Arc unreachable') : network ? `${ARC.name} · #${network.blockNumber.toLocaleString()}` : tr('Connecting to Arc…')}</span>
        </div>
        <nav className="space-y-0.5 border-t border-white/[0.05] pt-2">
          <button onClick={() => { onFeedback(); onNavigate?.() }} className={cls(false)}><MessageSquareText size={17} className="opacity-70" /> {tr('Feedback')}</button>
          <Item id="settings" icon={Settings} label="Settings" />
          <button onClick={() => { go('about'); onNavigate?.() }} className={cls(false)}><HelpCircle size={17} className="opacity-70" /> {tr('Help & FAQ')}</button>
        </nav>
      </div>
    </div>
  )
}

type HeaderMenu = 'notifications' | 'language' | 'wallet' | null

function Notifications({ open, onToggle, onClose }: { open: boolean; onToggle: () => void; onClose: () => void }) {
  const { activity, settings, setTxDetail, mask, live, mode, address, taskNotifications, taskNotificationsError, go } = useWallet()
  const [tr, language] = useT()
  const locale = language === 'vi' ? 'vi' : 'en'
  const [seen, setSeen] = useState(() => Number(localStorage.getItem('mk.seen') ?? 0))
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useDismissibleOverlay(open, triggerRef, panelRef, onClose)
  const incoming = activity.filter((a) => a.direction === 'in' && a.verified).slice(0, 6)
  const taskAlerts = taskItemsForAccount(taskNotifications, mode, address).slice(0, 8)
  const unread = (settings.txAlerts ? incoming.filter((a) => a.timestamp > seen).length : 0) + taskAlerts.filter((item) => Date.parse(item.createdAt) > seen).length
  const toggle = () => {
    onToggle()
    if (!open) { const n = Date.now(); localStorage.setItem('mk.seen', String(n)); setTimeout(() => setSeen(n), 1500) }
  }
  return (
    <div className="relative">
      <button ref={triggerRef} onClick={toggle} aria-expanded={open} aria-controls="mk-notifications" className={`relative h-10 w-10 inline-flex items-center justify-center rounded-xl ${T.sub} hover:text-white hover:bg-white/[0.06]`} aria-label={tr('Notifications')}>
        <Bell size={17} />
        {unread > 0 && <span className="absolute top-1.5 right-1.5 min-w-4 h-4 px-1 rounded-full bg-neon-500 text-[10px] font-bold text-[#0b0b10] flex items-center justify-center ring-2 ring-[#0b0b10]">{unread}</span>}
      </button>
      {open && (
          <div ref={panelRef} id="mk-notifications" className="fixed inset-x-4 top-14 z-50 sm:absolute sm:left-auto sm:right-0 sm:top-12 sm:w-[340px] sm:max-w-[calc(100vw-2rem)] rounded-2xl border border-white/10 bg-[#17171d] shadow-2xl mk-in">
            <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between"><span className="text-[14px] font-semibold">{tr('Notifications')}</span><span className="flex gap-1.5">{!live && <Badge>{tr('Sample data')}</Badge>}{!settings.txAlerts && <Badge>{tr('Alerts off')}</Badge>}</span></div>
            <div className="max-h-[360px] overflow-y-auto p-1.5">
              {taskNotificationsError && <div className="p-3 text-[12px] text-amber-300">{taskText('backendOffline', locale)}</div>}
              {taskAlerts.map((item) => <button key={item.id} onClick={() => { go('tasks'); onClose() }} className="w-full flex gap-3 p-2.5 rounded-xl hover:bg-white/[0.05] text-left"><span className="w-8 h-8 rounded-full bg-neon-500/10 text-neon-300 flex items-center justify-center shrink-0"><Bell size={15} /></span><span className="flex-1 min-w-0"><span className="block text-[13px] font-semibold">{locale === 'vi' ? item.titleVi ?? item.title : item.titleEn ?? item.title}</span><span className={`block text-[12px] break-words ${T.mute}`}>{locale === 'vi' ? item.messageVi ?? item.message : item.messageEn ?? item.message}</span><span className={`block text-[11px] ${T.mute}`}>{taskDate(item.createdAt, locale)}</span></span>{Date.parse(item.createdAt) > seen && <span className="w-2 h-2 mt-1.5 rounded-full bg-neon-400" />}</button>)}
              {incoming.length === 0 && taskAlerts.length === 0 && !taskNotificationsError && <div className={`p-6 text-center text-[13px] ${T.mute}`}>{tr("You're all caught up.")}</div>}
              {incoming.map((a) => (
                <button key={a.id} onClick={() => { setTxDetail(a); onClose() }} className="w-full flex gap-3 p-2.5 rounded-xl hover:bg-white/[0.05] text-left">
                  <span className="w-8 h-8 rounded-full bg-live/10 text-live flex items-center justify-center shrink-0"><ArrowDownLeft size={15} /></span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px]">{tr('Received')} <b>{mask(`${fmtAmt(a.amount)} ${a.symbol}`)}</b></span>
                    <span className={`block text-[12px] ${T.mute}`}>{tr('from')} {a.counterpartyName ?? short(a.counterparty)} · {ago(a.timestamp, language)}</span>
                  </span>
                  {a.timestamp > seen && <span className="w-2 h-2 mt-1.5 rounded-full bg-neon-400" />}
                </button>
              ))}
            </div>
          </div>
      )}
    </div>
  )
}

const FLAG: Record<string, string> = { en: 'EN', vi: 'VI', zh: '中', ja: '日', ko: '한' }
function LangSwitcher({ open, onToggle, onClose }: { open: boolean; onToggle: () => void; onClose: () => void }) {
  const [tr, lang] = useT()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLUListElement>(null)
  useDismissibleOverlay(open, triggerRef, panelRef, onClose)
  return (
    <div className="relative">
      <button ref={triggerRef} onClick={onToggle} aria-haspopup="listbox" aria-expanded={open} aria-controls="mk-languages" aria-label={tr('Language')} title={tr('Language')}
        className="h-9 px-2 sm:px-2.5 inline-flex items-center gap-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-[12.5px] font-semibold hover:border-neon-500/40 hover:bg-white/[0.07] transition">
        <Globe size={15} className="text-neon-300" />
        <span className="font-num">{FLAG[lang]}</span>
        <ChevronDown size={13} className={`hidden sm:block ${T.mute} transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
          <ul ref={panelRef} id="mk-languages" role="listbox" className="absolute right-0 top-11 z-50 w-48 rounded-xl border border-white/10 bg-[#17171d] shadow-2xl p-1.5 mk-in">
            {LANGS.map((l) => (
              <li key={l.code}>
                <button role="option" aria-selected={lang === l.code} onClick={() => { setLang(l.code); onClose() }}
                  className={`w-full flex items-center gap-2.5 px-3 h-9 rounded-lg text-[13px] hover:bg-white/[0.06] ${lang === l.code ? 'text-white' : T.sub}`}>
                  <span className={`w-7 text-[11px] font-bold font-num ${lang === l.code ? 'text-neon-300' : T.mute}`}>{FLAG[l.code]}</span>
                  <span className="flex-1 text-left">{l.label}</span>
                  {lang === l.code && <Check size={14} className="text-neon-300" />}
                </button>
              </li>
            ))}
          </ul>
      )}
    </div>
  )
}

function ThemeToggle() {
  const [tr] = useT()
  const [theme, setTheme] = useTheme()
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <button onClick={() => setTheme(next)} aria-label={tr(next === 'light' ? 'Light mode' : 'Dark mode')} title={tr(next === 'light' ? 'Light mode' : 'Dark mode')}
      className="h-9 w-9 inline-flex items-center justify-center rounded-lg bg-white/[0.04] border border-white/[0.08] hover:border-neon-500/40 transition">
      {theme === 'dark' ? <Sun size={15} className="text-neon-300" /> : <Moon size={15} className="text-neon-300" />}
    </button>
  )
}

function Header({ onMenu, onConnect, menuOpen, menuTriggerRef }: { onMenu: () => void; onConnect: () => void; menuOpen: boolean; menuTriggerRef: React.RefObject<HTMLButtonElement | null> }) {
  const { page, mode, displayAddress, address, hidden, setHidden, notify, disconnect, go, watch } = useWallet()
  const [tr] = useT()
  const [q, setQ] = useState('')
  const [openMenu, setOpenMenu] = useState<HeaderMenu>(null)
  const ref = useRef<HTMLInputElement>(null)
  const walletTriggerRef = useRef<HTMLButtonElement>(null)
  const walletPanelRef = useRef<HTMLDivElement>(null)
  const closeMenu = useCallback(() => setOpenMenu(null), [])
  useDismissibleOverlay(openMenu === 'wallet', walletTriggerRef, walletPanelRef, closeMenu)
  useEffect(() => { closeMenu() }, [page, closeMenu])
  useEffect(() => { if (mode === 'demo') closeMenu() }, [mode, closeMenu])
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) { e.preventDefault(); ref.current?.focus() }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])
  const submit = () => {
    const v = q.trim()
    if (!v) return
    if (isAddress(v)) watch(v)
    else go(/tx|activity|history/i.test(v) ? 'activity' : 'assets')
    setQ('')
  }
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.05] bg-[#0b0b10]/85 backdrop-blur-xl">
      <div className="max-w-[1320px] mx-auto h-14 px-4 sm:px-6 lg:px-8 flex items-center gap-2">
        <button ref={menuTriggerRef} className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-white/10" onClick={() => { closeMenu(); onMenu() }} aria-label={tr('Open menu')} aria-expanded={menuOpen} aria-controls="mk-mobile-sidebar"><Menu size={20} /></button>
        <button onClick={() => go('home')} className="lg:hidden flex items-center" aria-label={`Makoto · ${tr('Home')}`}><LogoLockup size={26} sub={false} /></button>
        <form onSubmit={(e) => { e.preventDefault(); submit() }} className="mk-field-shell hidden md:flex items-center gap-2 h-9 w-[320px] px-3 rounded-lg bg-white/[0.03] border border-white/[0.06] transition">
          <Search size={15} className={T.mute} />
          <input ref={ref} value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Search assets or paste an address')} className="flex-1 min-w-0 bg-transparent outline-none text-[13px] placeholder:text-[#83838E]" />
          <kbd className={`text-[11px] px-1.5 rounded border border-white/10 ${T.mute}`}>/</kbd>
        </form>
        <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
          <button onClick={() => window.dispatchEvent(new Event('mk:palette'))} className={`hidden lg:inline-flex h-9 px-2.5 items-center gap-1.5 rounded-lg text-[12px] ${T.sub} hover:text-white hover:bg-white/[0.05]`} title={tr('Command menu')} aria-label={tr('Command menu')}><Command size={14} /> K</button>
          <button onClick={() => setHidden(!hidden)} className={`hidden sm:inline-flex h-9 w-9 items-center justify-center rounded-lg ${T.sub} hover:text-white hover:bg-white/[0.05]`} aria-label={tr('Toggle privacy')} title={tr(hidden ? 'Show balances' : 'Hide balances')}>{hidden ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          <span className="hidden sm:inline-flex"><ThemeToggle /></span>
          <LangSwitcher open={openMenu === 'language'} onToggle={() => setOpenMenu((current) => current === 'language' ? null : 'language')} onClose={closeMenu} />
          <Notifications open={openMenu === 'notifications'} onToggle={() => setOpenMenu((current) => current === 'notifications' ? null : 'notifications')} onClose={closeMenu} />
          <div className="w-px h-5 bg-white/10 mx-1 hidden sm:block" />
          {mode === 'demo' ? (
            <Button variant="primary" size="sm" className="h-9 px-3.5 text-[13px] rounded-lg" onClick={onConnect}><Wallet size={15} /> <span className="hidden sm:inline">{tr('Connect wallet')}</span><span className="sm:hidden">{tr('Connect')}</span></Button>
          ) : (
            <div className="relative">
              <button ref={walletTriggerRef} onClick={() => setOpenMenu((current) => current === 'wallet' ? null : 'wallet')} aria-label={tr('Account menu')} aria-expanded={openMenu === 'wallet'} aria-controls="mk-wallet-menu" className="inline-flex items-center gap-2 h-9 pl-1 pr-2.5 rounded-lg bg-white/[0.04] border border-white/[0.07] hover:border-white/[0.14] transition">
                <Avatar size={26} seed={address} />
                <span className="text-left leading-tight hidden sm:block">
                  <span className="block text-[12px] font-semibold font-mono">{short(displayAddress)}</span>
                  <span className={`block text-[10.5px] ${T.mute}`}>{tr(mode === 'connected' ? 'Wallet connected' : 'Watch-only · read only')}</span>
                </span>
              </button>
              {openMenu === 'wallet' && (
                  <div ref={walletPanelRef} id="mk-wallet-menu" className="absolute right-0 top-11 z-50 w-56 rounded-xl border border-white/10 bg-[#17171d] shadow-2xl p-1.5 mk-in text-[13px]">
                    <button onClick={() => { copyText(address, notify, 'Address copied'); closeMenu() }} className="w-full flex items-center gap-2 px-3 h-9 rounded-lg hover:bg-white/[0.06]"><Copy size={14} /> {tr('Copy address')}</button>
                    <a href={`${ARC.explorer}/address/${address}`} target="_blank" rel="noreferrer" onClick={closeMenu} className="w-full flex items-center gap-2 px-3 h-9 rounded-lg hover:bg-white/[0.06]"><ArrowUpRight size={14} /> {tr('View on ArcScan')}</a>
                    <button onClick={() => { go('settings'); closeMenu() }} className="w-full flex items-center gap-2 px-3 h-9 rounded-lg hover:bg-white/[0.06]"><Settings size={14} /> {tr('Settings')}</button>
                    <button onClick={() => { disconnect(); closeMenu() }} className="w-full flex items-center gap-2 px-3 h-9 rounded-lg hover:bg-rose-500/10 text-rose-300"><LogOut size={14} /> {tr('Disconnect')}</button>
                  </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

function MobileTabBar() {
  const { page, go, setReceiveOpen, hidden, setHidden } = useWallet()
  const [tr] = useT()
  const [theme, setTheme] = useTheme()
  const [sheet, setSheet] = useState(false)
  const sheetTriggerRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { setSheet(false) }, [page])
  useEffect(() => {
    if (!sheet) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { setSheet(false); sheetTriggerRef.current?.focus() } }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [sheet])
  const walletPages: Page[] = ['dashboard', 'assets']
  const Tab = ({ id, icon: Icon, label, match }: { id: Page; icon: any; label: string; match?: Page[] }) => {
    const active = page === id || !!match?.includes(page)
    return (
      <button onClick={() => go(id)} className={`flex flex-col items-center justify-center gap-1 text-[10.5px] font-medium ${active ? 'text-white' : T.mute}`}>
        <Icon size={19} className={active ? 'text-neon-300' : ''} />{tr(label)}
      </button>
    )
  }
  const more: { icon: any; label: string; on: () => void }[] = [
    { icon: ArrowUpRight, label: 'Send', on: () => go('send') },
    { icon: ArrowDownLeft, label: 'Receive', on: () => setReceiveOpen(true) },
    { icon: ArrowLeftRight, label: 'Swap', on: () => go('swap') },
    { icon: Rainbow, label: 'Bridge', on: () => go('bridge') },
    { icon: ListChecks, label: 'Tasks', on: () => go('tasks') },
    { icon: Droplets, label: 'Faucet', on: () => go('faucet') },
    { icon: Settings, label: 'Settings', on: () => go('settings') },
    { icon: theme === 'dark' ? Sun : Moon, label: theme === 'dark' ? 'Light mode' : 'Dark mode', on: () => setTheme(theme === 'dark' ? 'light' : 'dark') },
    { icon: hidden ? Eye : EyeOff, label: hidden ? 'Show balances' : 'Hide balances', on: () => setHidden(!hidden) },
    { icon: Info, label: 'About', on: () => go('about') },
  ]
  return (
    <>
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-white/[0.06] bg-[#131317]/95 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-5 h-[60px]">
          <Tab id="home" icon={Home} label="Home" />
          <Tab id="agent" icon={Sparkles} label="Agent" />
          <button ref={sheetTriggerRef} onClick={() => setSheet(true)} className="flex items-center justify-center" aria-label={tr('More actions')} aria-expanded={sheet} aria-controls="mk-mobile-actions">
            <span className="mk-primary w-11 h-11 rounded-2xl bg-neon-500 text-[#0b0b10] flex items-center justify-center active:scale-95 transition"><Plus size={20} /></span>
          </button>
          <Tab id="dashboard" icon={Wallet} label="Wallet" match={walletPages} />
          <Tab id="activity" icon={History} label="Activity" />
        </div>
      </nav>
      {sheet && (
        <div className="lg:hidden fixed inset-0 z-[55] flex items-end">
          <button className="absolute inset-0 bg-black/60" onClick={() => setSheet(false)} aria-label={tr('Close')} />
          <div id="mk-mobile-actions" className="relative w-full rounded-t-[22px] border-t border-white/10 bg-[#17171d] p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] mk-in">
            <div className="mx-auto w-10 h-1 rounded-full bg-white/15 mb-4" />
            <div className="grid grid-cols-3 gap-2">
              {more.map(({ icon: Icon, label, on }) => (
                <button key={label} onClick={() => { on(); setSheet(false) }} className="flex flex-col items-center gap-2 py-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] active:scale-[0.97] transition">
                  <Icon size={19} className="text-neon-300" /><span className="text-[12.5px] font-medium">{tr(label)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-72" />
      <div className="grid sm:grid-cols-2 gap-4 pt-2"><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div>
    </div>
  )
}

const TITLES: Partial<Record<Page, string>> = { agent: 'Agent', tasks: 'Tasks', dashboard: 'Portfolio', assets: 'Assets', activity: 'Activity', send: 'Send', swap: 'Swap', bridge: 'Bridge', settings: 'Settings', insights: 'Insights', faucet: 'Faucet', about: 'About', legal: 'Terms & Privacy', changelog: "What's new", status: 'System status', audit: 'UX audit' }

/** Privacy screen preview only — App Lock is not implemented and is not a security feature. */
function LockScreen({ onClose }: { onClose: () => void }) {
  const [tr] = useT()
  return (
    <div className="fixed inset-0 z-[80] bg-[#0b0b10] flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-labelledby="mk-lock-title">
      <div className="w-full max-w-[340px] text-center mk-in">
        <div className="mx-auto w-fit"><Logo size={52} /></div>
        <div className="mt-5"><Badge>{tr('Privacy screen preview')}</Badge></div>
        <h1 id="mk-lock-title" className="mt-3 text-[20px] font-bold">{tr('Balances hidden')}</h1>
        <p className={`mt-1.5 text-[13px] ${T.sub}`}>{tr('This is a design preview of a future privacy screen. App Lock is coming soon and is not a security feature. Transactions are authorized by your wallet.')}</p>
        <Button variant="primary" size="lg" className="mt-6 w-full" onClick={onClose}><EyeOffIcon size={16} /> {tr('Close preview')}</Button>
      </div>
    </div>
  )
}

function Shell() {
  const [tr] = useT()
  const w = useWallet()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const [connectOpen, setConnectOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const openConnect = useCallback(() => setConnectOpen(true), [])
  useEffect(() => { setMenuOpen(false) }, [w.page])
  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenuOpen(false); menuTriggerRef.current?.focus() } }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [menuOpen])
  useEffect(() => {
    const name = TITLES[w.page]
    document.title = name ? `${tr(name)} · Makoto Wallet` : `Makoto Wallet — ${tr('The wallet you can just ask')}`
    window.scrollTo({ top: 0 })
  }, [w.page, tr])
  const pages: Record<Page, React.ReactNode> = {
    home: <HomePage />, agent: <AgentPage />, tasks: <TasksPage />, dashboard: <Dashboard />, assets: <AssetsPage />, activity: <ActivityPage />,
    send: <SendPage />, swap: <SwapPage />, bridge: <BridgePage />, settings: <SettingsPage />, insights: <InsightsPage />, audit: <AuditPage />, faucet: <FaucetPage />,
    about: <AboutPage />, legal: <LegalPage />, changelog: <ChangelogPage />, status: <StatusPage />,
  }

  return (
    <div data-vivid={w.settings.vivid !== false ? 'on' : undefined} className={`mk-shell min-h-screen ${T.text} flex antialiased`} style={{ fontFamily: 'Montserrat, system-ui, sans-serif', background: '#0b0b10' }}>
      <style>{`
        .mk-bg{background:radial-gradient(900px 420px at 70% -160px, rgba(168,85,247,.10), transparent 70%)}
        .mk-grid{background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px);background-size:36px 36px;mask-image:radial-gradient(ellipse at 50% 0%,black 30%,transparent 75%)}
        @keyframes mk-breathe{0%,100%{opacity:.4;transform:scale(1)}50%{opacity:.7;transform:scale(1.05)}}
        .mk-breathe{animation:mk-breathe 4s ease-in-out infinite}
        @keyframes mk-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
        .mk-blink{animation:mk-blink 5s infinite}
        @keyframes mk-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
        .mk-in{animation:mk-in .35s cubic-bezier(.2,.7,.2,1) both}
        @keyframes mk-dot{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-2px)}}
        .mk-dot{animation:mk-dot 1.1s ease-in-out infinite}
        .font-num{font-feature-settings:'tnum'}
        @media (prefers-reduced-motion: reduce){.mk-in,.mk-breathe,.mk-blink,.mk-dot{animation:none}}
      `}</style>

      <button className="mk-skip" onClick={() => document.getElementById('mk-main')?.focus()}>{tr('Skip to content')}</button>
      {w.lockPreview && <LockScreen onClose={() => w.setLockPreview(false)} />}

      <aside className="hidden lg:block w-[232px] shrink-0 border-r border-white/[0.05] bg-[#131317] sticky top-0 h-screen"><Sidebar onFeedback={() => setFeedbackOpen(true)} /></aside>
      {menuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div id="mk-mobile-sidebar" className="w-[260px] bg-[#131317] border-r border-white/[0.06] mk-in relative">
            <button onClick={() => setMenuOpen(false)} className="absolute right-3 top-5 p-2 rounded-lg hover:bg-white/10 z-10" aria-label={tr('Close menu')}><X size={18} /></button>
            <Sidebar onNavigate={() => setMenuOpen(false)} onFeedback={() => setFeedbackOpen(true)} />
          </div>
          <button className="flex-1 bg-black/60" onClick={() => setMenuOpen(false)} aria-label={tr('Close menu')} />
        </div>
      )}

      <div className="flex-1 min-w-0 mk-bg overflow-x-hidden">
        <Header onMenu={() => setMenuOpen(true)} onConnect={() => setConnectOpen(true)} menuOpen={menuOpen} menuTriggerRef={menuTriggerRef} />
        {w.walletError && (
          <div className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 pt-4">
            <div className={`p-3 rounded-xl border border-white/[0.07] bg-white/[0.02] text-[13px] ${T.sub} flex items-center gap-2`}><AlertTriangle size={15} className="text-amber-300" /> {tr("Couldn't load wallet data.")} <button onClick={w.refetchWallet} className="font-semibold text-neon-300">{tr('Retry')}</button></div>
          </div>
        )}
        <main id="mk-main" tabIndex={-1} key={w.page} className="outline-none max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-7 pb-28 lg:pb-10">
          <Suspense fallback={<PageSkeleton />}>{pages[w.page]}</Suspense>
          <footer className={`mt-12 pt-6 border-t border-white/[0.05] text-[12px] ${T.mute}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2"><Logo size={16} /> Makoto · {ARC.name}</span>
              <span className="flex items-center gap-1">
                {COMMUNITY.map(({ icon: I, label, href }) => (
                  <a key={label} href={href} target="_blank" rel="noreferrer" aria-label={tr(label)} title={tr(label)} className="h-8 w-8 inline-flex items-center justify-center rounded-lg hover:bg-white/[0.05] hover:text-white"><I size={15} /></a>
                ))}
              </span>
            </div>
            <nav className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
              <button onClick={() => w.go('about')} className="hover:text-white">{tr('About')}</button>
              <button onClick={() => w.go('changelog')} className="hover:text-white">{tr("What's new")}</button>
              <button onClick={() => w.go('status')} className="hover:text-white inline-flex items-center gap-1.5"><LiveDot off={w.networkError} /> {tr('System status')}</button>
              <button onClick={() => w.go('legal')} className="hover:text-white">{tr('Terms & Privacy')}</button>
              <button onClick={() => w.go('insights')} className="hover:text-white">{tr('Insights')}</button>
              <a href={ARC.explorer} target="_blank" rel="noreferrer" className="hover:text-white">{tr('Explorer')}</a>
            </nav>
          </footer>
        </main>
      </div>

      <MobileTabBar />
      <ConnectModal open={connectOpen} onClose={() => setConnectOpen(false)} />
      <CommandPalette onConnect={openConnect} />
      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
      <ReceiveModal />
      <TxDetailModal />

      {w.toast && (
        <div className="fixed bottom-24 lg:bottom-6 left-1/2 -translate-x-1/2 z-[90] mk-in max-w-[calc(100vw-2rem)]">
          <div className="flex items-center gap-2 px-4 h-10 rounded-xl bg-[#1c1c23] border border-white/10 shadow-2xl text-[13px] font-medium">
            {w.toast.kind === 'ok' ? <Check size={15} className="text-live shrink-0" /> : <AlertTriangle size={15} className="text-rose-300 shrink-0" />} <span className="truncate">{tr(w.toast.msg)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default function App() {
  useEffect(() => {
    const root = document.documentElement
    const pointer = () => { root.dataset.inputMethod = 'pointer' }
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Tab' || !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement)) {
        root.dataset.inputMethod = 'keyboard'
      }
    }
    document.addEventListener('pointerdown', pointer, true)
    document.addEventListener('keydown', keyboard, true)
    return () => {
      document.removeEventListener('pointerdown', pointer, true)
      document.removeEventListener('keydown', keyboard, true)
    }
  }, [])
  return (
    <WalletProvider>
      <Shell />
    </WalletProvider>
  )
}
