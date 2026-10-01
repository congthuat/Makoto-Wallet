import { useEffect, useRef, useState } from 'react'
import { formatUnits, type Hex } from 'viem'
import { useT } from '../lib/i18n.ts'
import { ARC, explorerTx, getProvider } from '../lib/wallet.ts'
import { SendSubmissionGuard } from '../lib/sendExecution.ts'
import { checkProtocolReceipt, isWalletRejection, pollProtocolReceipt, requestReviewedAction } from '../migrated/protocolExecution.ts'
import { createReview, evaluateToolPolicy, revalidateReview, verifyFiniteApproval, type ReviewSnapshot } from '../migrated/policy.ts'
import { prepareApproval, prepareSwap, quoteSwap, readAllowance, readBalance, readWallet, type PreparedToolAction, type SwapToolQuote } from '../migrated/toolLayer.ts'
import { XYLO_ROUTER } from '../migrated/swap.ts'
import { Button, T } from './wallet/ui.tsx'
import { useWallet } from '../lib/store.tsx'
import type { SwapRecord } from '../lib/protocolActivity.ts'
import { createStrategyRun, recoverStrategyRun, restoreStrategyRun, saveStrategyRun, transitionStrategy, type StrategyEvent, type StrategyRun } from '../migrated/strategyController.ts'

type Stage = 'idle' | 'review-approval' | 'review-swap' | 'pending' | 'approval-confirmed' | 'confirmed' | 'failed' | 'rejected' | 'unknown'
type Props = { account: string; from: string; to: string; amount: string; slip: '0.5%' | '1%' | '3%'; onConfirmed: () => Promise<unknown> }

