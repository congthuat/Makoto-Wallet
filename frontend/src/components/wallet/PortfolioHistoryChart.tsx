import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWallet } from '../../lib/store'
import { useT } from '../../lib/i18n'
import { HISTORY_RANGES, historyAccessEnabled, historyDisplayState, historyPoints, historyQueryKey, portfolioHistoryApi, type HistoryRange } from '../../lib/portfolioHistory'
import { AreaChart } from './charts'
import { Button, Skeleton, T } from './ui'

export function PortfolioHistoryChart({ compact = false }: { compact?: boolean }) {
  const { taskAuthenticated, taskAuthLoading, verifyTaskWallet, portfolioScope, portfolioHistoryReady, portfolioHistoryError, mask } = useWallet()
  const [tr, language] = useT()
  const [range, setRange] = useState<HistoryRange>('1d')
  const [verifying, setVerifying] = useState(false)
  const [verificationFailureScope, setVerificationFailureScope] = useState('')
  const verificationPending = useRef(false)
  const scopeKey = portfolioScope ? `${portfolioScope.walletAddress}:${portfolioScope.chainId}` : ''
  const accessEnabled = historyAccessEnabled(portfolioScope, taskAuthenticated)
  const authLoading = !!portfolioScope && taskAuthLoading
  const needsVerification = !!portfolioScope && !taskAuthLoading && !taskAuthenticated
  const rangesDisabled = !!portfolioScope && (taskAuthLoading || !taskAuthenticated || !portfolioHistoryReady)
  const query = useQuery({
    queryKey: historyQueryKey(portfolioScope, range),
    queryFn: ({ signal }) => portfolioHistoryApi.history(portfolioScope!, range, signal),
    enabled: accessEnabled && !taskAuthLoading && portfolioHistoryReady, staleTime: 30_000, refetchInterval: 60_000, retry: 1,
  })
  const points = historyPoints(query.data, accessEnabled ? portfolioScope : null)
  const state = authLoading ? 'loading' : needsVerification ? 'auth' : historyDisplayState(points.length, !!portfolioScope && ((!portfolioHistoryReady && !portfolioHistoryError) || query.isLoading), !!portfolioScope && (portfolioHistoryError || query.isError))
  const height = compact ? 80 : 170
  const locale = language === 'vi' ? 'vi-VN' : language
  const dateLabel = (seconds: number) => new Date(seconds * 1000).toLocaleString(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const message = state === 'error' ? 'Could not load balance history.' : state === 'starting' ? 'Starting to record balance history.' : query.data?.totalSnapshots && portfolioScope ? 'No recorded balance snapshots in this range.' : 'No balance history yet'
  const verify = async () => {
    if (!needsVerification || verificationPending.current) return
    verificationPending.current = true
    setVerifying(true)
    setVerificationFailureScope('')
    try { await verifyTaskWallet() }
    catch { setVerificationFailureScope(scopeKey) }
    finally { verificationPending.current = false; setVerifying(false) }
  }

  return (
    <section className="min-w-0" aria-label={tr('Balance history')} data-history-state={state}>
      <div className="flex items-center justify-between gap-2 mb-2">
        {!compact && <span className={`text-[12px] ${T.sub}`}>{tr('Balance history')}</span>}
        <div role="group" aria-label={tr('History range')} className={`inline-flex max-w-full p-0.5 rounded-lg bg-white/[0.04] border border-white/[0.06] ${compact ? '' : 'ml-auto'}`}>
          {HISTORY_RANGES.map((option) => (
            <button key={option} type="button" aria-pressed={range === option} disabled={rangesDisabled} onClick={() => setRange(option)}
              className={`min-w-9 h-8 px-2 sm:px-3 rounded-md text-[11px] font-semibold transition disabled:opacity-50 ${range === option ? 'bg-white/10 text-white' : `${T.mute} hover:text-white`}`}>
              {option === 'all' ? tr('ALL') : option.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      {state === 'loading' ? <div style={{ height }}><Skeleton className="w-full h-full rounded-lg" /></div> : state === 'auth' ? (
        <div className="rounded-lg bg-white/[0.03] flex flex-col items-center justify-center px-3 py-4 text-center gap-2" style={{ minHeight: height }}>
          <p className={`text-[13px] font-semibold ${T.text}`}>{tr('Verify your wallet to enable balance history')}</p>
          <p className={`max-w-md text-[12px] ${T.sub}`}>{tr('Sign a message to prove wallet ownership. No gas or transaction is involved.')}</p>
          <Button type="button" size="sm" variant="primary" className="min-h-11 h-auto" disabled={verifying} aria-busy={verifying} onClick={() => void verify()}>
            {tr(verifying ? 'Verifying…' : 'Verify wallet')}
          </Button>
          {verificationFailureScope === scopeKey && <p role="status" className={`text-[12px] ${T.sub}`}>{tr("Wallet verification was not completed. Try again when you're ready.")}</p>}
        </div>
      ) : state === 'chart' ? (
        <>
          <AreaChart points={points} height={height} mask={mask} />
          <div className={`flex justify-between gap-2 mt-1 text-[10px] font-num ${T.mute}`} aria-hidden="true">
            <span>{dateLabel(points[0][0])}</span><span className="text-right">{dateLabel(points[points.length - 1][0])}</span>
          </div>
          {query.data?.downsampled && <p className={`mt-1 text-[10px] ${T.mute}`}>{tr('Showing selected recorded snapshots.')}</p>}
        </>
      ) : (
        <div className={`rounded-lg bg-white/[0.03] flex flex-col items-center justify-center px-3 text-center gap-1 text-[12px] ${T.mute}`} style={{ height }} role={state === 'error' ? 'alert' : 'status'}>
          <span>{tr(message)}</span>
          {state === 'error' && <button type="button" onClick={() => void query.refetch()} className="min-h-6 font-semibold text-neon-300 underline">{tr('Retry')}</button>}
        </div>
      )}
    </section>
  )
}
