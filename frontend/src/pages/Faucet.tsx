import { Copy, Droplets, ExternalLink, RefreshCw, Wallet, Eye, Info, CheckCircle2 } from 'lucide-react'
import { useState } from 'react'
import { useWallet } from '../lib/store'
import { ARC, TOKENS, fmtAmt, short } from '../lib/wallet'
import { Badge, Button, Card, CardHeader, PageHeader, T, TokenIcon } from '../components/wallet/ui'
import { ConnectModal, copyText } from '../components/wallet/shared'
import { useT } from '../lib/i18n'

export default function FaucetPage() {
  const { mode, address, holdings, walletError, walletRefreshing, notify, refetchWallet } = useWallet()
  const [tr] = useT()
  const [connectOpen, setConnectOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const hasAddr = mode !== 'demo' && !!address

  const open = () => {
    if (hasAddr) copyText(address, notify, tr('Address copied — paste it in the Circle faucet'))
    window.open(ARC.faucet, '_blank', 'noopener,noreferrer')
  }

  const refresh = async () => {
    setRefreshing(true)
    try {
      const result = await refetchWallet()
      if (result.isError) notify(tr('Could not refresh balances. Try again.'), 'err')
    } catch {
      notify(tr('Could not refresh balances. Try again.'), 'err')
    } finally {
      setRefreshing(false)
    }
  }

  const steps = [
    tr('Copy your wallet address below.'),
    tr('Open the Circle faucet for USDC, EURC or cirBTC and select Arc Testnet.'),
    tr('Paste your address, complete the check and request tokens.'),
    tr('Return here and refresh balances to check what arrived.'),
  ]

  return (
    <>
      <ConnectModal open={connectOpen} onClose={() => setConnectOpen(false)} />
      <PageHeader eyebrow="Arc Testnet" title="Testnet faucet" desc="Get test USDC, EURC and cirBTC from Circle's Arc Testnet faucet. Test tokens have no real value." />
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-5 items-start">
        <Card className="mk-hero p-5 sm:p-6 mk-in min-w-0">
          <div className="flex items-center gap-3">
            <span className="w-11 h-11 rounded-xl bg-neon-500/15 text-neon-300 flex items-center justify-center shrink-0"><Droplets size={20} /></span>
            <div className="min-w-0">
              <h2 className="text-[17px] font-bold">{tr('Request test tokens')}</h2>
              <p className={`text-[13px] break-words ${T.mute}`}>{tr('Provided by Circle · faucet.circle.com')}</p>
            </div>
          </div>

          <div className="mt-5">
            <div className={`text-[12px] mb-1.5 ${T.mute}`}>{tr('Receiving address')}</div>
            {hasAddr ? (
              <div className="flex items-center gap-2 rounded-xl bg-black/30 border border-white/[0.08] px-3 h-12 min-w-0">
                <span className="font-mono text-[13px] truncate flex-1 min-w-0" title={address}><span className="hidden sm:inline">{address}</span><span className="sm:hidden">{short(address)}</span></span>
                <Badge>{mode === 'connected' ? tr('Wallet connected') : tr('Watch-only')}</Badge>
                <button onClick={() => copyText(address, notify, tr('Address copied'))} className={`p-2 rounded-lg ${T.sub} hover:text-white hover:bg-white/10`} aria-label={tr('Copy address')}><Copy size={15} /></button>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-white/[0.12] p-4 text-[13px]">
                <p className={T.sub}>{tr('Connect a wallet or watch your address so you can copy it and see test tokens arrive.')}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" onClick={() => setConnectOpen(true)}><Wallet size={13} /> {tr('Connect wallet')}</Button>
                  <Button size="sm" onClick={() => setConnectOpen(true)}><Eye size={13} /> {tr('Watch address')}</Button>
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 space-y-2">
            {TOKENS.map((token) => {
              const balance = hasAddr && !walletError ? holdings.find((h) => h.verified && h.address.toLowerCase() === token.address.toLowerCase())?.balance : undefined
              return (
                <div key={token.sym} className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 flex flex-col sm:flex-row sm:items-center gap-3 min-w-0">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <TokenIcon color={token.color} glyph={token.glyph} size={34} />
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-semibold">{token.sym}</div>
                      <div className={`text-[11.5px] font-num ${T.mute}`}>{tr('Balance')}: {balance == null ? '—' : fmtAmt(balance, token.decimals)}</div>
                    </div>
                  </div>
                  <Button size="sm" onClick={open} className="w-full sm:w-auto shrink-0"><ExternalLink size={13} /> {tr('Open Circle faucet for {asset}').replace('{asset}', token.sym)}</Button>
                </div>
              )
            })}
          </div>
          {!hasAddr && <p className={`mt-2 text-[12px] ${T.mute}`}>{tr('Connect or watch an address to see live balances.')}</p>}
          {walletError && <p className="mt-2 text-[12px] text-rose-300">{tr('Balances unavailable. Try refreshing.')}</p>}
          {hasAddr && <Button size="lg" className="mt-4 w-full" disabled={refreshing || walletRefreshing} onClick={refresh}><RefreshCw size={15} className={refreshing || walletRefreshing ? 'animate-spin' : ''} /> {tr(refreshing || walletRefreshing ? 'Refreshing balances…' : 'Refresh balances')}</Button>}
          <p className={`mt-3 text-[12px] ${T.mute}`}>{tr('The Circle faucet opens in a new tab. Opening it does not request or deliver tokens.')}</p>
        </Card>

        <div className="space-y-5 min-w-0">
          <Card className="mk-in">
            <CardHeader title="How it works" />
            <ol className="px-5 pb-5 space-y-3">
              {steps.map((step, i) => (
                <li key={i} className="flex gap-3 text-[13px]">
                  <span className="w-6 h-6 rounded-full bg-neon-500/15 text-neon-300 text-[11.5px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                  <span className={T.sub}>{step}</span>
                </li>
              ))}
            </ol>
          </Card>
          <Card className="p-5 mk-in">
            <div className="flex gap-2.5 text-[13px]">
              <Info size={16} className="text-neon-300 shrink-0 mt-0.5" />
              <div className={T.sub}>
                <p>{tr('On Arc, USDC is the gas token — you need a little test USDC to pay network fees.')}</p>
                <p className="mt-2 flex items-center gap-1.5"><CheckCircle2 size={13} className="text-live" /> {tr('Makoto never asks for your private key to use the faucet.')}</p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}
