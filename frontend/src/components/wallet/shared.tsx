import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Rainbow, Copy, ExternalLink, AlertTriangle, Eye, Wallet, Info, Share2, ChevronRight, Check, Loader2,
} from 'lucide-react'
import { useWallet } from '../../lib/store'
import { ARC, TOKENS, ago, explorerTx, fmtAmt, isAddress, short, tokenBySym, txKind, type Tx } from '../../lib/wallet'
import { activityDate } from '../../lib/activity'
import { Badge, Button, Logo, Modal, StatusChip, T, TokenIcon, inputCls, Avatar } from './ui'
import { translate, useT } from '../../lib/i18n'
import { browserWalletRevision, discoverBrowserWallets, getBrowserWallets, getProvider, subscribeBrowserWallets, type BrowserWallet, type WalletKind } from '../../lib/walletProviders'
import { walletPickerCopy } from '../../lib/walletPickerCopy'
import { WalletProviderIcon } from './WalletProviderIcon'

export async function copyText(text: string, notify: (m: string, kind?: 'ok' | 'err') => void, label = 'Copied') {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
    await navigator.clipboard.writeText(text)
    notify(label)
    return true
  } catch {
    notify(translate('Copy failed'), 'err')
    return false
  }
}

const KIND = {
  send: { label: 'Sent', icon: ArrowUpRight, cls: 'bg-white/[0.06] text-[#d6d3e6]' },
  receive: { label: 'Received', icon: ArrowDownLeft, cls: 'bg-live/10 text-live' },
  swap: { label: 'Swap', icon: ArrowLeftRight, cls: 'bg-neon-500/15 text-neon-200' },
  bridge: { label: 'Bridge', icon: Rainbow, cls: 'bg-sky-400/10 text-sky-200' },
} as const

export function txTitle(tx: Tx, t: (s: string) => string = (s) => s) {
  const k = txKind(tx)
  if (k === 'swap') return tx.toSymbol ? `${t('Swap')} ${tx.symbol} → ${tx.toSymbol}` : `${t('Swap')} ${tx.symbol}`
  if (k === 'bridge') return `${t('Bridge')} ${tx.symbol}`
  return `${t(KIND[k].label)} ${tx.symbol}`
}

