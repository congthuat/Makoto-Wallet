import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { formatUnits, type Hex } from 'viem'
import { useT } from '../lib/i18n.ts'
import { ARC, explorerTx, getProvider } from '../lib/wallet.ts'
import { SendSubmissionGuard } from '../lib/sendExecution.ts'
import { isWalletRejection, pollProtocolReceipt, requestReviewedAction } from '../migrated/protocolExecution.ts'
import { createReview, evaluateToolPolicy, revalidateReview, verifyFiniteApproval, type ReviewSnapshot } from '../migrated/policy.ts'
import { prepareApproval, prepareSwap, quoteSwap, readAllowance, readBalance, readWallet, type PreparedToolAction, type SwapToolQuote } from '../migrated/toolLayer.ts'
import { XYLO_ROUTER } from '../migrated/swap.ts'
import { Button, T } from './wallet/ui.tsx'
import { useWallet } from '../lib/store.tsx'
import type { SwapRecord } from '../lib/protocolActivity.ts'
import { hasSavedProtocolCompletion } from '../lib/protocolActivity.ts'
import { createStrategyRun, recoverStrategyRun, restoreStrategyRun, saveStrategyRun, transitionStrategy, type StrategyEvent, type StrategyRun } from '../migrated/strategyController.ts'

type Stage = 'idle' | 'review-approval' | 'review-swap' | 'pending' | 'approval-confirmed' | 'confirmed' | 'failed' | 'rejected' | 'unknown'
type Operation = { generation: number; account: string; chainId?: number; input?: string; run?: StrategyRun; saved: string | null | undefined }
type Props = { account: string; from: string; to: string; amount: string; slip: '0.5%' | '1%' | '3%'; onConfirmed: () => Promise<unknown>; onComplete: () => void }

