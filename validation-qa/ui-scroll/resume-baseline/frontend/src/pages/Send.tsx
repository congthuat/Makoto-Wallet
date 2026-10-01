import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, BookUser, Check, CheckCircle2, Circle, Clock, FileCheck2, Fuel, Loader2, PenLine, Send as SendIcon, XCircle, Zap } from 'lucide-react'
import { useWallet } from '../lib/store'
import { ARC, TOKENS, fmtAmt, getProvider, isAddress, short, usd } from '../lib/wallet'
import { Avatar, Badge, Button, Card, Field, PageHeader, PreviewTag, Segmented, T, TokenIcon, inputCls } from '../components/wallet/ui'
import { useT } from '../lib/i18n'
import { consumeBrainHandoff } from '../brain/handoff'
import { useDismissibleOverlay } from '../lib/useDismissibleOverlay'
import { prepareBrainReview, revalidateBrainReview } from '../brain/policy'
import type { BrainPreparation, BrainReviewSnapshot } from '../brain/types'
import { SendSubmissionGuard, assertFreshSend, feeInUsdcUnits, formatSendAmount, isWalletRejection, parseSendAmount, pollSendReceipt, prepareSend, requestSend, safeMax, type PreparedSend, type SendStatus } from '../lib/sendExecution'
import { explorerTx } from '../lib/wallet'

type Stage = 'form' | 'review' | 'preview' | 'result'
const PREVIEW_STATES = ['Prepared', 'Wallet signature', 'Submitted', 'Confirming', 'Completed', 'Failed'] as const
type PreviewState = (typeof PREVIEW_STATES)[number]
const STATE_COPY: Record<PreviewState, { icon: any; cls: string; title: string; desc: string }> = {
  Prepared: { icon: FileCheck2, cls: 'text-neon-300', title: 'Transaction prepared', desc: 'The transaction is built and reviewed. Nothing has been signed yet.' },
  'Wallet signature': { icon: PenLine, cls: 'text-neon-300', title: 'Sign in your wallet', desc: 'Your wallet would open here and ask you to authorize this transaction. Makoto cannot sign for you.' },
  Submitted: { icon: SendIcon, cls: 'text-sky-200', title: 'Submitted', desc: 'The signed transaction was sent to the network. It is not final yet.' },
  Confirming: { icon: Loader2, cls: 'text-amber-200 animate-spin', title: 'Confirming', desc: 'Waiting for the network to include the transaction in a block. Status is pending, not completed.' },
  Completed: { icon: CheckCircle2, cls: 'text-live', title: 'Completed', desc: 'Shown only after the network reports a successful receipt.' },
  Failed: { icon: XCircle, cls: 'text-rose-300', title: 'Failed', desc: 'The network reported a failure or the request was rejected in the wallet.' },
}

