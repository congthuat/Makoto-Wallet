import { useState } from 'react'
import { AlertTriangle, ExternalLink, X } from 'lucide-react'
import { useT } from '../lib/i18n'
import { openInBrowserHref } from '../lib/googleSignIn'

const KEY = 'mk-coccoc-notice'

/** Cốc Cốc on phones runs its own add-ons (ad block, forced dark mode, translate…) on top of the page,
 *  which can make Makoto freeze. Suggest the phone's main browser instead. */
export function BrowserNotice() {
  const [, lang] = useT()
  const vi = lang === 'vi'
  const [show, setShow] = useState(() => {
    if (typeof navigator === 'undefined') return false
    const ua = navigator.userAgent || ''
    if (!/coc_coc_browser|CocCoc/i.test(ua) || !/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return false
    try { return localStorage.getItem(KEY) !== '1' } catch { return true }
  })
  if (!show) return null
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent)
  const browser = ios ? 'Safari' : 'Chrome'
  const href = openInBrowserHref()
  const close = () => { setShow(false); try { localStorage.setItem(KEY, '1') } catch { /* ignore */ } }
  return (
    <div className="max-w-[1320px] mx-auto px-4 pt-3 lg:hidden" data-browser-notice>
      <div className="relative p-3 pr-9 rounded-xl border border-amber-300/30 bg-amber-300/[0.07] text-[12.5px] text-amber-100">
        <button type="button" onClick={close} className="absolute right-1.5 top-1.5 p-1.5 rounded-lg text-amber-200/80" aria-label={vi ? 'Đóng' : 'Close'}><X size={15} /></button>
        <p className="flex items-start gap-2 font-semibold"><AlertTriangle size={15} className="shrink-0 mt-0.5 text-amber-300" />
          {vi ? `Cốc Cốc trên điện thoại có thể làm Makoto bị đơ` : `Cốc Cốc on phones can make Makoto freeze`}</p>
        <p className="mt-1 text-amber-100/80">
          {vi
            ? `Các tiện ích có sẵn của Cốc Cốc (chặn quảng cáo, chế độ tối, dịch trang) chạy chồng lên trang. Để dùng mượt, hãy mở Makoto bằng ${browser}.`
            : `Cốc Cốc’s built-in add-ons (ad block, dark mode, translate) run on top of the page. For a smooth experience, open Makoto in ${browser}.`}
        </p>
        {href && (
          <a href={href} className="mt-2 inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-amber-300 text-[#0b0b10] font-semibold">
            {vi ? `Mở bằng ${browser}` : `Open in ${browser}`} <ExternalLink size={13} aria-hidden />
          </a>
        )}
      </div>
    </div>
  )
}
