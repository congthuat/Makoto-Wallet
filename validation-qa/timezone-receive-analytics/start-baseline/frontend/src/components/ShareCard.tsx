import { useState } from 'react'
import { Share2, Download, Check } from 'lucide-react'
import { useWallet } from '../lib/store'
import { usd } from '../lib/wallet'
import { chartCoordinates, type ChartPoint } from '../lib/chartGeometry'
import { useT } from '../lib/i18n'
import { Button, MK_LEFT, MK_RIGHT, MK_TOP, Modal, T } from './wallet/ui'

type Row = { symbol: string; value: string; color: string }
function draw(opts: { total: string; pnl: string; up: boolean; rows: Row[]; tag: string; points: ChartPoint[]; brand: string; date: string }) {
  const W = 1200, H = 630
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d')!
  g.fillStyle = '#0b0b10'; g.fillRect(0, 0, W, H)
  const rg = g.createRadialGradient(W * 0.8, -60, 20, W * 0.8, -60, 700); rg.addColorStop(0, 'rgba(168,85,247,.35)'); rg.addColorStop(1, 'rgba(168,85,247,0)')
  g.fillStyle = rg; g.fillRect(0, 0, W, H)
  const lg = g.createRadialGradient(80, H + 40, 10, 80, H + 40, 520); lg.addColorStop(0, 'rgba(142,254,126,.22)'); lg.addColorStop(1, 'rgba(142,254,126,0)')
  g.fillStyle = lg; g.fillRect(0, 0, W, H)
  g.strokeStyle = 'rgba(255,255,255,.04)'; g.lineWidth = 1
  for (let x = 0; x < W; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke() }
  for (let y = 0; y < H; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke() }
  // logo mark
  const mg = g.createLinearGradient(72, 64, 128, 120); mg.addColorStop(0, '#B8FF9F'); mg.addColorStop(.45, '#8EFE7E'); mg.addColorStop(1, '#7E47FF')
  g.fillStyle = mg; g.beginPath(); g.roundRect(72, 64, 56, 56, 16); g.fill()
  g.save(); g.translate(72, 64); g.scale(56 / 48, 56 / 48); g.translate(9, 14.1); g.scale(0.0411, 0.0411); g.translate(-260, -308)
  g.fillStyle = '#0b0b10'; for (const d of [MK_TOP, MK_LEFT, MK_RIGHT]) g.fill(new Path2D(d))
  g.restore()
  g.fillStyle = '#fff'; g.font = '600 28px Montserrat, sans-serif'; (g as any).letterSpacing = '6px'; g.fillText('MAKOTO', 146, 92); (g as any).letterSpacing = '0px'
  g.fillStyle = '#9d9aa8'; g.font = '500 18px Montserrat, sans-serif'; g.fillText(opts.brand, 146, 116)
  // tag
  g.font = '600 18px Montserrat, sans-serif'; const tw = g.measureText(opts.tag).width + 32
  g.fillStyle = 'rgba(255,255,255,.07)'; g.beginPath(); g.roundRect(W - 72 - tw, 70, tw, 40, 20); g.fill()
  g.fillStyle = '#c8ffbe'; g.fillText(opts.tag, W - 72 - tw + 16, 97)
  // total
  g.fillStyle = '#9d9aa8'; g.font = '500 24px Montserrat, sans-serif'; g.fillText('Total balance', 72, 230)
  g.fillStyle = '#fff'; g.font = '700 96px "JetBrains Mono", monospace'; g.fillText(opts.total, 66, 330)
  g.fillStyle = opts.up ? '#8efe7e' : '#fda4af'; g.font = '600 28px "JetBrains Mono", monospace'; g.fillText(opts.pnl, 72, 380)
  // sparkline
  const pts = opts.points
  if (pts.length > 1) {
    const x0 = 640, x1 = W - 72, y0 = 200, y1 = 380
    const coordinates = chartCoordinates(pts, x1 - x0, y1 - y0)
    g.beginPath()
    coordinates.forEach(([cx, cy], i) => { const x = x0 + cx, y = y0 + cy; i ? g.lineTo(x, y) : g.moveTo(x, y) })
    g.strokeStyle = '#8efe7e'; g.lineWidth = 4; g.lineJoin = 'round'; g.stroke()
  }
  // holdings
  opts.rows.slice(0, 3).forEach((r, i) => {
    const x = 72 + i * 360, y = 440
    g.fillStyle = 'rgba(255,255,255,.04)'; g.beginPath(); g.roundRect(x, y, 336, 84, 18); g.fill()
    g.fillStyle = r.color; g.beginPath(); g.arc(x + 42, y + 42, 18, 0, Math.PI * 2); g.fill()
    g.fillStyle = '#fff'; g.font = '700 24px Montserrat, sans-serif'; g.fillText(r.symbol, x + 76, y + 38)
    g.fillStyle = '#9d9aa8'; g.font = '500 20px "JetBrains Mono", monospace'; g.fillText(r.value, x + 76, y + 64)
  })
  g.fillStyle = '#6b6878'; g.font = '500 18px Montserrat, sans-serif'; g.fillText(`${opts.date} · makoto wallet · Arc Testnet`, 72, H - 40)
  return c
}