export function TxRow({ tx, compact = false }: { tx: Tx; compact?: boolean }) {
  const { mask, setTxDetail, contacts } = useWallet()
  const [tr, lang] = useT()
  const k = txKind(tx)
  const K = KIND[k]
  const inbound = k === 'receive'
  const contact = contacts.find((c) => c.address.toLowerCase() === tx.counterparty.toLowerCase())
  const who = tx.route ?? contact?.name ?? tx.counterpartyName ?? short(tx.counterparty)
  const status = tx.status
  return (
    <button onClick={() => setTxDetail(tx)} className="group w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.03] transition">
      <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${K.cls}`}><K.icon size={16} /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[13.5px] font-semibold">
          <span className="truncate">{txTitle(tx, tr)}</span>
          {!tx.verified && <Badge tone="warn">{tr('Unverified')}</Badge>}
        </span>
        <span className={`block text-[12px] truncate ${T.mute}`}>
          {k === 'swap' || k === 'bridge' ? '' : `${tr(inbound ? 'From' : 'To')} `}<span className={contact || tx.counterpartyName || tx.route ? '' : 'font-mono text-[11.5px]'}>{who}</span> · {compact ? ago(tx.timestamp, lang) : new Intl.DateTimeFormat(lang === 'vi' ? 'vi-VN' : 'en-US', { hour: 'numeric', minute: '2-digit' }).format(tx.timestamp)}
        </span>
      </span>
      <span className="text-right shrink-0 flex flex-col items-end gap-1">
        <span className={`text-[13.5px] font-semibold font-num ${inbound && status === 'completed' ? 'text-live' : status === 'failed' ? 'text-[#83838E] line-through decoration-white/20' : ''}`}>
          {mask(`${inbound ? '+' : k === 'swap' ? '' : '−'}${fmtAmt(tx.amount)} ${tx.symbol}`)}
        </span>
        <StatusChip status={status} />
      </span>
    </button>
  )
}

export function TxDetailModal() {
  const { txDetail, activity, setTxDetail, notify, network, contacts, setContacts, mask } = useWallet()
  const [tr, lang] = useT()
  const tx = txDetail?.hash ? activity.find((item) => item.hash?.toLowerCase() === txDetail.hash?.toLowerCase()) ?? txDetail : txDetail
  if (!tx) return null
  const meta = tokenBySym(tx.symbol)
  const k = txKind(tx)
  const inbound = k === 'receive'
  const status = tx.status
  const known = contacts.some((c) => c.address.toLowerCase() === tx.counterparty.toLowerCase())
  const rows: [string, React.ReactNode][] = [
    ['Status', <StatusChip status={status} />],
    ['Type', txTitle(tx, tr)],
    ['Date', activityDate(tx.timestamp, lang)],
    ...(tx.route ? [['Route', tx.route] as [string, React.ReactNode]] : []),
    ...(tx.toSymbol && tx.toAmount != null ? [['Received', `${fmtAmt(tx.toAmount)} ${tx.toSymbol}`] as [string, React.ReactNode]] : []),
    [inbound ? 'From' : 'To', <span className="font-mono text-[12px] break-all" title={tx.counterparty}>{tx.counterpartyName ? `${tx.counterpartyName} · ` : ''}{tx.counterparty}</span>],
    ['Network', ARC.name],
    ...(tx.fee != null ? [['Network fee', `${tx.fee} USDC`] as [string, React.ReactNode]] : []),
    ['Block', tx.block != null ? `#${tx.block.toLocaleString()}` : '—'],
    ['Confirmations', tx.block != null && network && network.blockNumber >= tx.block ? (network.blockNumber - tx.block + 1).toLocaleString() : '—'],
    ['Tx hash', tx.hash ? <span className="font-mono text-[12px] break-all" title={tx.hash}>{tx.hash}</span> : <span className={T.mute}>{tr('Sample data — no hash')}</span>],
  ]
  return (
    <Modal open onClose={() => setTxDetail(null)} title={tr('Transaction details')}>
      <div className="text-center py-4">
        <div className="mx-auto w-fit"><TokenIcon color={meta?.color ?? '#475569'} glyph={meta?.glyph ?? '?'} size={52} /></div>
        <div className={`mt-3 text-[28px] font-bold font-num tracking-tight ${inbound && status === 'completed' ? 'text-live' : ''}`}>{mask(`${inbound ? '+' : k === 'swap' ? '' : '−'}${fmtAmt(tx.amount)} ${tx.symbol}`)}</div>
        <div className={`text-[13px] ${T.mute}`}>{txTitle(tx, tr)}</div>
      </div>
      {status === 'failed' && <div className="mb-3 p-3 rounded-xl border border-white/[0.07] bg-white/[0.02] text-[13px] text-[#c9c7d2]">{tr("This transaction didn't go through. No funds left your wallet except any network fee.")}</div>}
      {status === 'pending' && <div className="mb-3 p-3 rounded-xl border border-white/[0.07] bg-white/[0.02] text-[13px] text-[#c9c7d2]">{tr(tx.hash ? 'Waiting for network confirmation. Check the transaction hash before retrying.' : 'Sample pending state for design preview.')}</div>}
      {status === 'unknown' && <div className="mb-3 p-3 rounded-xl border border-white/[0.07] bg-white/[0.02] text-[13px] text-[#c9c7d2]">{tr('The final transaction result cannot be determined yet. Check the hash before retrying.')}</div>}
      {!tx.verified && (
        <div className="mb-3 p-3 rounded-xl border border-amber-400/30 bg-amber-500/10 text-[13px] text-amber-100 flex gap-2">
          <AlertTriangle size={16} className="text-amber-300 shrink-0 mt-0.5" /> {tr("This token is not a verified Circle asset. Don't interact with links or sites it promotes.")}
        </div>
      )}
      <dl className="rounded-2xl border border-white/[0.07] divide-y divide-white/[0.06] text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between px-4 py-3 gap-3">
            <dt className={`${T.mute} shrink-0`}>{tr(k)}</dt>
            <dd className="text-right min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {tx.hash ? (
          <>
            <Button onClick={() => copyText(tx.hash!, notify, tr('Hash copied'))}><Copy size={14} /> {tr('Copy hash')}</Button>
            <a href={explorerTx(tx.hash)} target="_blank" rel="noreferrer"><Button className="w-full">ArcScan <ExternalLink size={13} /></Button></a>
          </>
        ) : (
          <Button className="col-span-2" disabled>{tr('Sample transaction — no explorer link')}</Button>
        )}
        {isAddress(tx.counterparty) && !known && (
          <Button variant="ghost" className="col-span-2" onClick={() => { setContacts([...contacts, { name: `Contact ${contacts.length + 1}`, address: tx.counterparty }]); notify(tr('Saved to address book')) }}>
            + {tr('Save {address} to address book').replace('{address}', short(tx.counterparty))}
          </Button>
        )}
      </div>
    </Modal>
  )
}

