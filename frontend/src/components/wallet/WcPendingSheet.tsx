import { useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, Loader2, Smartphone } from 'lucide-react'
import { cancelPendingWc, getPendingWc, subscribePendingWc } from '../../lib/walletConnect'
import { useT } from '../../lib/i18n'
import { Button, T } from './ui'

/**
 * Shown while a WalletConnect request waits in the phone wallet app. Phone browsers often block
 * opening the wallet automatically, so the user gets a real "Open wallet" tap and a way to cancel.
 */
export function WcPendingSheet() {
  const pending = useSyncExternalStore(subscribePendingWc, getPendingWc, () => null)
  const [, lang] = useT()
  const vi = lang === 'vi'
  if (!pending || typeof document === 'undefined') return null
  const name = pending.walletName
  const sign = pending.method === 'personal_sign' || pending.method.startsWith('eth_sign')
  const tx = pending.method === 'eth_sendTransaction'
  const title = sign
    ? (vi ? `Ký xác nhận trong ${name}` : `Sign in ${name}`)
    : tx ? (vi ? `Duyệt giao dịch trong ${name}` : `Approve the transaction in ${name}`)
      : (vi ? `Duyệt yêu cầu trong ${name}` : `Approve the request in ${name}`)
  return createPortal(
    <div className="fixed inset-0 z-[94] flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="mk-wc-title" data-wc-pending>
      <div className="absolute inset-0 bg-black/70" />
      <div className="relative w-full max-w-[420px] rounded-t-[22px] sm:rounded-[18px] border border-white/10 bg-[#121418] shadow-2xl p-5">
        <h2 id="mk-wc-title" className="text-[17px] font-bold flex items-center gap-2"><Smartphone size={18} className="text-neon-300" /> {title}</h2>
        <p className={`mt-2 text-[13px] leading-5 ${T.sub}`}>
          {pending.link
            ? (vi ? `Yêu cầu đã được gửi tới ví. Bấm "Mở ${name}", duyệt trong app ví, rồi quay lại trang này.` : `The request was sent to your wallet. Tap "Open ${name}", approve it in the wallet app, then come back here.`)
            : (vi ? 'Yêu cầu đã được gửi tới ví. Mở app ví đã kết nối để duyệt, rồi quay lại trang này.' : 'The request was sent to your wallet. Open the connected wallet app to approve it, then come back here.')}
        </p>
        {sign && <p className={`mt-1.5 text-[12px] ${T.mute}`}>{vi ? 'Chỉ là ký tin nhắn — không mất phí, không chuyển tiền.' : 'Message signature only — no fee, no transfer.'}</p>}
        <p className={`mt-3 flex items-center gap-2 text-[12px] ${T.mute}`}><Loader2 size={13} className="animate-spin" /> {vi ? 'Đang chờ ví phản hồi…' : 'Waiting for the wallet…'}</p>
        <div className={`mt-4 grid gap-2 ${pending.link ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <Button size="lg" onClick={cancelPendingWc} data-wc-cancel>{vi ? 'Hủy' : 'Cancel'}</Button>
          {pending.link && (
            <a href={pending.link} data-wc-open className="inline-flex items-center justify-center gap-1.5 h-11 rounded-xl bg-neon-500 text-[#0b0b10] text-[14px] font-semibold">
              {vi ? `Mở ${name}` : `Open ${name}`} <ExternalLink size={14} aria-hidden />
            </a>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
