import { useEffect, useRef, useState } from 'react'
import { formatUnits, type Hex } from 'viem'
import { useT } from '../lib/i18n.ts'
import { useWallet } from '../lib/store.tsx'
import { api } from '../lib/api.ts'
import { ARC, explorerTx, getProvider } from '../lib/wallet.ts'
import { SendSubmissionGuard } from '../lib/sendExecution.ts'
import { createReview, evaluateToolPolicy, revalidateReview, type ReviewSnapshot } from '../migrated/policy.ts'
import { isWalletRejection, pollProtocolReceipt, requestReviewedCctpAction } from '../migrated/protocolExecution.ts'
import { prepareCctpApproval, prepareCctpBurn, quoteBridge, readAllowance, readBalance, readGasBalance, readWallet, type BridgeToolQuote, type CctpTransferSpeed, type PreparedToolAction } from '../migrated/toolLayer.ts'
import { cctpGasEstimateChanged, getOfficialCctpStatus, sameCctpActionMaterial, sameCctpQuoteMaterial, simulatePreparedCctpCall } from '../protocols/circle/cctpAdapter.ts'
import { Button, T } from './wallet/ui.tsx'
import type { BridgeRecord } from '../lib/protocolActivity.ts'
import { createStrategyRun, recoverStrategyRun, restoreStrategyRun, saveStrategyRun, transitionStrategy, type StrategyEvent, type StrategyReceiptBinding, type StrategyRun } from '../migrated/strategyController.ts'

type Stage = 'idle' | 'review-approval' | 'review-burn' | 'source-pending' | 'source-unknown' | 'source-confirmed' | 'attestation-pending' | 'attestation-available' | 'forwarding-pending' | 'forwarding-failed' | 'destination-pending' | 'destination-confirmed' | 'destination-failed' | 'status-unavailable' | 'failed' | 'rejected'
export type LiveQuote = Readonly<{ amount: bigint; expectedReceive: bigint; maxFee: bigint; speed: CctpTransferSpeed }>
type LiveCctpProps = { account: string; amount: string; transferSpeed: CctpTransferSpeed; onSourceConfirmed: () => Promise<unknown>; onQuoteChange?: (quote?: LiveQuote) => void }