export function LiveSwapControl({ account, from, to, amount, slip, onConfirmed }: Props) {
  const { upsertSwap } = useWallet()
  const [tr, lang] = useT()
  const vi = lang === 'vi'
  const say = (en: string, vn: string) => vi ? vn : en
  const [stage, setStage] = useState<Stage>('idle')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [errorFallback, setErrorFallback] = useState('Review unavailable.')
  const [quote, setQuote] = useState<SwapToolQuote>()
  const [prepared, setPrepared] = useState<PreparedToolAction>()
  const [review, setReview] = useState<ReviewSnapshot>()
  const [hash, setHash] = useState<Hex>()
  const [reviewedInput, setReviewedInput] = useState('')
  const guard = useRef(new SendSubmissionGuard())
  const run = useRef<StrategyRun | undefined>(undefined)
  const advance = (event: StrategyEvent) => {
    const current = run.current ?? createStrategyRun('swap', account, event.now)
    const result = transitionStrategy(current, event)
    if (!result.accepted) throw new Error(result.reason)
    run.current = result.state
    if (typeof localStorage !== 'undefined') saveStrategyRun(localStorage, result.state)
    return result.state
  }
  useEffect(() => {
    const restored = typeof localStorage === 'undefined' ? undefined : restoreStrategyRun(localStorage, 'swap', account)
    run.current = restored
    if (restored && ['RECOVERING', 'PENDING', 'UNKNOWN'].includes(restored.phase)) { setHash(restored.hash as Hex | undefined); setStage(restored.phase === 'PENDING' ? 'pending' : 'unknown') }
  }, [account])
  const slipValue = slip === '0.5%' ? 0.005 : slip === '1%' ? 0.01 : 0.03
  const recordFor = (submitted: Hex, action: PreparedToolAction, reviewedQuote: SwapToolQuote, status: SwapRecord['status']): SwapRecord => ({ hash: submitted, account: action.account, target: action.request.to, calldata: action.request.data, fromSymbol: from as 'USDC' | 'EURC', toSymbol: to as 'USDC' | 'EURC', amount, minimumOutputUnits: reviewedQuote.minimumReceive.toString(), timestamp: Date.now(), status })

  async function simulate(action: PreparedToolAction) {
    const p = getProvider()
    if (!p) return false
    try { await p.request({ method: 'eth_call', params: [action.request, 'latest'] }); return true }
    catch { return false }
  }

  async function start() {
    if (busy) return
    if (run.current && ['RECOVERING', 'PENDING', 'UNKNOWN', 'SUBMITTED', 'AWAITING_USER'].includes(run.current.phase)) { setError('Resolve the previous wallet request before starting another swap.'); return }
    if (!run.current || !['REVALIDATING', 'REQUOTING'].includes(run.current.phase)) run.current = createStrategyRun('swap', account)
    setBusy(true); setError(''); setErrorFallback('Review unavailable.'); setHash(undefined); setReview(undefined); setPrepared(undefined); setStage('idle')
    try {
      if ((from !== 'USDC' && from !== 'EURC') || (to !== 'USDC' && to !== 'EURC') || from === to) throw new Error('Live Xylo swap supports USDC and EURC only.')
      const p = getProvider(); if (!p) throw new Error('Wallet unavailable.')
      const result = await quoteSwap(p, { account, from, to, amount, slippage: slipValue })
      if (result.status !== 'OK' || !result.data) throw new Error(result.reason ?? 'Live quote unavailable.')
      const fresh = result.data
      if (run.current?.phase === 'REVALIDATING') advance({ type: 'allowance-reread', sufficient: fresh.allowance >= fresh.quote.amountIn, account, chainId: ARC.chainId, now: Date.now() })
      if (run.current?.phase === 'BLOCKED') throw new Error('Approval receipt did not establish sufficient allowance')
      setQuote(fresh)
      setReviewedInput(`${account.toLowerCase()}:${from}:${to}:${amount}:${slip}`)
      if (fresh.allowance < fresh.quote.amountIn) {
        const approval = await prepareApproval(p, { account, symbol: from, spender: XYLO_ROUTER, amount: fresh.quote.amountIn })
        if (!verifyFiniteApproval(approval, { symbol: from, spender: XYLO_ROUTER, amount: fresh.quote.amountIn })) throw new Error('Approval request mismatch')
        if (!await simulate(approval)) throw new Error('Finite approval simulation failed.')
        advance({ type: 'review', step: 'approval', account, chainId: ARC.chainId, expiresAt: Math.min(approval.expiresAt, fresh.expiresAt), quoteFresh: true, policyPassed: true, simulationPassed: true, now: Date.now() })
        setPrepared(approval); setStage('review-approval')
        return
      }
      const action = await prepareSwap(p, fresh)
      const simulation = await simulate(action) ? 'passed' : 'reverted'
      const policy = evaluateToolPolicy({ action, quote: fresh, account, chainId: ARC.chainId, simulation, now: Date.now(), balance: fresh.balance, allowance: fresh.allowance })
      if (policy.mustStop) throw new Error(policy.findings.map((finding) => finding.code).join(', '))
      advance({ type: 'review', step: 'swap', account, chainId: ARC.chainId, expiresAt: Math.min(action.expiresAt, fresh.expiresAt), quoteFresh: true, policyPassed: true, simulationPassed: simulation === 'passed', now: Date.now() })
      setPrepared(action); setReview(createReview(action, fresh, policy)); setStage('review-swap')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Review unavailable.') }
    finally { setBusy(false) }
  }

  async function confirm() {
    if (busy || !prepared || !quote || (stage !== 'review-approval' && stage !== 'review-swap')) return
    setBusy(true); setError(''); setErrorFallback('Wallet request failed.')
    try {
      if (reviewedInput !== `${account.toLowerCase()}:${from}:${to}:${amount}:${slip}`) throw new Error('Swap details changed. Review again.')
      const p = getProvider(); if (!p) throw new Error('Wallet unavailable.')
      const wallet = await readWallet(p)
      if (wallet.status !== 'OK' || !wallet.data || wallet.data.chainId !== ARC.chainId || wallet.data.account.toLowerCase() !== prepared.account.toLowerCase() || account.toLowerCase() !== prepared.account.toLowerCase()) throw new Error('Wallet account or chain changed. Review again.')
      if (Date.now() > prepared.expiresAt || Date.now() > quote.expiresAt) throw new Error('Quote expired. Review again.')
      const latestPrice = await p.request({ method: 'eth_gasPrice' })
      if (typeof latestPrice !== 'string' || BigInt(latestPrice) > BigInt(prepared.request.gasPrice)) throw new Error('Network fee changed. Review again.')
      const freshBalance = await readBalance(p, from, account)
      const freshAllowance = await readAllowance(p, from, XYLO_ROUTER, account)
      if (freshBalance.status !== 'OK' || !freshBalance.data || freshBalance.data.units < quote.quote.amountIn || freshAllowance.status !== 'OK' || !freshAllowance.data) throw new Error('Balance or allowance changed. Review again.')
      if (stage === 'review-approval') {
        if (!verifyFiniteApproval(prepared, { symbol: from as 'USDC' | 'EURC', spender: XYLO_ROUTER, amount: quote.quote.amountIn })) throw new Error('Approval request changed')
        if (freshAllowance.data.units >= quote.quote.amountIn) throw new Error('Approval is already sufficient. Refresh the swap review.')
        if (!await simulate(prepared)) throw new Error('Approval simulation failed.')
      } else {
        if (!review) throw new Error('Review unavailable.')
        const freshQuote = await quoteSwap(p, { account, from: from as 'USDC' | 'EURC', to: to as 'USDC' | 'EURC', amount, slippage: slipValue })
        if (freshQuote.status !== 'OK' || !freshQuote.data) throw new Error('Fresh quote unavailable.')
        const simulation = await simulate(prepared) ? 'passed' : 'reverted'
        const validated = revalidateReview(review, { action: prepared, quote: freshQuote.data, account, chainId: wallet.data.chainId, simulation, now: Date.now(), balance: freshBalance.data.units, allowance: freshAllowance.data.units })
        if (validated.status !== 'OK') throw new Error(validated.reason ?? 'Review changed.')
      }
      setStage('pending')
      advance({ type: 'wallet-request', binding: { from: prepared.account, to: prepared.request.to, data: prepared.request.data, symbol: from as 'USDC' | 'EURC', ...(stage === 'review-approval' ? { spender: XYLO_ROUTER, requiredUnits: quote.quote.amountIn.toString() } : { outputSymbol: to as 'USDC' | 'EURC', minimumOutputUnits: quote.minimumReceive.toString(), amount }) }, now: Date.now() })
      let submitted: Hex
      try { submitted = await requestReviewedAction(p, prepared, guard.current) }
      catch (caught) {
        if (isWalletRejection(caught)) { advance({ type: 'user-rejected', now: Date.now() }); setStage('rejected'); return }
        advance({ type: 'unknown', now: Date.now() }); setStage('unknown'); throw caught
      }
      advance({ type: 'hash', hash: submitted, now: Date.now() })
      setHash(submitted)
      if (stage === 'review-swap') upsertSwap(recordFor(submitted, prepared, quote, 'pending'))
      const outcome = await pollProtocolReceipt(p, prepared, submitted, stage === 'review-approval' ? { approval: { symbol: from as 'USDC' | 'EURC', spender: XYLO_ROUTER, minimum: quote.quote.amountIn } } : { swapQuote: quote }, () => { if (run.current?.phase === 'SUBMITTED') advance({ type: 'pending', now: Date.now() }) })
      advance({ type: outcome === 'confirmed' ? 'confirmed' : outcome === 'failed' ? 'failed' : 'unknown', now: Date.now() })
      if (stage === 'review-swap') upsertSwap(recordFor(submitted, prepared, quote, outcome === 'confirmed' ? 'completed' : outcome))
      if (outcome === 'confirmed' && stage === 'review-approval') { setStage('approval-confirmed'); await onConfirmed() }
      else if (outcome === 'confirmed') { setStage('confirmed'); await onConfirmed() }
      else setStage(outcome)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Wallet request failed.'); setStage((current) => current === 'pending' ? 'unknown' : current) }
    finally { setBusy(false) }
  }

  async function checkAgain() {
    if (!hash || busy) return
    const p = getProvider(); if (!p) return
    setBusy(true); setErrorFallback('Status unavailable. Check again later.')
    try {
      if (!prepared || !quote) {
        const restored = run.current
        if (restored) {
          const recovered = await recoverStrategyRun(p, restored)
          run.current = recovered; if (typeof localStorage !== 'undefined') saveStrategyRun(localStorage, recovered)
          setStage(recovered.phase === 'COMPLETED' ? 'confirmed' : recovered.phase === 'REVALIDATING' ? 'approval-confirmed' : recovered.phase === 'FAILED' ? 'failed' : recovered.phase === 'PENDING' ? 'pending' : 'unknown')
          if (recovered.phase === 'COMPLETED' || recovered.phase === 'REVALIDATING') await onConfirmed()
        }
        return
      }
      const result = await checkProtocolReceipt(p, prepared, hash, prepared.kind === 'approval' ? { approval: { symbol: from as 'USDC' | 'EURC', spender: XYLO_ROUTER, minimum: quote.quote.amountIn } } : { swapQuote: quote })
      if (result !== 'pending' && run.current) { const next = transitionStrategy(run.current, { type: result === 'confirmed' ? 'confirmed' : result === 'failed' ? 'failed' : 'unknown', now: Date.now() }); if (next.accepted) { run.current = next.state; if (typeof localStorage !== 'undefined') saveStrategyRun(localStorage, next.state) } }
      if (prepared.kind === 'swap') upsertSwap(recordFor(hash, prepared, quote, result === 'confirmed' ? 'completed' : result))
      if (result === 'confirmed') { setStage(prepared.kind === 'approval' ? 'approval-confirmed' : 'confirmed'); await onConfirmed() }
      else if (result === 'failed') setStage('failed')
      else setStage(result === 'pending' && run.current?.phase !== 'UNKNOWN' ? 'pending' : 'unknown')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Status unavailable. Check again later.')
      if (run.current?.phase !== 'COMPLETED' && run.current?.phase !== 'REVALIDATING' && run.current?.phase !== 'FAILED') setStage('unknown')
    } finally {
      setBusy(false)
    }
  }

  return <div className="mt-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3.5 text-[13px] space-y-3" aria-live="polite">
    <div className="font-semibold">{say('Live XyloNet swap', 'Hoán đổi trực tiếp qua XyloNet')}</div>
    {quote && <div className={T.sub}>{say('Live output', 'Nhận dự kiến')}: {formatUnits(quote.quote.amountOut, 6)} {to} · {say('Minimum', 'Tối thiểu')}: {formatUnits(quote.minimumReceive, 6)} {to} · {say('Quote expires in 45 seconds', 'Báo giá hết hạn sau 45 giây')}</div>}
    {stage === 'review-approval' && prepared && <p>{say('Review finite approval', 'Xem lại phê duyệt hữu hạn')}: {formatUnits(quote!.quote.amountIn, 6)} {from} · XyloNet · {say('wallet confirmation required', 'cần xác nhận trong ví')}</p>}
    {stage === 'review-swap' && prepared && <p>{say('Review exact wallet request', 'Xem lại yêu cầu ví chính xác')}: {amount} {from} → {to} · {say('maximum gas', 'gas tối đa')} {BigInt(prepared.request.gas) * BigInt(prepared.request.gasPrice)} wei</p>}
    {stage === 'pending' && <p>{say('Submitted or awaiting receipt. Do not retry until the hash is checked.', 'Đã gửi hoặc đang chờ biên nhận. Đừng thử lại trước khi kiểm tra mã giao dịch.')}</p>}
    {stage === 'approval-confirmed' && <p>{say('Approval confirmed. Refresh the quote and review the swap separately.', 'Phê duyệt đã xác nhận. Làm mới báo giá và xem lại giao dịch hoán đổi riêng biệt.')}</p>}
    {stage === 'confirmed' && <p>{say('Swap confirmed with matching output transfer evidence.', 'Giao dịch hoán đổi đã xác nhận với bằng chứng chuyển token nhận phù hợp.')}</p>}
    {stage === 'failed' && <p>{say('Transaction failed on Arc.', 'Giao dịch thất bại trên Arc.')}</p>}
    {stage === 'rejected' && <p>{say('Wallet request rejected. Nothing was submitted.', 'Yêu cầu ví bị từ chối. Chưa gửi giao dịch.')}</p>}
    {stage === 'unknown' && <p>{say('Final status unknown. Check the hash before any new attempt.', 'Chưa rõ trạng thái cuối. Kiểm tra mã giao dịch trước khi thử lại.')}</p>}
    {hash && <a href={explorerTx(hash)} target="_blank" rel="noreferrer" className="text-neon-300 break-all">{hash}</a>}
    {error && <p className="text-rose-300 break-words">{vi && tr(error) === error ? tr(errorFallback) : tr(error)}</p>}
    {(stage === 'idle' || stage === 'approval-confirmed' || stage === 'failed' || stage === 'rejected' || stage === 'confirmed') && <Button variant="primary" disabled={busy || !amount} onClick={start}>{busy ? say('Loading…', 'Đang tải…') : say('Get live quote and review', 'Lấy báo giá trực tiếp và xem lại')}</Button>}
    {(stage === 'review-approval' || stage === 'review-swap') && <div className="flex gap-2"><Button variant="primary" disabled={busy} onClick={confirm}>{busy ? say('Checking…', 'Đang kiểm tra…') : stage === 'review-approval' ? say('Confirm approval in wallet', 'Xác nhận phê duyệt trong ví') : say('Confirm swap in wallet', 'Xác nhận hoán đổi trong ví')}</Button><Button disabled={busy} onClick={() => { setStage('idle'); setPrepared(undefined); setReview(undefined) }}>{say('Cancel', 'Hủy')}</Button></div>}
    {(stage === 'unknown' || stage === 'pending') && hash && <Button disabled={busy} onClick={checkAgain}>{say('Check receipt again', 'Kiểm tra lại biên nhận')}</Button>}
  </div>
}
