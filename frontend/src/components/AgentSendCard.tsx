/**
 * AgentSendCard — Send execution embedded in the Agent chat.
 *
 * Safety invariants (never relax when integrating):
 * - eth_sendTransaction is called ONLY when the user clicks "Confirm in wallet".
 * - prepareSend re-reads live chain state immediately before the wallet request.
 * - assertFreshSend verifies the review has not changed or expired (60-second window).
 * - SendSubmissionGuard prevents a double-click from opening a second wallet request.
 * - The transaction hash is persisted to Activity BEFORE receipt polling begins.
 * - Pending/unknown never trigger an automatic re-submit.
 * - Demo/watch mode is blocked at the top level before mounting.
 * - eth_chainId and eth_accounts are checked directly from the injected wallet; stale
 *   backend network data is never used as authorisation for signing.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, ExternalLink, Loader2, XCircle, AlertTriangle } from 'lucide-react'
import { useWallet } from '../lib/store'
import { ARC, TOKENS, explorerTx, getProvider, isAddress, short } from '../lib/wallet'
import {
  SendSubmissionGuard, assertFreshSend, feeInUsdcUnits, formatSendAmount,
  isWalletRejection, pollSendReceipt, prepareSend, requestSend,
  type PreparedSend, type SendStatus,
} from '../lib/sendExecution'
import { Button, T } from './wallet/ui'
import { useT } from '../lib/i18n'
import { translate } from '../lib/i18n'

export type AgentSendParams = {
  account: string
  symbol: string
  amount: string
  recipient: string
}

type Stage = 'preparing' | 'review' | 'requesting' | 'submitted' | 'pending' | 'confirmed' | 'failed' | 'rejected' | 'unknown'

const VI: Record<string, string> = {
  'Preparing live review…': 'Đang chuẩn bị xem lại…',
  'Review transfer': 'Xem lại giao dịch',
  'Amount': 'Số tiền',
  'Recipient': 'Người nhận',
  'Asset': 'Tài sản',
  'Network': 'Mạng',
  'Maximum fee': 'Phí tối đa',
  'Total': 'Tổng cộng',
  'Confirm in wallet': 'Xác nhận trong ví',
  'Cancel': 'Hủy',
  'Awaiting wallet confirmation': 'Đang chờ xác nhận trong ví',
  'Submitted — waiting for receipt': 'Đã gửi — đang chờ biên nhận',
  'Transfer confirmed': 'Giao dịch đã xác nhận',
  'Transfer failed': 'Giao dịch thất bại',
  'Wallet rejected — nothing was submitted': 'Ví đã từ chối — chưa gửi giao dịch',
  'Final status unknown — check before retrying': 'Chưa rõ trạng thái cuối — kiểm tra trước khi thử lại',
  'Check again': 'Kiểm tra lại',
  'Done': 'Hoàn tất',
  'Review again': 'Xem lại',
  'View on ArcScan': 'Xem trên ArcScan',
  'Revalidating…': 'Đang xác minh lại…',
  'Wrong network: Arc Testnet is required': 'Sai mạng: cần Arc Testnet',
  'Wallet disconnected': 'Ví đã ngắt kết nối',
  'Wallet account changed — review again': 'Tài khoản ví thay đổi — xem lại',
  'Chain changed — review again': 'Chain thay đổi — xem lại',
  'This review has expired — refresh to continue': 'Bản xem lại đã hết hạn — làm mới để tiếp tục',
  'Send review changed or expired. Review again.': 'Bản xem lại đã thay đổi hoặc hết hạn. Hãy xem lại.',
  'Insufficient USDC for amount and fee': 'Không đủ USDC cho số tiền và phí',
  'Connected account changed': 'Tài khoản kết nối đã thay đổi',
}

function sv(en: string, lang: string): string {
  return lang === 'vi' ? (VI[en] ?? translate(en, 'vi')) : en
}

export function AgentSendCard({ params, onDone, onCancel }: {
  params: AgentSendParams
  /** Called when the user explicitly clicks Done.
   *  Passes the terminal outcome so the caller can distinguish success from failure/rejection/unknown.
   *  'unknown': wallet call threw without a hash (no broadcast evidence) — caller must NOT assume success. */
  onDone: (outcome: 'confirmed' | 'failed' | 'rejected' | 'unknown') => void
  onCancel: () => void
}) {
  const { mode, address, walletChainId, upsertSend, refetchWallet, holdings } = useWallet()
  const [, lang] = useT()
  const s = useCallback((v: string) => sv(v, lang), [lang])

  // stageRef MUST be declared before setStage so the closure captures a live ref, never undefined.
  // Keep a ref so the catch/finally in confirmSend reads the live stage, not a stale closure.
  const stageRef = useRef<Stage>('preparing')
  const [stage, setStageRaw] = useState<Stage>('preparing')
  const setStage = (s: Stage) => { stageRef.current = s; setStageRaw(s) }
  const [prepared, setPrepared] = useState<PreparedSend | null>(null)
  const [error, setError] = useState('')
  const [hash, setHash] = useState<string | null>(null)
  const [sendStatus, setSendStatus] = useState<SendStatus>('READY')
  const [busy, setBusy] = useState(false)

  const guard = useRef(new SendSubmissionGuard())
  const reviewGen = useRef(0)
  const mounted = useRef(true)
  // Track account+chain used when review was prepared — any change invalidates it
  const reviewedAccount = useRef('')
  const reviewedChain = useRef<number | undefined>(undefined)
  // Increments whenever account/chain changes mid-review; forces prepare effect to re-run
  const [prepareKey, setPrepareKey] = useState(0)

  const { symbol, amount, recipient, account } = params
  const meta = TOKENS.find((t) => t.sym === symbol)
  const holding = holdings.find((h) => h.verified && h.symbol === symbol)

  // Invalidate review when account/chain changes after prepare.
  // Also bump prepareKey so the prepare effect re-runs with the new wallet state —
  // this prevents the card from staying stuck at 'preparing' indefinitely.
  useEffect(() => {
    if (!prepared) return
    const accountChanged = walletChainId !== reviewedChain.current ||
      address.toLowerCase() !== reviewedAccount.current.toLowerCase()
    if (accountChanged) {
      setPrepared(null)
      setStage('preparing')
      setError(s(walletChainId !== reviewedChain.current ? 'Chain changed — review again' : 'Wallet account changed — review again'))
      setPrepareKey((k) => k + 1)
    }
  }, [address, walletChainId, prepared, s])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // Auto-prepare on mount and when inputs or wallet context change.
  // prepareKey increments when account/chain changes mid-review (set by the invalidation
  // effect above) so the prepare effect re-runs with the new wallet state instead of
  // staying stuck at 'preparing' indefinitely.
  useEffect(() => {
    if (mode !== 'connected') return
    if (!isAddress(recipient) || !amount || !symbol) return
    const gen = ++reviewGen.current
    setStage('preparing')
    setPrepared(null)
    setError('')

    const p = getProvider()
    if (!p) { setError(s('Wallet disconnected')); setStage('review'); return }

    void prepareSend(p, { account, recipient, symbol, amount }).then((live) => {
      if (!mounted.current || gen !== reviewGen.current) return
      reviewedAccount.current = live.account
      reviewedChain.current = live.chainId
      setPrepared(live)
      setStage('review')
    }).catch((e: unknown) => {
      if (!mounted.current || gen !== reviewGen.current) return
      setError(s(e instanceof Error ? e.message : 'Review unavailable'))
      setStage('review')
    })
  // prepareKey is intentionally included: it increments on account/chain change so the
  // effect re-runs and the card never stays stuck at 'preparing' after a wallet switch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, symbol, amount, recipient, mode, prepareKey])

  const confirmSend = async () => {
    // Only allow a wallet request from 'review' (prepared data is ready, user is actively reviewing).
    // 'preparing' is also not blocked here because !prepared below handles it.
    // Explicitly block every non-idle stage so StrictMode double-invocation, rapid re-renders,
    // or any future code path cannot open a second wallet request.
    if (['confirmed', 'failed', 'rejected', 'unknown', 'submitted', 'pending', 'requesting'].includes(stageRef.current)) return
    if (!prepared || busy) return
    try {
      await guard.current.run(async () => {
        const p = getProvider()
        if (!p) throw new Error('Wallet disconnected')
        setBusy(true)
        setError('')
        try {
          // Revalidate immediately before wallet request — live chain state
          const fresh = await prepareSend(p, { account, recipient, symbol, amount })
          assertFreshSend(prepared, fresh)
          if (fresh.account.toLowerCase() !== account.toLowerCase()) throw new Error('Connected account changed')
          if (fresh.chainId !== ARC.chainId) throw new Error('Wrong network: Arc Testnet is required')
          setSendStatus('REQUESTING_WALLET')
          setStage('requesting')
          let txHash: string
          try {
            txHash = await requestSend(p, prepared)
          } catch (e) {
            if (isWalletRejection(e)) {
              setSendStatus('USER_REJECTED')
              setStage('rejected')
              return
            }
            setSendStatus('UNKNOWN')
            setStage('unknown')
            throw e
          }
          // Persist hash BEFORE polling — never lose a submitted transaction
          setHash(txHash)
          setSendStatus('SUBMITTED')
          setStage('submitted')
          const record = {
            hash: txHash, account: prepared.account, chainId: prepared.chainId,
            recipient: prepared.recipient, symbol, amount,
            timestamp: Date.now(), status: 'pending' as const,
          }
          upsertSend(record)
          const outcome = await pollSendReceipt(p, txHash, prepared, () => {
            if (mounted.current) setSendStatus('PENDING')
          })
          if (!mounted.current) return
          const finalStatus = outcome === 'confirmed' ? 'CONFIRMED' : outcome === 'failed' ? 'FAILED' : 'UNKNOWN'
          setSendStatus(finalStatus)
          setStage(outcome === 'confirmed' ? 'confirmed' : outcome === 'failed' ? 'failed' : 'unknown')
          upsertSend({ ...record, status: outcome === 'confirmed' ? 'completed' : outcome === 'failed' ? 'failed' : 'unknown' })
          if (outcome === 'confirmed') await refetchWallet()
        } catch (e) {
          if (!mounted.current) return
          setError(s(e instanceof Error ? e.message : 'Wallet request failed'))
          // Use stageRef (not the closed-over 'stage') to read the live current stage
          if (stageRef.current === 'requesting') setStage('review')
        } finally {
          if (mounted.current) setBusy(false)
        }
      })
    } catch { /* double-click blocked by guard */ }
  }

  const checkAgain = async () => {
    if (!hash || !prepared || busy) return
    const p = getProvider()
    if (!p) return
    setBusy(true)
    try {
      const result = await pollSendReceipt(p, hash, prepared, () => setSendStatus('PENDING'))
      if (!mounted.current) return
      const finalStatus = result === 'confirmed' ? 'CONFIRMED' : result === 'failed' ? 'FAILED' : 'UNKNOWN'
      setSendStatus(finalStatus)
      setStage(result === 'confirmed' ? 'confirmed' : result === 'failed' ? 'failed' : 'unknown')
      upsertSend({ hash, account: prepared.account, chainId: prepared.chainId, recipient: prepared.recipient, symbol, amount, timestamp: Date.now(), status: result === 'confirmed' ? 'completed' : result === 'failed' ? 'failed' : 'unknown' })
      if (result === 'confirmed') await refetchWallet()
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  if (!meta) return <p className={`text-[13px] text-rose-300`}>Unsupported asset: {symbol}</p>

  const feeLabel = prepared ? `${formatSendAmount(feeInUsdcUnits(prepared.fee), 6)} USDC` : '—'
  const totalLabel = prepared
    ? symbol === 'USDC'
      ? `${formatSendAmount(prepared.units + feeInUsdcUnits(prepared.fee), 6)} USDC`
      : `${amount} ${symbol} + ${formatSendAmount(feeInUsdcUnits(prepared.fee), 6)} USDC`
    : '—'

  const statusLabel: Record<SendStatus, string> = {
    READY: s('Preparing live review…'),
    REQUESTING_WALLET: s('Awaiting wallet confirmation'),
    USER_REJECTED: s('Wallet rejected — nothing was submitted'),
    SUBMITTED: s('Submitted — waiting for receipt'),
    PENDING: s('Submitted — waiting for receipt'),
    CONFIRMED: s('Transfer confirmed'),
    FAILED: s('Transfer failed'),
    UNKNOWN: s('Final status unknown — check before retrying'),
  }

  return (
    <div className="mt-3 rounded-2xl border border-white/[0.08] bg-[#0e0e13] overflow-hidden text-[13px]" aria-live="polite">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center justify-between gap-2">
        <span className={`text-[11px] font-bold tracking-[0.12em] ${T.mute}`}>
          {s('Review transfer').toUpperCase()} · {symbol}
        </span>
        <span className={`text-[11.5px] px-2 py-0.5 rounded-full border border-white/[0.08] ${T.mute}`}>Arc Testnet</span>
      </div>

      {/* Result states */}
      {(stage === 'confirmed' || stage === 'failed' || stage === 'rejected' || stage === 'unknown') && (
        <div className="p-4 text-center space-y-3">
          <div className="mx-auto w-12 h-12 rounded-full flex items-center justify-center bg-white/[0.05]">
            {stage === 'confirmed' ? <CheckCircle2 size={24} className="text-live" /> :
              stage === 'rejected' || stage === 'failed' ? <XCircle size={24} className="text-rose-300" /> :
                <AlertTriangle size={24} className="text-amber-300" />}
          </div>
          <div className="font-semibold">{statusLabel[sendStatus]}</div>
          <p className={`text-[12px] ${T.mute}`}>{amount} {symbol} → {short(recipient)}</p>
          {hash && (
            <a href={explorerTx(hash)} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-neon-300 text-[12px] break-all">
              {short(hash)} <ExternalLink size={11} />
            </a>
          )}
          {error && <p className="text-rose-300 break-words text-[12px]">{error}</p>}
          <div className="flex gap-2 justify-center flex-wrap pt-1">
            {stage === 'unknown' && hash && (
              <Button size="sm" disabled={busy} onClick={checkAgain}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : null}
                {s('Check again')}
              </Button>
            )}
            {stage === 'unknown' && !hash && (
              /* No hash: wallet call errored before broadcast — safe to dismiss.
                 The user should check Activity; we must NOT auto-retry. */
              <p className="text-[11.5px] text-amber-200/70 text-center">
                {lang === 'vi'
                  ? 'Không có hash giao dịch. Kiểm tra Activity trước khi thử lại.'
                  : 'No transaction hash. Check Activity before retrying.'}
              </p>
            )}
            {(stage === 'confirmed' || stage === 'failed' || stage === 'rejected' || stage === 'unknown') && (
              <Button size="sm" variant={stage === 'confirmed' ? 'primary' : 'secondary'} onClick={() => {
                if (stage === 'confirmed') onDone('confirmed')
                else if (stage === 'failed') onDone('failed')
                else if (stage === 'rejected') onDone('rejected')
                else onDone('unknown')
              }}>{s('Done')}</Button>
            )}
          </div>
        </div>
      )}

      {/* Requesting / submitted */}
      {(stage === 'requesting' || stage === 'submitted' || stage === 'pending') && (
        <div className="p-4 text-center space-y-3">
          <div className="mx-auto w-12 h-12 rounded-full flex items-center justify-center bg-white/[0.05]">
            <Loader2 size={24} className="text-neon-300 animate-spin" />
          </div>
          <div className="font-semibold">{statusLabel[sendStatus]}</div>
          <p className={`text-[12px] ${T.mute}`}>{amount} {symbol} → {short(recipient)}</p>
          {hash && (
            <a href={explorerTx(hash)} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-neon-300 text-[12px] break-all">
              {short(hash)} <ExternalLink size={11} />
            </a>
          )}
        </div>
      )}

      {/* Preparing */}
      {stage === 'preparing' && (
        <div className="p-4 flex items-center gap-2 text-[13px]">
          <Loader2 size={15} className="animate-spin text-neon-300 shrink-0" />
          <span className={T.mute}>{s('Preparing live review…')}</span>
        </div>
      )}

      {/* Review */}
      {stage === 'review' && (
        <div className="p-4 space-y-3">
          {/* Amount display */}
          <div className="text-center py-2">
            <div className="text-[28px] font-bold font-num tracking-tight">{amount} {symbol}</div>
            {holding?.price != null && (
              <div className={`text-[13px] ${T.mute}`}>
                ≈ ${(Number(amount) * holding.price).toFixed(2)}
              </div>
            )}
          </div>
          {/* Details */}
          <dl className="rounded-xl border border-white/[0.07] divide-y divide-white/[0.05] text-[13px]">
            <div className="flex justify-between gap-3 px-3.5 py-2.5">
              <dt className={T.mute}>{s('Recipient')}</dt>
              <dd className="font-mono text-[12px] text-right break-all max-w-[200px]">{recipient}</dd>
            </div>
            <div className="flex justify-between gap-3 px-3.5 py-2.5">
              <dt className={T.mute}>{s('Asset')}</dt>
              <dd>{meta.name} ({symbol})</dd>
            </div>
            <div className="flex justify-between gap-3 px-3.5 py-2.5">
              <dt className={T.mute}>{s('Network')}</dt>
              <dd>{ARC.name}</dd>
            </div>
            <div className="flex justify-between gap-3 px-3.5 py-2.5">
              <dt className={T.mute}>{s('Maximum fee')}</dt>
              <dd className="font-num">{feeLabel}</dd>
            </div>
            <div className="flex justify-between gap-3 px-3.5 py-2.5 font-semibold">
              <dt>{s('Total')}</dt>
              <dd className="font-num text-right break-words min-w-0">{totalLabel}</dd>
            </div>
          </dl>
          {error && (
            <div className="rounded-lg border border-rose-400/20 bg-rose-500/[0.06] px-3 py-2 text-rose-300 text-[12px] break-words">
              {error}
            </div>
          )}
          {!prepared && !error && (
            <p className={`text-[12px] ${T.mute} text-center`}>{s('Preparing live review…')}</p>
          )}
          {prepared && (
            <p className={`text-[11.5px] ${T.mute} text-center`}>
              {lang === 'vi'
                ? 'Chỉ gửi giao dịch khi bạn bấm nút xác nhận trong ví bên dưới.'
                : 'The transaction is only submitted when you confirm it in your wallet below.'}
            </p>
          )}
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="primary"
              className="flex-1 min-w-[160px]"
              disabled={!prepared || busy}
              onClick={confirmSend}
            >
              {busy
                ? <><Loader2 size={13} className="animate-spin" /> {s('Revalidating…')}</>
                : s('Confirm in wallet')}
            </Button>
            <Button disabled={busy} onClick={onCancel}>{s('Cancel')}</Button>
          </div>
        </div>
      )}
    </div>
  )
}
