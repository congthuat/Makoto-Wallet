import { useId, useMemo, useRef, useState } from 'react'
import { chartCoordinates, closestPointIndex } from '../../lib/chartGeometry'
import { useT } from '../../lib/i18n'

export type Point = [number, number]

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

function scale(points: Point[], w: number, h: number, pad = 4) {
  return chartCoordinates(points, w, h, pad)
}

export function Sparkline({ points, up, width = 96, height = 32, color: c, fluid = false }: { points: Point[]; up: boolean; width?: number; height?: number; color?: string; fluid?: boolean }) {
  if (points.length < 2) return <div style={{ width, height }} />
  const xy = scale(points, width, height, 3)
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const color = c ?? (up ? '#34d399' : '#fb7185')
  return (
    <svg width={fluid ? '100%' : width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio={fluid ? 'none' : undefined} className="overflow-visible">
      <path d={d} fill="none" stroke={color} strokeWidth={fluid ? 2 : 1.6} vectorEffect={fluid ? 'non-scaling-stroke' : undefined} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export function AreaChart({ points, height = 180, mask = (value) => value }: { points: Point[]; height?: number; mask?: (value: string) => string }) {
  const W = 800
  const [tr, language] = useT()
  const id = useId().replace(/:/g, '')
  const locale = language === 'vi' ? 'vi-VN' : language
  const ref = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)

  const { line, area, xy } = useMemo(() => {
    if (points.length < 2) return { line: '', area: '', xy: [] as number[][] }
    const xy = scale(points, W, height, 12)
    const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
    return { line, area: `${line} L${W},${height} L0,${height} Z`, xy }
  }, [points, height])

  if (points.length < 2) return <div className="w-full rounded-xl bg-white/[0.03] animate-pulse" style={{ height }} />

  const onMove = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setHover(closestPointIndex(points, (e.clientX - r.left) / r.width))
  }

  const selected = hover == null ? null : Math.min(hover, points.length - 1)
  const h = selected != null ? xy[selected] : null
  const hp = selected != null ? points[selected] : null
  const formatDate = (point: Point) => new Date(point[0] * 1000).toLocaleString(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const valueText = hp ? `${formatDate(hp)}, ${mask(usd(hp[1]))}` : ''

  return (
    <div ref={ref} role="slider" tabIndex={0} aria-label={tr('Recorded portfolio balance history')} aria-describedby={`${id}-help`}
      aria-valuemin={0} aria-valuemax={points.length - 1} aria-valuenow={selected ?? points.length - 1} aria-valuetext={valueText || `${formatDate(points[points.length - 1])}, ${mask(usd(points[points.length - 1][1]))}`}
      className="mk-portfolio-chart relative w-full select-none rounded-lg" style={{ height, touchAction: 'pan-y' }}
      onPointerMove={onMove} onPointerDown={(event) => { event.currentTarget.focus({ preventScroll: true }); onMove(event) }} onPointerLeave={(event) => { if (event.pointerType === 'mouse') setHover(null) }}
      onFocus={() => setHover(points.length - 1)} onBlur={() => setHover(null)}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Escape'].includes(event.key)) return
        event.preventDefault()
        if (event.key === 'Escape') { setHover(null); return }
        const current = selected ?? points.length - 1
        setHover(event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : Math.max(0, Math.min(points.length - 1, current + (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1))))
      }}>
      <span id={`${id}-help`} className="sr-only">{tr('Use arrow keys to explore recorded snapshots.')}</span>
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: 'var(--mk-chart-area)', stopOpacity: 0.28 }} />
            <stop offset="100%" style={{ stopColor: 'var(--mk-chart-area)', stopOpacity: 0 }} />
          </linearGradient>
          <linearGradient id={`${id}-line`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" style={{ stopColor: 'var(--mk-chart-line-start)' }} />
            <stop offset="100%" style={{ stopColor: 'var(--mk-chart-line-end)' }} />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={W} y1={height * f} y2={height * f} className="mk-chart-grid" stroke="rgba(255,255,255,0.05)" strokeDasharray="4 6" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={area} fill={`url(#${id}-area)`} />
        <path d={line} fill="none" stroke={`url(#${id}-line)`} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {h && <line x1={h[0]} x2={h[0]} y1={0} y2={height} stroke="var(--mk-chart-cursor)" vectorEffect="non-scaling-stroke" />}
      </svg>
      {h && hp && (
        <>
          <div
            className="mk-chart-point absolute w-3 h-3 -ml-1.5 -mt-1.5 rounded-full pointer-events-none"
            style={{ left: `${(h[0] / W) * 100}%`, top: h[1] }}
          />
          <div
            className="mk-chart-tooltip absolute top-1 z-10 max-w-full px-2.5 py-1.5 rounded-lg border border-white/10 shadow-xl text-xs pointer-events-none whitespace-nowrap"
            style={{ left: `${(h[0] / W) * 100}%`, transform: `translateX(${h[0] / W > 0.8 ? '-100%' : h[0] / W < 0.2 ? '0' : '-50%'})` }}
          >
            <div className="font-semibold tabular-nums">{mask(usd(hp[1]))}</div>
            <div style={{ color: 'var(--mk-chart-tooltip-muted)' }}>
              {formatDate(hp)}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export function ScoreRing({ value, total }: { value: number; total: number }) {
  const r = 26
  const c = 2 * Math.PI * r
  const pct = value / total
  const color = pct === 1 ? '#34d399' : '#fbbf24'
  return (
    <div className="relative w-16 h-16">
      <svg viewBox="0 0 64 64" className="w-16 h-16 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
        <circle
          cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: 'stroke-dashoffset .6s ease, stroke .3s' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-sm font-bold tabular-nums">
        {value}/{total}
      </div>
    </div>
  )
}
