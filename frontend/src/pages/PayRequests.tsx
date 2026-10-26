import { useCallback, useEffect, useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { CheckCircle2, Copy, ExternalLink, FileSignature, Loader2, ReceiptText, Rocket, Users, XCircle } from 'lucide-react'
import type { Address, Hex } from 'viem'
import { useWallet } from '../lib/store'
import { useT } from '../lib/i18n'
import { TxSteps } from '../components/wallet/TxSteps'
import { ARC, getProvider, short } from '../lib/wallet'
import { isWalletRejection } from '../lib/sendExecution'
import { Badge, Button, Card, Field, PageHeader, T, inputCls } from '../components/wallet/ui'
import { RecipientSafety } from './Send'
import {
  approveData, cancelData, cancelledEventMatches, configuredPayAddress, createData, createdRequestId, deployData, formatUnitsText, myRequestIds, paidEventMatches,
  payData, payLink, prepareTx, readAllowanceUnits, readHasPaid, readPayRequest, readTokenUnits, rememberMyRequest, rememberPayAddress, requestIdFromHash,
  sendPrepared, validateCreate, verifyPayContract, waitForReceipt, PAY_TOKENS, type PayRequest, type PayToken, type PreparedTx,
} from '../lib/payRequests'

const L = (vi: boolean, en: string, viText: string) => (vi ? viText : en)
type Step = { label: string; tx: PreparedTx; onConfirmed: (receipt: Record<string, unknown> | undefined) => boolean | Promise<boolean> }
type Phase = { kind: 'idle' } | { kind: 'review'; step: Step } | { kind: 'wallet' } | { kind: 'pending'; hash: Hex } | { kind: 'done'; hash: Hex; message: string } | { kind: 'error'; message: string; hash?: Hex }

/** One reviewed write at a time: prepare → review → wallet → receipt + event evidence. */
function useReviewedWrite() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const review = (step: Step) => setPhase({ kind: 'review', step })
  const confirm = async (step: Step, success: string) => {
    const p = getProvider()
    if (!p) { setPhase({ kind: 'error', message: 'Wallet provider unavailable.' }); return }
    setPhase({ kind: 'wallet' })
    let hash: Hex
    try { hash = await sendPrepared(p, step.tx) }
    catch (error) { setPhase({ kind: 'error', message: isWalletRejection(error) ? 'Wallet request rejected. Nothing was sent.' : error instanceof Error ? error.message : 'Wallet request failed.' }); return }
    setPhase({ kind: 'pending', hash })
    const outcome = await waitForReceipt(hash)
    if (outcome.status === 'unknown') { setPhase({ kind: 'error', hash, message: 'Status unknown — check the transaction on the explorer before trying again.' }); return }
    if (outcome.status === 'failed') { setPhase({ kind: 'error', hash, message: 'The transaction failed on-chain.' }); return }
    const ok = await step.onConfirmed(outcome.receipt)
    setPhase(ok ? { kind: 'done', hash, message: success } : { kind: 'error', hash, message: 'Receipt found but the expected contract event is missing.' })
  }
  return { phase, setPhase, review, confirm }
}

