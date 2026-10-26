import { ShieldCheck, KeyRound, Eye, FileCode2, Bot, Ban, ExternalLink, Github, Copy, Database, LifeBuoy } from 'lucide-react'
import { useWallet } from '../lib/store'
import { useT } from '../lib/i18n'
import { ARC, TOKENS, short } from '../lib/wallet'
import { DEPLOYED_PAY_REQUESTS_ADDRESS } from '../lib/payRequests'
import { Badge, Card, CardHeader, T } from '../components/wallet/ui'
import { copyText } from '../components/wallet/shared'

const REPO = 'https://github.com/congthuat/Makoto-Wallet'

/** Trust Center — plain-language security model. Every claim here must stay true in code. */
export default function TrustPage() {
  const { notify } = useWallet()
  const [tr] = useT()
  const pillars = [
    { icon: KeyRound, t: 'Non-custodial', d: 'Makoto never holds your keys or your funds. Your browser wallet keeps them.' },
    { icon: ShieldCheck, t: 'You sign every transaction', d: 'Nothing moves until you approve it in your own wallet. You can always reject.' },
    { icon: Bot, t: 'The Agent only prepares', d: 'The AI drafts actions and explains them. It cannot sign, send or approve on its own.' },
    { icon: Eye, t: 'Proof, not promises', d: 'Results are confirmed from on-chain receipts and events, with an explorer link.' },
  ]
  const agentCan = ['Read balances, prices and network status', 'Explain transactions and check addresses', 'Prepare a send, swap, bridge or payment request for your review', 'Watch conditions and notify you (tasks)']
  const agentCannot = ['Sign or broadcast a transaction', 'Approve unlimited token allowances', 'Access your seed phrase or private key', 'Move funds without your confirmation']
  const contracts: { label: string; address: string; note: string }[] = [
    ...(DEPLOYED_PAY_REQUESTS_ADDRESS ? [{ label: 'MakotoPayRequests', address: DEPLOYED_PAY_REQUESTS_ADDRESS, note: 'Payment requests · no admin, no upgrades, no fees, never holds funds' }] : []),
    ...TOKENS.filter((token) => token.sym === 'USDC' || token.sym === 'EURC').map((token) => ({ label: token.sym, address: token.address, note: 'Official Circle token on Arc Testnet' })),
  ]
  return (
    <div className="space-y-5">
      <section className="mk-hero mk-in relative overflow-hidden rounded-2xl border border-white/[0.08] px-5 py-8 sm:px-8 sm:py-10">
        <div className="relative z-10 max-w-[720px]">
          <Badge tone="ok">{tr('Trust Center')}</Badge>
          <h1 className="mt-3 text-[26px] sm:text-[34px] leading-[1.1] font-bold">{tr('How Makoto keeps you in control')}</h1>
          <p className={`mt-3 text-[14.5px] leading-6 ${T.sub}`}>{tr('A clear summary of what Makoto can and cannot do, which contracts it uses, and how to verify everything yourself.')}</p>
        </div>
      </section>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {pillars.map(({ icon: Icon, t, d }) => (
          <Card key={t} className="p-4 mk-in">
            <span className="w-9 h-9 rounded-xl bg-neon-500/12 text-neon-300 flex items-center justify-center"><Icon size={17} /></span>
            <div className="mt-3 text-[14px] font-semibold">{tr(t)}</div>
            <div className={`mt-1 text-[12.5px] leading-5 ${T.sub}`}>{tr(d)}</div>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <Card className="mk-in">
          <CardHeader title="What the Agent can do" />
          <ul className="px-5 pb-5 space-y-2.5">
            {agentCan.map((item) => <li key={item} className="flex items-start gap-2.5 text-[13.5px]"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-live" />{tr(item)}</li>)}
          </ul>
        </Card>
        <Card className="mk-in">
          <CardHeader title="What the Agent can never do" />
          <ul className="px-5 pb-5 space-y-2.5">
            {agentCannot.map((item) => <li key={item} className="flex items-start gap-2.5 text-[13.5px]"><Ban size={15} className="mt-0.5 shrink-0 text-rose-300" />{tr(item)}</li>)}
          </ul>
        </Card>
      </div>

      <Card className="mk-in">
        <CardHeader title="Contracts" sub="Addresses Makoto asks your wallet to interact with" />
        <div className="px-2 pb-2">
          {contracts.map(({ label, address, note }) => (
            <div key={address} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-3 rounded-xl hover:bg-white/[0.03]">
              <FileCode2 size={16} className="text-neon-300 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold">{label}</span>
                <span className={`block text-[12px] ${T.mute}`}>{tr(note)}</span>
              </span>
              <span className="font-mono text-[12.5px]" title={address}>{short(address)}</span>
              <button onClick={() => copyText(address, notify, 'Address copied')} className={`h-8 w-8 inline-flex items-center justify-center rounded-lg hover:bg-white/[0.06] ${T.sub}`} aria-label={tr('Copy address')}><Copy size={14} /></button>
              <a href={`${ARC.explorer}/address/${address}`} target="_blank" rel="noreferrer" className={`h-8 w-8 inline-flex items-center justify-center rounded-lg hover:bg-white/[0.06] ${T.sub}`} aria-label={tr('View on ArcScan')}><ExternalLink size={14} /></a>
            </div>
          ))}
        </div>
        <p className={`px-5 pb-4 text-[12px] ${T.mute}`}>{tr('Always compare the address shown in your wallet with the one listed here before you sign.')}</p>
      </Card>

      <div className="grid md:grid-cols-3 gap-3">
        <Card className="p-4 mk-in">
          <Database size={17} className="text-neon-300" />
          <div className="mt-2.5 text-[14px] font-semibold">{tr('Your data')}</div>
          <p className={`mt-1 text-[12.5px] leading-5 ${T.sub}`}>{tr('Contacts, notes and chat history stay in your browser. Tasks are stored on the Makoto server and tied to your wallet signature. Agent messages are sent to the Makoto server and an AI provider to generate replies.')}</p>
        </Card>
        <Card className="p-4 mk-in">
          <Github size={17} className="text-neon-300" />
          <div className="mt-2.5 text-[14px] font-semibold">{tr('Open source')}</div>
          <p className={`mt-1 text-[12.5px] leading-5 ${T.sub}`}>{tr('The app and contract source code are public on GitHub.')}</p>
          <a href={REPO} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-semibold text-neon-300">{tr('View source')} <ExternalLink size={12} /></a>
        </Card>
        <Card className="p-4 mk-in">
          <LifeBuoy size={17} className="text-neon-300" />
          <div className="mt-2.5 text-[14px] font-semibold">{tr('Report a problem')}</div>
          <p className={`mt-1 text-[12.5px] leading-5 ${T.sub}`}>{tr('Found a bug or a security issue? Open an issue on GitHub. Makoto will never ask for your seed phrase.')}</p>
          <a href={`${REPO}/issues`} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-semibold text-neon-300">{tr('Open an issue')} <ExternalLink size={12} /></a>
        </Card>
      </div>
      <p className={`text-[12px] ${T.mute}`}>{tr('Makoto runs on Arc Testnet. Testnet tokens have no real value.')}</p>
    </div>
  )
}