export function LiveSwapControl({ account, from, to, amount, slip, onConfirmed, onComplete }: Props) {
  const { upsertSwap, swapRecords, walletChainId } = useWallet()
  const [tr, lang] = useT()
  const vi = lang === 'vi'
  const say = (en: string, vn: string) => vi ? vn : en
  const [stage, setStage] = useState<Stage>('idle')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [errorFallback, setErrorFallback] = useState('Review unavailable.')
  const [activityUnavailable, setActivityUnavailable] = useState(false)
  const [checkpointUnavailable, setCheckpointUnavailable] = useState(false)
  const [quote, setQuote] = useState<SwapToolQuote>()
  const [prepared, setPrepared] = useState<PreparedToolAction>()
  const [review, setReview] = useState<ReviewSnapshot>()
  const [hash, setHash] = useState<Hex>()
  const [reviewedInput, setReviewedInput] = useState('')
  const guard = useRef(new SendSubmissionGuard())
  const run = useRef<StrategyRun | undefined>(undefined)
  const mounted = useRef(false)
  const generation = useRef(0)
  const operation = useRef<Operation | undefined>(undefined)
  const checkpoint = useRef<string | null | undefined>(undefined)
  const normalizedAccount = account.toLowerCase()
  const input = `${normalizedAccount}:${from}:${to}:${amount}:${slip}`
  const context = useRef({ account: normalizedAccount, chainId: walletChainId, input })
  context.current = { account: normalizedAccount, chainId: walletChainId, input }
  const resumeApproval = useRef<() => void>(() => {})
  const needsResume = useRef(false)
  const savedCheckpoint = (owner: string) => {
    try { return typeof localStorage === 'undefined' ? undefined : localStorage.getItem(`mk.strategy.v1:swap:${owner}`) }
    catch { return undefined }
  }
  const sameLifecycle = (op: Operation) => mounted.current && generation.current === op.generation && context.current.account === op.account && context.current.chainId === op.chainId
  const isCurrent = (op: Operation) => sameLifecycle(op) && operation.current === op && (!op.input || context.current.input === op.input)
    && run.current === op.run && savedCheckpoint(op.account) === op.saved
  const requireCurrent = (op: Operation) => { if (!isCurrent(op)) throw new Error('Swap details changed. Review again.') }
  const begin = (reviewInput: boolean): Operation | undefined => {
    if (!mounted.current || operation.current) return undefined
    // undefined means the checkpoint could not be read; null is a verified
    // absence. Never replace an unreadable, possibly submitted request.
    if (checkpoint.current === undefined || savedCheckpoint(normalizedAccount) === undefined) {
      setError('Saved swap strategy state is unavailable.'); return undefined
    }
    const op: Operation = { generation: generation.current, account: normalizedAccount, chainId: walletChainId, input: reviewInput ? input : undefined, run: run.current, saved: checkpoint.current }
    operation.current = op
    if (!isCurrent(op)) { operation.current = undefined; return undefined }
    setBusy(true); setError('')
    return op
  }
  const finish = (op: Operation) => {
    if (operation.current !== op) return
    operation.current = undefined
    if (sameLifecycle(op)) setBusy(false)
  }
  const rememberRun = (next: StrategyRun, op: Operation) => {
    requireCurrent(op)
    if (typeof localStorage !== 'undefined' && !saveStrategyRun(localStorage, next)) throw new Error('Saved swap strategy state is unavailable.')
    if (typeof localStorage !== 'undefined' && savedCheckpoint(next.account) !== JSON.stringify(next)) throw new Error('Swap details changed. Review again.')
    run.current = next; op.run = next
    checkpoint.current = savedCheckpoint(next.account); op.saved = checkpoint.current
    setCheckpointUnavailable(false)
  }
  const advance = (event: StrategyEvent, op: Operation) => {
    requireCurrent(op)
    const result = transitionStrategy(op.run ?? createStrategyRun('swap', op.account, event.now), event)
    if (!result.accepted) throw new Error(result.reason)
    rememberRun(result.state, op)
    return result.state
  }
  // A wallet can return after account/input changes. Keep its real outcome under
  // the original account, without replacing a newer checkpoint or updating stale UI.
  const rememberWalletOutcome = (event: StrategyEvent, op: Operation) => {
    if (!op.run) return
    const saved = savedCheckpoint(op.account)
    if (saved !== op.saved) {
      // A failed read is not evidence of a newer checkpoint. Retain only the
      // returned hash in this request's mounted context; never write through an
      // unverified checkpoint or continue receipt work until reads recover.
      if (saved === undefined && typeof op.saved === 'string' && event.type === 'hash'
        && sameLifecycle(op) && operation.current === op && run.current === op.run) {
        const next = transitionStrategy(op.run, event)
        if (next.accepted) {
          run.current = next.state; op.run = next.state
          setHash(event.hash as Hex); setStage('unknown'); setCheckpointUnavailable(true)
        }
      }
      return
    }
    const next = transitionStrategy(op.run, event)
    if (!next.accepted) return
    if (isCurrent(op)) {
      try { rememberRun(next.state, op) }
      catch (caught) {
        if (event.type !== 'hash' || !isCurrent(op)) throw caught
        // A returned hash is real evidence even when persistence is unavailable.
        // Keep it in memory against the unchanged checkpoint and block resubmission.
        run.current = next.state; op.run = next.state
        setCheckpointUnavailable(true)
      }
      return
    }
    const serialized = JSON.stringify(next.state)
    if (typeof localStorage !== 'undefined' && saveStrategyRun(localStorage, next.state) && savedCheckpoint(op.account) === serialized) {
      op.run = next.state; op.saved = serialized
    }
  }
  useLayoutEffect(() => {
    mounted.current = true; generation.current += 1; operation.current = undefined
    // Reset resume flag before any localStorage read so a chain change cannot
    // auto-resume a prior session without explicit user action.
    needsResume.current = false
    let restored: StrategyRun | undefined
    try { restored = typeof localStorage === 'undefined' ? undefined : restoreStrategyRun(localStorage, 'swap', normalizedAccount) }
    catch { /* A blocked localStorage property must not crash receipt recovery UI. */ }
    run.current = restored; checkpoint.current = savedCheckpoint(normalizedAccount)
    // Only resume if the restored run's chainId matches the current wallet chain.
    needsResume.current = !!(restored && walletChainId === ARC.chainId && (restored.phase === 'REVALIDATING' || (restored.phase === 'EXPIRED' && !!restored.approvalReceipt)))
    setBusy(false); setError(checkpoint.current === undefined ? 'Saved swap strategy state is unavailable.' : ''); setActivityUnavailable(false); setCheckpointUnavailable(false); setQuote(undefined); setPrepared(undefined); setReview(undefined); setReviewedInput('')
    setHash(restored?.hash as Hex | undefined)
    setStage(restored?.phase === 'COMPLETED' ? 'confirmed' : needsResume.current ? 'approval-confirmed' : restored?.phase === 'FAILED' ? 'failed' : restored?.phase === 'USER_REJECTED' ? 'rejected' : restored && ['RECOVERING', 'PENDING', 'UNKNOWN'].includes(restored.phase) ? restored.phase === 'PENDING' ? 'pending' : 'unknown' : 'idle')
    return () => { mounted.current = false; generation.current += 1; operation.current = undefined }
  }, [normalizedAccount, walletChainId])
  useLayoutEffect(() => {
    if (operation.current?.input && operation.current.input !== input) {
      needsResume.current = false
      generation.current += 1; operation.current = undefined; setBusy(false)
    }
    setQuote(undefined); setPrepared(undefined); setReview(undefined); setReviewedInput('')
    setStage((current) => current === 'review-approval' || current === 'review-swap' || current === 'approval-confirmed' ? 'idle' : current)
  }, [input])
  useEffect(() => { resumeApproval.current() }, [input, walletChainId])
  const slipValue = slip === '0.5%' ? 0.005 : slip === '1%' ? 0.01 : 0.03
  const recordFor = (submitted: Hex, action: PreparedToolAction, reviewedQuote: SwapToolQuote, status: SwapRecord['status']): SwapRecord => ({ hash: submitted, account: action.account, target: action.request.to, calldata: action.request.data, fromSymbol: from as 'USDC' | 'EURC', toSymbol: to as 'USDC' | 'EURC', amount, minimumOutputUnits: reviewedQuote.minimumReceive.toString(), timestamp: Date.now(), status })
  const recordActivity = (record: SwapRecord, op?: Operation) => {
    // Activity is a secondary projection; it must never interrupt receipt recovery.
    try { upsertSwap(record); if (!op || isCurrent(op)) setActivityUnavailable(false); return true }
    catch { if (!op || isCurrent(op)) setActivityUnavailable(true); return false }
  }

  async function walletContext(p: NonNullable<ReturnType<typeof getProvider>>) {
    const wallet = await readWallet(p)
    if (wallet.status !== 'OK' || !wallet.data || wallet.data.chainId !== ARC.chainId || wallet.data.account.toLowerCase() !== normalizedAccount) throw new Error('Wallet account or chain changed. Review again.')
    return wallet.data
  }
  async function simulate(action: PreparedToolAction) {
    const p = getProvider()
    if (!p) return false
    try { await p.request({ method: 'eth_call', params: [action.request, 'latest'] }); return true }
    catch { return false }
  }
  async function refreshAfterReceipt(op: Operation) {
    // Portfolio refresh is not transaction evidence. Its failure cannot prevent
    // the independently verified allowance, quote and simulation reads below.
    try { await onConfirmed() } catch { /* Wallet data reports its own availability. */ }
    requireCurrent(op)
  }

  /** Read-only continuation. Only confirm() below can request a wallet transaction. */
  async function prepareReview(op: Operation) {
    requireCurrent(op)
    setErrorFallback('Review unavailable.'); setReview(undefined); setPrepared(undefined)
    setStage(op.run?.phase === 'REVALIDATING' ? 'approval-confirmed' : 'idle')
    if ((from !== 'USDC' && from !== 'EURC') || (to !== 'USDC' && to !== 'EURC') || from === to) throw new Error('Live Xylo swap supports USDC and EURC only.')
    const p = getProvider(); if (!p) throw new Error('Wallet unavailable.')
    await walletContext(p); requireCurrent(op)
    // quoteSwap re-reads verified allowance and balances; never reuse the pre-approval quote.
    const result = await quoteSwap(p, { account, from, to, amount, slippage: slipValue })
    requireCurrent(op)
    if (result.status !== 'OK' || !result.data) throw new Error(result.reason ?? 'Live quote unavailable.')
    const fresh = result.data
    if (op.run?.phase === 'REVALIDATING') advance({ type: 'allowance-reread', sufficient: fresh.allowance >= fresh.quote.amountIn, account, chainId: ARC.chainId, now: Date.now() }, op)
    if (op.run?.phase === 'BLOCKED') throw new Error('Approval receipt did not establish sufficient allowance')
    setQuote(fresh); setReviewedInput(input)
    if (fresh.allowance < fresh.quote.amountIn) {
      const approval = await prepareApproval(p, { account, symbol: from, spender: XYLO_ROUTER, amount: fresh.quote.amountIn })
      requireCurrent(op)
      if (!verifyFiniteApproval(approval, { symbol: from, spender: XYLO_ROUTER, amount: fresh.quote.amountIn })) throw new Error('Approval request mismatch')
      const simulated = await simulate(approval); requireCurrent(op)
      if (!simulated) throw new Error('Finite approval simulation failed.')
      await walletContext(p); requireCurrent(op)
      advance({ type: 'review', step: 'approval', account, chainId: ARC.chainId, input: { kind: 'swap', amount, from, to, slip }, expiresAt: Math.min(approval.expiresAt, fresh.expiresAt), quoteFresh: true, policyPassed: true, simulationPassed: true, now: Date.now() }, op)
      setPrepared(approval); setStage('review-approval')
      return
    }
    const action = await prepareSwap(p, fresh); requireCurrent(op)
    const simulation = await simulate(action) ? 'passed' : 'reverted'; requireCurrent(op)
    const policy = evaluateToolPolicy({ action, quote: fresh, account, chainId: ARC.chainId, simulation, now: Date.now(), balance: fresh.balance, allowance: fresh.allowance })
    if (policy.mustStop) throw new Error(policy.findings.map((finding) => finding.code).join(', '))
    await walletContext(p); requireCurrent(op)
    advance({ type: 'review', step: 'swap', account, chainId: ARC.chainId, input: { kind: 'swap', amount, from, to, slip }, expiresAt: Math.min(action.expiresAt, fresh.expiresAt), quoteFresh: true, policyPassed: true, simulationPassed: simulation === 'passed', now: Date.now() }, op)
    setHash(undefined); setPrepared(action); setReview(createReview(action, fresh, policy)); setStage('review-swap')
  }

  async function start() {
    if (busy || operation.current) return
    if (run.current && ['RECOVERING', 'PENDING', 'UNKNOWN', 'SUBMITTED', 'AWAITING_USER'].includes(run.current.phase)) { setError('Resolve the previous wallet request before starting another swap.'); return }
    const op = begin(true); if (!op) return
    needsResume.current = false
    try {
      if (!op.run || !['REVALIDATING', 'REQUOTING'].includes(op.run.phase)) {
        const approvalReceipt = op.run?.approvalReceipt
        const resume = op.run?.phase === 'EXPIRED' && approvalReceipt
        rememberRun(Object.freeze({ ...createStrategyRun('swap', account), ...(approvalReceipt ? { approvalReceipt } : {}), ...(resume ? { phase: 'REVALIDATING' as const, step: 'approval' as const, hash: approvalReceipt.hash, binding: approvalReceipt.binding, input: op.run?.input } : {}) }), op)
      }
      await prepareReview(op)
    } catch (caught) { if (isCurrent(op)) setError(caught instanceof Error ? caught.message : 'Review unavailable.') }
    finally { finish(op) }
  }
  resumeApproval.current = () => {
    if (needsResume.current && amount && (run.current?.phase === 'REVALIDATING' || run.current?.phase === 'EXPIRED' && run.current.approvalReceipt) && walletChainId === ARC.chainId && !operation.current) void start()
  }

  async function confirm() {
    if (busy || !prepared || !quote || (stage !== 'review-approval' && stage !== 'review-swap')) return
    const op = begin(true); if (!op) return
    const approving = stage === 'review-approval'
    setErrorFallback('Wallet request failed.')
    try {
      if (reviewedInput !== input) throw new Error('Swap details changed. Review again.')
      const p = getProvider(); if (!p) throw new Error('Wallet unavailable.')
      await walletContext(p); requireCurrent(op)
      if (prepared.account.toLowerCase() !== normalizedAccount) throw new Error('Wallet account or chain changed. Review again.')
      if (Date.now() > prepared.expiresAt || Date.now() > quote.expiresAt) throw new Error('Quote expired. Review again.')
      const latestPrice = await p.request({ method: 'eth_gasPrice' }); requireCurrent(op)
      if (typeof latestPrice !== 'string' || BigInt(latestPrice) > BigInt(prepared.request.gasPrice)) throw new Error('Network fee changed. Review again.')
      const freshBalance = await readBalance(p, from, account); requireCurrent(op)
      const freshAllowance = await readAllowance(p, from, XYLO_ROUTER, account); requireCurrent(op)
      if (freshBalance.status !== 'OK' || !freshBalance.data || freshBalance.data.units < quote.quote.amountIn || freshAllowance.status !== 'OK' || !freshAllowance.data) throw new Error('Balance or allowance changed. Review again.')
      if (approving) {
        if (!verifyFiniteApproval(prepared, { symbol: from as 'USDC' | 'EURC', spender: XYLO_ROUTER, amount: quote.quote.amountIn })) throw new Error('Approval request changed')
        if (freshAllowance.data.units >= quote.quote.amountIn) throw new Error('Approval is already sufficient. Refresh the swap review.')
        const simulated = await simulate(prepared); requireCurrent(op)
        if (!simulated) throw new Error('Approval simulation failed.')
      } else {
        if (!review) throw new Error('Review unavailable.')
        const freshQuote = await quoteSwap(p, { account, from: from as 'USDC' | 'EURC', to: to as 'USDC' | 'EURC', amount, slippage: slipValue }); requireCurrent(op)
        if (freshQuote.status !== 'OK' || !freshQuote.data) throw new Error('Fresh quote unavailable.')
        const simulation = await simulate(prepared) ? 'passed' : 'reverted'; requireCurrent(op)
        const validated = revalidateReview(review, { action: prepared, quote: freshQuote.data, account, chainId: ARC.chainId, simulation, now: Date.now(), balance: freshBalance.data.units, allowance: freshAllowance.data.units })
        if (validated.status !== 'OK') throw new Error(validated.reason ?? 'Review changed.')
      }
      await walletContext(p); requireCurrent(op)
      if (Date.now() > prepared.expiresAt || Date.now() > quote.expiresAt) throw new Error('Quote expired. Review again.')
      advance({ type: 'wallet-request', binding: { from: prepared.account, to: prepared.request.to, data: prepared.request.data, symbol: from as 'USDC' | 'EURC', amount, ...(approving ? { spender: XYLO_ROUTER, requiredUnits: quote.quote.amountIn.toString() } : { outputSymbol: to as 'USDC' | 'EURC', minimumOutputUnits: quote.minimumReceive.toString() }) }, now: Date.now() }, op)
      setHash(undefined)
      // Once the wallet request begins, input edits cannot erase its receipt
      // evidence. They still prevent preparing a dependent review for old inputs.
      op.input = undefined
      setStage('pending')
      let submitted: Hex
      try { submitted = await requestReviewedAction(p, prepared, guard.current) }
      catch (caught) {
        rememberWalletOutcome({ type: isWalletRejection(caught) ? 'user-rejected' : 'unknown', now: Date.now() }, op)
        if (!isCurrent(op)) return
        setStage(isWalletRejection(caught) ? 'rejected' : 'unknown')
        if (!isWalletRejection(caught)) throw caught
        return
      }
      rememberWalletOutcome({ type: 'hash', hash: submitted, now: Date.now() }, op)
      if (isCurrent(op)) setHash(submitted)
      if (!approving) recordActivity(recordFor(submitted, prepared, quote, 'pending'), op)
      if (!isCurrent(op)) return
      const outcome = await pollProtocolReceipt(p, prepared, submitted, approving ? { approval: { symbol: from as 'USDC' | 'EURC', spender: XYLO_ROUTER, minimum: quote.quote.amountIn } } : { swapQuote: quote }, () => { if (isCurrent(op) && op.run?.phase === 'SUBMITTED') advance({ type: 'pending', now: Date.now() }, op) })
      if (!isCurrent(op)) return
      advance({ type: outcome === 'confirmed' ? 'confirmed' : outcome === 'failed' ? 'failed' : 'unknown', now: Date.now() }, op)
      if (!approving) recordActivity(recordFor(submitted, prepared, quote, outcome === 'confirmed' ? 'completed' : outcome), op)
      if (outcome !== 'confirmed') { setStage(outcome); return }
      setStage(approving ? 'approval-confirmed' : 'confirmed')
      await refreshAfterReceipt(op)
      if (approving && context.current.input === input) { op.input = input; await prepareReview(op) }
    } catch (caught) {
      if (!isCurrent(op)) return
      setError(caught instanceof Error ? caught.message : 'Wallet request failed.')
      if (op.run?.phase === 'REVALIDATING' || op.run?.phase === 'REQUOTING' || op.run?.phase === 'BLOCKED') setStage('approval-confirmed')
      else if (op.run?.phase === 'REVIEW_APPROVAL' || op.run?.phase === 'REVIEW_ACTION') { setStage('idle'); setPrepared(undefined); setReview(undefined) }
      else if (op.run?.phase !== 'COMPLETED' && op.run?.phase !== 'USER_REJECTED') setStage('unknown')
    } finally { finish(op) }
  }

  async function checkAgain() {
    if (!hash || busy) return
    const op = begin(false); if (!op) return
    if (!op.run) { finish(op); return }
    const p = getProvider(); if (!p) { finish(op); return }
    setErrorFallback('Status unavailable. Check again later.')
    try {
      await walletContext(p); requireCurrent(op)
      const recovered = await recoverStrategyRun(p, op.run); requireCurrent(op)
      rememberRun(recovered, op)
      setHash(recovered.hash as Hex | undefined)
      setStage(recovered.phase === 'COMPLETED' ? 'confirmed' : recovered.phase === 'REVALIDATING' ? 'approval-confirmed' : recovered.phase === 'FAILED' ? 'failed' : recovered.phase === 'PENDING' ? 'pending' : 'unknown')
      const binding = recovered.binding
      if (recovered.step === 'swap' && recovered.hash && binding?.symbol && binding.outputSymbol && binding.minimumOutputUnits) recordActivity({ hash: recovered.hash, account: recovered.account, target: binding.to, calldata: binding.data, fromSymbol: binding.symbol, toSymbol: binding.outputSymbol, amount: binding.amount ?? '0', minimumOutputUnits: binding.minimumOutputUnits, timestamp: recovered.updatedAt, status: recovered.phase === 'COMPLETED' ? 'completed' : recovered.phase === 'FAILED' ? 'failed' : recovered.phase === 'PENDING' ? 'pending' : 'unknown' }, op)
      if (recovered.phase === 'COMPLETED' || recovered.phase === 'REVALIDATING') {
        await refreshAfterReceipt(op)
        if (recovered.phase === 'REVALIDATING' && context.current.input === input && amount) { op.input = input; await prepareReview(op) }
      }
    } catch (caught) {
      if (!isCurrent(op)) return
      setError(caught instanceof Error ? caught.message : 'Status unavailable. Check again later.')
      if (op.run?.phase === 'REVALIDATING' || op.run?.phase === 'REQUOTING' || op.run?.phase === 'BLOCKED') setStage('approval-confirmed')
      else if (op.run?.phase !== 'COMPLETED' && op.run?.phase !== 'FAILED') setStage('unknown')
    } finally { finish(op) }
  }

  function complete() {
    if (stage !== 'confirmed' || busy || operation.current || !mounted.current || run.current?.phase !== 'COMPLETED' || savedCheckpoint(normalizedAccount) !== checkpoint.current) return
    if (!completedActivity || typeof localStorage === 'undefined' || !hasSavedProtocolCompletion(localStorage, 'swap', normalizedAccount, hash ?? '')) {
      const saved = run.current
      const binding = saved.binding
      setActivityUnavailable(true)
      if (!saved.hash || !binding?.symbol || !binding.outputSymbol || !binding.minimumOutputUnits) return
      recordActivity({
        hash: saved.hash, account: saved.account, target: binding.to, calldata: binding.data,
        fromSymbol: binding.symbol, toSymbol: binding.outputSymbol, amount: binding.amount ?? '0',
        minimumOutputUnits: binding.minimumOutputUnits, timestamp: saved.updatedAt, status: 'completed',
      })
      // The real store persists Activity in an effect. A separate Done must
      // observe the durable record before removing the recovery checkpoint.
      setActivityUnavailable(true)
      return
    }
    const freshRun = createStrategyRun('swap', account)
    if (typeof localStorage !== 'undefined' && !saveStrategyRun(localStorage, freshRun)) { setError('Saved swap strategy state is unavailable.'); return }
    run.current = freshRun
    checkpoint.current = savedCheckpoint(normalizedAccount)
    setStage('idle'); setQuote(undefined); setPrepared(undefined); setReview(undefined); setHash(undefined)
    setError(''); setErrorFallback('Review unavailable.'); setActivityUnavailable(false); setCheckpointUnavailable(false); setReviewedInput('')
    onComplete()
  }

  const completedActivity = Array.isArray(swapRecords) && swapRecords.some((record) => typeof record?.hash === 'string' && typeof record.account === 'string' && record.hash.toLowerCase() === hash?.toLowerCase() && record.account.toLowerCase() === normalizedAccount && record.status === 'completed')
  return <div className="mt-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3.5 text-[13px] space-y-3" aria-live="polite">
    <div className="font-semibold">{say('Live XyloNet swap', 'Hoán đổi trực tiếp qua XyloNet')}</div>
    {quote && <div className={T.sub}>{say('Live output', 'Nhận dự kiến')}: {formatUnits(quote.quote.amountOut, 6)} {to} · {say('Minimum', 'Tối thiểu')}: {formatUnits(quote.minimumReceive, 6)} {to} · {say('Quote expires in 45 seconds', 'Báo giá hết hạn sau 45 giây')}</div>}
    {stage === 'review-approval' && prepared && <p>{say('Review finite approval', 'Xem lại phê duyệt hữu hạn')}: {formatUnits(quote!.quote.amountIn, 6)} {from} · XyloNet · {say('wallet confirmation required', 'cần xác nhận trong ví')}</p>}
    {stage === 'review-swap' && prepared && <p>{say('Review exact wallet request', 'Xem lại yêu cầu ví chính xác')}: {amount} {from} → {to} · {say('maximum gas', 'gas tối đa')} {BigInt(prepared.request.gas) * BigInt(prepared.request.gasPrice)} wei</p>}
    {stage === 'pending' && <p>{say('Submitted or awaiting receipt. Do not retry until the hash is checked.', 'Đã gửi hoặc đang chờ biên nhận. Đừng thử lại trước khi kiểm tra mã giao dịch.')}</p>}
    {stage === 'approval-confirmed' && <p>{busy ? say('Approval confirmed. Preparing a fresh swap review. The swap still needs your separate wallet confirmation.', 'Phê duyệt đã xác nhận. Đang chuẩn bị báo giá mới. Bạn vẫn cần xác nhận hoán đổi riêng trong ví.') : say('Approval confirmed. A fresh swap review is required before your separate wallet confirmation.', 'Phê duyệt đã xác nhận. Cần chuẩn bị báo giá mới trước khi bạn xác nhận hoán đổi riêng trong ví.')}</p>}
    {stage === 'confirmed' && <p>{say('Swap confirmed with matching output transfer evidence.', 'Giao dịch hoán đổi đã xác nhận với bằng chứng chuyển token nhận phù hợp.')}</p>}
    {stage === 'failed' && <p>{say('Transaction failed on Arc.', 'Giao dịch thất bại trên Arc.')}</p>}
    {stage === 'rejected' && <p>{say('Wallet request rejected for this step. No transaction was submitted; any earlier confirmed approval is retained.', 'Yêu cầu ví ở bước này đã bị từ chối, chưa gửi giao dịch. Bằng chứng phê duyệt đã xác nhận trước đó vẫn được giữ lại.')}</p>}
    {stage === 'unknown' && <p>{hash
      ? say('Final status unknown. Check the hash before any new attempt.', 'Chưa rõ trạng thái cuối. Kiểm tra mã giao dịch trước khi thử lại.')
      : say('The wallet did not return a transaction hash. Check your wallet history or explorer before any new attempt. Do not resubmit.', 'Ví không trả về mã giao dịch. Hãy kiểm tra lịch sử trong ví hoặc trình khám phá trước khi thử lại. Không gửi lại giao dịch.')}</p>}
    {hash && <a href={explorerTx(hash)} target="_blank" rel="noreferrer" className="text-neon-300 break-all">{hash}</a>}
    {error && <p className="text-rose-300 break-words">{vi && tr(error) === error ? tr(errorFallback) : tr(error)}</p>}
    {activityUnavailable && <p className="text-rose-300 break-words">{say('Activity could not be updated. The transaction hash remains on this page for status checks.', 'Chưa thể cập nhật Hoạt động. Mã giao dịch vẫn còn trên trang này để kiểm tra trạng thái.')}</p>}
    {checkpointUnavailable && <p className="text-rose-300 break-words">{say('Recovery could not be saved. Keep this transaction hash and check its status before leaving this page. Do not resubmit.', 'Chưa thể lưu trạng thái khôi phục. Hãy giữ mã giao dịch và kiểm tra trạng thái trước khi rời trang. Không gửi lại.')}</p>}
    {(stage === 'idle' || stage === 'approval-confirmed' || stage === 'failed' || stage === 'rejected') && (
      <>
        <Button variant="primary" disabled={busy || !amount} onClick={start}>{busy ? say('Loading…', 'Đang tải…') : stage === 'approval-confirmed' ? say('Retry fresh swap review', 'Chuẩn bị lại báo giá hoán đổi') : say('Get live quote and review', 'Lấy báo giá trực tiếp và xem lại')}</Button>
        {busy && (
          <button
            type="button"
            onClick={() => { generation.current += 1; operation.current = undefined; setBusy(false); setError(say('Cancelled. Try again when the network is available.', 'Đã hủy. Thử lại khi mạng khả dụng.')); }}
            className={`text-[12px] ${T.sub} hover:text-white underline`}
          >{say('Cancel', 'Hủy')}</button>
        )}
      </>
    )}
    {stage === 'confirmed' && <Button variant="primary" disabled={busy} onClick={complete}>{say('Done', 'Hoàn tất')}</Button>}
    {(stage === 'review-approval' || stage === 'review-swap') && <div className="flex gap-2"><Button variant="primary" disabled={busy} onClick={confirm}>{busy ? say('Checking…', 'Đang kiểm tra…') : stage === 'review-approval' ? say('Confirm approval in wallet', 'Xác nhận phê duyệt trong ví') : say('Confirm swap in wallet', 'Xác nhận hoán đổi trong ví')}</Button><Button disabled={busy} onClick={() => { setStage('idle'); setPrepared(undefined); setReview(undefined) }}>{say('Cancel', 'Hủy')}</Button></div>}
    {(stage === 'unknown' || stage === 'pending') && hash && <Button disabled={busy} onClick={checkAgain}>{say('Check receipt again', 'Kiểm tra lại biên nhận')}</Button>}
  </div>
}