function TxPanel({ phase, onConfirm, onCancel, vi }: { phase: Phase; onConfirm: () => void; onCancel: () => void; vi: boolean }) {
  if (phase.kind === 'idle') return null
  const link = (hash: Hex) => <a className="inline-flex items-center gap-1 text-neon-300 break-all" href={`${ARC.explorer}/tx/${hash}`} target="_blank" rel="noreferrer">{short(hash)} <ExternalLink size={12} /></a>
  return (
    <div className={`mt-4 rounded-2xl border p-4 text-[13px] space-y-2.5 ${phase.kind === 'done' ? 'border-neon-500/30 bg-neon-500/[0.05]' : phase.kind === 'error' ? 'border-rose-400/25 bg-rose-500/[0.04]' : 'border-white/[0.08] bg-white/[0.03]'}`} aria-live="polite">
      <TxSteps stage={phase.kind} vi={vi} failedAt={phase.kind === 'error' && !phase.hash ? 'wallet' : 'pending'} />
      {phase.kind === 'review' && <>
        <div className="font-semibold">{L(vi, 'Review before signing', 'Xem lại trước khi ký')}</div>
        <p>{phase.step.label}</p>
        <p className={T.mute}>{L(vi, `Network fee ceiling about ${phase.step.tx.feeUsdc.toFixed(6)} USDC. Your wallet will ask you to confirm.`, `Phí mạng tối đa khoảng ${phase.step.tx.feeUsdc.toFixed(6)} USDC. Ví của bạn sẽ hỏi xác nhận.`)}</p>
        <div className="flex gap-2"><Button variant="primary" onClick={onConfirm}><FileSignature size={14} /> {L(vi, 'Confirm in wallet', 'Xác nhận trong ví')}</Button><Button onClick={onCancel}>{L(vi, 'Cancel', 'Hủy')}</Button></div>
      </>}
      {phase.kind === 'wallet' && <p className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> {L(vi, 'Waiting for your wallet…', 'Đang chờ ví của bạn…')}</p>}
      {phase.kind === 'pending' && <p className="flex items-center gap-2 flex-wrap"><Loader2 size={14} className="animate-spin" /> {L(vi, 'Waiting for the Arc receipt', 'Đang chờ biên nhận trên Arc')} · {link(phase.hash)}</p>}
      {phase.kind === 'done' && <p className="flex items-center gap-2 flex-wrap text-neon-200"><CheckCircle2 size={15} /> {phase.message} · {link(phase.hash)}</p>}
      {phase.kind === 'error' && <p className="flex items-center gap-2 flex-wrap text-rose-300"><XCircle size={15} /> {phase.message}{phase.hash && <> · {link(phase.hash)}</>}</p>}
    </div>
  )
}

function DeployCard({ onDeployed, vi }: { onDeployed: (address: Address) => void; vi: boolean }) {
  const w = useWallet()
  const write = useReviewedWrite()
  const [error, setError] = useState('')
  const start = async () => {
    setError('')
    const p = getProvider()
    if (!p || w.mode !== 'connected') { setError(L(vi, 'Connect your wallet first.', 'Hãy kết nối ví trước.')); return }
    try {
      const tx = await prepareTx(p, w.address as Address, undefined, deployData())
      write.review({
        label: L(vi, 'Deploy MakotoPayRequests on Arc Testnet (accepts only USDC and EURC; no owner, no admin, holds no funds).', 'Deploy hợp đồng MakotoPayRequests lên Arc Testnet (chỉ nhận USDC và EURC; không chủ sở hữu, không admin, không giữ tiền).'),
        tx,
        onConfirmed: async (receipt) => {
          const address = typeof receipt?.contractAddress === 'string' ? receipt.contractAddress as Address : null
          if (!address || !(await verifyPayContract(address))) return false
          rememberPayAddress(address)
          onDeployed(address)
          return true
        },
      })
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not prepare the deployment.') }
  }
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 font-semibold"><Rocket size={16} className="text-neon-300" /> {L(vi, 'Contract not deployed yet', 'Hợp đồng chưa được deploy')}</div>
      <p className={`mt-1.5 text-[13px] ${T.sub}`}>{L(vi, 'Deploy the Makoto Pay Requests contract once from your own wallet. It costs a little test USDC for gas. After that, share the contract address with the Makoto team so it becomes the official address for everyone.', 'Deploy hợp đồng Makoto Pay Requests một lần từ chính ví của bạn, tốn một ít USDC test làm phí gas. Sau đó gửi địa chỉ hợp đồng cho nhóm Makoto để đặt làm địa chỉ chính thức cho mọi người.')}</p>
      <Button className="mt-3" variant="primary" disabled={write.phase.kind === 'wallet' || write.phase.kind === 'pending'} onClick={() => void start()}><Rocket size={14} /> {L(vi, 'Deploy contract', 'Deploy hợp đồng')}</Button>
      {error && <p className="mt-2 text-[12.5px] text-rose-300">{error}</p>}
      <TxPanel vi={vi} phase={write.phase} onCancel={() => write.setPhase({ kind: 'idle' })} onConfirm={() => write.phase.kind === 'review' && void write.confirm(write.phase.step, L(vi, 'Contract deployed and verified.', 'Đã deploy và kiểm tra hợp đồng.'))} />
    </Card>
  )
}

