import { useEffect, useId } from 'react'
import { FlaskConical, X } from 'lucide-react'
import { useT } from '../../lib/i18n'

export const T = { text: 'text-[#F5F5F5]', sub: 'text-[#A3A3AD]', mute: 'text-[#83838E]' }

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`mk-card rounded-xl border border-white/[0.08] bg-[#121219] ${className}`}>
      {children}
    </section>
  )
}

export function CardHeader({ title, sub, right }: { title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode }) {
  const [t] = useT()
  title = t(title); sub = t(sub)
  return (
    <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
        {sub && <p className={`text-[13px] mt-0.5 ${T.mute}`}>{sub}</p>}
      </div>
      {right}
    </div>
  )
}

export function PageHeader({ eyebrow, title, desc, right }: { eyebrow?: string; title: string; desc?: string; right?: React.ReactNode }) {
  const [t] = useT()
  eyebrow = t(eyebrow); title = t(title); desc = t(desc)
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3 mk-in">
      <div>
        {eyebrow && <p className={`text-[13px] ${T.mute}`}>{eyebrow}</p>}
        <h1 className="mk-title text-[26px] font-bold tracking-[-0.02em] mt-0.5">{title}</h1>
        {desc && <p className={`text-[14px] mt-1 max-w-[640px] ${T.sub}`}>{desc}</p>}
      </div>
      {right}
    </div>
  )
}

export function Change({ v, className = '' }: { v?: number; className?: string }) {
  if (v == null) return <span className={T.mute}>—</span>
  const up = v >= 0
  return (
    <span className={`inline-flex items-center gap-0.5 tabular-nums font-medium ${up ? 'text-live' : 'text-rose-400'} ${className}`}>
      {up ? '▲' : '▼'} {Math.abs(v).toFixed(2)}%
    </span>
  )
}

export function TokenIcon({ color, glyph, size = 36 }: { color: string; glyph: string; size?: number }) {
  return (
    <span
      className="rounded-full flex items-center justify-center font-bold text-[#fff] shrink-0 ring-1 ring-white/15"
      style={{ width: size, height: size, fontSize: size * 0.45, background: `radial-gradient(circle at 30% 25%, ${color}, ${color}cc 60%, ${color}88)` }}
    >
      {glyph}
    </span>
  )
}

// Deterministic gradient avatar from an address
export function Avatar({ size = 24, seed = 'makoto' }: { size?: number; seed?: string }) {
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) % 360
  return (
    <span
      className="rounded-full shrink-0 ring-2 ring-white/10 inline-block"
      style={{ width: size, height: size, background: `conic-gradient(from ${h}deg, hsl(${h} 80% 60%), hsl(${(h + 90) % 360} 80% 55%), hsl(${(h + 200) % 360} 80% 60%), hsl(${h} 80% 60%))` }}
    />
  )
}

