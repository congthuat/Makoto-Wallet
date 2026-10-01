import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Search, Home, Sparkles, ListChecks, PieChart, Coins, History, ArrowUpRight, ArrowDownLeft, ArrowLeftRight, Rainbow, Droplets, Settings,
  Info, FileText, Rocket, Activity, Sun, Moon, Globe, Wallet, CornerDownLeft,
} from 'lucide-react'
import { useWallet, type Page } from '../lib/store'
import { useT, LANGS, setLang } from '../lib/i18n'
import { useTheme } from '../lib/theme'
import { T } from './wallet/ui'

type Cmd = { id: string; icon: any; label: string; group: string; run: () => void; hint?: string }

export default function CommandPalette({ onConnect }: { onConnect: () => void }) {
  const { go, setReceiveOpen, mode } = useWallet()
  const [tr, lang] = useT()
  const [theme, setTheme] = useTheme()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o) }
      else if (e.key === 'Escape') setOpen(false)
    }
    const o = () => setOpen(true)
    window.addEventListener('keydown', k)
    window.addEventListener('mk:palette', o)
    return () => { window.removeEventListener('keydown', k); window.removeEventListener('mk:palette', o) }
  }, [])
  useEffect(() => { if (open) { setQ(''); setIdx(0); setTimeout(() => inputRef.current?.focus(), 10) } }, [open])

  const cmds = useMemo<Cmd[]>(() => {
    const p = (id: Page, icon: any, label: string): Cmd => ({ id, icon, label, group: 'Go to', run: () => go(id) })
    return [
      p('home', Home, 'Home'), p('agent', Sparkles, 'Agent'), p('tasks', ListChecks, 'Tasks'), p('dashboard', PieChart, 'Portfolio'),
      p('assets', Coins, 'Assets'), p('activity', History, 'Activity'), p('send', ArrowUpRight, 'Send'), p('swap', ArrowLeftRight, 'Swap'),
      p('bridge', Rainbow, 'Bridge'), p('faucet', Droplets, 'Faucet'), p('settings', Settings, 'Settings'), p('about', Info, 'About'),
      p('changelog', Rocket, "What's new"), p('status', Activity, 'System status'), p('legal', FileText, 'Terms & Privacy'),
      ...(mode === 'demo' ? [{ id: 'connect', icon: Wallet, label: 'Connect wallet', group: 'Actions', run: onConnect }] : []),
      { id: 'receive', icon: ArrowDownLeft, label: 'Receive', group: 'Actions', run: () => setReceiveOpen(true) },
      { id: 'theme', icon: theme === 'dark' ? Sun : Moon, label: theme === 'dark' ? 'Light mode' : 'Dark mode', group: 'Actions', run: () => setTheme(theme === 'dark' ? 'light' : 'dark') },
      ...LANGS.filter((l) => l.code !== lang).map((l) => ({ id: `lang-${l.code}`, icon: Globe, label: l.label, hint: tr('Language'), group: 'Language', run: () => setLang(l.code) })),
    ]
  }, [go, mode, onConnect, setReceiveOpen, theme, setTheme, lang, tr])

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return cmds
    return cmds.filter((c) => `${c.label} ${tr(c.label)} ${c.group}`.toLowerCase().includes(s))
  }, [q, cmds, tr])

  if (!open) return null
  const run = (c?: Cmd) => { if (!c) return; setOpen(false); c.run() }
  let lastGroup = ''

  return (
    <div className="fixed inset-0 z-[85] flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label={tr('Command menu')}>
      <button className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} aria-label="Close" />
      <div className="relative w-full max-w-[520px] rounded-2xl border border-white/10 bg-[#17171d] shadow-2xl mk-in overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 h-12 border-b border-white/[0.06]">
          <Search size={16} className={T.mute} />
          <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setIdx(0) }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, list.length - 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)) }
              if (e.key === 'Enter') run(list[idx])
            }}
            placeholder={tr('Type a command or search…')} className="flex-1 bg-transparent outline-none text-[14px] placeholder:text-[#83838E]" />
          <kbd className={`text-[11px] px-1.5 rounded border border-white/10 ${T.mute}`}>Esc</kbd>
        </div>
        <div className="max-h-[360px] overflow-y-auto p-1.5">
          {list.length === 0 && <div className={`p-6 text-center text-[13px] ${T.mute}`}>{tr('No results')}</div>}
          {list.map((c, i) => {
            const head = c.group !== lastGroup ? (lastGroup = c.group) : null
            const Icon = c.icon
            return (
              <div key={c.id}>
                {head && <div className={`px-3 pt-2.5 pb-1 text-[10.5px] font-semibold tracking-[0.12em] uppercase ${T.mute}`}>{tr(head)}</div>}
                <button onMouseEnter={() => setIdx(i)} onClick={() => run(c)}
                  className={`w-full flex items-center gap-3 px-3 h-10 rounded-lg text-[13.5px] text-left ${i === idx ? 'bg-white/[0.07] text-white' : T.sub}`}>
                  <Icon size={16} className={i === idx ? 'text-neon-300' : 'opacity-70'} />
                  <span className="flex-1">{c.group === 'Language' ? c.label : tr(c.label)}</span>
                  {c.hint && <span className={`text-[11px] ${T.mute}`}>{c.hint}</span>}
                  {i === idx && <CornerDownLeft size={13} className={T.mute} />}
                </button>
              </div>
            )
          })}
        </div>
        <div className={`flex items-center gap-3 px-4 h-9 border-t border-white/[0.06] text-[11px] ${T.mute}`}>
          <span>↑↓ {tr('to navigate')}</span><span>↵ {tr('to open')}</span><span className="ml-auto">Ctrl / ⌘ K</span>
        </div>
      </div>
    </div>
  )
}
