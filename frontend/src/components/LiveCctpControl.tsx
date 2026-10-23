import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { formatUnits, isHash, type Hex } from 'viem'
import { useT } from '../lib/i18n.ts'
import { useWallet } from '../lib/store.tsx'
import { api } from '../lib/api.ts'
import { ARC, explorerTx, getProvider } from '../lib/wallet.ts'
import { SendSubmissionGuard } from '../lib/sendExecution.ts'
import { createReview, evaluateToolPolicy, revalidateReview, type ReviewSnapshot } from '../migrated/policy.ts'
import { isWalletRejection, pollProtocolReceipt, requestReviewedCctpAction } from '../migrated/protocolExecution.ts'
import { prepareCctpApproval, prepareCctpBurn, quoteBridge, readAllowance, readBalance, readGasBalance, readWallet, type BridgeToolQuote, type CctpTransferSpeed, type PreparedToolAction } from '../migrated/toolLayer.ts'
import { cctpGasCeilingExceeded, getOfficialCctpStatus, sameCctpActionMaterial, sameCctpQuoteMaterial, simulatePreparedCctpCall } from '../protocols/circle/cctpAdapter.ts'
import { withRpcTimeout, CCTP_STATUS_TIMEOUT_MS } from '../lib/rpcTimeout.ts'
import { Button, T } from './wallet/ui.tsx'
import type { BridgeRecord } from '../lib/protocolActivity.ts'
import { hasSavedProtocolCompletion } from '../lib/protocolActivity.ts'
import { createStrategyRun, recoverStrategyRun, restoreStrategyRun, saveStrategyRun, transitionStrategy, type StrategyEvent, type StrategyReceiptBinding, type StrategyRun } from '../migrated/strategyController.ts'

type Stage = 'idle' | 'review-approval' | 'approval-confirmed' | 'review-burn' | 'source-pending' | 'source-unknown' | 'source-confirmed' | 'attestation-pending' | 'attestation-available' | 'forwarding-pending' | 'forwarding-failed' | 'destination-pending' | 'destination-confirmed' | 'destination-failed' | 'status-unavailable' | 'failed' | 'rejected'
export type LiveQuote = Readonly<{ amount: bigint; expectedReceive: bigint; maxFee: bigint; speed: CctpTransferSpeed }>
type LiveCctpProps = { account: string; amount: string; transferSpeed: CctpTransferSpeed; onSourceConfirmed: () => Promise<unknown>; onComplete: () => void; onQuoteChange?: (quote?: LiveQuote) => void }
type Operation = { generation: number; account: string; chainId?: number; input?: string; run?: StrategyRun; saved: string | null | undefined }