const SEND_VI: Record<string, string> = {
  Review: 'Xem lại', 'Valid address format': 'Địa chỉ đúng định dạng', 'Not a token contract': 'Không phải hợp đồng token', 'Known recipient': 'Người nhận đã biết', 'Enough balance incl. fee': 'Đủ số dư gồm cả phí',
  'Enter recipient': 'Nhập người nhận', 'Enter amount': 'Nhập số tiền', 'Check the details above': 'Kiểm tra chi tiết bên trên',
  'Enter an amount greater than 0': 'Nhập số tiền lớn hơn 0', 'Not enough USDC left for the network fee': 'Không đủ USDC để trả phí mạng',
  'Invalid address — must be 0x followed by 40 hex characters': 'Địa chỉ không hợp lệ — cần 0x và 40 ký tự hex',
  'This is a token contract, not a wallet. Funds sent here are usually lost.': 'Đây là hợp đồng token, không phải ví. Tài sản gửi vào đây thường bị mất.',
  'This is your own address': 'Đây là địa chỉ của chính bạn',
  'First time sending to this address. Double-check the first and last characters.': 'Lần đầu gửi đến địa chỉ này. Hãy kiểm tra kỹ ký tự đầu và cuối.',
  'Check the details. Transfers on Arc are final once confirmed.': 'Kiểm tra chi tiết. Giao dịch trên Arc là vĩnh viễn sau khi xác nhận.',
  'Large transfer (≥ $100). Transactions on {network} are final and cannot be reversed.': 'Giao dịch lớn (≥ 100 USD). Giao dịch trên {network} là vĩnh viễn và không thể hoàn tác.',
  'Confirm in wallet': 'Xác nhận trong ví', 'Preparing live review…': 'Đang chuẩn bị xem lại bằng dữ liệu trực tiếp…',
  'Checking live balance and fee…': 'Đang kiểm tra số dư và phí trực tiếp…', 'Wallet required for live Send': 'Cần kết nối ví để gửi thật',
  'Unavailable until live checks pass': 'Chưa khả dụng cho đến khi kiểm tra trực tiếp đạt',
  'Maximum fee': 'Phí tối đa', 'Awaiting wallet confirmation': 'Đang chờ xác nhận trong ví',
  'Wallet request cancelled': 'Đã hủy yêu cầu trong ví', 'Submitted; waiting for receipt': 'Đã gửi; đang chờ biên nhận',
  'Transaction confirmed': 'Giao dịch đã xác nhận', 'Transaction failed': 'Giao dịch thất bại',
  'Final status unknown; check the transaction before retrying': 'Chưa rõ trạng thái cuối; kiểm tra giao dịch trước khi thử lại',
  'Check transaction again': 'Kiểm tra lại giao dịch', 'View on ArcScan': 'Xem trên ArcScan',
  'Review again': 'Xem lại', 'Wallet rejected; nothing was submitted.': 'Ví đã từ chối; chưa có giao dịch nào được gửi.',
  'Connected wallet or network changed. Review again.': 'Ví hoặc mạng đã thay đổi. Hãy xem lại.',
  'Review expired or details changed. Review again.': 'Bản xem lại đã hết hạn hoặc chi tiết đã thay đổi. Hãy xem lại.',
  'No live balance or fee available': 'Không có số dư hoặc phí trực tiếp', 'Asset unavailable': 'Tài sản chưa khả dụng',
  'Contract recipients are unavailable': 'Chưa hỗ trợ gửi đến hợp đồng',
  'Insufficient USDC for amount and fee': 'Không đủ USDC cho số tiền và phí',
  'Fee estimate unavailable': 'Không có ước tính phí', 'Wrong network: Arc Testnet is required': 'Sai mạng: cần Arc Testnet',
  'Wallet network unavailable': 'Không thể xác định mạng của ví',
  'Wallet disconnected': 'Ví đã ngắt kết nối', 'Connected account changed': 'Tài khoản kết nối đã thay đổi',
  'Invalid recipient': 'Địa chỉ người nhận không hợp lệ', 'Contract recipient is unavailable': 'Chưa hỗ trợ địa chỉ hợp đồng',
  'Invalid amount precision': 'Số chữ số thập phân không hợp lệ', 'Enter a positive amount': 'Nhập số tiền lớn hơn 0',
  'Self-send is blocked': 'Không thể gửi đến chính ví này', 'Unsupported asset': 'Tài sản chưa được hỗ trợ',
  'Send review changed or expired. Review again.': 'Bản xem lại đã thay đổi hoặc hết hạn. Hãy xem lại.',
  'Unable to complete this wallet request. Check the wallet and try again.': 'Không thể hoàn tất yêu cầu trong ví. Hãy kiểm tra ví rồi thử lại.',
  'After wallet approval': 'Sau khi xác nhận trong ví',
  Prepared: 'Đã chuẩn bị', 'Wallet signature': 'Xác nhận trong ví', Submitted: 'Đã gửi', Confirming: 'Đang xác nhận', Completed: 'Hoàn thành', Failed: 'Thất bại',
  'Transaction prepared': 'Giao dịch đã chuẩn bị', 'The transaction is built and reviewed. Nothing has been signed yet.': 'Giao dịch đã được chuẩn bị và xem lại. Chưa có gì được ký.',
  'Sign in your wallet': 'Xác nhận trong ví', 'Your wallet would open here and ask you to authorize this transaction. Makoto cannot sign for you.': 'Ví của bạn sẽ mở để yêu cầu bạn xác nhận giao dịch. Makoto không thể ký thay bạn.',
  'The signed transaction was sent to the network. It is not final yet.': 'Giao dịch đã ký được gửi lên mạng nhưng chưa có kết quả cuối cùng.',
  'Waiting for the network to include the transaction in a block. Status is pending, not completed.': 'Đang chờ mạng đưa giao dịch vào khối. Trạng thái vẫn đang chờ, chưa hoàn thành.',
  'Shown only after the network reports a successful receipt.': 'Chỉ hiển thị khi mạng trả về biên nhận thành công.',
  'The network reported a failure or the request was rejected in the wallet.': 'Mạng báo giao dịch thất bại hoặc ví đã từ chối yêu cầu.',
}