/** Arc Testnet → Base Sepolia USDC CCTP v2 only. Each approval and burn needs its own review and click. */
export function LiveCctpControl({ account, amount, transferSpeed, onSourceConfirmed, onQuoteChange }: LiveCctpProps) {
  const { upsertBridge } = useWallet()
  const [tr, lang] = useT()
  const say = (en: string, vn: string) => lang === 'vi' ? vn : en
  const [stage, setStage] = useState<Stage>('idle')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [quote, setQuote] = useState<BridgeToolQuote>()
  const [prepared, setPrepared] = useState<PreparedToolAction>()
  const [review, setReview] = useState<ReviewSnapshot>()
  const [reviewedInput, setReviewedInput] = useState('')
  const [hash, setHash] = useState<Hex>()
  const [destinationHash, setDestinationHash] = useState('')
  const guard = useRef(new SendSubmissionGuard())
  const run = useRef<StrategyRun | undefined>(undefined)

  const rememberRun = (next: StrategyRun) => {
    run.current = next
    if (typeof localStorage !== 'undefined') saveStrategyRun(localStorage, next)
  }
  const advance = (event: StrategyEvent) => {
    const current = run.current ?? createStrategyRun('cctp', account, event.now)
    const result = transitionStrategy(current, event)
    if (!result.accepted) throw new Error(result.reason)
    rememberRun(result.state)
    return result.state
  }

  useEffect(() => {
    const restored = typeof localStorage === 'undefined' ? undefined : restoreStrategyRun(localStorage, 'cctp', account)
    run.current = restored
    if (restored?.hash) setHash(restored.hash as Hex)
    if (restored && ['RECOVERING', 'PENDING', 'UNKNOWN', 'SOURCE_CONFIRMED', 'DESTINATION_PENDING', 'FORWARDING_FAILED', 'DESTINATION_FAILED'].includes(restored.phase)) {
      const nextStage: Stage = restored.phase === 'PENDING' ? 'source-pending' : restored.phase === 'SOURCE_CONFIRMED' ? 'source-confirmed' : restored.phase === 'DESTINATION_PENDING' ? 'destination-pending' : restored.phase === 'FORWARDING_FAILED' ? 'forwarding-failed' : restored.phase === 'DESTINATION_FAILED' ? 'destination-failed' : 'source-unknown'
      setStage(nextStage)
    }
  }, [account])

  useEffect(() => {
    setQuote(undefined)
    setPrepared(undefined); setReview(undefined)
    setStage((current) => current === 'review-approval' || current === 'review-burn' ? 'idle' : current)
  }, [account, amount, transferSpeed])

  const publishQuote = (value: BridgeToolQuote) => {
    setQuote(value)
    onQuoteChange?.({ amount: value.amount, expectedReceive: value.expectedReceive, maxFee: value.maxFee, speed: value.transferSpeed })
  }
  const recordFor = (txHash: Hex, action: PreparedToolAction, q: BridgeToolQuote, status: BridgeRecord['status']): BridgeRecord => ({
    hash: txHash, account: action.account, target: action.request.to, calldata: action.request.data,
    amount: formatUnits(q.amount, 6), expectedReceiveUnits: q.expectedReceive.toString(),
    destinationDomain: q.destinationDomain, maxFeeUnits: q.maxFee.toString(),
    finalityThreshold: action.cctp?.finalityThreshold?.toString(), timestamp: Date.now(), status,
  })
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

  function setReviewFor(action: PreparedToolAction, q: BridgeToolQuote, decision: ReturnType<typeof evaluateToolPolicy>, step: 'approval' | 'cctp-burn') {
    const now = Date.now()
    advance({ type: 'review', step, account, chainId: ARC.chainId, expiresAt: Math.min(action.expiresAt, q.expiresAt), quoteFresh: true, policyPassed: true, simulationPassed: true, now })
    setPrepared(action)
    setReview(createReview(action, q, decision, now))
    setStage(step === 'approval' ? 'review-approval' : 'review-burn')
    setReviewedInput(captureInput())
  }

  async function start() {
    if (busy) return
    const phase = run.current?.phase
    if (phase && ['RECOVERING', 'PENDING', 'UNKNOWN', 'SUBMITTED', 'AWAITING_USER', 'SOURCE_CONFIRMED', 'DESTINATION_PENDING', 'FORWARDING_FAILED', 'DESTINATION_FAILED'].includes(phase)) {
      setError('Resolve the previous CCTP transfer before preparing another.')
      return
    }
    if (!phase || ['FAILED', 'USER_REJECTED', 'COMPLETED', 'EXPIRED', 'BLOCKED'].includes(phase)) rememberRun(createStrategyRun('cctp', account))
    setBusy(true); setError('')
    try {
      const p = getProvider()
      if (!p) throw new Error('Wallet provider unavailable.')
      await walletContext(p)
      const result = await quoteBridge(p, { account, amount, asset: 'USDC', sourceChainId: ARC.chainId, destinationChainId: 84532, transferSpeed })
      if (result.status !== 'OK' || !result.data) throw new Error(result.reason ?? 'Official Circle fee quote unavailable.')
      const q = result.data
      publishQuote(q)
      const current = await evidence(p, q)
      if (run.current?.phase === 'REVALIDATING') {
        const sufficient = current.allowance >= q.totalDebit
        advance({ type: 'allowance-reread', sufficient, account, chainId: ARC.chainId, now: Date.now() })
        if (!sufficient) throw new Error('Approval receipt did not establish sufficient allowance.')
      }
      if (current.allowance < q.totalDebit) {
        const approval = await prepareCctpApproval(p, q, current.allowance)
        const policy = await simulateAndEvaluate(approval, q, current)
        setReviewFor(approval, q, policy, 'approval')
        return
      }
      const action = await prepareCctpBurn(p, q)
      const policy = await simulateAndEvaluate(action, q, current)
      setReviewFor(action, q, policy, 'cctp-burn')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'CCTP review unavailable.') }
    finally { setBusy(false) }
  }

  async function reconcileDestination(p: NonNullable<ReturnType<typeof getProvider>>, burnHash: Hex, binding: StrategyReceiptBinding, baseRecord: BridgeRecord) {
    if (!binding.recipient || !binding.expectedReceiveUnits || !binding.destinationDomain || !binding.maxFeeUnits || !binding.finalityThreshold) {
      setStage('status-unavailable'); setError('Saved CCTP verification details are incomplete; source remains confirmed.')
      return
    }
    const status = await getOfficialCctpStatus(p, {
      account: binding.from as `0x${string}`, burnHash,
      destinationDomain: binding.destinationDomain, recipient: binding.recipient as `0x${string}`,
      expectedReceive: BigInt(binding.expectedReceiveUnits), maxFee: BigInt(binding.maxFeeUnits), finalityThreshold: BigInt(binding.finalityThreshold),
    })
    if (status.state === 'unavailable') { setStage('status-unavailable'); setError(status.reason ?? 'Circle status unavailable. Check again later.'); return }
    if (status.state === 'forwarding-failed') {
      if (run.current && ['SOURCE_CONFIRMED', 'DESTINATION_PENDING'].includes(run.current.phase)) advance({ type: 'forwarding-failed', now: Date.now() })
      setStage('forwarding-failed'); upsertBridge({ ...baseRecord, status: 'forwarding-failed' }); return
    }
    if (!status.forwardTxHash) {
      const pendingStage: Stage = status.state === 'attestation-pending' ? 'attestation-pending' : status.state === 'attestation-available' ? 'attestation-available' : 'forwarding-pending'
      setStage(pendingStage); upsertBridge({ ...baseRecord, status: 'attesting' }); return
    }
    setDestinationHash(status.forwardTxHash)
    const response = await fetch(api(`cctp/destination?txHash=${status.forwardTxHash}&recipient=${binding.recipient}&minimumUnits=${binding.expectedReceiveUnits}`), { cache: 'no-store' })
    const data = response.ok ? await response.json() as { status?: string } : undefined
    const destinationState = data?.status === 'confirmed' ? 'destination-confirmed' : data?.status === 'failed' ? 'destination-failed' : 'destination-pending'
    if (destinationState === 'destination-confirmed' && run.current && ['SOURCE_CONFIRMED', 'DESTINATION_PENDING'].includes(run.current.phase)) advance({ type: 'destination-confirmed', now: Date.now() })
    else if (destinationState === 'destination-failed' && run.current && ['SOURCE_CONFIRMED', 'DESTINATION_PENDING'].includes(run.current.phase)) advance({ type: 'destination-failed', now: Date.now() })
    else if (destinationState === 'destination-pending' && run.current && ['SOURCE_CONFIRMED', 'DESTINATION_PENDING'].includes(run.current.phase)) advance({ type: 'destination-pending', now: Date.now() })
    setStage(destinationState)
    upsertBridge({ ...baseRecord, destinationHash: status.forwardTxHash, status: destinationState })
  }

  async function confirm() {
    if (busy || !prepared || !quote || !review || (stage !== 'review-approval' && stage !== 'review-burn')) return
    setBusy(true); setError('')
    try {
      if (reviewedInput !== captureInput()) throw new Error('Amount, account or transfer speed changed. Review again.')
      const p = getProvider()
      if (!p) throw new Error('Wallet provider unavailable.')
      const wallet = await walletContext(p)
      let freshQuote = quote
      if (Date.now() >= quote.expiresAt) {
        const freshQuoteResult = await quoteBridge(p, { account, amount, asset: 'USDC', sourceChainId: ARC.chainId, destinationChainId: 84532, transferSpeed })
        if (freshQuoteResult.status !== 'OK' || !freshQuoteResult.data) throw new Error(freshQuoteResult.reason ?? 'Official Circle fee quote unavailable.')
        freshQuote = freshQuoteResult.data
      }
      const current = await evidence(p, freshQuote)
      const wasApproval = stage === 'review-approval'

      if (wasApproval && current.allowance >= freshQuote.totalDebit) {
        publishQuote(freshQuote); setPrepared(undefined); setReview(undefined); setStage('idle')
        setError('Allowance is sufficient now. Start a new burn review.')
        return
      }
      if (!wasApproval && current.allowance < freshQuote.totalDebit) {
        rememberRun(createStrategyRun('cctp', account))
        const approval = await prepareCctpApproval(p, freshQuote, current.allowance)
        const policy = await simulateAndEvaluate(approval, freshQuote, current)
        publishQuote(freshQuote); setReviewFor(approval, freshQuote, policy, 'approval')
        setError('Allowance changed. Review this separate exact approval.')
        return
      }

      const freshAction = wasApproval
        ? await prepareCctpApproval(p, freshQuote, current.allowance)
        : await prepareCctpBurn(p, freshQuote)
      const policy = await simulateAndEvaluate(freshAction, freshQuote, current)
      const materialSame = sameCctpQuoteMaterial(quote, freshQuote) && sameCctpActionMaterial(prepared, freshAction)
      const gasChanged = cctpGasEstimateChanged(prepared.gasEstimate, freshAction.gasEstimate)
      const reviewExpired = Date.now() >= review.expiresAt
      if (!materialSame || gasChanged || reviewExpired) {
        publishQuote(freshQuote)
        setPrepared(freshAction)
        setReview(createReview(freshAction, freshQuote, policy))
        setReviewedInput(captureInput())
        setError(!materialSame ? 'Circle fee or request changed. Review the refreshed request, then confirm again.' : gasChanged ? 'Fresh gas estimate updated. Review the maximum Arc gas fee, then confirm again.' : 'Review expired. Check the refreshed request, then confirm again.')
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
      advance({ type: 'wallet-request', binding: bindingFor(freshAction, freshQuote, wasApproval), now: Date.now() })
      let submitted: Hex
      try { submitted = await requestReviewedCctpAction(freshAction, guard.current) }
      catch (caught) {
        if (isWalletRejection(caught)) { advance({ type: 'user-rejected', now: Date.now() }); setStage('rejected'); return }
        advance({ type: 'unknown', now: Date.now() }); setStage('source-unknown'); throw caught
      }
      advance({ type: 'hash', hash: submitted, now: Date.now() })
      setHash(submitted)
      if (!wasApproval) upsertBridge(recordFor(submitted, freshAction, freshQuote, 'source-pending'))
      const result = await pollProtocolReceipt(p, freshAction, submitted, wasApproval ? { approval: { symbol: 'USDC', spender: freshQuote.spender, minimum: freshQuote.totalDebit } } : {}, () => {
        if (run.current?.phase === 'SUBMITTED') advance({ type: 'pending', now: Date.now() })
      })
      advance({ type: result === 'confirmed' ? 'confirmed' : result === 'failed' ? 'failed' : 'unknown', now: Date.now() })
      if (wasApproval) {
        setStage(result === 'confirmed' ? 'source-confirmed' : result === 'failed' ? 'failed' : 'source-unknown')
        if (result === 'confirmed') await onSourceConfirmed()
      } else {
        const nextStatus = result === 'confirmed' ? 'source-confirmed' : result === 'failed' ? 'failed' : 'source-unknown'
        upsertBridge(recordFor(submitted, freshAction, freshQuote, nextStatus))
        setStage(nextStatus)
        if (result === 'confirmed') await onSourceConfirmed()
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'CCTP wallet request failed.')
      setStage((current) => current === 'source-pending' ? 'source-unknown' : current)
    } finally { setBusy(false) }
  }

  async function checkAgain() {
    if (busy || !hash) return
    const p = getProvider()
    if (!p) return
    setBusy(true); setError('')
    try {
      const wallet = await walletContext(p)
      const currentRun = run.current
      if (!currentRun) throw new Error('No saved CCTP receipt details are available.')
      const recovered = await recoverStrategyRun(p, currentRun)
      rememberRun(recovered)
      if (recovered.phase === 'PENDING') { setStage('source-pending'); return }
      if (recovered.phase === 'FAILED') { setStage('failed'); return }
      if (recovered.phase !== 'SOURCE_CONFIRMED' && recovered.phase !== 'DESTINATION_PENDING') { setStage('source-unknown'); return }
      await onSourceConfirmed()
      const binding = recovered.binding
      if (!binding || !recovered.hash) throw new Error('Saved CCTP receipt details are incomplete.')
      const baseRecord: BridgeRecord = {
        hash: recovered.hash, account: wallet.account, target: binding.to, calldata: binding.data,
        amount: binding.amount ?? '0', expectedReceiveUnits: binding.expectedReceiveUnits ?? '0',
        destinationDomain: binding.destinationDomain, maxFeeUnits: binding.maxFeeUnits,
        finalityThreshold: binding.finalityThreshold, timestamp: recovered.updatedAt, status: 'source-confirmed',
      }
      upsertBridge(baseRecord)
      await reconcileDestination(p, recovered.hash as Hex, binding, baseRecord)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'CCTP status unavailable.') }
    finally { setBusy(false) }
  }

  const liveMaxGas = prepared?.gasEstimate ? formatUnits(prepared.gasEstimate.maximumFee, 18) : undefined
  return <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3.5 text-[13px] space-y-3" aria-live="polite">
    <div className="font-semibold">{say('Direct Circle CCTP v2 · Arc → Base Sepolia', 'Circle CCTP v2 trực tiếp · Arc → Base Sepolia')}</div>
    {quote && <div className={T.sub}>
      <p>{say('Gross USDC amount', 'Số USDC chuyển')} {formatUnits(quote.amount, 6)} · {say('Receive floor', 'Nhận tối thiểu')} {formatUnits(quote.expectedReceive, 6)} USDC</p>
      <p>{say('Circle maximum fee', 'Phí Circle tối đa')} {formatUnits(quote.maxFee, 6)} USDC · {say('Speed', 'Tốc độ')} {quote.transferSpeed === 'FAST' ? say('Fast', 'Nhanh') : say('Standard', 'Tiêu chuẩn')}</p>
    </div>}
    {prepared && liveMaxGas && <p className={T.sub}>{say('Estimated Arc gas ceiling', 'Phí gas Arc ước tính tối đa')}: {liveMaxGas} USDC</p>}
    {stage === 'review-approval' && quote && <p>{say('Exact finite USDC approval', 'Phê duyệt USDC hữu hạn chính xác')}: {formatUnits(quote.totalDebit, 6)} USDC. {say('This is a separate wallet confirmation.', 'Đây là xác nhận ví riêng.')}</p>}
    {stage === 'review-burn' && <p>{say('Review the Circle CCTP source burn. Destination completes only after Base receipt and USDC transfer evidence.', 'Xem lại lệnh đốt CCTP của Circle. Chỉ hoàn tất khi có biên nhận Base và bằng chứng chuyển USDC.')}</p>}
    {stage === 'source-pending' && <p>{say('Awaiting Arc receipt. Do not submit this transfer again.', 'Đang chờ biên nhận Arc. Không gửi lại giao dịch này.')}</p>}
    {stage === 'source-unknown' && <p>{say('Source status is unknown. Check the saved hash before retrying.', 'Chưa rõ trạng thái nguồn. Kiểm tra mã giao dịch đã lưu trước khi thử lại.')}</p>}
    {stage === 'source-confirmed' && <p>{prepared?.kind === 'approval' ? say('Approval confirmed. Refresh the fee quote and review the burn separately.', 'Đã xác nhận phê duyệt. Làm mới báo giá và xem lệnh đốt riêng.') : say('Arc source confirmed. Circle attestation and Base destination are still pending.', 'Nguồn Arc đã xác nhận. Chứng thực Circle và đích Base vẫn đang chờ.')}</p>}
    {stage === 'attestation-pending' && <p>{say('Circle attestation is pending.', 'Chứng thực Circle đang chờ.')}</p>}
    {stage === 'attestation-available' && <p>{say('Circle attestation is available. Waiting for its forwarded transaction.', 'Đã có chứng thực Circle. Đang chờ giao dịch chuyển tiếp.')}</p>}
    {stage === 'forwarding-pending' && <p>{say('Circle forwarding is pending.', 'Chuyển tiếp Circle đang chờ.')}</p>}
    {stage === 'forwarding-failed' && <p>{say('Circle forwarding failed. The Arc burn remains confirmed; destination funds are not confirmed.', 'Chuyển tiếp Circle thất bại. Lệnh đốt Arc vẫn đã xác nhận; tiền ở đích chưa được xác nhận.')}</p>}
    {stage === 'destination-pending' && <p>{say('Forward transaction observed. Waiting for verified Base receipt and USDC transfer.', 'Đã thấy giao dịch chuyển tiếp. Đang chờ biên nhận Base và chuyển USDC được xác minh.')}</p>}
    {stage === 'destination-confirmed' && <p>{say('Destination confirmed by Base receipt and matching USDC transfer.', 'Đích đã xác nhận bằng biên nhận Base và chuyển USDC phù hợp.')}</p>}
    {stage === 'destination-failed' && <p>{say('The forwarded Base transaction failed. The Arc burn remains confirmed.', 'Giao dịch Base chuyển tiếp thất bại. Lệnh đốt Arc vẫn đã xác nhận.')}</p>}
    {stage === 'status-unavailable' && <p>{say('Circle status is unavailable. The confirmed Arc burn remains pending destination evidence.', 'Không thể lấy trạng thái Circle. Lệnh đốt Arc đã xác nhận nhưng vẫn thiếu bằng chứng đích.')}</p>}
    {stage === 'failed' && <p>{say('Arc source transaction failed.', 'Giao dịch nguồn Arc thất bại.')}</p>}
    {stage === 'rejected' && <p>{say('Wallet request rejected. No transaction was submitted.', 'Ví đã từ chối yêu cầu. Chưa gửi giao dịch.')}</p>}
    {hash && <a className="block break-all text-neon-300" href={explorerTx(hash)} target="_blank" rel="noreferrer">{hash}</a>}
    {destinationHash && <a className="block break-all text-neon-300" href={`https://sepolia.basescan.org/tx/${destinationHash}`} target="_blank" rel="noreferrer">{destinationHash}</a>}
    {error && <p className="text-rose-300 break-words">{lang === 'vi' && tr(error) === error ? tr('CCTP review or status unavailable.') : tr(error)}</p>}
    {['idle', 'source-confirmed', 'failed', 'rejected', 'destination-confirmed'].includes(stage) && (stage === 'idle' || prepared?.kind === 'approval' || run.current?.phase === 'REVALIDATING' || ['failed', 'rejected', 'destination-confirmed'].includes(stage)) && <Button variant="primary" disabled={busy || !amount} onClick={start}>{busy ? say('Checking…', 'Đang kiểm tra…') : say('Get live Circle quote and review', 'Lấy báo giá Circle và xem lại')}</Button>}
    {(stage === 'review-approval' || stage === 'review-burn') && <div className="flex gap-2 flex-wrap"><Button variant="primary" disabled={busy} onClick={confirm}>{busy ? say('Checking…', 'Đang kiểm tra…') : stage === 'review-approval' ? say('Review exact approval', 'Xem phê duyệt chính xác') : say('Review CCTP burn', 'Xem lệnh đốt CCTP')}</Button><Button disabled={busy} onClick={() => { rememberRun(createStrategyRun('cctp', account)); setPrepared(undefined); setReview(undefined); setStage('idle'); setError('') }}>{say('Cancel', 'Hủy')}</Button></div>}
    {hash && ['source-pending', 'source-unknown', 'source-confirmed', 'attestation-pending', 'attestation-available', 'forwarding-pending', 'forwarding-failed', 'destination-pending', 'destination-failed', 'status-unavailable'].includes(stage) && <Button disabled={busy} onClick={checkAgain}>{say('Check Arc receipt, Circle status and Base destination', 'Kiểm tra biên nhận Arc, trạng thái Circle và đích Base')}</Button>}
  </div>
}
