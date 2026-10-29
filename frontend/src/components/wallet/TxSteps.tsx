import { Check, Loader2, X } from 'lucide-react'

export type TxStage = 'review' | 'wallet' | 'pending' | 'done' | 'error'

const ORDER: Exclude<TxStage, 'error'>[] = ['review', 'wallet', 'pending', 'done']

/** Shared progress rail for reviewed writes: Review → Sign → Confirming → Done. Presentation only. */
export function TxSteps({ stage, vi, failedAt = 'pending' }: { stage: TxStage; vi: boolean; failedAt?: Exclude<TxStage, 'error' | 'done'> }) {
  const labels: Record<(typeof ORDER)[number], string> = vi
    ? { review: 'Xem lại', wallet: 'Ký trong ví', pending: 'Xác nhận trên Arc', done: 'Hoàn tất' }
    : { review: 'Review', wallet: 'Sign in wallet', pending: 'Confirming on Arc', done: 'Done' }
  const current = stage === 'error' ? ORDER.indexOf(failedAt) : ORDER.indexOf(stage)
  return (
    <ol className="flex items-center gap-1.5 text-[11.5px]" aria-label={vi ? 'Tiến trình giao dịch' : 'Transaction progress'}>
      {ORDER.map((key, index) => {
        const done = index < current || stage === 'done'
        const active = index === current && stage !== 'done'
        const failed = stage === 'error' && index === current
        return (
          <li key={key} className="flex items-center gap-1.5 min-w-0" aria-current={active ? 'step' : undefined}>
            <span className={`w-5 h-5 rounded-full shrink-0 flex items-center justify-center border text-[10px] font-bold transition-colors duration-300 ${failed ? 'border-rose-400/60 bg-rose-500/15 text-rose-300' : done ? 'border-neon-500/60 bg-neon-500/15 text-neon-300' : active ? 'border-white/30 bg-white/[0.06] text-white' : 'border-white/[0.12] text-white/40'}`}>
              {failed ? <X size={11} /> : done ? <Check size={11} strokeWidth={3} className="mk-copied" /> : active && (key === 'wallet' || key === 'pending') ? <Loader2 size={11} className="animate-spin" /> : index + 1}
            </span>
            <span className={`truncate ${active || failed ? 'font-semibold' : 'opacity-60'} hidden sm:inline`}>{labels[key]}</span>
            {index < ORDER.length - 1 && <span className={`h-px w-4 sm:w-6 shrink-0 transition-colors duration-500 ${done ? 'bg-neon-500/50' : 'bg-white/[0.12]'}`} aria-hidden />}
          </li>
        )
      })}
    </ol>
  )
}