export default function SendPage() {
  const { holdings, network, contacts, sendDraft, setSendDraft, mode, address, walletChainId, settings, activity, go, mask, notify, upsertSend, refetchWallet } = useWallet()
  const [tr, lang] = useT()
  const s = (value: string) => lang === 'vi' ? SEND_VI[value] ?? tr(value) : tr(value)
  const localError = (error: unknown) => {
    const message = error instanceof Error ? error.message : ''
    const translated = s(message)
    return lang === 'vi' && translated === message ? s('Unable to complete this wallet request. Check the wallet and try again.') : translated
  }
  const [symbol, setSymbol] = useState('USDC')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [stage, setStage] = useState<Stage>('form')
  const [ack, setAck] = useState(false)
  const [showBook, setShowBook] = useState(false)
  const bookTriggerRef = useRef<HTMLButtonElement>(null)
  const bookPanelRef = useRef<HTMLDivElement>(null)
  const closeBook = useCallback(() => setShowBook(false), [])
  useDismissibleOverlay(showBook, bookTriggerRef, bookPanelRef, closeBook)
  const [pv, setPv] = useState<PreviewState>('Wallet signature')
  const [wantReview, setWantReview] = useState(false)
  const [brainReview, setBrainReview] = useState<BrainReviewSnapshot | null>(null)
  const [prepared, setPrepared] = useState<PreparedSend | null>(null)
  const [sendStatus, setSendStatus] = useState<SendStatus>('READY')
  const [sendHash, setSendHash] = useState<string | null>(null)
  const [sendError, setSendError] = useState('')
  const [busy, setBusy] = useState(false)
  const submitGuard = useRef(new SendSubmissionGuard())

  useEffect(() => {
    if (!sendDraft) return
    if (sendDraft.symbol) setSymbol(sendDraft.symbol)
    if (sendDraft.to) setTo(sendDraft.to)
    if (sendDraft.amount) setAmount(sendDraft.amount)
    if (sendDraft.review) setWantReview(true)
    setSendDraft(null)
  }, [sendDraft, setSendDraft])

  useEffect(() => {
    if (mode !== 'connected' || !address || typeof sessionStorage === 'undefined') return
    const handoff = consumeBrainHandoff(sessionStorage, address)
    if (!handoff || handoff.action !== 'send') return
    if (handoff.asset) setSymbol(handoff.asset)
    if (handoff.recipient) setTo(handoff.recipient)
    if (handoff.amount) setAmount(handoff.amount)
    setWantReview(true)
  }, [mode, address])

  useEffect(() => { setBrainReview(null); setPrepared(null); setStage((current) => current === 'review' ? 'form' : current) }, [mode, address, walletChainId])

  const meta = TOKENS.find((t) => t.sym === symbol)!
  const h = holdings.find((x) => x.verified && x.symbol === symbol)
  const bal = h?.balance ?? 0
  const price = h?.price
  const amt = Number(amount) || 0
  const fee = mode === 'connected' ? prepared ? Number(prepared.fee) / 1e18 : undefined : network?.tokenTransferFeeUsdc
  const feeLabel = mode === 'connected' ? prepared ? `${formatSendAmount(feeInUsdcUnits(prepared.fee), 6)} USDC` : undefined : fee !== undefined ? `${fee.toFixed(6)} USDC` : undefined
  const totalLabel = mode === 'connected' && prepared
    ? symbol === 'USDC' ? `${formatSendAmount(prepared.units + feeInUsdcUnits(prepared.fee), 6)} USDC` : `${formatSendAmount(prepared.units, meta.decimals)} ${symbol} + ${formatSendAmount(feeInUsdcUnits(prepared.fee), 6)} USDC`
    : fee === undefined ? undefined : symbol === 'USDC' ? `${fmtAmt(amt + fee)} USDC` : `${amount} ${symbol} + ${fee.toFixed(6)} USDC`
  const usdcBal = holdings.find((x) => x.symbol === 'USDC')?.balance ?? 0

  const toValid = isAddress(to)
  const contact = contacts.find((c) => c.address.toLowerCase() === to.trim().toLowerCase())
  const knownBefore = activity.some((a) => a.counterparty.toLowerCase() === to.trim().toLowerCase())
  const isTokenContract = TOKENS.some((t) => t.address.toLowerCase() === to.trim().toLowerCase())
  const isSelf = mode !== 'demo' && to.trim().toLowerCase() === address.toLowerCase()

  const amountUnits = (() => { try { return parseSendAmount(amount, meta.decimals) } catch { return undefined } })()
  const amountErr = !amount ? null : (amount.split('.')[1]?.length ?? 0) > meta.decimals ? `Max ${meta.decimals} decimals` : !amountUnits ? 'Invalid amount precision' : mode !== 'connected' && amt > bal ? `Insufficient ${symbol} balance` : mode !== 'connected' && symbol === 'USDC' && fee !== undefined && amt + fee > usdcBal ? 'Not enough USDC left for the network fee' : null
  const toErr = to && !toValid ? 'Invalid address — must be 0x followed by 40 hex characters' : isTokenContract ? 'This is a token contract, not a wallet. Funds sent here are usually lost.' : isSelf ? 'This is your own address' : null
  const canReview = toValid && !toErr && !!amountUnits && !amountErr && (mode !== 'connected' || walletChainId === ARC.chainId)
  const usdValue = price != null ? amt * price : undefined
  const large = settings.confirmLarge && (usdValue ?? 0) >= 100

  const brainAction = (): BrainPreparation => ({ kind: 'send', rawUserText: 'Manual Send flow', asset: symbol, amount: amount || undefined, recipient: to || undefined })
  const brainContext = () => ({
    connected: mode === 'connected',
    account: mode === 'connected' ? address : undefined,
    chainId: walletChainId,
    balances: Object.fromEntries(holdings.filter((x) => x.verified).map((x) => [x.symbol, x.balance])),
    knownRecipients: [...contacts.map((c) => c.address), ...activity.map((a) => a.counterparty)],
  })

  const warnings = useMemo(() => {
    const w: string[] = []
    if (toValid && !contact && !knownBefore) w.push('First time sending to this address. Double-check the first and last characters.')
    if (large) w.push('Large transfer (≥ $100). Transactions on {network} are final and cannot be reversed.')
    return w
  }, [toValid, contact, knownBefore, large])

  useEffect(() => { if (wantReview) { if (canReview) setStage('review'); setWantReview(false) } }, [wantReview, canReview])
  const steps = [
    { l: 'Recipient', ok: toValid && !toErr },
    { l: 'Asset', ok: !!symbol },
    { l: 'Amount', ok: amt > 0 && !amountErr },
    { l: 'Review', ok: false },
  ]

  const max = async () => {
    if (mode !== 'connected' || !toValid || toErr || walletChainId !== ARC.chainId) return
    const p = getProvider(); if (!p) return
    setBusy(true)
    try {
      const sample = await prepareSend(p, { account: address, recipient: to, symbol, amount: `0.${'0'.repeat(meta.decimals - 1)}1` })
      const value = safeMax(sample.tokenBalance, sample.usdcBalance, sample.fee, symbol)
      if (!value) throw new Error('Insufficient USDC for amount and fee')
      setAmount(formatSendAmount(value, meta.decimals))
    } catch (e) { notify(localError(e), 'err') } finally { setBusy(false) }
  }

  const startReview = async () => {
    if (!canReview || busy) return
    if (mode !== 'connected') { const review = prepareBrainReview(brainAction(), brainContext()); setBrainReview(review); setStage('review'); return }
    const p = getProvider(); if (!p) { notify(s('Wallet disconnected'), 'err'); return }
    setBusy(true)
    try {
      const live = await prepareSend(p, { account: address, recipient: to, symbol, amount })
      const review = prepareBrainReview(brainAction(), { connected: true, account: live.account, chainId: live.chainId, balances: { [symbol]: Number(formatSendAmount(live.tokenBalance, meta.decimals)) }, knownRecipients: brainContext().knownRecipients })
      if (review.assessment.status === 'blocked' || review.assessment.status === 'unknown') throw new Error(review.assessment.blockers[0] ?? 'Unavailable until live checks pass')
      setBrainReview(review); setPrepared(live); setAck(false); setStage('review')
    } catch (e) { notify(localError(e), 'err') } finally { setBusy(false) }
  }

  const confirmSend = async () => {
    if (!prepared || !brainReview || (large && !ack)) return
    try { await submitGuard.current.run(async () => {
      const p = getProvider(); if (!p) { notify(s('Wallet disconnected'), 'err'); return }
      setBusy(true)
      try {
      const fresh = await prepareSend(p, { account: address, recipient: to, symbol, amount })
      assertFreshSend(prepared, fresh)
      const checked = revalidateBrainReview(brainReview, brainAction(), { connected: true, account: fresh.account, chainId: fresh.chainId, balances: { [symbol]: Number(formatSendAmount(fresh.tokenBalance, meta.decimals)) }, knownRecipients: brainContext().knownRecipients })
      if (!checked.valid || checked.assessment.status === 'unknown') throw new Error('Review expired or details changed. Review again.')
      setSendStatus('REQUESTING_WALLET'); setStage('result')
      let hash: string
      try { hash = await requestSend(p, prepared) } catch (e) {
        if (isWalletRejection(e)) { setSendStatus('USER_REJECTED'); setSendError('Wallet rejected; nothing was submitted.'); return }
        setSendStatus('UNKNOWN'); setSendError(localError(e)); return
      }
      setSendHash(hash); setSendStatus('SUBMITTED')
      const record = { hash, account: prepared.account, chainId: prepared.chainId, recipient: prepared.recipient, symbol, amount, timestamp: Date.now(), status: 'pending' as const }
      upsertSend(record)
      const outcome = await pollSendReceipt(p, hash, prepared, () => setSendStatus('PENDING'))
      setSendStatus(outcome === 'confirmed' ? 'CONFIRMED' : outcome === 'failed' ? 'FAILED' : 'UNKNOWN')
      upsertSend({ ...record, status: outcome === 'confirmed' ? 'completed' : outcome === 'failed' ? 'failed' : 'unknown' })
      if (outcome === 'confirmed') await refetchWallet()
      } catch (e) {
        setSendError(localError(e)); notify(localError(e), 'err'); setBrainReview(null); setPrepared(null); setStage('form')
      } finally { setBusy(false) }
    }) } catch { /* A second click cannot open another wallet request. */ }
  }

  const trErr = (e: string) => e.startsWith('Insufficient ') ? s('Insufficient {asset} balance').replace('{asset}', symbol) : e.startsWith('Max ') ? s('Max {n} decimals').replace('{n}', String(meta.decimals)) : s(e)

  const reset = () => { setStage('form'); setAmount(''); setTo(''); setAck(false); setPv('Wallet signature'); setBrainReview(null); setPrepared(null); setSendHash(null); setSendError(''); setSendStatus('READY') }

  if (stage === 'result') {
    const resultCopy: Record<SendStatus, string> = { READY: 'Preparing live review…', REQUESTING_WALLET: 'Awaiting wallet confirmation', USER_REJECTED: 'Wallet request cancelled', SUBMITTED: 'Submitted; waiting for receipt', PENDING: 'Submitted; waiting for receipt', CONFIRMED: 'Transaction confirmed', FAILED: 'Transaction failed', UNKNOWN: 'Final status unknown; check the transaction before retrying' }
    return <div className="max-w-[520px] mx-auto"><Card className="p-6 sm:p-8 mk-in min-w-0">
      <div className="text-center"><div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-4 bg-white/[0.05]">{sendStatus === 'CONFIRMED' ? <CheckCircle2 size={30} className="text-live" /> : sendStatus === 'FAILED' || sendStatus === 'USER_REJECTED' ? <XCircle size={30} className="text-rose-300" /> : sendStatus === 'UNKNOWN' ? <AlertTriangle size={30} className="text-amber-300" /> : <Loader2 size={30} className="text-neon-300 animate-spin" />}</div>
        <h2 className="text-[20px] font-bold">{s(resultCopy[sendStatus])}</h2><p className={`mt-2 text-[13px] break-words ${T.sub}`}>{amount} {symbol} {s('to')} {short(to)}</p>
        {sendError && <p className="mt-3 text-[13px] text-rose-300 break-words">{sendError}</p>}
      </div>
      {sendHash && <div className="mt-5 rounded-2xl border border-white/[0.07] p-4 min-w-0"><div className={`text-[12px] ${T.mute}`}>{s('Transaction hash')}</div><a href={explorerTx(sendHash)} target="_blank" rel="noreferrer" className="font-mono text-[12px] text-neon-300 break-all">{sendHash}</a><div className="mt-2"><a href={explorerTx(sendHash)} target="_blank" rel="noreferrer" className="text-[12px] text-neon-300">{s('View on ArcScan')}</a></div></div>}
      {sendHash && (sendStatus === 'UNKNOWN' || sendStatus === 'PENDING') && <Button variant="primary" className="mt-5 w-full" disabled={busy} onClick={async () => { const p = getProvider(); if (!p || !prepared || !sendHash) return; setBusy(true); const result = await pollSendReceipt(p, sendHash, prepared, () => setSendStatus('PENDING')); setSendStatus(result === 'confirmed' ? 'CONFIRMED' : result === 'failed' ? 'FAILED' : 'UNKNOWN'); upsertSend({ hash: sendHash, account: prepared.account, chainId: prepared.chainId, recipient: prepared.recipient, symbol, amount, timestamp: Date.now(), status: result === 'confirmed' ? 'completed' : result === 'failed' ? 'failed' : 'unknown' }); if (result === 'confirmed') await refetchWallet(); setBusy(false) }}>{s('Check transaction again')}</Button>}
      {(sendStatus === 'CONFIRMED' || sendStatus === 'FAILED' || sendStatus === 'USER_REJECTED') && <Button variant="primary" className="mt-5 w-full" onClick={reset}>{s('New transfer')}</Button>}
    </Card></div>
  }

  // DESIGN PREVIEW: no signing, no submission, no receipt polling, no transaction hash.
  if (stage === 'preview') {
    const C = STATE_COPY[pv]
    const idx = PREVIEW_STATES.indexOf(pv)
    const line = PREVIEW_STATES.filter((x) => x !== 'Failed')
    return (
      <div className="max-w-[520px] mx-auto">
        <Card className="p-6 sm:p-8 mk-in">
          <div className="flex items-center justify-between gap-2">
            <button onClick={() => setStage('review')} className={`inline-flex items-center gap-1 text-[13px] ${T.sub} hover:text-white`}><ArrowLeft size={14} /> {tr('Back to review')}</button>
            <Badge tone="warn">{tr('Preview state')}</Badge>
          </div>
          <div className="mt-6 text-center">
            <div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-4 bg-white/[0.05]"><C.icon size={30} className={C.cls} /></div>
            <h2 className="text-[20px] font-bold">{s(C.title)}</h2>
          <p className={`mt-1 text-[14px] ${T.sub}`}>{amount} {symbol} {tr('to')} {contact?.name ?? short(to)}</p>
            <p className={`mt-2 text-[13px] max-w-[380px] mx-auto ${T.mute}`}>{s(C.desc)}</p>
          </div>
          <ol className="mt-6 space-y-2.5 text-[13px]" aria-label={tr('Transaction states')}>
            {line.map((l, i) => {
              const failed = pv === 'Failed'
              const done = !failed && i < idx
              const cur = !failed && i === idx
              return (
                <li key={l} className="flex items-center gap-2">
                  {done ? <CheckCircle2 size={16} className="text-live" /> : cur ? <Clock size={16} className="text-neon-300" /> : <Circle size={16} className="text-white/20" />}
                  <span className={done || cur ? '' : T.mute}>{s(l)}</span>
                  <span className={`ml-auto text-[11.5px] ${T.mute}`}>{done ? tr('Done') : cur ? tr('Current') : failed && i === 0 ? '' : tr('Not reached')}</span>
                </li>
              )
            })}
            {pv === 'Failed' && <li className="flex items-center gap-2 text-rose-300"><XCircle size={16} /> {s('Failed')} <span className={`ml-auto text-[11.5px] ${T.mute}`}>{tr('Current')}</span></li>}
          </ol>
          <dl className="mt-5 rounded-2xl border border-white/[0.07] divide-y divide-white/[0.06] text-[13px]">
            <div className="flex justify-between px-4 py-2.5"><dt className={T.mute}>{tr('Transaction hash')}</dt><dd className={T.mute}>— ({tr('none in preview')})</dd></div>
            <div className="flex justify-between px-4 py-2.5"><dt className={T.mute}>{tr('Network')}</dt><dd>Arc</dd></div>
          </dl>
          <div className="mt-5">
            <div className={`mb-2 text-[11.5px] font-semibold ${T.mute}`}>{tr('Preview a state')}</div>
            <div className="overflow-x-auto -mx-1 px-1"><Segmented size="sm" value={pv} options={PREVIEW_STATES} onChange={setPv} label={s} /></div>
          </div>
          <Button variant="primary" className="mt-5 w-full" onClick={reset}>{tr('New transfer')}</Button>
          <p className={`mt-3 text-[12px] text-center ${T.mute}`}>{tr('Nothing was signed, submitted or moved.')}</p>
        </Card>
      </div>
    )
  }

  return (
    <>
      <PageHeader title={s(stage === 'form' ? 'Send' : 'Review transaction')} desc={stage === 'form' ? s('Send assets to any {network} address. Fees are paid in USDC.').replace('{network}', ARC.name) : s('Check the details. Transfers on Arc are final once confirmed.')} right={mode === 'connected' ? <Badge tone={walletChainId === ARC.chainId ? 'ok' : 'warn'}>{walletChainId === ARC.chainId ? ARC.name : s(walletChainId === undefined ? 'Wallet network unavailable' : 'Wrong network: Arc Testnet is required')}</Badge> : <PreviewTag>{s('Design preview')}</PreviewTag>} />
      <ol className="mb-5 grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-2 text-[12px]">
        {steps.map((st, i) => {
          const active = stage === 'form' ? !st.ok && steps.slice(0, i).every((x) => x.ok) : i === 3
          const done = stage !== 'form' ? i < 3 : st.ok
          return (
            <li key={st.l} className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10.5px] font-bold ${done ? 'bg-neon-500 text-[#0b0b10]' : active ? 'ring-1 ring-neon-400 text-neon-200' : 'bg-white/[0.05] text-[#83838E]'}`}>{done ? <Check size={11} strokeWidth={3} /> : i + 1}</span>
              <span className={done || active ? 'text-white font-medium' : T.mute}>{s(st.l)}</span>
              {i < 3 && <span className="hidden sm:block w-8 h-px bg-white/10" />}
            </li>
          )
        })}
      </ol>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,560px)_1fr] gap-5 items-start">
        <Card className="p-5 sm:p-6 mk-in">
          {stage === 'form' ? (
            <div className="space-y-5">
              <Field label={s('Recipient')} error={toErr ? s(toErr) : toErr} hint={contact ? `${s('Saved contact')} · ${contact.name}` : undefined}
                right={<button ref={bookTriggerRef} onClick={() => setShowBook(!showBook)} aria-expanded={showBook} aria-controls="mk-address-book" className="text-[12px] font-medium text-neon-300 hover:text-neon-200 inline-flex items-center gap-1"><BookUser size={13} /> {tr('Address book')}</button>}>
                <input value={to} onChange={(e) => { setTo(e.target.value); setPrepared(null) }} placeholder="0x…" className={`${inputCls} font-mono text-[13px] ${toErr ? '!border-rose-400/60' : ''}`} spellCheck={false} />
                {showBook && (
                  <div ref={bookPanelRef} id="mk-address-book" className="mt-2 rounded-2xl border border-white/10 bg-[#18181e] p-1.5 max-h-56 overflow-y-auto">
                    {contacts.length === 0 && <div className={`p-3 text-[13px] ${T.mute}`}>{tr('No contacts yet. Add them in Settings or after a transfer.')}</div>}
                    {contacts.map((c) => (
                      <button key={c.address} onClick={() => { setTo(c.address); setPrepared(null); setShowBook(false) }} className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/[0.06] text-left">
                        <Avatar size={28} seed={c.address} />
                        <span className="min-w-0"><span className="block text-[13px] font-semibold">{c.name}</span><span className={`block font-mono text-[11px] ${T.mute}`}>{short(c.address)}</span></span>
                      </button>
                    ))}
                  </div>
                )}
              </Field>

              <Field label={tr('Asset')}>
                <div className="grid grid-cols-3 gap-2">
                  {TOKENS.map((t) => {
                    const hb = holdings.find((x) => x.verified && x.symbol === t.sym)?.balance ?? 0
                    return (
                      <button key={t.sym} onClick={() => { setSymbol(t.sym); setAmount(''); setPrepared(null) }} className={`flex items-center gap-2 p-2.5 rounded-2xl border text-left transition ${symbol === t.sym ? 'border-white/20 bg-white/[0.08]' : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05]'}`}>
                        <TokenIcon color={t.color} glyph={t.glyph} size={28} />
                        <span className="min-w-0"><span className="block text-[13px] font-semibold">{t.sym}</span><span className={`block text-[11px] truncate tabular-nums ${T.mute}`}>{mask(fmtAmt(hb, 4))}</span></span>
                      </button>
                    )
                  })}
                </div>
              </Field>

              <Field label={s('Amount')} error={amountErr ? trErr(amountErr) : amountErr} right={<span className={`text-[12px] ${T.mute} break-words`}>{s('Balance')}: <span className="tabular-nums">{mask(fmtAmt(bal))}</span> {symbol}</span>}>
                <div className={`mk-field-shell flex items-center min-w-0 rounded-2xl bg-black/30 border ${amountErr ? 'border-rose-400/60' : 'border-white/[0.1]'} px-3 sm:px-4`}>
                  <input value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')); setPrepared(null) }} inputMode="decimal" placeholder="0.00" className="flex-1 min-w-0 h-16 bg-transparent outline-none text-[24px] sm:text-[28px] font-bold tabular-nums placeholder:text-white/20" />
                  <span className="text-[13px] sm:text-[15px] font-semibold mx-2 shrink-0">{symbol}</span>
                  <button onClick={max} disabled={mode !== 'connected' || !toValid || !!toErr || walletChainId !== ARC.chainId || busy} className="shrink-0 text-[12px] font-bold px-2.5 py-1 rounded-lg bg-neon-500/20 text-neon-200 hover:bg-neon-500/30 disabled:opacity-40">{s('MAX')}</button>
                </div>
                <div className={`mt-1.5 text-[12px] tabular-nums ${T.mute}`}>{usdValue != null ? `≈ ${usd(usdValue)}` : ''}</div>
              </Field>

              <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-4 text-[13px] space-y-2">
                <div className="flex justify-between gap-3"><span className={`${T.mute} inline-flex items-center gap-1.5`}><Fuel size={13} /> {s(mode === 'connected' ? 'Maximum fee' : 'Estimated fee')}</span><span className="tabular-nums">{feeLabel ?? s('Unavailable')}</span></div>
                <div className="flex justify-between gap-3"><span className={`${T.mute} inline-flex items-center gap-1.5`}><Zap size={13} /> {s('Estimated time')}</span><span>{s(mode === 'connected' ? 'After wallet approval' : '< 1 second (est.)')}</span></div>
              </div>

              <Button variant="primary" size="lg" className="w-full" disabled={!canReview || busy} onClick={startReview}>
                {s(busy ? 'Preparing live review…' : !to ? 'Enter recipient' : !amount ? 'Enter amount' : canReview ? 'Review' : 'Check the details above')}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <button onClick={() => { setPrepared(null); setBrainReview(null); setStage('form') }} className={`inline-flex items-center gap-1 text-[13px] ${T.sub} hover:text-white`}><ArrowLeft size={14} /> {tr('Edit')}</button>
              <div className="text-center py-3">
                <div className="mx-auto w-fit"><TokenIcon color={meta.color} glyph={meta.glyph} size={48} /></div>
                <div className="mt-3 text-[32px] font-bold tabular-nums tracking-tight break-words">{amount} {symbol}</div>
                {usdValue != null && <div className={`text-[14px] ${T.mute}`}>≈ {usd(usdValue)}</div>}
              </div>
              <dl className="rounded-2xl border border-white/[0.07] divide-y divide-white/[0.06] text-[13px] min-w-0 overflow-hidden [&_dd]:min-w-0 [&_dd]:break-words">
                <div className="flex justify-between gap-3 px-4 py-3"><dt className={T.mute}>{tr('From')}</dt><dd className="font-mono text-[12px]">{mode === 'demo' ? tr('Demo wallet') : short(address)}{mode === 'watch' ? ` · ${tr('Watch-only')}` : ''}</dd></div>
                <div className="flex justify-between gap-3 px-4 py-3"><dt className={`${T.mute} shrink-0`}>{tr('To')}</dt><dd className="text-right min-w-0">{contact && <div className="font-semibold">{contact.name}</div>}<div className="font-mono text-[12px] break-all max-w-[260px]">{to}</div></dd></div>
                <div className="flex justify-between px-4 py-3"><dt className={T.mute}>{tr('Asset')}</dt><dd>{meta.name} ({symbol})</dd></div>
                <div className="flex justify-between gap-3 px-4 py-3"><dt className={T.mute}>{tr('Amount')}</dt><dd className="font-num text-right break-words min-w-0">{amount} {symbol}{usdValue != null ? ` · ≈ ${usd(usdValue)}` : ''}</dd></div>
                <div className="flex justify-between px-4 py-3"><dt className={T.mute}>{tr('Network')}</dt><dd>{ARC.name}</dd></div>
                <div className="flex justify-between gap-3 px-4 py-3"><dt className={T.mute}>{s(mode === 'connected' ? 'Maximum fee' : 'Estimated fee')}</dt><dd className="tabular-nums text-right">{feeLabel ?? s('Unavailable')}</dd></div>
                <div className="flex justify-between gap-3 px-4 py-3 font-semibold"><dt>{s('Total')}</dt><dd className="tabular-nums text-right break-words min-w-0">{totalLabel ?? s('Unavailable')}</dd></div>
              </dl>
              {warnings.map((w) => (
                <div key={w} className="mk-send-warning p-3 rounded-xl border border-amber-400/20 bg-amber-500/[0.06] text-[13px] flex gap-2 min-w-0"><AlertTriangle size={16} className="shrink-0 mt-0.5" /><span className="min-w-0 break-words">{s(w).replace('{network}', ARC.name)}</span></div>
              ))}
              {large && (
                <label className="flex items-start gap-2.5 text-[13px] cursor-pointer">
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 accent-neon-500 w-4 h-4" />
                  {tr("I've verified the recipient address and understand this can't be undone.")}
                </label>
              )}
              <Button variant="primary" size="lg" className="w-full" disabled={(large && !ack) || busy} onClick={mode === 'connected' ? confirmSend : () => { const snapshot = brainReview ?? prepareBrainReview(brainAction(), brainContext()); const checked = revalidateBrainReview(snapshot, brainAction(), brainContext()); if (!checked.valid) { notify(s('Review expired or details changed. Review again.'), 'err'); setStage('form'); setBrainReview(null); return } setPv('Wallet signature'); setStage('preview') }}>
                {s(mode === 'connected' ? 'Confirm in wallet' : 'Preview wallet step')}
              </Button>
              {mode !== 'connected' && <p className={`text-[12px] text-center ${T.mute}`}>{s('In this preview your wallet won’t open and nothing is sent. In the full app, you approve every transfer in your own wallet.')}</p>}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <div className="text-[14px] font-semibold">{tr('Before you continue')}</div>
            <ul className="mt-3 space-y-2 text-[13px]">
              {[
                ['Valid address format', toValid],
                ['Not a token contract', toValid && !isTokenContract && (mode !== 'connected' || !!prepared)],
                ['Known recipient', toValid && (!!contact || knownBefore)],
                ['Enough balance incl. fee', mode === 'connected' ? !!prepared && stage === 'review' : amt > 0 && !amountErr],
              ].map(([l, ok]) => (
                <li key={String(l)} className="flex items-center gap-2">
                  {ok ? <CheckCircle2 size={15} className="text-neon-300" /> : <span className="w-[15px] h-[15px] rounded-full border border-white/20" />}
                  <span className={ok ? '' : T.mute}>{s(l as string)}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-5">
            <div className="text-[14px] font-semibold">{tr('Recent recipients')}</div>
            <div className="mt-2 space-y-1">
              {Array.from(new Map(activity.filter((a) => a.direction === 'out' && a.verified).map((a) => [a.counterparty, a])).values()).slice(0, 4).map((a) => (
                <button key={a.counterparty} onClick={() => { setTo(a.counterparty); setPrepared(null) }} className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/[0.05] text-left">
                  <Avatar size={26} seed={a.counterparty} /><span className="font-mono text-[12px]">{a.counterpartyName ?? short(a.counterparty)}</span>
                </button>
              ))}
              {!activity.some((a) => a.direction === 'out') && <p className={`text-[13px] ${T.mute}`}>{tr('No outgoing transfers yet.')}</p>}
            </div>
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => go('settings')}>{tr('Manage address book')}</Button>
          </Card>
          <Badge>{tr(mode === 'connected' ? 'Wallet connected' : mode === 'watch' ? 'Watch-only' : 'Demo')}</Badge>
        </div>
      </div>
    </>
  )
}
