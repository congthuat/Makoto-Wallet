/**
 * AgentBridgeCard — Bridge execution embedded in the Agent chat.
 *
 * Mounts LiveCctpControl directly (no logic duplication).
 * Arc Testnet → Base Sepolia via Circle CCTP v2 only.
 *
 * Safety invariants preserved from LiveCctpControl:
 * - Approval and Burn are two separate wallet confirmations.
 * - "Completed" only when destination evidence (Base receipt + USDC transfer) is available.
 * - Source confirmed ≠ Bridge completed.
 * - Checkpoint/recovery is maintained by LiveCctpControl's existing strategy controller.
 */
import { useCallback, useState } from 'react'
import { X } from 'lucide-react'
import { useWallet } from '../lib/store'
import { T } from './wallet/ui'
import { useT } from '../lib/i18n'
import { LiveCctpControl, type LiveQuote } from './LiveCctpControl'
import type { CctpTransferSpeed } from '../migrated/toolLayer'

export type AgentBridgeParams = {
  account: string
  amount: string
  transferSpeed: CctpTransferSpeed
}

export function AgentBridgeCard({ params, onDone, onCancel }: {
  params: AgentBridgeParams
  onDone: () => void
  onCancel: () => void
}) {
  const { refetchWallet } = useWallet()
  const [, lang] = useT()
  const vi = lang === 'vi'
  const say = useCallback((en: string, vn: string) => vi ? vn : en, [vi])
  const [liveQuote, setLiveQuote] = useState<LiveQuote | undefined>(undefined)

  const onSourceConfirmed = useCallback(async () => {
    try { await refetchWallet() } catch { /* non-fatal */ }
  }, [refetchWallet])

  return (
    <div className="mt-3 rounded-2xl border border-white/[0.08] bg-[#0e0e13] overflow-hidden text-[13px]" aria-live="polite">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center justify-between gap-2">
        <span className={`text-[11px] font-bold tracking-[0.12em] ${T.mute}`}>
          {say('BRIDGE IN CHAT', 'CHUYỂN CHUỖI TRONG CHAT')} · Arc → Base Sepolia
        </span>
        <button onClick={onCancel} className={`${T.mute} hover:text-white p-0.5`} aria-label="Close">
          <X size={14} />
        </button>
      </div>

      <div className="p-3 space-y-2">
        {/* Transfer summary */}
        <div className={`text-[12px] ${T.mute} flex flex-wrap items-center gap-x-3 gap-y-1`}>
          <span>{say('Amount', 'Số tiền')}: <span className="font-num font-semibold text-white">{params.amount} USDC</span></span>
          <span>{say('Speed', 'Tốc độ')}: <span className="font-semibold text-white">{params.transferSpeed === 'FAST' ? say('Fast', 'Nhanh') : say('Standard', 'Tiêu chuẩn')}</span></span>
          {liveQuote && (
            <>
              <span>{say('Receive floor', 'Nhận tối thiểu')}: <span className="font-num font-semibold text-white">
                {(Number(liveQuote.expectedReceive) / 1e6).toFixed(6)} USDC
              </span></span>
              <span>{say('Max fee', 'Phí tối đa')}: <span className="font-num font-semibold text-white">
                {(Number(liveQuote.maxFee) / 1e6).toFixed(6)} USDC
              </span></span>
            </>
          )}
        </div>

        {/* Speed selector note */}
        <p className={`text-[11.5px] ${T.mute}`}>
          {say(
            'Route: Arc Testnet → Base Sepolia · Circle CCTP v2',
            'Tuyến: Arc Testnet → Base Sepolia · Circle CCTP v2',
          )}
        </p>

        {/* LiveCctpControl handles all execution logic */}
        <LiveCctpControl
          account={params.account}
          amount={params.amount}
          transferSpeed={params.transferSpeed}
          onSourceConfirmed={onSourceConfirmed}
          onComplete={onDone}
          onQuoteChange={setLiveQuote}
        />
      </div>

      {/* Safety note */}
      <div className={`px-4 py-2 border-t border-white/[0.05] text-[11.5px] ${T.mute}`}>
        {say(
          'Approval and burn are separate wallet confirmations. Completed only after Base destination evidence.',
          'Phê duyệt và đốt là hai xác nhận ví riêng. Chỉ hoàn tất khi có bằng chứng đích trên Base.',
        )}
      </div>
    </div>
  )
}