/** Makoto Agent mascot — glossy purple helmet, dark visor, glowing lime eyes (brand colours). */
export function Orb({ size = 56, glow = true }: { size?: number; glow?: boolean }) {
  const id = useId().replace(/:/g, '')
  return (
    <div className="relative shrink-0" style={{ width: size, height: size * 0.84 }}>
      {glow && <div className="absolute -inset-[18%] rounded-full bg-[#7e47ff]/35 blur-xl mk-breathe" aria-hidden />}
      <svg viewBox="0 0 120 100" width={size} height={size * 0.84} className="relative" role="img" aria-label="Makoto Agent">
        <defs>
          <linearGradient id={`sh-${id}`} x1="20" y1="6" x2="100" y2="96" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#a78bfa" />
            <stop offset=".45" stopColor="#7e47ff" />
            <stop offset="1" stopColor="#2e1a78" />
          </linearGradient>
          <linearGradient id={`ear-${id}`} x1="0" y1="30" x2="0" y2="70" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#8b6cff" />
            <stop offset="1" stopColor="#3b1c9c" />
          </linearGradient>
          <radialGradient id={`vi-${id}`} cx="60" cy="40" r="46" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#1c1530" />
            <stop offset="1" stopColor="#06050b" />
          </radialGradient>
          <filter id={`gl-${id}`} x="-100%" y="-50%" width="300%" height="200%">
            <feGaussianBlur stdDeviation="3.2" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {/* ear pods */}
        <rect x="3" y="33" width="17" height="34" rx="7" fill={`url(#ear-${id})`} />
        <rect x="100" y="33" width="17" height="34" rx="7" fill={`url(#ear-${id})`} />
        <rect x="5.5" y="39" width="3.2" height="22" rx="1.6" fill="#8efe7e" filter={`url(#gl-${id})`} />
        <rect x="111.3" y="39" width="3.2" height="22" rx="1.6" fill="#8efe7e" filter={`url(#gl-${id})`} />
        {/* helmet */}
        <rect x="14" y="6" width="92" height="88" rx="38" fill={`url(#sh-${id})`} />
        <path d="M30 16 Q60 4 90 16" stroke="#fff" strokeOpacity=".45" strokeWidth="3" strokeLinecap="round" fill="none" />
        {/* visor */}
        <rect x="23" y="17" width="74" height="64" rx="27" fill={`url(#vi-${id})`} stroke="#c4b5fd" strokeOpacity=".35" strokeWidth="1.5" />
        <path d="M34 24 Q46 20 58 21" stroke="#fff" strokeOpacity=".18" strokeWidth="3" strokeLinecap="round" fill="none" />
        {/* eyes */}
        <g filter={`url(#gl-${id})`} className="mk-blink" style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
          <rect x="43" y="34" width="9.5" height="27" rx="4.75" fill="#8efe7e" />
          <rect x="67.5" y="34" width="9.5" height="27" rx="4.75" fill="#8efe7e" />
        </g>
        <rect x="45" y="37" width="3" height="9" rx="1.5" fill="#fff" opacity=".7" />
        <rect x="69.5" y="37" width="3" height="9" rx="1.5" fill="#fff" opacity=".7" />
      </svg>
    </div>
  )
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: () => void; label?: string }) {
  return (
    <button
      role="switch" aria-checked={on} aria-label={label} onClick={onChange}
      className={`relative w-10 h-6 shrink-0 rounded-full transition-colors ${on ? 'bg-neon-500' : 'bg-white/15'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : ''}`} />
    </button>
  )
}

export function Segmented<V extends string>({ value, options, onChange, size = 'md', label }: { value: V; options: readonly V[]; onChange: (v: V) => void; size?: 'sm' | 'md'; label?: (v: V) => string }) {
  const [t] = useT()
  return (
    <div className="inline-flex p-1 rounded-xl bg-white/[0.04] border border-white/[0.06]">
      {options.map((o) => (
        <button
          key={o} onClick={() => onChange(o)}
          className={`px-3 ${size === 'sm' ? 'h-7' : 'h-8'} rounded-lg text-[12px] font-semibold transition whitespace-nowrap ${value === o ? 'bg-white/10 text-white shadow' : `${T.mute} hover:text-white`}`}
        >
          {label ? label(o) : t(o)}
        </button>
      ))}
    </div>
  )
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg' }
export function Button({ variant = 'secondary', size = 'md', className = '', ...p }: BtnProps) {
  const v = {
    primary: 'mk-primary bg-neon-500 text-[#0b0b10] hover:bg-neon-400 disabled:bg-white/[0.08] disabled:text-white/40 disabled:shadow-none',
    secondary: 'bg-white/[0.05] border border-white/[0.08] hover:bg-white/[0.09] disabled:opacity-40',
    ghost: `${T.sub} hover:text-white hover:bg-white/[0.06]`,
    danger: 'bg-rose-500/10 text-rose-300 border border-rose-400/30 hover:bg-rose-500/20',
  }[variant]
  const s = { sm: 'h-8 px-3 text-[12px] rounded-lg', md: 'h-10 px-4 text-[13px] rounded-xl', lg: 'h-12 px-5 text-[15px] rounded-2xl' }[size]
  return (
    <button
      {...p}
      className={`inline-flex items-center justify-center gap-2 font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 ${v} ${s} ${className}`}
    />
  )
}

export function Modal({ open, onClose, title, children, width = 440 }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; width?: number }) {
  const [tr] = useT()
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-label={tr('Close')} />
      <div role="dialog" aria-modal className="relative w-full mk-in rounded-t-[24px] sm:rounded-[24px] border border-white/10 bg-[#18181e] shadow-2xl max-h-[92vh] overflow-y-auto" style={{ maxWidth: width }}>
        <div className="flex items-center justify-between px-5 pt-5 pb-2">
          <h3 className="text-[16px] font-semibold">{title}</h3>
          <button onClick={onClose} className={`p-1.5 rounded-lg ${T.mute} hover:text-white hover:bg-white/10`} aria-label={tr('Close')}><X size={18} /></button>
        </div>
        <div className="px-5 pb-5">{children}</div>
      </div>
    </div>
  )
}