function CreateCard({ contract, vi, onCreated }: { contract: Address; vi: boolean; onCreated: (id: bigint) => void }) {
  const w = useWallet()
  const write = useReviewedWrite()
  const [token, setToken] = useState<PayToken>('USDC')
  const [amount, setAmount] = useState('')
  const [payers, setPayers] = useState('1')
  const [payer, setPayer] = useState('')
  const [expiry, setExpiry] = useState('7')
  const [memo, setMemo] = useState('')
  const [error, setError] = useState('')
  const errors: Record<string, string> = {
    amount: L(vi, 'Enter a valid amount per person.', 'Nhập số tiền hợp lệ cho mỗi người.'),
    payers: L(vi, 'Number of payers must be 1–100.', 'Số người trả phải từ 1 đến 100.'),
    payer: L(vi, 'A specific payer needs a valid 0x address (other than yours) and exactly 1 payer.', 'Người trả cụ thể cần địa chỉ 0x hợp lệ (khác ví bạn) và chỉ 1 người trả.'),
    memo: L(vi, 'Note is too long (max 140 bytes).', 'Ghi chú quá dài (tối đa 140 byte).'),
  }
  const start = async () => {
    setError('')
    const checked = validateCreate({ amount, decimals: PAY_TOKENS[token].decimals, payers, allowedPayer: payer, memo, account: w.address })
    if (!checked.ok) { setError(errors[checked.error]); return }
    const p = getProvider()
    if (!p || w.mode !== 'connected') { setError(L(vi, 'Connect your wallet first.', 'Hãy kết nối ví trước.')); return }
    const expiresAt = expiry === '0' ? 0 : Math.floor(Date.now() / 1000) + Number(expiry) * 86_400
    try {
      const tx = await prepareTx(p, w.address as Address, contract, createData({ token, amount: checked.amount, maxPayments: checked.maxPayments, allowedPayer: checked.allowedPayer, expiresAt, memo: checked.memo }))
      const per = `${formatUnitsText(checked.amount, PAY_TOKENS[token].decimals)} ${token}`
      write.review({
        label: checked.maxPayments === 1
          ? L(vi, `Create an invoice: ${per}${checked.allowedPayer ? ` from ${short(checked.allowedPayer)}` : ''}, paid directly to you.`, `Tạo hóa đơn: ${per}${checked.allowedPayer ? ` từ ${short(checked.allowedPayer)}` : ''}, trả thẳng cho bạn.`)
          : L(vi, `Create a split bill: ${checked.maxPayments} people × ${per}, each pays you directly.`, `Tạo yêu cầu chia tiền: ${checked.maxPayments} người × ${per}, mỗi người trả thẳng cho bạn.`),
        tx,
        onConfirmed: (receipt) => {
          const id = createdRequestId(receipt, contract, w.address as Address)
          if (id === null) return false
          rememberMyRequest(w.address, id)
          onCreated(id)
          return true
        },
      })
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not prepare the request.') }
  }
  const busy = write.phase.kind === 'wallet' || write.phase.kind === 'pending'
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 font-semibold"><ReceiptText size={16} className="text-neon-300" /> {L(vi, 'New request', 'Tạo yêu cầu mới')}</div>
      <div className="mt-3 grid sm:grid-cols-2 gap-3">
        <Field label={L(vi, 'Token', 'Token')}>
          <div className="flex gap-2">{(['USDC', 'EURC'] as PayToken[]).map((item) => <button key={item} type="button" aria-pressed={token === item} onClick={() => setToken(item)} className={`h-10 flex-1 rounded-xl border text-[13px] font-semibold ${token === item ? 'border-neon-400 bg-neon-500/10 text-neon-200' : 'border-white/[0.08]'}`}>{item}</button>)}</div>
        </Field>
        <Field label={L(vi, 'Amount per person', 'Số tiền mỗi người')}><input aria-label={L(vi, 'Amount per person', 'Số tiền mỗi người')} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="10" className={`${inputCls} h-10`} /></Field>
        <Field label={L(vi, 'Number of payers', 'Số người trả')} hint={L(vi, '1 = invoice · 2+ = split bill', '1 = hóa đơn · từ 2 = chia tiền')}><input aria-label={L(vi, 'Number of payers', 'Số người trả')} value={payers} onChange={(e) => setPayers(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" className={`${inputCls} h-10`} /></Field>
        <Field label={L(vi, 'Expires', 'Hết hạn')}>
          <select aria-label={L(vi, 'Expires', 'Hết hạn')} value={expiry} onChange={(e) => setExpiry(e.target.value)} className={`${inputCls} h-10`}>
            <option value="1" className="bg-[#18181e]">{L(vi, 'In 1 day', 'Sau 1 ngày')}</option>
            <option value="7" className="bg-[#18181e]">{L(vi, 'In 7 days', 'Sau 7 ngày')}</option>
            <option value="30" className="bg-[#18181e]">{L(vi, 'In 30 days', 'Sau 30 ngày')}</option>
            <option value="0" className="bg-[#18181e]">{L(vi, 'Never', 'Không hết hạn')}</option>
          </select>
        </Field>
        {payers === '1' && <Field label={L(vi, 'Only this payer (optional)', 'Chỉ người trả này (không bắt buộc)')}><input aria-label={L(vi, 'Only this payer', 'Chỉ người trả này')} value={payer} onChange={(e) => setPayer(e.target.value.trim())} placeholder="0x…" spellCheck={false} className={`${inputCls} h-10 font-mono text-[12px]`} /></Field>}
        <Field label={L(vi, 'Note', 'Ghi chú')}><input aria-label={L(vi, 'Note', 'Ghi chú')} value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={140} placeholder={L(vi, 'Dinner on Friday', 'Ăn tối thứ Sáu')} className={`${inputCls} h-10`} /></Field>
      </div>
      <p className={`mt-3 text-[12px] ${T.mute}`}>{L(vi, 'Payments go straight to your wallet. The contract never holds funds and nobody else can cancel your request.', 'Tiền được chuyển thẳng vào ví bạn. Hợp đồng không bao giờ giữ tiền và không ai khác có thể hủy yêu cầu của bạn.')}</p>
      <Button className="mt-3" variant="primary" disabled={busy || w.mode !== 'connected'} onClick={() => void start()}>{L(vi, 'Review request', 'Xem lại yêu cầu')}</Button>
      {w.mode !== 'connected' && <p className={`mt-2 text-[12.5px] ${T.mute}`}>{L(vi, 'Connect a wallet to create requests.', 'Kết nối ví để tạo yêu cầu.')}</p>}
      {error && <p className="mt-2 text-[12.5px] text-rose-300">{error}</p>}
      <TxPanel vi={vi} phase={write.phase} onCancel={() => write.setPhase({ kind: 'idle' })} onConfirm={() => write.phase.kind === 'review' && void write.confirm(write.phase.step, L(vi, 'Request created.', 'Đã tạo yêu cầu.'))} />
    </Card>
  )
}

function RequestCard({ contract, id, vi, onChanged }: { contract: Address; id: bigint; vi: boolean; onChanged?: () => void }) {
  const w = useWallet()
  const write = useReviewedWrite()
  const [request, setRequest] = useState<PayRequest | null | undefined>(undefined)
  const [paid, setPaid] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    const value = await readPayRequest(contract, id).catch(() => null)
    setRequest(value)
    if (value && w.mode === 'connected' && w.address) setPaid(await readHasPaid(contract, id, w.address as Address).catch(() => false))
  }, [contract, id, w.mode, w.address])
  useEffect(() => { void load() }, [load])
  if (request === undefined) return <Card className="p-5"><p className={`text-[13px] ${T.mute}`}><Loader2 size={14} className="inline animate-spin" /> {L(vi, 'Loading request…', 'Đang tải yêu cầu…')}</p></Card>
  if (request === null) return <Card className="p-5"><p className="text-[13px] text-rose-300">{L(vi, `Request #${id} was not found on this contract.`, `Không tìm thấy yêu cầu #${id} trên hợp đồng này.`)}</p></Card>
  const me = w.mode === 'connected' ? w.address?.toLowerCase() : undefined
  const isPayee = me === request.payee.toLowerCase()
  const amountText = `${formatUnitsText(request.amount, request.decimals)} ${request.token}`
  const statusText: Record<string, string> = vi ? { open: 'Đang mở', completed: 'Đã đủ', cancelled: 'Đã hủy', expired: 'Hết hạn' } : { open: 'Open', completed: 'Completed', cancelled: 'Cancelled', expired: 'Expired' }
  const canPay = request.status === 'open' && w.mode === 'connected' && !isPayee && !paid && (!request.allowedPayer || request.allowedPayer.toLowerCase() === me)
  const startPay = async () => {
    setError('')
    const p = getProvider()
    if (!p || !w.address) return
    try {
      const account = w.address as Address
      const [allowance, balance] = await Promise.all([readAllowanceUnits(request.token, account, contract), readTokenUnits(request.token, account)])
      if (balance < request.amount) { setError(L(vi, `Not enough ${request.token}.`, `Không đủ ${request.token}.`)); return }
      if (allowance < request.amount) {
        // Exact, separate approval; the payment is reviewed on its own afterwards.
        const tx = await prepareTx(p, account, request.tokenAddress, approveData(contract, request.amount))
        write.review({ label: L(vi, `Step 1/2 · Approve exactly ${amountText} for this request (not unlimited). Some wallets show this as ${request.amount.toLocaleString('en-US')} "Unknown" — that is the same amount in raw token units, because the wallet does not recognise ${request.token} on Arc yet.`, `Bước 1/2 · Cho phép đúng ${amountText} cho yêu cầu này (không phải không giới hạn). Một số ví hiển thị là ${request.amount.toLocaleString('en-US')} "Unknown" — đó chính là số tiền này tính theo đơn vị gốc của token, do ví chưa nhận diện ${request.token} trên Arc.`), tx, onConfirmed: async () => (await readAllowanceUnits(request.token, account, contract)) >= request.amount })
        return
      }
      const tx = await prepareTx(p, account, contract, payData(id))
      write.review({ label: L(vi, `Pay ${amountText} directly to ${short(request.payee)}.`, `Trả ${amountText} thẳng cho ${short(request.payee)}.`), tx, onConfirmed: (receipt) => { const ok = paidEventMatches(receipt, contract, id, account); if (ok) { void load(); onChanged?.() } return ok } })
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not prepare the payment.') }
  }
  const startCancel = async () => {
    setError('')
    const p = getProvider()
    if (!p || !w.address) return
    try {
      const tx = await prepareTx(p, w.address as Address, contract, cancelData(id))
      write.review({ label: L(vi, `Cancel request #${id}. Payments already received stay with you.`, `Hủy yêu cầu #${id}. Khoản đã nhận vẫn ở lại ví bạn.`), tx, onConfirmed: (receipt) => { const ok = cancelledEventMatches(receipt, contract, id); if (ok) { void load(); onChanged?.() } return ok } })
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not prepare the cancellation.') }
  }
  const link = payLink(id)
  return (
    <Card className="p-5" >
      <div data-pay-request={id.toString()} className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`text-[12px] ${T.mute}`}>{L(vi, 'Request', 'Yêu cầu')} #{id.toString()}</div>
          <div className="mt-0.5 text-[22px] font-bold tabular-nums">{amountText}{request.maxPayments > 1 && <span className={`text-[14px] font-medium ${T.sub}`}> {L(vi, 'per person', '/ người')}</span>}</div>
          {request.memo && <p className="mt-1 text-[13.5px] break-words">“{request.memo}”</p>}
        </div>
        <Badge tone={request.status === 'open' ? 'live' : request.status === 'completed' ? 'ok' : 'warn'}>{statusText[request.status]}</Badge>
      </div>
      <dl className="mt-3 grid grid-cols-[120px_minmax(0,1fr)] gap-y-1.5 text-[13px]">
        <dt className={T.mute}>{L(vi, 'Pay to', 'Trả cho')}</dt><dd className="font-mono text-[12px] break-all">{request.payee}</dd>
        <dt className={T.mute}>{L(vi, 'Progress', 'Tiến độ')}</dt><dd className="flex items-center gap-1.5"><Users size={13} /> {request.paidCount}/{request.maxPayments}</dd>
        {request.allowedPayer && <><dt className={T.mute}>{L(vi, 'Only payer', 'Chỉ người trả')}</dt><dd className="font-mono text-[12px] break-all">{request.allowedPayer}</dd></>}
        <dt className={T.mute}>{L(vi, 'Expires', 'Hết hạn')}</dt><dd>{request.expiresAt ? new Date(request.expiresAt * 1000).toLocaleString(vi ? 'vi-VN' : 'en-US') : L(vi, 'Never', 'Không hết hạn')}</dd>
      </dl>
      {!isPayee && w.mode === 'connected' && <div className="mt-3"><RecipientSafety recipient={request.payee} contacts={w.contacts} activity={w.activity} /></div>}
      {isPayee && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="rounded-lg bg-white p-1.5"><QRCodeSVG value={link} size={92} level="M" /></div>
          <div className="min-w-0 flex-1 space-y-2">
            <p className={`text-[12px] ${T.mute} break-all`}>{link}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => { void navigator.clipboard?.writeText(link).then(() => w.notify(L(vi, 'Link copied', 'Đã sao chép link'))) }}><Copy size={13} /> {L(vi, 'Copy link', 'Sao chép link')}</Button>
              {request.status === 'open' && <Button size="sm" onClick={() => void startCancel()}>{L(vi, 'Cancel request', 'Hủy yêu cầu')}</Button>}
            </div>
          </div>
        </div>
      )}
      {paid && <p className="mt-3 text-[13px] text-neon-200"><CheckCircle2 size={14} className="inline" /> {L(vi, 'You have paid this request.', 'Bạn đã trả yêu cầu này.')}</p>}
      {canPay && <Button className="mt-4" variant="primary" disabled={write.phase.kind === 'wallet' || write.phase.kind === 'pending'} onClick={() => void startPay()}>{L(vi, `Pay ${amountText}`, `Trả ${amountText}`)}</Button>}
      {!canPay && !isPayee && !paid && request.status === 'open' && w.mode !== 'connected' && <p className={`mt-3 text-[12.5px] ${T.mute}`}>{L(vi, 'Connect your wallet to pay.', 'Kết nối ví để thanh toán.')}</p>}
      {error && <p className="mt-2 text-[12.5px] text-rose-300">{error}</p>}
      <TxPanel vi={vi} phase={write.phase} onCancel={() => write.setPhase({ kind: 'idle' })} onConfirm={() => write.phase.kind === 'review' && void write.confirm(write.phase.step, L(vi, 'Confirmed on Arc.', 'Đã xác nhận trên Arc.'))} />
    </Card>
  )
}

