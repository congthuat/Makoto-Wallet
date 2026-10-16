import { useEffect, useId, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { ArrowLeft, Copy, Download, FileText, MoreHorizontal, Share2 } from 'lucide-react'
import { downloadReceiveQr, type ReceiveShareData } from '../../lib/receiveShare'
import { useT } from '../../lib/i18n'
import { T } from './ui'
import { SharePlatformIcon } from './SharePlatformIcon'

type Notify = (message: string, kind?: 'ok' | 'err') => void
type CopyText = (value: string, notify: Notify, label?: string) => Promise<boolean>
const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current'
const action = `min-h-12 rounded-xl border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.07] transition disabled:opacity-40 disabled:cursor-not-allowed ${focus}`

export function ReceiveSharePanel({ data, onBack, notify, copyText }: { data: ReceiveShareData; onBack: () => void; notify: Notify; copyText: CopyText }) {
  const [tr] = useT()
  const headingId = useId()
  const back = useRef<HTMLButtonElement>(null)
  const qr = useRef<SVGSVGElement>(null)
  const active = useRef(true)
  const [pending, setPending] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  useEffect(() => {
    active.current = true
    back.current?.focus({ preventScroll: true })
    return () => { active.current = false }
  }, [])
  const report: Notify = (message, kind) => {
    if (!active.current) return
    setStatus(message)
    notify(message, kind)
  }
  const copy = async (value: string, label: string, kind: string) => {
    if (pending) return
    setPending(kind)
    await copyText(value, report, label)
    if (active.current) setPending(null)
  }
  const nativeShare = async () => {
    if (pending || typeof navigator.share !== 'function') return
    setPending('native')
    try { await navigator.share({ title: data.title, text: data.details }) } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) report(tr('System sharing could not open. Choose another option below.'), 'err')
    } finally { if (active.current) setPending(null) }
  }
  const download = () => {
    try {
      if (!qr.current) throw new Error('QR unavailable')
      downloadReceiveQr(qr.current, data)
      report(tr('QR download started'))
    } catch { report(tr('QR download unavailable. Try copying your address instead.'), 'err') }
  }
  return (
    <section aria-labelledby={headingId} onKeyDownCapture={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onBack() }
    }}>
      <button ref={back} type="button" onClick={onBack} className={`-ml-2 mb-2 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-[13px] ${T.sub} hover:text-white ${focus}`}>
        <ArrowLeft size={16} aria-hidden="true" /> {tr('Back to Receive')}
      </button>
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-neon-500/15 text-neon-200"><Share2 size={21} /></span>
        <div className="min-w-0">
          <h4 id={headingId} className="text-[17px] font-semibold tracking-tight">{tr('Share receive details')}</h4>
          <p className={`mt-0.5 text-[12px] ${T.sub}`}>{data.symbol} · {data.network} · {tr('Chain ID')} {data.chainId}</p>
        </div>
      </div>
      <div className="mt-4 rounded-2xl border border-white/[0.08] bg-black/30 p-3">
        <p className={`mb-1 text-[11px] ${T.mute}`}>{tr('Your address')}</p>
        <p className="break-all font-mono text-[12px] leading-relaxed">{data.address}</p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" disabled={!!pending} onClick={() => void copy(data.address, tr('Address copied'), 'address')} className={`${action} flex min-h-22 flex-col items-start gap-2 p-3 text-left text-[13px] font-semibold`}>
          <Copy size={19} className={T.sub} aria-hidden="true" /><span>{tr('Copy address')}</span>
        </button>
        <button type="button" disabled={!!pending} onClick={() => void copy(data.details, tr('Receive details copied'), 'details')} className={`${action} flex min-h-22 flex-col items-start gap-2 p-3 text-left text-[13px] font-semibold`}>
          <FileText size={19} className={T.sub} aria-hidden="true" /><span>{tr('Copy receive details')}</span>
        </button>
      </div>
      <p className={`mb-2 mt-5 text-[12px] font-medium ${T.sub}`}>{tr('Share with')}</p>
      <div className="grid grid-cols-3 gap-2">
        {(['x', 'telegram', 'whatsapp'] as const).map((platform) => (
          <a key={platform} href={data.links[platform]} target="_blank" rel="noopener noreferrer" className={`${action} flex min-h-20 flex-col items-center justify-center gap-2 px-1 py-3 text-[12px] font-semibold`}>
            <SharePlatformIcon platform={platform} /><span>{platform === 'x' ? 'X (Twitter)' : platform === 'telegram' ? 'Telegram' : 'WhatsApp'}</span>
          </a>
        ))}
      </div>
      <button type="button" onClick={download} className={`${action} mt-3 flex w-full items-center justify-center gap-2 px-3 py-3 text-[13px] font-semibold`}><Download size={17} aria-hidden="true" /> {tr('Download QR')}</button>
      {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && <button type="button" disabled={!!pending} onClick={() => void nativeShare()} className={`mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl text-[13px] ${T.sub} hover:bg-white/[0.03] disabled:opacity-40 ${focus}`}><MoreHorizontal size={18} aria-hidden="true" /> {tr('More options')}</button>}
      <p role="status" aria-live="polite" className={`mt-3 min-h-5 text-center text-[12px] ${T.sub}`}>{status || tr('Choose an app, then confirm where to share.')}</p>
      <div hidden aria-hidden="true"><QRCodeSVG ref={qr} value={data.address} size={256} level="M" marginSize={4} fgColor="#0e0e12" bgColor="#ffffff" title={data.title} data-receive-address={data.address} /></div>
    </section>
  )
}