export default function ShareButton() {
  const { total, holdings, portfolioDayPoints, mask, pricesReady, live } = useWallet()
  const [tr] = useT()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [blob, setBlob] = useState<Blob | null>(null)
  const [done, setDone] = useState(false)

  const build = () => {
    const priced = holdings.filter((h) => h.verified && h.value != null && h.change24h != null)
    const pnl = priced.reduce((s, h) => s + (h.value! - h.value! / (1 + h.change24h! / 100)), 0)
    const pct = total - pnl ? (pnl / (total - pnl)) * 100 : 0
    const c = draw({
      total: mask(usd(total)), up: pnl >= 0,
      pnl: `${mask(`${pnl >= 0 ? '+' : '−'}${usd(Math.abs(pnl))}`)}  (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)  24h`,
      rows: holdings.filter((h) => h.verified).slice(0, 3).map((h) => ({ symbol: h.symbol, color: h.color, value: h.value != null ? mask(usd(h.value)) : '—' })),
      tag: live ? 'Live · Arc Testnet' : 'Sample data', points: portfolioDayPoints, brand: 'The wallet you can just ask',
      date: new Date().toLocaleDateString(),
    })
    c.toBlob((b) => { if (!b) return; setBlob(b); setUrl(URL.createObjectURL(b)) }, 'image/png')
    setDone(false); setOpen(true)
  }
  const file = () => new File([blob!], 'makoto-portfolio.png', { type: 'image/png' })
  const canShare = typeof navigator !== 'undefined' && !!navigator.canShare && !!blob && navigator.canShare({ files: [file()] })
  const share = async () => { try { await navigator.share({ files: [file()], title: 'Makoto Wallet' }); setDone(true) } catch { /* cancelled */ } }

  return (
    <>
      <button onClick={build} disabled={!pricesReady} title={tr('Share as image')} aria-label={tr('Share as image')}
        className={`h-8 w-8 inline-flex items-center justify-center rounded-lg ${T.sub} hover:text-white hover:bg-white/[0.06] disabled:opacity-40`}><Share2 size={15} /></button>
      <Modal open={open} onClose={() => { setOpen(false); if (url) URL.revokeObjectURL(url); setUrl('') }} title={tr('Share as image')} width={560}>
        {url ? <img src={url} alt="Portfolio card" className="w-full rounded-xl border border-white/[0.08]" /> : <div className="aspect-[1200/630] rounded-xl bg-white/[0.03]" />}
        <p className={`mt-3 text-[12.5px] ${T.mute}`}>{tr('Tip: turn on “Hide balances” first if you want to share without showing amounts.')}{!live && ` ${tr('This card uses sample data.')}`}</p>
        <div className="mt-4 flex gap-2">
          <a href={url} download="makoto-portfolio.png" onClick={() => setDone(true)} className="flex-1"><Button variant="primary" className="w-full">{done ? <Check size={15} /> : <Download size={15} />} {tr('Download image')}</Button></a>
          {canShare && <Button onClick={share}><Share2 size={15} /> {tr('Share')}</Button>}
        </div>
      </Modal>
    </>
  )
}