export default function PayRequestsPage() {
  const w = useWallet()
  const [, lang] = useT()
  const vi = lang === 'vi'
  const [contract, setContract] = useState<Address | null>(() => configuredPayAddress())
  const [verified, setVerified] = useState<boolean | null>(null)
  const [openId, setOpenId] = useState<bigint | null>(() => typeof window === 'undefined' ? null : requestIdFromHash(window.location.hash))
  const [lookup, setLookup] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    if (!contract) return
    let alive = true
    void verifyPayContract(contract).then((ok) => { if (alive) setVerified(ok) })
    return () => { alive = false }
  }, [contract])
  useEffect(() => {
    const onHash = () => setOpenId(requestIdFromHash(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const mine = useMemo(() => myRequestIds(w.mode === 'connected' ? w.address : undefined), [w.mode, w.address, refresh])
  return (
    <>
      <PageHeader eyebrow={L(vi, 'Transactions', 'Giao dịch')} title={L(vi, 'Payment requests', 'Yêu cầu thanh toán')} desc={L(vi, 'Create an invoice or split a bill in USDC/EURC on Arc and share a link. Payers pay you directly.', 'Tạo hóa đơn hoặc chia tiền bằng USDC/EURC trên Arc rồi gửi link. Người trả chuyển thẳng cho bạn.')} />
      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
        <div className="space-y-4">
          {!contract && <DeployCard vi={vi} onDeployed={(address) => { setContract(address); setVerified(true) }} />}
          {contract && verified === false && <Card className="p-5"><p className="text-[13px] text-rose-300">{L(vi, 'The configured contract could not be verified on Arc Testnet. Payments are disabled.', 'Không xác minh được hợp đồng đã cấu hình trên Arc Testnet. Tạm khóa thanh toán.')}</p></Card>}
          {contract && verified && openId !== null && <RequestCard key={`open-${openId}`} contract={contract} id={openId} vi={vi} onChanged={() => setRefresh((n) => n + 1)} />}
          {contract && verified && <CreateCard contract={contract} vi={vi} onCreated={(id) => { setRefresh((n) => n + 1); window.location.hash = `pay-${id}` }} />}
          {contract && verified && mine.length > 0 && (
            <div className="space-y-3">
              <div className={`text-[12px] font-semibold tracking-[0.08em] ${T.mute}`}>{L(vi, 'MY REQUESTS (THIS DEVICE)', 'YÊU CẦU CỦA TÔI (TRÊN THIẾT BỊ NÀY)')}</div>
              {mine.filter((id) => id !== openId).slice(0, 10).map((id) => <RequestCard key={`${id}-${refresh}`} contract={contract} id={id} vi={vi} />)}
            </div>
          )}
        </div>
        <aside className="space-y-4">
          <Card className="p-5">
            <div className="font-semibold">{L(vi, 'Open a request', 'Mở một yêu cầu')}</div>
            <div className="mt-2 flex gap-2">
              <input aria-label={L(vi, 'Request number', 'Số yêu cầu')} value={lookup} onChange={(e) => setLookup(e.target.value.replace(/[^0-9]/g, ''))} placeholder="#12" className={`${inputCls} h-10 flex-1`} />
              <Button disabled={!lookup} onClick={() => { window.location.hash = `pay-${lookup}`; setLookup('') }}>{L(vi, 'Open', 'Mở')}</Button>
            </div>
          </Card>
          <Card className="p-5 text-[12.5px] space-y-2">
            <div className="font-semibold text-[13px]">{L(vi, 'How it works', 'Cách hoạt động')}</div>
            <p className={T.sub}>{L(vi, '1. Create a request: one payer (invoice) or several (split bill).', '1. Tạo yêu cầu: một người trả (hóa đơn) hoặc nhiều người (chia tiền).')}</p>
            <p className={T.sub}>{L(vi, '2. Share the link or QR code.', '2. Gửi link hoặc mã QR.')}</p>
            <p className={T.sub}>{L(vi, '3. Each payer approves the exact amount, then pays — two separate wallet confirmations. Money goes straight to you.', '3. Mỗi người trả cho phép đúng số tiền, rồi thanh toán — hai lần xác nhận ví riêng. Tiền vào thẳng ví bạn.')}</p>
            {contract && <a className="inline-flex items-center gap-1 text-neon-300" href={`${ARC.explorer}/address/${contract}`} target="_blank" rel="noreferrer">{L(vi, 'Contract on ArcScan', 'Hợp đồng trên ArcScan')} <ExternalLink size={12} /></a>}
          </Card>
        </aside>
      </div>
    </>
  )
}
