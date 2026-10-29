/**
 * AgentSendCard — Send execution embedded in the Agent chat.
 *
 * Safety invariants (never relax when integrating):
 * - eth_sendTransaction is called ONLY when the user clicks "Confirm in wallet".
 * - prepareSend re-reads live chain state immediately before the wallet request.
 * - assertFreshSend verifies the review has not changed or expired (60-second window).
 * - SendSubmissionGuard prevents a double-click from opening a second wallet request.
 * - A pending-intent checkpoint is written to sessionStorage BEFORE the wallet request.
 *   If writing fails the wallet request is aborted — we never sign without an audit trail.
 * - The checkpoint is cleared only on USER_REJECTED (definitive non-broadcast), confirmed,
 *   or failed receipt. On UNKNOWN (with or without hash) the checkpoint stays so a
 *   remounted card blocks a second request until the user explicitly resolves it.
 * - The transaction hash (when obtained) is persisted to Activity BEFORE receipt polling.
 * - Pending/unknown never trigger an automatic re-submit.
 * - Account/chain changes only invalidate a pre-request review (preparing/review).
 *   Once a wallet request is in-flight (requesting/submitted/pending/unknown) the
 *   card preserves hash and recovery state; it never silently resets to preparing.
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
import {
  readIntent, writeIntent, clearIntent, intentMatches,
  type IntentCheckpoint,
} from '../lib/sendIntentCheckpoint'
import { Button, T } from './wallet/ui'
import { SuccessBurst } from './wallet/SuccessBurst'
import { useT } from '../lib/i18n'
import { translate } from '../lib/i18n'

export type AgentSendParams = {
  account: string
  symbol: string
  amount: string
  recipient: string
}

export type AgentSendStage = 'preparing' | 'review' | 'requesting' | 'submitted' | 'pending' | 'confirmed' | 'failed' | 'rejected' | 'unknown'
type Stage = AgentSendStage

/** Stages in which a wallet request has been initiated or is in-flight.
 *  Account/chain changes must NOT reset these stages — the checkpoint and
 *  any obtained hash must be preserved for recovery. */
const IN_FLIGHT_STAGES: Stage[] = ['requesting', 'submitted', 'pending', 'unknown']
/** All stages that must not allow a new wallet request (includes terminal states). */
const BLOCKED_STAGES: Stage[] = ['confirmed', 'failed', 'rejected', 'unknown', 'submitted', 'pending', 'requesting']

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

