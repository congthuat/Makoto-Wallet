/**
 * AgentSwapCard — Swap execution embedded in the Agent chat.
 *
 * Mounts LiveSwapControl directly (no logic duplication).
 * The user must press "Get live quote and review" first, then
 * separately confirm approval (if needed) and then confirm swap.
 * No auto-transition from approval to swap signing.
 */
import { useCallback } from 'react'
import { X } from 'lucide-react'
import { useWallet } from '../lib/store'
import { T } from './wallet/ui'
import { useT } from '../lib/i18n'
import { LiveSwapControl } from './LiveSwapControl'

export type AgentSwapParams = {
  account: string
  from: string   // 'USDC' | 'EURC'
  to: string     // 'USDC' | 'EURC'
  amount: string
  slip: '0.5%' | '1%' | '3%'
}

export function AgentSwapCard({ params, onDone, onCancel }: {
  params: AgentSwapParams
  /** Called when LiveSwapControl fires onComplete (user pressed Done after confirmed swap). */
  onDone: (outcome: 'completed') => void
  onCancel: () => void
}) {
  const { refetchWallet } = useWallet()
  const [, lang] = useT()
  const vi = lang === 'vi'
  const say = useCallback((en: string, vn: string) => vi ? vn : en, [vi])

  // onConfirmed: called after approval or swap receipt — triggers wallet refresh
  const onConfirmed = useCallback(async () => {
    try { await refetchWallet() } catch { /* non-fatal */ }
  }, [refetchWallet])

  return (
    <div className="mt-3 rounded-2xl border border-white/[0.08] bg-[#0e0e13] overflow-hidden text-[13px]" aria-live="polite">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center justify-between gap-2">
        <span className={`text-[11px] font-bold tracking-[0.12em] ${T.mute}`}>
          {say('SWAP IN CHAT', 'HOÁN ĐỔI TRONG CHAT')} · {params.from} → {params.to}
        </span>
        <button onClick={onCancel} className={`${T.mute} hover:text-white p-0.5`} aria-label="Close">
          <X size={14} />
        </button>
      </div>

      <div className="p-3">
        {/* Slippage indicator */}
        <div className={`mb-2 text-[12px] ${T.mute} flex items-center gap-2`}>
          <span>{say('Amount', 'Số tiền')}:</span>
          <span className="font-num font-semibold text-white">{params.amount} {params.from}</span>
          <span className="ml-2">{say('Slippage', 'Trượt giá')}:</span>
          <span className="font-num font-semibold text-white">{params.slip}</span>
        </div>

        {/* LiveSwapControl handles all execution logic */}
        <LiveSwapControl
          account={params.account}
          from={params.from}
          to={params.to}
          amount={params.amount}
          slip={params.slip}
          onConfirmed={onConfirmed}
          onComplete={() => onDone('completed')}
        />
      </div>

      {/* Safety note */}
      <div className={`px-4 py-2 border-t border-white/[0.05] text-[11.5px] ${T.mute}`}>
        {say(
          'Each approval and swap needs a separate wallet confirmation. No automatic signing.',
          'Mỗi phê duyệt và hoán đổi cần xác nhận riêng trong ví. Không tự động ký.',
        )}
      </div>
    </div>
  )
}