/** Arc Testnet → Base Sepolia USDC CCTP v2 only. Each approval and burn needs its own review and click. */
export function LiveCctpControl({ account, amount, transferSpeed, onSourceConfirmed, onComplete, onQuoteChange }: LiveCctpProps) {
  const { upsertBridge, bridgeRecords, walletChainId } = useWallet()
  const [tr, lang] = useT()
  const say = (en: string, vn: string) => lang === 'vi' ? vn : en
  const [stage, setStage] = useState<Stage>('idle')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [activityUnavailable, setActivityUnavailable] = useState(false)
  const [checkpointUnavailable, setCheckpointUnavailable] = useState(false)
  const [quote, setQuote] = useState<BridgeToolQuote>()
  const [prepared, setPrepared] = useState<PreparedToolAction>()
  const [review, setReview] = useState<ReviewSnapshot>()
  const [reviewedInput, setReviewedInput] = useState('')
  const [hash, setHash] = useState<Hex>()
  const [destinationHash, setDestinationHash] = useState('')
  const guard = useRef(new SendSubmissionGuard())
  const run = useRef<StrategyRun | undefined>(undefined)
  const mounted = useRef(false)
  const generation = useRef(0)
  const operation = useRef<Operation | undefined>(undefined)
  const checkpoint = useRef<string | null | undefined>(undefined)
  const autoApprovalContinuation = useRef('')
  const activityRecords = useRef(bridgeRecords)
  activityRecords.current = Array.isArray(bridgeRecords) ? bridgeRecords : []
  const normalizedAccount = account.toLowerCase()
  const input = `${normalizedAccount}:${amount}:${transferSpeed}`
  const context = useRef({ account: normalizedAccount, chainId: walletChainId, input })
  context.current = { account: normalizedAccount, chainId: walletChainId, input }

  const savedCheckpoint = (owner: string) => {
    try { return typeof localStorage === 'undefined' ? undefined : localStorage.getItem(`mk.strategy.v1:cctp:${owner}`) }
    catch { return undefined }
  }
  const sameLifecycle = (op: Operation) => mounted.current && generation.current === op.generation && context.current.account === op.account && context.current.chainId === op.chainId
  const isCurrent = (op: Operation) => sameLifecycle(op) && operation.current === op && (!op.input || context.current.input === op.input)
    && run.current === op.run && (!op.run || op.run.protocol === 'cctp' && op.run.account === op.account && op.run.chainId === ARC.chainId)
    && savedCheckpoint(op.account) === op.saved
  const requireCurrent = (op: Operation) => { if (!isCurrent(op)) throw new Error('Stale CCTP operation') }
  const begin = (reviewInput = false): Operation | undefined => {
    if (!mounted.current || operation.current) return undefined
    // undefined means the checkpoint could not be read; null is a verified
    // absence. Never replace an unreadable, possibly submitted request.
    if (checkpoint.current === undefined || savedCheckpoint(normalizedAccount) === undefined) {
      setError('Saved CCTP strategy state is unavailable.'); return undefined
    }
    const op: Operation = { generation: generation.current, account: normalizedAccount, chainId: walletChainId, input: reviewInput ? input : undefined, run: run.current, saved: checkpoint.current }
    operation.current = op
    if (!isCurrent(op)) { operation.current = undefined; return undefined }
    setBusy(true); setError('')
    return op
  }
  const finish = (op: Operation) => {
    // A stale finally must never unlock a newer account's operation.
    if (operation.current !== op) return
    operation.current = undefined
    if (sameLifecycle(op)) setBusy(false)
  }

  const rememberRun = (next: StrategyRun, op?: Operation) => {
    if (op) requireCurrent(op)
    const serialized = JSON.stringify(next)
    if (typeof localStorage !== 'undefined') {
      if (!saveStrategyRun(localStorage, next)) throw new Error('Saved CCTP strategy state is unavailable.')
      if (savedCheckpoint(next.account) !== serialized) throw new Error('Stale CCTP operation')
    }
    run.current = next
    checkpoint.current = typeof localStorage === 'undefined' ? undefined : serialized
    if (op) { op.run = next; op.saved = checkpoint.current }
    setCheckpointUnavailable(false)
  }
  const advance = (event: StrategyEvent, op: Operation) => {
    requireCurrent(op)
    const current = run.current ?? createStrategyRun('cctp', account, event.now)
    const result = transitionStrategy(current, event)
    if (!result.accepted) throw new Error(result.reason)
    rememberRun(result.state, op)
    return result.state
  }
  // The wallet may return after an account/chain change or unmount. Retain its
  // actual outcome under the untouched original checkpoint, without stale UI writes.
  const rememberWalletOutcome = (event: StrategyEvent, op: Operation) => {
    if (!op.run) return
    const saved = savedCheckpoint(op.account)
    if (saved !== op.saved) {
      // A failed read is not evidence of a newer checkpoint. Retain only the
      // returned hash in this request's mounted context; never write through an
      // unverified checkpoint or continue receipt work until reads recover.
      if (saved === undefined && typeof op.saved === 'string' && event.type === 'hash'
        && sameLifecycle(op) && operation.current === op && run.current === op.run) {
        const result = transitionStrategy(op.run, event)
        if (result.accepted) {
          run.current = result.state; op.run = result.state
          setHash(event.hash as Hex); setStage('source-unknown'); setCheckpointUnavailable(true)
        }
      }
      return
    }
    const result = transitionStrategy(op.run, event)
    if (!result.accepted) return
    if (isCurrent(op)) {
      try { rememberRun(result.state, op) }
      catch (caught) {
        if (event.type !== 'hash' || !isCurrent(op)) throw caught
        // A returned hash is real evidence even when persistence is unavailable.
        // Keep it in memory against the unchanged checkpoint and block resubmission.
        run.current = result.state; op.run = result.state
        setCheckpointUnavailable(true)
      }
      return
    }
    const serialized = JSON.stringify(result.state)
    if (typeof localStorage !== 'undefined' && saveStrategyRun(localStorage, result.state) && savedCheckpoint(op.account) === serialized) {
      op.run = result.state; op.saved = serialized
    }
  }
  const newReviewRun = () => {
    const next = createStrategyRun('cctp', account)
    const approvalReceipt = run.current?.account === normalizedAccount ? run.current.approvalReceipt : undefined
    if (approvalReceipt && run.current?.phase === 'EXPIRED') return Object.freeze({ ...next, phase: 'REVALIDATING' as const, step: 'approval' as const, hash: approvalReceipt.hash, binding: approvalReceipt.binding, input: run.current.input, approvalReceipt })
    return approvalReceipt ? Object.freeze({ ...next, approvalReceipt }) : next
  }

  useLayoutEffect(() => {
    mounted.current = true
    generation.current += 1
    operation.current = undefined
    autoApprovalContinuation.current = ''
    let restored: StrategyRun | undefined
    try { restored = typeof localStorage === 'undefined' ? undefined : restoreStrategyRun(localStorage, 'cctp', normalizedAccount) }
    catch { /* A blocked localStorage property must not crash receipt recovery UI. */ }
    run.current = restored
    checkpoint.current = savedCheckpoint(normalizedAccount)
    setBusy(false); setError(checkpoint.current === undefined ? 'Saved CCTP strategy state is unavailable.' : ''); setActivityUnavailable(false); setCheckpointUnavailable(false); setQuote(undefined); setPrepared(undefined); setReview(undefined); setReviewedInput('')
    setHash(restored?.hash as Hex | undefined)
    const previousActivity = activityRecords.current.find((record) => typeof record?.hash === 'string' && typeof record.account === 'string' && record.hash.toLowerCase() === restored?.hash?.toLowerCase() && record.account.toLowerCase() === normalizedAccount)
    setDestinationHash(typeof previousActivity?.destinationHash === 'string' && isHash(previousActivity.destinationHash) ? previousActivity.destinationHash : ''); setStage('idle')
    if (restored?.phase === 'COMPLETED') setStage('destination-confirmed')
    else if (restored?.phase === 'REVALIDATING' || restored?.phase === 'EXPIRED' && restored.approvalReceipt) setStage('approval-confirmed')
    else if (restored && ['RECOVERING', 'PENDING', 'UNKNOWN', 'SOURCE_CONFIRMED', 'DESTINATION_PENDING', 'FORWARDING_FAILED', 'DESTINATION_FAILED'].includes(restored.phase)) {
      const nextStage: Stage = restored.phase === 'PENDING' ? 'source-pending' : restored.phase === 'SOURCE_CONFIRMED' ? 'source-confirmed' : restored.phase === 'DESTINATION_PENDING' ? 'destination-pending' : restored.phase === 'FORWARDING_FAILED' ? 'forwarding-failed' : restored.phase === 'DESTINATION_FAILED' ? 'destination-failed' : 'source-unknown'
      setStage(nextStage)
    }
    return () => { mounted.current = false; generation.current += 1; operation.current = undefined }
  }, [normalizedAccount, walletChainId])

  useLayoutEffect(() => {
    if (operation.current?.input && operation.current.input !== input) {
      generation.current += 1; operation.current = undefined; setBusy(false)
    }
    setQuote(undefined)
    setPrepared(undefined); setReview(undefined)
    setStage((current) => current === 'review-approval' || current === 'review-burn' ? 'idle' : current)
  }, [input])

  const publishQuote = (value: BridgeToolQuote, op: Operation) => {
    requireCurrent(op)
    setQuote(value)
    onQuoteChange?.({ amount: value.amount, expectedReceive: value.expectedReceive, maxFee: value.maxFee, speed: value.transferSpeed })
  }
  const recordFor = (txHash: Hex, action: PreparedToolAction, q: BridgeToolQuote, status: BridgeRecord['status']): BridgeRecord => ({
    hash: txHash, account: action.account, target: action.request.to, calldata: action.request.data,
    amount: formatUnits(q.amount, 6), expectedReceiveUnits: q.expectedReceive.toString(),
    destinationDomain: q.destinationDomain, maxFeeUnits: q.maxFee.toString(),
    finalityThreshold: action.cctp?.finalityThreshold?.toString(), timestamp: Date.now(), status,
  })
  const recordActivity = (record: BridgeRecord, op?: Operation) => {
    // Activity is a secondary projection; it must never interrupt receipt recovery.
    try { upsertBridge(record); if (!op || isCurrent(op)) setActivityUnavailable(false); return true }
    catch { if (!op || isCurrent(op)) setActivityUnavailable(true); return false }
  }
  const bindingFor = (action: PreparedToolAction, q: BridgeToolQuote, approval: boolean): StrategyReceiptBinding => ({
    from: action.request.from, to: action.request.to, data: action.request.data,
    amount: formatUnits(q.amount, 6),
    ...(approval ? { symbol: 'USDC' as const, spender: q.spender, requiredUnits: q.totalDebit.toString() } : {
      expectedReceiveUnits: q.expectedReceive.toString(), recipient: q.recipient,
      destinationDomain: q.destinationDomain, maxFeeUnits: q.maxFee.toString(),
      finalityThreshold: action.cctp?.finalityThreshold?.toString(),
    }),
  })
  const captureInput = () => `${account.toLowerCase()}:${amount}:${transferSpeed}`

  async function walletContext(p: NonNullable<ReturnType<typeof getProvider>>) {
    const wallet = await readWallet(p)
    if (wallet.status !== 'OK' || !wallet.data || wallet.data.chainId !== ARC.chainId || wallet.data.account.toLowerCase() !== account.toLowerCase()) throw new Error('Connect the reviewed account on Arc Testnet.')
    return wallet.data
  }

  async function refreshAfterReceipt(op: Operation) {
    // Portfolio availability cannot invalidate independently verified source evidence.
    try { await onSourceConfirmed() } catch { /* Wallet data reports its own availability. */ }
    requireCurrent(op)
  }

  async function evidence(p: NonNullable<ReturnType<typeof getProvider>>, q: BridgeToolQuote) {
    const [balance, allowance, gas] = await Promise.all([
      readBalance(p, 'USDC', account), readAllowance(p, 'USDC', q.spender, account), readGasBalance(p, account),
    ])
    if (balance.status !== 'OK' || !balance.data || allowance.status !== 'OK' || !allowance.data || gas.status !== 'OK' || gas.data === undefined) throw new Error('USDC balance, allowance or Arc gas balance is unavailable.')
    return { balance: balance.data.units, allowance: allowance.data.units, gasBalance: gas.data }
  }

  async function simulateAndEvaluate(action: PreparedToolAction, q: BridgeToolQuote, current: { balance: bigint; allowance: bigint; gasBalance: bigint }) {
    const simulation = await simulatePreparedCctpCall(action)
    const decision = evaluateToolPolicy({
      action, quote: q, account, chainId: ARC.chainId,
      simulation: simulation.success ? 'passed' : simulation.error ? 'reverted' : 'unavailable',
      now: Date.now(), balance: current.balance, allowance: current.allowance, gasBalance: current.gasBalance,
      ...(action.kind === 'approval' ? { approval: { symbol: 'USDC' as const, spender: q.spender, required: q.totalDebit, allowance: current.allowance, requested: action.cctp?.approvalAmount ?? 0n } } : {}),
    })
    if (decision.mustStop) throw new Error(decision.findings.map((item) => item.code).join(', '))
    return decision
  }

  function setReviewFor(action: PreparedToolAction, q: BridgeToolQuote, decision: ReturnType<typeof evaluateToolPolicy>, step: 'approval' | 'cctp-burn', op: Operation) {
    requireCurrent(op)
    const now = Date.now()
    advance({ type: 'review', step, account, chainId: ARC.chainId, input: { kind: 'cctp', amount, transferSpeed }, expiresAt: Math.min(action.expiresAt, q.expiresAt), quoteFresh: true, policyPassed: true, simulationPassed: true, now }, op)
    setPrepared(action)
    setReview(createReview(action, q, decision, now))
    if (step === 'cctp-burn') setHash(undefined)
    setStage(step === 'approval' ? 'review-approval' : 'review-burn')
    setReviewedInput(captureInput())
  }

  async function start() {
    if (busy || operation.current) return
    const phase = run.current?.phase
    if (phase && ['RECOVERING', 'PENDING', 'UNKNOWN', 'SUBMITTED', 'AWAITING_USER', 'SOURCE_CONFIRMED', 'DESTINATION_PENDING', 'FORWARDING_FAILED', 'DESTINATION_FAILED'].includes(phase)) {
      setError('Resolve the previous CCTP transfer before preparing another.')
      return
    }
    const op = begin(true)
    if (!op) return
    try {
      if (!phase || ['IDLE', 'REVIEW_APPROVAL', 'REVIEW_ACTION', 'FAILED', 'USER_REJECTED', 'COMPLETED', 'EXPIRED', 'BLOCKED'].includes(phase)) rememberRun(newReviewRun(), op)
      const p = getProvider()
      if (!p) throw new Error('Wallet provider unavailable.')
      await walletContext(p)
      if (!isCurrent(op)) return
      const result = await quoteBridge(p, { account, amount, asset: 'USDC', sourceChainId: ARC.chainId, destinationChainId: 84532, transferSpeed })
      if (!isCurrent(op)) return
      if (result.status !== 'OK' || !result.data) throw new Error(result.reason ?? 'Official Circle fee quote unavailable.')
      const q = result.data
      publishQuote(q, op)
      const current = await evidence(p, q)
      if (!isCurrent(op)) return
      if (run.current?.phase === 'REVALIDATING') {
        const sufficient = current.allowance >= q.totalDebit
        advance({ type: 'allowance-reread', sufficient, account, chainId: ARC.chainId, now: Date.now() }, op)
        if (!sufficient) throw new Error('Approval receipt did not establish sufficient allowance.')
      }
      if (current.allowance < q.totalDebit) {
        const approval = await prepareCctpApproval(p, q, current.allowance)
        if (!isCurrent(op)) return
        const policy = await simulateAndEvaluate(approval, q, current)
        if (!isCurrent(op)) return
        setReviewFor(approval, q, policy, 'approval', op)
        return
      }
      const action = await prepareCctpBurn(p, q)
      if (!isCurrent(op)) return
      const policy = await simulateAndEvaluate(action, q, current)
      if (!isCurrent(op)) return
      setReviewFor(action, q, policy, 'cctp-burn', op)
    } catch (caught) { if (isCurrent(op)) setError(caught instanceof Error ? caught.message : 'CCTP review unavailable.') }
    finally { finish(op) }
  }

  useEffect(() => {
    if (stage !== 'approval-confirmed' || busy || !amount || walletChainId !== ARC.chainId) return
    const approvalHash = run.current?.phase === 'EXPIRED' ? run.current.approvalReceipt?.hash
      : run.current?.step === 'approval' && ['REVALIDATING', 'REQUOTING'].includes(run.current.phase) ? run.current.hash : undefined
    if (!approvalHash) return
    const key = `${approvalHash.toLowerCase()}:${normalizedAccount}:${walletChainId}:${amount}:${transferSpeed}`
    if (autoApprovalContinuation.current === key) return
    autoApprovalContinuation.current = key
    // Receipt-confirmed approval only authorizes fresh reads and a new burn review.
    // The burn wallet request remains exclusively inside the user's confirm action.
    void start()
    // start is scoped by this input and the generation/checkpoint guards above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, busy, hash, normalizedAccount, walletChainId, amount, transferSpeed])

  async function reconcileDestination(p: NonNullable<ReturnType<typeof getProvider>>, burnHash: Hex, binding: StrategyReceiptBinding, baseRecord: BridgeRecord, op: Operation) {
    if (!isCurrent(op) || op.run?.hash?.toLowerCase() !== burnHash.toLowerCase() || op.run.binding !== binding) return
    if (!binding.recipient || !binding.expectedReceiveUnits || !binding.destinationDomain || !binding.maxFeeUnits || !binding.finalityThreshold) {
      setStage('status-unavailable'); setError('Saved CCTP verification details are incomplete; source remains confirmed.')
      return
    }
    const status = await withRpcTimeout(
      getOfficialCctpStatus(p, {
        account: binding.from as `0x${string}`, burnHash,
        destinationDomain: binding.destinationDomain, recipient: binding.recipient as `0x${string}`,
        expectedReceive: BigInt(binding.expectedReceiveUnits), maxFee: BigInt(binding.maxFeeUnits), finalityThreshold: BigInt(binding.finalityThreshold),
      }),
      CCTP_STATUS_TIMEOUT_MS,
      'Circle CCTP status',
    ).catch((e: unknown) => ({ state: 'unavailable' as const, reason: e instanceof Error ? e.message : 'Circle CCTP status timed out' }))
    if (!isCurrent(op)) return
    const completedRecovery = op.run?.phase === 'COMPLETED'
    if (status.state === 'unavailable') { if (!completedRecovery) setStage('status-unavailable'); setError(status.reason ?? 'Circle status unavailable. Check again later.'); return }
    if (completedRecovery && (status.state === 'forwarding-failed' || !status.forwardTxHash)) { setError('Circle status unavailable. Check again later.'); return }
    if (status.state === 'forwarding-failed') {
      if (run.current && ['SOURCE_CONFIRMED', 'DESTINATION_PENDING'].includes(run.current.phase)) advance({ type: 'forwarding-failed', now: Date.now() }, op)
      setStage('forwarding-failed'); recordActivity({ ...baseRecord, status: 'forwarding-failed' }, op); return
    }
    if (!status.forwardTxHash) {
      const pendingStage: Stage = status.state === 'attestation-pending' ? 'attestation-pending' : status.state === 'attestation-available' ? 'attestation-available' : 'forwarding-pending'
      setStage(pendingStage); recordActivity({ ...baseRecord, status: 'attesting' }, op); return
    }
    setDestinationHash(status.forwardTxHash)
    // Both fetch() and response.json() are inside the same deadline so a hung
    // body read cannot stall the reconcile loop. On timeout the checkpoint,
    // source hash and destination hash are preserved; no new burn is started.
    const data = await withRpcTimeout(
      (async () => {
        const resp = await fetch(api(`cctp/destination?txHash=${status.forwardTxHash}&recipient=${binding.recipient}&minimumUnits=${binding.expectedReceiveUnits}`), { cache: 'no-store' })
        return resp.ok ? await resp.json() as { status?: string } : undefined
      })(),
      CCTP_STATUS_TIMEOUT_MS,
      'Base destination fetch',
    ).catch(() => undefined)
    if (!isCurrent(op)) return
    if (!data || !['confirmed', 'failed', 'pending'].includes(data.status ?? '')) {
      if (!completedRecovery) setStage('status-unavailable')
      setError('Base destination evidence is unavailable. Check the saved transfer again later.')
      if (!completedRecovery) recordActivity({ ...baseRecord, destinationHash: status.forwardTxHash }, op)
      return
    }
    const destinationState = data?.status === 'confirmed' ? 'destination-confirmed' : data?.status === 'failed' ? 'destination-failed' : 'destination-pending'
    if (completedRecovery && destinationState !== 'destination-confirmed') { setError('Base destination evidence is unavailable. Check the saved transfer again later.'); return }
    if (destinationState === 'destination-confirmed' && run.current && ['SOURCE_CONFIRMED', 'DESTINATION_PENDING'].includes(run.current.phase)) advance({ type: 'destination-confirmed', now: Date.now() }, op)
    else if (destinationState === 'destination-failed' && run.current && ['SOURCE_CONFIRMED', 'DESTINATION_PENDING'].includes(run.current.phase)) advance({ type: 'destination-failed', now: Date.now() }, op)
    else if (destinationState === 'destination-pending' && run.current && ['SOURCE_CONFIRMED', 'DESTINATION_PENDING'].includes(run.current.phase)) advance({ type: 'destination-pending', now: Date.now() }, op)
    setStage(destinationState)
    recordActivity({ ...baseRecord, destinationHash: status.forwardTxHash, status: destinationState }, op)
  }

  async function confirm() {
    if (busy || !prepared || !quote || !review || (stage !== 'review-approval' && stage !== 'review-burn')) return
    const op = begin(true)
    if (!op) return
    try {
      if (reviewedInput !== captureInput()) throw new Error('Amount, account or transfer speed changed. Review again.')
      const p = getProvider()
      if (!p) throw new Error('Wallet provider unavailable.')
      const wallet = await walletContext(p)
      if (!isCurrent(op)) return
      let freshQuote = quote
      if (Date.now() >= quote.expiresAt) {
        const freshQuoteResult = await quoteBridge(p, { account, amount, asset: 'USDC', sourceChainId: ARC.chainId, destinationChainId: 84532, transferSpeed })
        if (!isCurrent(op)) return
        if (freshQuoteResult.status !== 'OK' || !freshQuoteResult.data) throw new Error(freshQuoteResult.reason ?? 'Official Circle fee quote unavailable.')
        freshQuote = freshQuoteResult.data
      }
      const current = await evidence(p, freshQuote)
      if (!isCurrent(op)) return
      const wasApproval = stage === 'review-approval'

      if (wasApproval && current.allowance >= freshQuote.totalDebit) {
        publishQuote(freshQuote, op); setPrepared(undefined); setReview(undefined); setStage('idle')
        setError('Allowance is sufficient now. Start a new burn review.')
        return
      }
      if (!wasApproval && current.allowance < freshQuote.totalDebit) {
        rememberRun(newReviewRun(), op)
        const approval = await prepareCctpApproval(p, freshQuote, current.allowance)
        if (!isCurrent(op)) return
        const policy = await simulateAndEvaluate(approval, freshQuote, current)
        if (!isCurrent(op)) return
        publishQuote(freshQuote, op); setReviewFor(approval, freshQuote, policy, 'approval', op)
        setError('Allowance changed. Review this separate exact approval.')
        return
      }

      const freshAction = wasApproval
        ? await prepareCctpApproval(p, freshQuote, current.allowance)
        : await prepareCctpBurn(p, freshQuote)
      if (!isCurrent(op)) return
      const policy = await simulateAndEvaluate(freshAction, freshQuote, current)
      if (!isCurrent(op)) return
      const materialSame = sameCctpQuoteMaterial(quote, freshQuote) && sameCctpActionMaterial(prepared, freshAction)
      const gasCeilingExceeded = cctpGasCeilingExceeded(prepared.gasEstimate, freshAction.gasEstimate)
      const reviewExpired = Date.now() >= review.expiresAt
      if (!materialSame || gasCeilingExceeded || reviewExpired) {
        publishQuote(freshQuote, op)
        setPrepared(freshAction)
        setReview(createReview(freshAction, freshQuote, policy))
        setReviewedInput(captureInput())
        setError(!materialSame ? 'Circle fee or request changed. Review the refreshed request, then confirm again.' : gasCeilingExceeded ? 'Arc gas exceeds the reviewed maximum. Review the new gas ceiling before confirming.' : 'Review expired. Check the refreshed request, then confirm again.')
        return
      }
      const validation = revalidateReview(review, {
        action: freshAction, quote: freshQuote, account, chainId: wallet.chainId,
        simulation: 'passed', now: Date.now(), balance: current.balance,
        allowance: current.allowance, gasBalance: current.gasBalance,
        ...(wasApproval ? { approval: { symbol: 'USDC' as const, spender: freshQuote.spender, required: freshQuote.totalDebit, allowance: current.allowance, requested: freshAction.cctp?.approvalAmount ?? 0n } } : {}),
      })
      if (validation.status !== 'OK') throw new Error(validation.reason ?? 'Reviewed CCTP request changed.')
      setStage('source-pending')
      advance({ type: 'wallet-request', binding: bindingFor(freshAction, freshQuote, wasApproval), now: Date.now() }, op)
      setHash(undefined)
      // After the user's click, receipt tracking belongs to this run, not the editable amount.
      op.input = undefined
      let submitted: Hex
      try { submitted = await requestReviewedCctpAction(freshAction, guard.current) }
      catch (caught) {
        rememberWalletOutcome({ type: isWalletRejection(caught) ? 'user-rejected' : 'unknown', now: Date.now() }, op)
        if (!isCurrent(op)) return
        if (isWalletRejection(caught)) { setStage('rejected'); return }
        setStage('source-unknown'); throw caught
      }
      rememberWalletOutcome({ type: 'hash', hash: submitted, now: Date.now() }, op)
      if (isCurrent(op)) setHash(submitted)
      if (!wasApproval) recordActivity(recordFor(submitted, freshAction, freshQuote, 'source-pending'), op)
      if (!isCurrent(op)) return
      const result = await pollProtocolReceipt(p, freshAction, submitted, wasApproval ? { approval: { symbol: 'USDC', spender: freshQuote.spender, minimum: freshQuote.totalDebit } } : {}, () => {
        if (isCurrent(op) && run.current?.phase === 'SUBMITTED') advance({ type: 'pending', now: Date.now() }, op)
      })
      if (!isCurrent(op)) return
      advance({ type: result === 'confirmed' ? 'confirmed' : result === 'failed' ? 'failed' : 'unknown', now: Date.now() }, op)
      if (wasApproval) {
        setStage(result === 'confirmed' ? 'approval-confirmed' : result === 'failed' ? 'failed' : 'source-unknown')
        if (result === 'confirmed') await refreshAfterReceipt(op)
      } else {
        const nextStatus = result === 'confirmed' ? 'source-confirmed' : result === 'failed' ? 'failed' : 'source-unknown'
        setStage(nextStatus)
        recordActivity(recordFor(submitted, freshAction, freshQuote, nextStatus), op)
        if (result === 'confirmed') await refreshAfterReceipt(op)
      }
    } catch (caught) {
      if (!isCurrent(op)) return
      setError(caught instanceof Error ? caught.message : 'CCTP wallet request failed.')
      setStage((current) => current === 'source-pending' ? 'source-unknown' : current)
    } finally { finish(op) }
  }

  async function checkAgain() {
    if (busy || !hash) return
    const p = getProvider()
    if (!p) return
    const op = begin()
    if (!op) return
    try {
      const currentRun = op.run
      if (!currentRun || currentRun.hash?.toLowerCase() !== hash.toLowerCase()) throw new Error('No saved CCTP receipt details are available.')
      const wallet = await walletContext(p)
      if (!isCurrent(op)) return
      const recovered = await recoverStrategyRun(p, currentRun)
      if (!isCurrent(op)) return
      const completedRecovery = currentRun.phase === 'COMPLETED'
      if (completedRecovery) {
        if (recovered.phase !== 'SOURCE_CONFIRMED') { setError('CCTP status unavailable.'); return }
      } else {
        rememberRun(recovered, op)
        if (recovered.phase === 'PENDING') { setStage('source-pending'); return }
        if (recovered.phase === 'FAILED') { setStage('failed'); return }
        if (recovered.phase === 'REVALIDATING') { setStage('approval-confirmed'); await refreshAfterReceipt(op); return }
        if (recovered.phase !== 'SOURCE_CONFIRMED' && recovered.phase !== 'DESTINATION_PENDING') { setStage('source-unknown'); return }
      }
      await refreshAfterReceipt(op)
      if (!isCurrent(op)) return
      const binding = recovered.binding
      if (!binding || !recovered.hash) throw new Error('Saved CCTP receipt details are incomplete.')
      const baseRecord: BridgeRecord = {
        hash: recovered.hash, account: wallet.account, target: binding.to, calldata: binding.data,
        amount: binding.amount ?? '0', expectedReceiveUnits: binding.expectedReceiveUnits ?? '0',
        destinationDomain: binding.destinationDomain, maxFeeUnits: binding.maxFeeUnits,
        finalityThreshold: binding.finalityThreshold, timestamp: recovered.updatedAt, status: 'source-confirmed',
      }
      if (!completedRecovery) recordActivity(baseRecord, op)
      await reconcileDestination(p, recovered.hash as Hex, binding, baseRecord, op)
    } catch (caught) { if (isCurrent(op)) setError(caught instanceof Error ? caught.message : 'CCTP status unavailable.') }
    finally { finish(op) }
  }

  function complete() {
    if (busy || operation.current || !mounted.current || stage !== 'destination-confirmed' || run.current?.phase !== 'COMPLETED' || savedCheckpoint(normalizedAccount) !== checkpoint.current) return
    if (!completedActivity || typeof localStorage === 'undefined' || !hasSavedProtocolCompletion(localStorage, 'cctp', normalizedAccount, hash ?? '')) {
      const saved = run.current
      const binding = saved.binding
      const confirmedDestination = destinationHash || completedActivity?.destinationHash
      setActivityUnavailable(true)
      if (!saved.hash || !binding || !confirmedDestination) return
      recordActivity({
        hash: saved.hash, account: saved.account, target: binding.to, calldata: binding.data,
        amount: binding.amount ?? '0', expectedReceiveUnits: binding.expectedReceiveUnits ?? '0',
        destinationDomain: binding.destinationDomain, maxFeeUnits: binding.maxFeeUnits,
        finalityThreshold: binding.finalityThreshold, timestamp: saved.updatedAt,
        destinationHash: confirmedDestination, status: 'destination-confirmed',
      })
      // The real store persists Activity in an effect. A separate Done must
      // observe the durable record before removing the recovery checkpoint.
      setActivityUnavailable(true)
      return
    }
    try { rememberRun(createStrategyRun('cctp', account)) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'CCTP status unavailable.'); return }
    setStage('idle')
    setQuote(undefined)
    setPrepared(undefined)
    setReview(undefined)
    setReviewedInput('')
    setHash(undefined)
    setDestinationHash('')
    setError('')
    setActivityUnavailable(false)
    onQuoteChange?.(undefined)
    onComplete()
  }

  function cancelReview() {
    if (operation.current || !mounted.current || savedCheckpoint(normalizedAccount) !== checkpoint.current) return
    try { rememberRun(newReviewRun()) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'CCTP status unavailable.'); return }
    setPrepared(undefined); setReview(undefined); setStage('idle'); setError('')
  }

  const liveMaxGas = prepared?.gasEstimate ? formatUnits(prepared.gasEstimate.maximumFee, 18) : undefined
  const completedActivity = activityRecords.current.find((record) => typeof record?.hash === 'string' && typeof record.account === 'string' && record.hash.toLowerCase() === hash?.toLowerCase() && record.account.toLowerCase() === normalizedAccount && record.status === 'destination-confirmed' && typeof record.destinationHash === 'string' && isHash(record.destinationHash))
  const savedBurn = Boolean(hash && run.current?.hash === hash && run.current?.step === 'cctp-burn')
  const errorText = savedBurn
    ? tr('Circle status is unavailable. Do not resubmit the transfer; check its saved status.')
    : lang === 'vi' ? describeCctpErrorVi(error) : error

  function describeCctpErrorVi(msg: string): string {
    if (!msg) return ''
    const m = msg.toLowerCase()
    if (m.includes('circle fee quote unavailable') || m.includes('getmaxfee') || m.includes('official circle fee')) return 'Không lấy được báo giá Circle. Vui lòng thử lại.'
    if (m.includes('rpc') && (m.includes('timeout') || m.includes('timed out'))) return 'Kết nối Arc RPC đã hết thời gian. Vui lòng thử lại. [RPC_TIMEOUT]'
    if (m.includes('gas estimate') || m.includes('gasestimate') || m.includes('invalid gas')) return 'Không ước tính được phí gas. Vui lòng thử lại. [GAS_UNAVAILABLE]'
    if (m.includes('simulation') || m.includes('simulate') || m.includes('reverted')) return 'Giao dịch không thể mô phỏng. Kiểm tra số dư và ủy quyền. [SIMULATE_FAILED]'
    if (m.includes('balance') && (m.includes('unavailable') || m.includes('insufficient'))) return 'Không đọc được số dư USDC. Vui lòng thử lại. [BALANCE_UNAVAILABLE]'
    if (m.includes('allowance') && m.includes('unavailable')) return 'Không đọc được ủy quyền USDC. Vui lòng thử lại. [ALLOWANCE_UNAVAILABLE]'
    if (m.includes('allowance') && m.includes('sufficient')) return 'Đã đủ ủy quyền. Bắt đầu xem xét lệnh đốt mới.'
    if (m.includes('quote expired') || m.includes('expired') || m.includes('circle cctp fee observation expired')) return 'Báo giá đã hết hạn. Lấy báo giá mới. [QUOTE_EXPIRED]'
    if (m.includes('policy') || m.includes('must stop') || m.includes('policy rejected')) return 'Chính sách an toàn đã dừng giao dịch. Kiểm tra số dư và ủy quyền. [POLICY_REJECTED]'
    if (m.includes('cctp status') || m.includes('circle status')) return 'Không lấy được trạng thái CCTP từ Circle. Thử lại sau. [CCTP_STATUS_UNAVAILABLE]'
    if (m.includes('destination') && m.includes('unavailable')) return 'Không lấy được bằng chứng đích Base Sepolia. Thử lại sau. [DEST_UNAVAILABLE]'
    if (m.includes('connect the reviewed account') || m.includes('arc testnet')) return 'Vui lòng kết nối đúng tài khoản trên Arc Testnet.'
    if (m.includes('stale cctp operation') || m.includes('checkpoint')) return 'Trạng thái CCTP đã thay đổi. Vui lòng bắt đầu lại.'
    if (m.includes('circle cctp v2 arc testnet to base sepolia configuration')) return 'Cấu hình route CCTP Circle chưa sẵn sàng.'
    if (m.includes('arc usdc conflicts') || m.includes('messenger conflicts') || m.includes('transmitter conflicts')) return 'Cấu hình CCTP xung đột với registry Makoto. Liên hệ hỗ trợ. [ROUTE_CONFLICT]'
    if (m.includes('circle burn fields differ') || m.includes('calldata does not match')) return 'Dữ liệu lệnh đốt Circle không khớp với giao dịch đã xem xét. [BURN_MISMATCH]'
    if (m.includes('amount, account or transfer speed changed')) return 'Thông số thay đổi. Xem xét lại.'
    if (m.includes('circle fee or request changed')) return 'Phí hoặc yêu cầu Circle đã thay đổi. Xem xét lại yêu cầu mới.'
    if (m.includes('gas exceeds the reviewed maximum')) return 'Phí gas Arc vượt mức đã xem xét. Xem xét lại mức trần gas mới.'
    if (m.includes('review expired')) return 'Bước xem xét đã hết hạn. Xem xét lại yêu cầu mới.'
    if (m.includes('wallet provider unavailable')) return 'Ví chưa kết nối.'
    // Unknown error: show a safe diagnostic code derived from the first words, no wallet data exposed.
    const code = msg.replace(/[^a-zA-Z0-9 ]/g, '').trim().split(/\s+/).slice(0, 4).join('_').toUpperCase().slice(0, 48)
    return `Không thể lấy trạng thái CCTP. Vui lòng thử lại. [${code || 'ERR'}]`
  }
  return <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3.5 text-[13px] space-y-3" aria-live="polite">
    <div className="font-semibold">{say('Direct Circle CCTP v2 · Arc → Base Sepolia', 'Circle CCTP v2 trực tiếp · Arc → Base Sepolia')}</div>
    {quote && <div className={T.sub}>
      <p>{say('Gross USDC amount', 'Số USDC chuyển')} {formatUnits(quote.amount, 6)} · {say('Receive floor', 'Nhận tối thiểu')} {formatUnits(quote.expectedReceive, 6)} USDC</p>
      <p>{say('Circle maximum fee', 'Phí Circle tối đa')} {formatUnits(quote.maxFee, 6)} USDC · {say('Speed', 'Tốc độ')} {quote.transferSpeed === 'FAST' ? say('Fast', 'Nhanh') : say('Standard', 'Tiêu chuẩn')}</p>
    </div>}
    {prepared && liveMaxGas && <p className={T.sub}>{say('Estimated Arc gas ceiling', 'Phí gas Arc ước tính tối đa')}: {liveMaxGas} USDC</p>}
    {stage === 'review-approval' && quote && <p>{say('Exact finite USDC approval', 'Phê duyệt USDC hữu hạn chính xác')}: {formatUnits(quote.totalDebit, 6)} USDC. {say('This is a separate wallet confirmation.', 'Đây là xác nhận ví riêng.')}</p>}
    {stage === 'approval-confirmed' && <p>{say('USDC approval confirmed. Preparing a fresh Circle quote and burn review; the burn still needs your separate wallet confirmation.', 'Đã xác nhận cấp quyền USDC. Đang chuẩn bị báo giá Circle mới và bước xem lại lệnh đốt; bạn vẫn cần xác nhận lệnh đốt riêng trong ví.')}</p>}
    {stage === 'review-burn' && <p>{say('Review the Circle CCTP source burn. Destination completes only after Base receipt and USDC transfer evidence.', 'Xem lại lệnh đốt CCTP của Circle. Chỉ hoàn tất khi có biên nhận Base và bằng chứng chuyển USDC.')}</p>}
    {stage === 'source-pending' && <p>{say('Awaiting Arc receipt. Do not submit this transfer again.', 'Đang chờ biên nhận Arc. Không gửi lại giao dịch này.')}</p>}
    {stage === 'source-unknown' && <p>{hash
      ? say('Source status is unknown. Check the saved hash before retrying.', 'Chưa rõ trạng thái nguồn. Kiểm tra mã giao dịch đã lưu trước khi thử lại.')
      : say('The wallet did not return a transaction hash. Check your wallet history or explorer before any new attempt. Do not resubmit.', 'Ví không trả về mã giao dịch. Hãy kiểm tra lịch sử trong ví hoặc trình khám phá trước khi thử lại. Không gửi lại giao dịch.')}</p>}
    {stage === 'source-confirmed' && <p>{say('Arc source confirmed. Circle attestation and Base destination are still pending.', 'Nguồn Arc đã xác nhận. Chứng thực Circle và đích Base vẫn đang chờ.')}</p>}
    {stage === 'attestation-pending' && <p>{say('Circle attestation is pending.', 'Chứng thực Circle đang chờ.')}</p>}
    {stage === 'attestation-available' && <p>{say('Circle attestation is available. Waiting for its forwarded transaction.', 'Đã có chứng thực Circle. Đang chờ giao dịch chuyển tiếp.')}</p>}
    {stage === 'forwarding-pending' && <p>{say('Circle forwarding is pending.', 'Chuyển tiếp Circle đang chờ.')}</p>}
    {stage === 'forwarding-failed' && <p>{say('Circle forwarding failed. The Arc burn remains confirmed; destination funds are not confirmed.', 'Chuyển tiếp Circle thất bại. Lệnh đốt Arc vẫn đã xác nhận; tiền ở đích chưa được xác nhận.')}</p>}
    {stage === 'destination-pending' && <p>{say('Forward transaction observed. Waiting for verified Base receipt and USDC transfer.', 'Đã thấy giao dịch chuyển tiếp. Đang chờ biên nhận Base và chuyển USDC được xác minh.')}</p>}
    {stage === 'destination-confirmed' && <p>{say('Destination confirmed by Base receipt and matching USDC transfer.', 'Đích đã xác nhận bằng biên nhận Base và chuyển USDC phù hợp.')}</p>}
    {stage === 'destination-failed' && <p>{say('The forwarded Base transaction failed. The Arc burn remains confirmed.', 'Giao dịch Base chuyển tiếp thất bại. Lệnh đốt Arc vẫn đã xác nhận.')}</p>}
    {stage === 'status-unavailable' && <p>{say('Circle status or destination evidence is unavailable. The confirmed Arc burn remains pending destination evidence.', 'Chưa thể lấy trạng thái Circle hoặc bằng chứng đích. Lệnh đốt Arc đã xác nhận nhưng vẫn thiếu bằng chứng đích.')}</p>}
    {stage === 'failed' && <p>{say('Arc source transaction failed.', 'Giao dịch nguồn Arc thất bại.')}</p>}
    {stage === 'rejected' && <p>{say('Wallet request rejected for this step. No transaction was submitted; any earlier confirmed approval is retained.', 'Yêu cầu ví ở bước này đã bị từ chối, chưa gửi giao dịch. Bằng chứng phê duyệt đã xác nhận trước đó vẫn được giữ lại.')}</p>}
    {hash && <a className="block break-all text-neon-300" href={explorerTx(hash)} target="_blank" rel="noreferrer">{hash}</a>}
    {destinationHash && <a className="block break-all text-neon-300" href={`https://sepolia.basescan.org/tx/${destinationHash}`} target="_blank" rel="noreferrer">{destinationHash}</a>}
    {error && <p className="text-rose-300 break-words">{errorText}</p>}
    {activityUnavailable && <p className="text-rose-300 break-words">{say('Activity could not be updated. The transaction hash remains on this page for status checks.', 'Chưa thể cập nhật Hoạt động. Mã giao dịch vẫn còn trên trang này để kiểm tra trạng thái.')}</p>}
    {checkpointUnavailable && <p className="text-rose-300 break-words">{say('Recovery could not be saved. Keep this transaction hash and check its status before leaving this page. Do not resubmit.', 'Chưa thể lưu trạng thái khôi phục. Hãy giữ mã giao dịch và kiểm tra trạng thái trước khi rời trang. Không gửi lại.')}</p>}
    {['idle', 'approval-confirmed', 'failed', 'rejected'].includes(stage) && (
      <>
        <Button variant="primary" disabled={busy || !amount} onClick={start}>{busy ? say('Checking…', 'Đang kiểm tra…') : say('Get live Circle quote and review', 'Lấy báo giá Circle và xem lại')}</Button>
        {busy && (
          <button
            type="button"
            onClick={() => { generation.current += 1; operation.current = undefined; setBusy(false); setError(say('Cancelled. Try again when the network is available.', 'Đã hủy. Thử lại khi mạng khả dụng.')); }}
            className={`text-[12px] ${T.sub} hover:text-white underline`}
          >{say('Cancel', 'Hủy')}</button>
        )}
      </>
    )}
    {stage === 'destination-confirmed' && <Button variant="primary" disabled={busy} onClick={complete}>{say('Done', 'Hoàn tất')}</Button>}
    {(stage === 'review-approval' || stage === 'review-burn') && <div className="flex gap-2 flex-wrap"><Button variant="primary" disabled={busy} onClick={confirm}>{busy ? say('Checking…', 'Đang kiểm tra…') : stage === 'review-approval' ? say('Review exact approval', 'Xem phê duyệt chính xác') : say('Review CCTP burn', 'Xem lệnh đốt CCTP')}</Button><Button disabled={busy} onClick={cancelReview}>{say('Cancel', 'Hủy')}</Button></div>}
    {hash && (['source-pending', 'source-unknown', 'source-confirmed', 'attestation-pending', 'attestation-available', 'forwarding-pending', 'forwarding-failed', 'destination-pending', 'destination-failed', 'status-unavailable'].includes(stage) || stage === 'destination-confirmed' && !completedActivity) && <Button disabled={busy} onClick={checkAgain}>{run.current?.step === 'approval' ? say('Check approval receipt', 'Kiểm tra biên nhận cấp quyền') : say('Check Arc receipt, Circle status and Base destination', 'Kiểm tra biên nhận Arc, trạng thái Circle và đích Base')}</Button>}
  </div>
}