export function AgentSendCard({ params, onDone, onCancel, onStageChange }: {
  params: AgentSendParams
  /** Called when the user explicitly clicks Done.
   *  'confirmed'  → transaction proven on-chain; caller may show success.
   *  'failed'     → transaction on-chain but reverted.
   *  'rejected'   → user cancelled in wallet; nothing was broadcast.
   *  'unknown'    → wallet call errored without a hash, OR hash obtained but receipt
   *                 inconclusive. Caller must NOT assume success or failure. */
  onDone: (outcome: 'confirmed' | 'failed' | 'rejected' | 'unknown') => void
  onCancel: () => void
  /** Read-only execution progress; parent must never equate UNKNOWN/FAILED with completion. */
  onStageChange?: (stage: AgentSendStage) => void
}) {
  const { mode, address, walletChainId, upsertSend, refetchWallet, holdings } = useWallet()
  const [, lang] = useT()
  const s = useCallback((v: string) => sv(v, lang), [lang])

  // stageRef MUST be declared before setStage so the closure captures a live ref, never undefined.
  const stageRef = useRef<Stage>('preparing')
  const [stage, setStageRaw] = useState<Stage>('preparing')
  const setStage = (s: Stage) => {
    stageRef.current = s
    setStageRaw(s)
    onStageChange?.(s)
  }
  const [prepared, setPrepared] = useState<PreparedSend | null>(null)
  const [error, setError] = useState('')
  const [hash, setHash] = useState<string | null>(null)
  const [sendStatus, setSendStatus] = useState<SendStatus>('READY')
  const [busy, setBusy] = useState(false)

  const guard = useRef(new SendSubmissionGuard())
  const reviewGen = useRef(0)
  const mounted = useRef(true)
  // Track account+chain used when review was prepared — any change invalidates pre-request review.
  const reviewedAccount = useRef('')
  const reviewedChain = useRef<number | undefined>(undefined)
  // Increments when account/chain changes during pre-request stages.
  const [prepareKey, setPrepareKey] = useState(0)

  // sessionStorage reference — null when unavailable (SSR / private browsing / quota).
  const storage = useRef<Storage | null>(null)
  useEffect(() => {
    try { storage.current = typeof sessionStorage !== 'undefined' ? sessionStorage : null }
    catch { storage.current = null }
  }, [])

  const { symbol, amount, recipient, account } = params
  const meta = TOKENS.find((t) => t.sym === symbol)
  const holding = holdings.find((h) => h.verified && h.symbol === symbol)

  // Invalidate pre-request review when account/chain changes after a successful prepare.
  // CRITICAL: in-flight stages (requesting/submitted/pending/unknown) must NOT be reset —
  // they hold the hash and recovery state. Only pre-request stages are safe to invalidate.
  // Note: when prepare failed (prepared === null), walletChainId is already in the prepare
  // effect's deps, so a chain change back to Arc Testnet automatically triggers a re-prepare
  // without needing this invalidation effect.
  useEffect(() => {
    if (!prepared) return
    // Do not invalidate while a wallet request is in-flight or has reached an uncertain state.
    if (IN_FLIGHT_STAGES.includes(stageRef.current)) return
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
  // prepareKey increments when account/chain changes during pre-request stages so the
  // effect re-runs with the new wallet state instead of staying stuck at 'preparing'.
  // walletChainId is included so a chain change (including returning to Arc Testnet after
  // an error) automatically triggers a fresh prepare even when prepared === null.
  useEffect(() => {
    if (mode !== 'connected') return
    if (!isAddress(recipient) || !amount || !symbol) return
    // Do not reset to preparing while a wallet request is in-flight, or after terminal states.
    // walletChainId is in deps to auto-retry after chain changes, but we must not disturb
    // in-flight or terminal stages when walletChainId changes.
    if (IN_FLIGHT_STAGES.includes(stageRef.current)) return
    if (['confirmed', 'failed', 'rejected'].includes(stageRef.current)) return
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
  // prepareKey increments on account/chain change so the effect re-runs after a wallet switch.
  // walletChainId is included so a return to Arc Testnet auto-retries after a wrong-chain error.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, symbol, amount, recipient, mode, prepareKey, walletChainId])

  const confirmSend = async () => {
    if (BLOCKED_STAGES.includes(stageRef.current)) return
    if (!prepared || busy) return

    // Check for an unresolved intent checkpoint from a previous attempt (same intent, same wallet).
    // Each intent has its own slot in the keyed map — a different intent (B) cannot overwrite this
    // slot (A), so a UNKNOWN checkpoint from A is always found exactly when A's card re-confirms.
    const intentParams = { account, chainId: ARC.chainId, recipient, symbol, amount }
    const existingIntent = readIntent(storage.current, intentParams)
    if (intentMatches(existingIntent, intentParams)) {
      setError(lang === 'vi'
        ? 'Giao dịch trước đó chưa rõ kết quả. Kiểm tra lịch sử giao dịch trong ví hoặc block explorer trước khi thử lại.'
        : 'A previous attempt for this transfer is unresolved. Check your wallet\'s transaction history or a block explorer before retrying.')
      return
    }

    try {
      await guard.current.run(async () => {
        const p = getProvider()
        if (!p) throw new Error('Wallet disconnected')
        setBusy(true)
        setError('')
        try {
          // Revalidate immediately before wallet request — live chain state.
          const fresh = await prepareSend(p, { account, recipient, symbol, amount })
          assertFreshSend(prepared, fresh)
          if (fresh.account.toLowerCase() !== account.toLowerCase()) throw new Error('Connected account changed')
          if (fresh.chainId !== ARC.chainId) throw new Error('Wrong network: Arc Testnet is required')

          // Write intent checkpoint BEFORE opening the wallet. If this fails, abort.
          // The checkpoint lets us detect an unresolved previous attempt on remount.
          // writeIntent throws if an unresolved checkpoint for the same intent already
          // exists (race between early check and guard entry) — treat it like the early check.
          const checkpoint: IntentCheckpoint = {
            account: fresh.account, chainId: fresh.chainId,
            recipient: fresh.recipient, symbol, amount,
            savedAt: Date.now(),
          }
          try { writeIntent(storage.current, checkpoint) }
          catch (writeErr) {
            const msg = writeErr instanceof Error ? writeErr.message : ''
            if (msg.includes('Unresolved intent')) {
              setError(lang === 'vi'
                ? 'Giao dịch trước đó chưa rõ kết quả. Kiểm tra lịch sử giao dịch trong ví hoặc block explorer trước khi thử lại.'
                : 'A previous attempt for this transfer is unresolved. Check your wallet\'s transaction history or a block explorer before retrying.')
              throw writeErr // propagate to abort the guard's run without entering 'requesting'
            }
            throw writeErr // storage quota / unavailable — propagate as-is
          }

          setSendStatus('REQUESTING_WALLET')
          setStage('requesting')
          let txHash: string
          try {
            txHash = await requestSend(p, prepared)
          } catch (e) {
            if (isWalletRejection(e)) {
              // Definitive non-broadcast: safe to clear the checkpoint for this specific intent.
              clearIntent(storage.current, intentParams)
              setSendStatus('USER_REJECTED')
              setStage('rejected')
              return
            }
            // Wallet errored without returning a hash (timeout, popup closed, etc.).
            // Leave the checkpoint in place — we cannot prove the tx was NOT broadcast.
            setSendStatus('UNKNOWN')
            setStage('unknown')
            throw e
          }

          // Hash obtained — persist to Activity BEFORE polling.
          // Checkpoint remains until receipt is finalized.
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

          // Finalize — clear checkpoint only on definitive outcomes.
          if (outcome === 'confirmed' || outcome === 'failed') clearIntent(storage.current, intentParams)
          // 'unknown' receipt: leave checkpoint so a future remount detects the ambiguity.

          const finalStatus = outcome === 'confirmed' ? 'CONFIRMED' : outcome === 'failed' ? 'FAILED' : 'UNKNOWN'
          setSendStatus(finalStatus)
          setStage(outcome === 'confirmed' ? 'confirmed' : outcome === 'failed' ? 'failed' : 'unknown')
          upsertSend({ ...record, status: outcome === 'confirmed' ? 'completed' : outcome === 'failed' ? 'failed' : 'unknown' })
          if (outcome === 'confirmed') await refetchWallet()
        } catch (e) {
          if (!mounted.current) return
          setError(s(e instanceof Error ? e.message : 'Wallet request failed'))
          // Use stageRef (not the closed-over 'stage') to read the live current stage.
          // Only reset to review if we errored before broadcast (still in 'requesting').
          if (stageRef.current === 'requesting') {
            // We errored before the wallet call — checkpoint was written but wallet never saw the tx.
            // Clear the checkpoint (nothing was broadcast from 'requesting' pre-wallet-call errors).
            clearIntent(storage.current, intentParams)
            setStage('review')
          }
          // 'unknown' stage errors: checkpoint stays — we cannot prove non-broadcast.
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
      if (result === 'confirmed' || result === 'failed') {
        clearIntent(storage.current, { account: prepared.account, chainId: prepared.chainId, recipient: prepared.recipient, symbol, amount })
      }
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
          {stage === 'confirmed' && <SuccessBurst size={48} label={statusLabel[sendStatus]} />}
          <div className={`mx-auto w-12 h-12 rounded-full items-center justify-center bg-white/[0.05] ${stage === 'confirmed' ? 'hidden' : 'flex'}`}>
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
              /* No hash: wallet call errored before broadcast — we cannot prove a tx was sent.
                 Direct user to their wallet's history or a block explorer — NOT Activity,
                 since upsertSend was never called (no hash = no Activity record). */
              <p className="text-[11.5px] text-amber-200/70 text-center">
                {lang === 'vi'
                  ? 'Không có hash giao dịch. Kiểm tra lịch sử giao dịch trong ví hoặc block explorer trước khi thử lại.'
                  : 'No transaction hash. Check your wallet\'s transaction history or a block explorer before retrying.'}
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
