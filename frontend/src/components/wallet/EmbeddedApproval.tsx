import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { decodeFunctionData, erc20Abi, formatUnits } from 'viem'
import { AlertTriangle, FileSignature, PenLine, ShieldCheck } from 'lucide-react'
import { answerApproval, currentApproval, subscribeApprovals, type ApprovalRequest } from '../../lib/embeddedWallet'
import { ARC, TOKENS, short } from '../../lib/wallet'
import { useT } from '../../lib/i18n'
import { Button, LogoMark, T } from './ui'

function txSummary(request: Extract<ApprovalRequest, { kind: 'transaction' }>, vi: boolean) {
  const { to, data, value } = request.tx
  const token = TOKENS.find((entry) => to && entry.address.toLowerCase() === to.toLowerCase())
  if (token && data && data !== '0x') {
    try {
      const decoded = decodeFunctionData({ abi: erc20Abi, data })
      const [target, amount] = decoded.args as readonly [string, bigint]
      if (decoded.functionName === 'transfer') return { title: vi ? `Gửi ${formatUnits(amount, token.decimals)} ${token.sym}` : `Send ${formatUnits(amount, token.decimals)} ${token.sym}`, rows: [[vi ? 'Đến' : 'To', target]] as [string, string][], warn: null }
      if (decoded.functionName === 'approve') {
        const unlimited = amount > 10n ** 30n
        return { title: vi ? `Cho phép chi ${unlimited ? 'KHÔNG GIỚI HẠN' : formatUnits(amount, token.decimals)} ${token.sym}` : `Allow spending ${unlimited ? 'UNLIMITED' : formatUnits(amount, token.decimals)} ${token.sym}`, rows: [[vi ? 'Bên được phép' : 'Spender', target]] as [string, string][], warn: unlimited ? (vi ? 'Quyền chi không giới hạn. Chỉ duyệt nếu bạn tin hợp đồng này.' : 'Unlimited allowance. Only approve if you trust this contract.') : null }
      }
    } catch { /* not a plain ERC-20 call */ }
  }
  if ((!data || data === '0x') && value) return { title: vi ? `Gửi ${formatUnits(value, 18)} USDC` : `Send ${formatUnits(value, 18)} USDC`, rows: [[vi ? 'Đến' : 'To', to ?? '—']] as [string, string][], warn: null }
  return { title: vi ? 'Tương tác hợp đồng' : 'Contract interaction', rows: [[vi ? 'Hợp đồng' : 'Contract', to ?? (vi ? 'Tạo hợp đồng mới' : 'New contract')], ...(value ? [[vi ? 'Kèm' : 'Value', `${formatUnits(value, 18)} USDC`]] : [])] as [string, string][], warn: null }
}

/** Makoto's own confirmation screen. Nothing is signed until the user clicks Approve. */
export function EmbeddedApproval() {
  const request = useSyncExternalStore(subscribeApprovals, currentApproval, () => null)
  const [, lang] = useT()
  const vi = lang === 'vi'
  const [armed, setArmed] = useState(false)
  // Short arming delay so a stray double-click cannot approve a request that just appeared.
  useEffect(() => { setArmed(false); if (!request) return; const timer = setTimeout(() => setArmed(true), 700); return () => clearTimeout(timer) }, [request])
  if (!request || typeof document === 'undefined') return null
  const tx = request.kind === 'transaction' ? txSummary(request, vi) : null
  const fee = request.kind === 'transaction' && request.tx.gas && (request.tx.maxFeePerGas ?? request.tx.gasPrice) ? Number(formatUnits(request.tx.gas * (request.tx.maxFeePerGas ?? request.tx.gasPrice)!, 18)) : null
  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="mk-approve-title" data-embedded-approval>
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" />
      <div className="relative w-full max-w-[420px] rounded-t-[22px] sm:rounded-[18px] border border-white/10 bg-[#121418] shadow-2xl p-5 mk-in">
        <div className="flex items-center gap-2.5">
          <LogoMark size={28} />
          <div className="min-w-0">
            <div className="text-[12px] font-semibold">Makoto Wallet</div>
            <div className={`text-[11.5px] ${T.mute}`}>{ARC.name} · {short(request.from)}</div>
          </div>
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-live"><ShieldCheck size={13} /> {vi ? 'Chỉ bạn duyệt' : 'You approve'}</span>
        </div>
        <h2 id="mk-approve-title" className="mt-4 text-[19px] font-bold flex items-center gap-2">
          {request.kind === 'transaction' ? <FileSignature size={18} className="text-neon-300" /> : <PenLine size={18} className="text-neon-300" />}
          {request.kind === 'transaction' ? tx!.title : request.kind === 'message' ? (vi ? 'Ký tin nhắn' : 'Sign message') : (vi ? 'Ký dữ liệu' : 'Sign data')}
        </h2>
        {request.kind === 'transaction' && (
          <dl className="mt-3 space-y-2 text-[13px]">
            {tx!.rows.map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt className={T.mute}>{label}</dt><dd className="font-mono text-[12px] break-all text-right">{value}</dd></div>)}
            <div className="flex justify-between gap-3"><dt className={T.mute}>{vi ? 'Phí mạng tối đa' : 'Max network fee'}</dt><dd className="font-num">{fee != null ? `≈ ${fee < 0.0001 ? fee.toExponential(2) : fee.toFixed(6)} USDC` : (vi ? 'Ước tính khi gửi' : 'Estimated on send')}</dd></div>
          </dl>
        )}
        {tx?.warn && <p className="mt-3 flex gap-2 text-[12.5px] text-amber-300"><AlertTriangle size={15} className="shrink-0 mt-0.5" />{tx.warn}</p>}
        {request.kind === 'message' && <pre className="mt-3 max-h-56 overflow-auto rounded-xl bg-black/30 border border-white/[0.06] p-3 text-[12px] whitespace-pre-wrap break-words font-mono">{request.message}</pre>}
        {request.kind === 'typed' && (
          <div className="mt-3 text-[12.5px]">
            <p className={T.sub}>{String(request.typed.domain?.name ?? '')} · {request.typed.primaryType}</p>
            <pre className="mt-2 max-h-56 overflow-auto rounded-xl bg-black/30 border border-white/[0.06] p-3 text-[11.5px] whitespace-pre-wrap break-words font-mono">{JSON.stringify(request.typed.message, (_k, v) => typeof v === 'bigint' ? v.toString() : v, 2)}</pre>
          </div>
        )}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button size="lg" onClick={() => answerApproval(request.id, false)}>{vi ? 'Từ chối' : 'Reject'}</Button>
          <Button size="lg" variant="primary" disabled={!armed} onClick={() => answerApproval(request.id, true)} data-approve>{vi ? 'Duyệt' : 'Approve'}</Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