export function EmptyState({ icon: Icon, title, desc, action }: { icon: any; title: string; desc?: string; action?: React.ReactNode }) {
  const [t] = useT()
  title = t(title); if (desc) desc = t(desc)
  return (
    <div className="px-4 py-12 text-center">
      <div className="mx-auto w-12 h-12 rounded-2xl bg-white/[0.05] flex items-center justify-center mb-3"><Icon size={20} className={T.mute} /></div>
      <div className="text-[14px] font-semibold">{title}</div>
      {desc && <div className={`text-[13px] mt-1 max-w-[320px] mx-auto ${T.mute}`}>{desc}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <span className={`inline-block rounded-md bg-white/[0.06] animate-pulse ${className}`} />
}

export function Field({ label, hint, error, children, right }: { label: string; hint?: React.ReactNode; error?: string | null; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className={`text-[13px] font-medium ${T.sub}`}>{label}</label>
        {right}
      </div>
      {children}
      {error ? <p className="mt-1.5 text-[12px] text-rose-400">{error}</p> : hint ? <p className={`mt-1.5 text-[12px] ${T.mute}`}>{hint}</p> : null}
    </div>
  )
}

export const inputCls =
  'w-full h-12 px-4 rounded-2xl bg-black/30 border border-white/[0.1] text-[15px] placeholder:text-[#83838E] transition'

export function Badge({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'ok' | 'warn' | 'err' | 'ai' | 'live' }) {
  const [t] = useT()
  children = t(children)
  const c = {
    default: 'bg-white/[0.06] text-[#A3A3AD]',
    ok: 'bg-live/10 text-live',
    warn: 'bg-amber-500/12 text-amber-300',
    err: 'bg-rose-500/12 text-rose-300',
    ai: 'bg-neon-500/15 text-neon-200',
    live: 'bg-live/10 text-live',
  }[tone]
  return <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${c}`}>{children}</span>
}

export type TxStatus = 'completed' | 'submitted' | 'pending' | 'failed' | 'unknown' | 'user_rejected'
export function StatusChip({ status }: { status: TxStatus }) {
  const [tr] = useT()
  const m = {
    completed: ['Confirmed', 'bg-live/10 text-live', 'bg-live'],
    submitted: ['Submitted', 'bg-sky-400/10 text-sky-200', 'bg-sky-300'],
    pending: ['Pending', 'bg-amber-400/10 text-amber-200', 'bg-amber-300 animate-pulse'],
    failed: ['Failed', 'bg-rose-500/10 text-rose-300', 'bg-rose-400'],
    unknown: ['Status unknown', 'bg-slate-400/10 text-slate-200', 'bg-slate-300'],
    user_rejected: ['Wallet request cancelled', 'bg-slate-400/10 text-slate-200', 'bg-slate-300'],
  }[status]
  return <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${m[1]}`}><span className={`w-1.5 h-1.5 rounded-full ${m[2]}`} />{tr(m[0])}</span>
}

export function LiveDot({ off = false }: { off?: boolean }) {
  return (
    <span className="relative flex w-2 h-2 shrink-0">
      {!off && <span className="absolute inline-flex w-full h-full rounded-full bg-live opacity-50 animate-ping" />}
      <span className={`relative inline-flex w-2 h-2 rounded-full ${off ? 'bg-rose-400' : 'bg-live'}`} />
    </span>
  )
}

export function Thinking({ label = 'Makoto is thinking…' }: { label?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 text-[13px] ${T.sub}`}>
      <span className="flex gap-1">{[0, 1, 2].map((i) => <span key={i} className="w-1.5 h-1.5 rounded-full bg-neon-300 mk-dot" style={{ animationDelay: `${i * 0.15}s` }} />)}</span>
      {label}
    </span>
  )
}

/**
 * Makoto mark — a monoline "M" whose centre valley holds the agent node.
 * The M reads as two peaks (your assets, your wallet) joined by the agent in the middle,
 * which only acts after you confirm. Tile: lime → cyan → violet, the product palette.
 */
/** Makoto "M" mark — torii-inspired crossbar with a V and two chiselled legs (source coords 1254px art). */
export const MK_TOP = 'M260 310Q330 338 380 336L465 336L625 498L790 336L870 336Q940 336 992 310Q965 370 932 398L860 398Q845 400 830 412L617 610L405 398L320 398Q285 365 260 310Z'
export const MK_LEFT = 'M388 410L470 492L470 722L388 790Z'
export const MK_RIGHT = 'M866 410L785 490L785 722L866 790Z'

export function LogoMark({ size = 32, mono = false }: { size?: number; mono?: boolean }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" role="img" aria-label="Makoto" className="shrink-0">
      <defs>
        <linearGradient id={`mk-g-${id}`} x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#B8FF9F" />
          <stop offset=".45" stopColor="#8EFE7E" />
          <stop offset="1" stopColor="#7E47FF" />
        </linearGradient>
        <radialGradient id={`mk-h-${id}`} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(14 8) rotate(50) scale(34)">
          <stop offset="0" stopColor="#fff" stopOpacity=".45" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="13" fill={mono ? '#0b0b10' : `url(#mk-g-${id})`} />
      {!mono && <rect x="2" y="2" width="44" height="44" rx="13" fill={`url(#mk-h-${id})`} />}
      <rect x="2.5" y="2.5" width="43" height="43" rx="12.5" stroke={mono ? '#8EFE7E' : '#fff'} strokeOpacity={mono ? 0.6 : 0.25} />
      <g transform="translate(9 14.1) scale(0.0411) translate(-260 -308)" fill={mono ? '#8EFE7E' : '#0B0B10'}>
        <path d={MK_TOP} />
        <path d={MK_LEFT} />
        <path d={MK_RIGHT} />
      </g>
    </svg>
  )
}

export function Logo({ size = 32 }: { size?: number }) {
  return <LogoMark size={size} />
}

/** Full lockup: mark + "makoto" wordmark (Syne) + optional descriptor. */
export function LogoLockup({ size = 30, sub = true }: { size?: number; sub?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={size} />
      <span className="leading-none text-left">
        <span className="block font-semibold tracking-[0.22em] text-[#F5F5F5]" style={{ fontFamily: 'Montserrat, sans-serif', fontSize: size * 0.52 }}>MAKOTO</span>
        {sub && <span className="block mt-1 text-[9px] font-semibold tracking-[0.28em] text-[#8EFE7E]/80">AGENT WALLET</span>}
      </span>
    </span>
  )
}

export function ErrorNote({ msg, onRetry }: { msg: string; onRetry?: () => void }) {
  return (
    <div className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-white/[0.06] bg-white/[0.02] text-[13px] ${T.sub}`}>
      <span>{msg}</span>
      {onRetry && <button onClick={onRetry} className="font-semibold text-neon-300 hover:text-neon-200">Retry</button>}
    </div>
  )
}

/** Small, non-intrusive label marking simulated UI. */
export function PreviewTag({ children = 'Prototype interaction' }: { children?: React.ReactNode }) {
  const [t] = useT()
  children = t(children)
  return <span className={`inline-flex items-center gap-1 text-[10.5px] font-medium ${T.mute}`}><FlaskConical size={11} /> {children}</span>
}