export function ReceiveModal() {
  const { receiveOpen, setReceiveOpen, address, live, displayAddress, notify } = useWallet()
  const [sym, setSym] = useState('USDC')
  const [tr] = useT()
  const full = live ? address : ''
  return (
    <Modal open={receiveOpen} onClose={() => setReceiveOpen(false)} title={tr('Receive')}>
      <div className="flex gap-1.5">
        {TOKENS.map((t) => (
          <button key={t.sym} onClick={() => setSym(t.sym)} className={`h-8 px-3 rounded-lg text-[12px] font-semibold inline-flex items-center gap-1.5 border transition ${sym === t.sym ? 'bg-white/[0.07] border-white/15 text-white' : `border-white/[0.06] ${T.mute} hover:text-white`}`}>
            <TokenIcon color={t.color} glyph={t.glyph} size={16} /> {t.sym}
          </button>
        ))}
      </div>
      <div className="mt-4 mx-auto w-fit p-4 rounded-3xl bg-white relative">
        {full ? (
          <QRCodeSVG value={full} size={188} level="M" fgColor="#0e0e12" />
        ) : (
          <div className="w-[188px] h-[188px] flex flex-col items-center justify-center text-center text-[#2c2c35] text-[13px] px-6 gap-2">
            <Wallet size={26} /> {tr('Connect or watch a wallet to show your QR code')}
          </div>
        )}
        {full && <div className="absolute inset-0 m-auto w-fit h-fit ring-4 ring-white rounded-[10px] pointer-events-none"><Logo size={40} /></div>}
      </div>
      <div className="mt-4 p-3 rounded-xl bg-black/30 border border-white/[0.08] flex items-center gap-3">
        <Avatar size={28} seed={displayAddress} />
        <div className="min-w-0 flex-1">
          <div className={`text-[12px] ${T.mute}`}>{tr('Your address')} · {tr('Network')}: Arc</div>
          <div className="font-mono text-[12.5px] break-all">{full || displayAddress}</div>
        </div>
      </div>
      <div className={`mt-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] text-[12px] ${T.sub} flex gap-2`}>
        <Info size={14} className="text-amber-300 shrink-0 mt-0.5" /> {tr('Only send {asset} on {network} (Chain ID {id}). For other networks, use Bridge.').replace('{asset}', sym).replace('{network}', ARC.name).replace('{id}', String(ARC.chainId))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="primary" disabled={!full} onClick={() => copyText(full, notify, 'Address copied')}><Copy size={14} /> {tr('Copy address')}</Button>
        <Button disabled={!full} onClick={() => (navigator.share ? navigator.share({ text: full }).catch(() => {}) : copyText(full, notify, 'Address copied'))}><Share2 size={14} /> {tr('Share')}</Button>
      </div>
    </Modal>
  )
}

export function ConnectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { connect, watch, mode } = useWallet()
  const [addr, setAddr] = useState('')
  const [tr, lang] = useT()
  const copy = walletPickerCopy(lang)
  const revision = useSyncExternalStore(subscribeBrowserWallets, browserWalletRevision, () => 0)
  const [pending, setPending] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const connection = useRef<AbortController | null>(null)
  useEffect(() => {
    if (open) discoverBrowserWallets()
    else { connection.current?.abort(); connection.current = null }
    return () => { connection.current?.abort() }
  }, [open])
  // Revision subscribes to late wallet announcements and successful selections.
  void revision
  const wallets = getBrowserWallets()
  const kinds: WalletKind[] = ['okx', 'metamask', 'rabby']
  const names = { okx: 'OKX Wallet', metamask: 'MetaMask', rabby: 'Rabby', other: copy.other }
  const rows = kinds.flatMap<{ id: string; kind: WalletKind; name: string; wallet?: BrowserWallet }>((kind) => {
    const detected = wallets.filter((wallet) => wallet.kind === kind)
    return detected.length ? detected.map((wallet) => ({ id: wallet.id, kind, name: wallet.name, wallet })) : [{ id: kind, kind, name: names[kind] }]
  })
  rows.push(...wallets.filter((wallet) => wallet.kind === 'other').map((wallet) => ({ id: wallet.id, kind: wallet.kind, name: wallet.source === 'legacy' ? copy.other : wallet.name, wallet })))
  const close = () => { connection.current?.abort(); connection.current = null; setPending(null); setFailed(false); onClose() }
  const choose = async (wallet: BrowserWallet) => {
    if (connection.current) return
    const controller = new AbortController()
    connection.current = controller
    setPending(wallet.id)
    setFailed(false)
    try {
      const connected = await connect(wallet, controller.signal)
      if (controller.signal.aborted) return
      if (connected) close()
      else setFailed(true)
    } finally {
      if (connection.current === controller) { connection.current = null; setPending(null) }
    }
  }
  const valid = isAddress(addr)
  return (
    <Modal open={open} onClose={close} title={tr('Connect a wallet')}>
      <p className={`text-[13px] ${T.sub}`}>{tr('Connect a browser wallet (transactions are authorized by your wallet), or watch a public address in read-only mode.')}</p>
      <div className="mt-4 space-y-2" aria-label={tr('Browser wallet')}>
        {rows.map((row) => {
          const connected = !!row.wallet && mode === 'connected' && getProvider() === row.wallet.provider
          return (
            <button key={row.id} type="button" data-wallet-kind={row.kind} data-wallet-id={row.id}
              disabled={!row.wallet || !!pending}
              onClick={() => { if (row.wallet) void choose(row.wallet) }}
              className={`w-full flex items-center gap-3 p-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-400/70 disabled:cursor-default ${row.wallet ? 'hover:bg-white/[0.06] disabled:hover:bg-white/[0.03]' : ''}`}
            >
              <WalletProviderIcon kind={row.kind} wallet={row.wallet} />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-[14px] break-words">{row.name}</span>
                <span className={`block text-[12px] ${row.wallet ? T.sub : T.mute}`}>
                  {pending === row.id ? copy.connecting : connected ? copy.connected : row.wallet ? copy.detected : copy.absent}
                </span>
              </span>
              {pending === row.id ? <Loader2 aria-hidden size={16} className="animate-spin shrink-0" /> : connected ? <Check aria-hidden size={16} className="text-live shrink-0" /> : row.wallet ? <ChevronRight aria-hidden size={16} className={`${T.mute} shrink-0`} /> : null}
            </button>
          )
        })}
      </div>
      <p className={`mt-3 text-[12px] leading-relaxed ${T.mute}`}>{wallets.length ? copy.choose : copy.none}</p>
      {failed && <p role="status" className="mt-2 text-[12px] text-rose-400">{copy.failed}</p>}
      <div className={`my-4 flex items-center gap-3 text-[12px] ${T.mute}`}><span className="flex-1 h-px bg-white/10" /> {tr('or watch an address')} <span className="flex-1 h-px bg-white/10" /></div>
      <label htmlFor="wallet-watch-address" className={`mb-1.5 block text-[12px] ${T.sub}`}>{copy.address}</label>
      <input id="wallet-watch-address" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder={tr('0x… Arc address')} className={`${inputCls} font-mono text-[13px]`} />
      {addr && !valid && <p className="mt-1.5 text-[12px] text-rose-400">{tr('Enter a valid 0x address (42 characters)')}</p>}
      <Button className="mt-3 w-full" disabled={!valid || !!pending} onClick={() => { watch(addr); close() }}><Eye size={15} /> {copy.watch}</Button>
      <p className={`mt-3 text-[11px] ${T.mute}`}>{tr("Tip: if the wallet popup doesn't appear inside the preview, open the app in a new tab.")}</p>
    </Modal>
  )
}
