import { useState } from 'react'
import { BookUser, Copy, ExternalLink, Lock, LogOut, Network, Plus, Trash2, Wallet, Bell, Eye, KeyRound, Globe, Palette, Filter, Activity, BookOpen, MessageSquare, Sparkles, Gauge } from 'lucide-react'
import { useWallet } from '../lib/store'
import { LANGS, setLang, useT, type Lang } from '../lib/i18n'
import { useTheme } from '../lib/theme'
import { ARC, ensureArcNetwork, getProvider, isAddress, short } from '../lib/wallet'
import { Avatar, Badge, Button, Card, LiveDot, Modal, PageHeader, Segmented, T, Toggle, inputCls } from '../components/wallet/ui'
import { ConnectModal, copyText } from '../components/wallet/shared'

function Row({ icon: Icon, title, desc, right }: { icon: any; title: string; desc?: React.ReactNode; right: React.ReactNode }) {
  const [t] = useT()
  title = t(title); desc = t(desc)
  return (
    <div className="flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-4">
      <span className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0"><Icon size={16} className="text-neon-300" /></span>
      <div className="flex-1 min-w-0"><div className="text-[14px] font-medium">{title}</div>{desc && <div className={`text-[12px] mt-0.5 ${T.mute}`}>{desc}</div>}</div>
      <div className="shrink-0">{right}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [t] = useT()
  title = t(title)
  return (
    <section>
      <h2 className={`px-1 mb-2 text-[11px] font-semibold tracking-[0.14em] uppercase ${T.mute}`}>{title}</h2>
      <Card className="divide-y divide-white/[0.06]">{children}</Card>
    </section>
  )
}

const selCls = 'h-9 px-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-[13px] outline-none disabled:opacity-40'

export default function SettingsPage() {
  const { settings, setSettings, mode, address, displayAddress, disconnect, contacts, setContacts, notify, hidden, setHidden, network, networkError, go, setLockPreview } = useWallet()
  const [connectOpen, setConnectOpen] = useState(false)
  const [tr, lang] = useT()
  const [theme, setTheme] = useTheme()
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [fb, setFb] = useState('')
  const [cName, setCName] = useState('')
  const [cAddr, setCAddr] = useState('')
  const set = (p: Partial<typeof settings>) => setSettings({ ...settings, ...p })

  const addToWallet = async () => {
    const p = getProvider()
    if (!p) return notify(tr('No wallet extension found'), 'err')
    try { await ensureArcNetwork(p); notify(tr('Arc Testnet added to your wallet')) } catch (e: any) { notify(e?.message ?? tr('Could not add network'), 'err') }
  }
  const sendFeedback = () => {
    const list = JSON.parse(localStorage.getItem('mk.feedback') || '[]')
    localStorage.setItem('mk.feedback', JSON.stringify([...list, { text: fb.trim(), at: Date.now() }]))
    setFb(''); setFeedbackOpen(false); notify(tr('Thanks — feedback saved'))
  }
  const latency = network?.rpcLatencyMs

  return (
    <>
      <ConnectModal open={connectOpen} onClose={() => setConnectOpen(false)} />
      <Modal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} title={tr('Send feedback')} width={440}>
        <textarea value={fb} onChange={(e) => setFb(e.target.value)} rows={4} placeholder={tr('What could Makoto do better?')} className={`${inputCls} h-auto py-3 text-[14px] resize-none`} />
        <Button variant="primary" className="w-full mt-3" disabled={!fb.trim()} onClick={sendFeedback}>{tr('Send')}</Button>
      </Modal>

      <PageHeader eyebrow="Preferences" title="Settings" desc="Settings are stored on this device only." />
      <div className="max-w-[760px] space-y-7">
        <Section title="Wallet">
          <div className="flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-4">
            <Avatar size={40} seed={displayAddress} />
            <div className="flex-1 min-w-0">
              <div className="font-mono text-[13px] truncate">{mode === 'demo' ? displayAddress : address}</div>
              <div className="mt-1">{mode === 'connected' ? <Badge tone="ok">{tr('Wallet connected')}</Badge> : mode === 'watch' ? <Badge>{tr('Watch-only · read only')}</Badge> : <Badge tone="warn">{tr('Demo · sample data')}</Badge>}</div>
            </div>
            {mode !== 'demo' && <Button size="sm" onClick={() => copyText(address, notify, tr('Address copied'))} aria-label={tr('Copy address')}><Copy size={13} /></Button>}
            {mode === 'demo' ? <Button size="sm" variant="primary" onClick={() => setConnectOpen(true)}><Wallet size={13} /> {tr('Connect')}</Button> : <Button size="sm" variant="danger" onClick={disconnect}><LogOut size={13} /> <span className="hidden sm:inline">{tr('Disconnect')}</span></Button>}
          </div>
          <Row icon={KeyRound} title="Signing & keys" desc="Transactions are authorized by your wallet. Makoto does not store private keys." right={<span className={`text-[12px] ${T.mute}`}>{tr('Wallet signing')}</span>} />
          <Row icon={Gauge} title="Confirm large transfers" desc="Ask again before sending ≥ $100" right={<Toggle on={settings.confirmLarge} onChange={() => set({ confirmLarge: !settings.confirmLarge })} />} />
        </Section>

        <Section title="Display">
          <Row icon={Globe} title="Language" right={<select aria-label={tr('Language')} className={selCls} value={lang} onChange={(e) => setLang(e.target.value as Lang)}>{LANGS.map((l) => <option key={l.code} value={l.code} className="bg-[#18181e]">{l.label}</option>)}</select>} />
          <Row icon={Palette} title="Appearance" right={<Segmented size="sm" value={theme === 'light' ? tr('Light') : tr('Dark')} options={[tr('Dark'), tr('Light')] as const} onChange={(v) => setTheme(v === tr('Light') ? 'light' : 'dark')} />} />
          <Row icon={Palette} title="Theme" desc={settings.vivid !== false ? 'Neon — lime glow and purple accents' : 'Calm — minimal colour, no glow'}
            right={<Segmented size="sm" value={tr(settings.vivid !== false ? 'Vivid' : 'Calm')} options={[tr('Calm'), tr('Vivid')] as const} onChange={(v) => set({ vivid: v === tr('Vivid') })} />} />
          <Row icon={Eye} title="Hide balances" desc="Mask amounts across the app" right={<Toggle on={hidden} onChange={() => setHidden(!hidden)} />} />
          <Row icon={Eye} title="Hide balances under $1" right={<Toggle on={settings.hideSmall} onChange={() => set({ hideSmall: !settings.hideSmall })} />} />
          <Row icon={Filter} title="Hide unverified tokens" desc="Filter unknown airdropped tokens" right={<Toggle on={settings.hideSpam} onChange={() => set({ hideSpam: !settings.hideSpam })} />} />
        </Section>

        <Section title="App">
          <Row icon={Lock} title="App Lock · coming soon" desc="You can preview the privacy screen design — it is not a security feature."
            right={<span className="flex items-center gap-2"><span className="hidden sm:inline-flex"><Badge>{tr('Coming soon')}</Badge></span><Button size="sm" onClick={() => setLockPreview(true)}>{tr('Preview')}</Button></span>} />
          <Row icon={Bell} title="Transaction alerts" desc="Show incoming transfers in the in-app notification list" right={<Toggle on={settings.txAlerts} onChange={() => set({ txAlerts: !settings.txAlerts })} />} />
        </Section>

        <Section title="Network">
          <Row icon={Network} title={ARC.name} desc={tr('Chain ID {id} · gas paid in USDC').replace('{id}', String(ARC.chainId))} right={<Button size="sm" onClick={addToWallet}>{tr('Add to wallet')}</Button>} />
          <Row icon={Activity} title="RPC status"
            desc={<span className="font-mono break-all">{ARC.rpc}</span>}
            right={<span className="inline-flex items-center gap-2 text-[12px]"><LiveDot off={networkError || !network} />{networkError ? tr('Unavailable') : network ? tr('Online · {latency} ms').replace('{latency}', String(latency ?? '—')) : tr('Checking…')}</span>} />
          <Row icon={ExternalLink} title="Explorer" desc={<span className="font-mono break-all">{ARC.explorer}</span>} right={<a href={ARC.explorer} target="_blank" rel="noreferrer" className={`p-2 rounded-lg ${T.mute} hover:text-white hover:bg-white/10 inline-flex`} aria-label={tr('Open explorer')}><ExternalLink size={14} /></a>} />
        </Section>

        <Section title="Address book">
          <div className="p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-[1fr_1.6fr_auto] gap-2">
            <input value={cName} onChange={(e) => setCName(e.target.value)} placeholder={tr('Name')} className={`${inputCls} h-10 text-[13px] rounded-xl`} />
            <input value={cAddr} onChange={(e) => setCAddr(e.target.value)} placeholder={tr('0x… address')} className={`${inputCls} h-10 text-[13px] rounded-xl font-mono`} />
            <Button disabled={!cName.trim() || !isAddress(cAddr) || contacts.some((c) => c.address.toLowerCase() === cAddr.trim().toLowerCase())}
              onClick={() => { setContacts([...contacts, { name: cName.trim(), address: cAddr.trim() }]); setCName(''); setCAddr(''); notify(tr('Contact saved')) }}><Plus size={14} /> {tr('Add')}</Button>
          </div>
          {contacts.length === 0 ? (
            <div className={`px-5 py-6 text-[13px] text-center ${T.mute}`}><BookUser size={18} className="mx-auto mb-2" />{tr('Save frequent recipients to send faster and avoid address mistakes.')}</div>
          ) : contacts.map((c, i) => (
            <div key={c.address} className="flex items-center gap-3 px-4 sm:px-5 py-3">
              <Avatar size={30} seed={c.address} />
              <div className="flex-1 min-w-0">
                <input value={c.name} onChange={(e) => setContacts(contacts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="bg-transparent outline-none text-[14px] font-medium w-full" />
                <div className={`font-mono text-[12px] ${T.mute}`}>{short(c.address)}</div>
              </div>
              <button onClick={() => setContacts(contacts.filter((_, j) => j !== i))} className={`p-2 rounded-lg ${T.mute} hover:text-rose-300 hover:bg-rose-500/10`} aria-label={tr('Delete contact')}><Trash2 size={15} /></button>
            </div>
          ))}
        </Section>

        <Section title="About">
          <Row icon={BookOpen} title="Arc documentation" right={<a href="https://docs.arc.network" target="_blank" rel="noreferrer" className={`p-2 rounded-lg ${T.mute} hover:text-white hover:bg-white/10 inline-flex`} aria-label={tr('Open docs')}><ExternalLink size={14} /></a>} />
          <Row icon={MessageSquare} title="Feedback" desc="Tell us what to improve" right={<Button size="sm" onClick={() => setFeedbackOpen(true)}>{tr('Write')}</Button>} />
          <Row icon={Sparkles} title="Insights" desc="Experimental · read-only market and chain data" right={<Button size="sm" onClick={() => go('insights')}>{tr('Open')}</Button>} />
        </Section>
      </div>
    </>
  )
}
