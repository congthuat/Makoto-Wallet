import { useState, type CSSProperties } from 'react'

const COLORS = ['#D4FF3A', '#4ade80', '#a78bfa', '#38bdf8', '#fbbf24', '#f472b6']

const makePieces = (count: number, size: number) => Array.from({ length: count }, (_, i) => {
  const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4
  const dist = size * (1.1 + Math.random() * 1.1)
  return {
    color: COLORS[i % COLORS.length],
    dx: `${Math.cos(angle) * dist}px`,
    dy: `${Math.sin(angle) * dist + size * 0.6}px`,
    rot: `${Math.round(Math.random() * 720 - 360)}deg`,
    dur: `${(0.9 + Math.random() * 0.7).toFixed(2)}s`,
    delay: `${(0.15 + Math.random() * 0.15).toFixed(2)}s`,
    round: i % 3 === 0,
  }
})

/**
 * Celebration for a network-confirmed success: a check that draws itself,
 * a ring that spreads out and a short burst of confetti. Purely visual.
 */
export function SuccessBurst({ size = 64, confetti = true, label }: { size?: number; confetti?: boolean; label?: string }) {
  const [pieces] = useState(() => makePieces(confetti ? 26 : 0, size))
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }} role="img" aria-label={label ?? 'Success'}>
      <span className="mk-ring" aria-hidden />
      {pieces.map((p, i) => (
        <span key={i} aria-hidden className="mk-confetti" style={{ background: p.color, borderRadius: p.round ? 9999 : 2, '--dx': p.dx, '--dy': p.dy, '--rot': p.rot, '--dur': p.dur, animationDelay: p.delay } as CSSProperties} />
      ))}
      <span className="mk-pop absolute inset-0 rounded-full flex items-center justify-center bg-emerald-400/15 border border-emerald-400/40 shadow-[0_0_32px_-6px_rgba(74,222,128,.55)]">
        <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} fill="none" aria-hidden>
          <path className="mk-check-path" pathLength={1} d="M5 12.5l4.2 4.2L19 7" stroke="#4ade80" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </div>
  )
}
