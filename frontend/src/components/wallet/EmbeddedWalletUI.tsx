import { useState } from 'react'
import { AlertTriangle, KeyRound, Loader2, Lock } from 'lucide-react'
import { useWallet } from '../../lib/store'
import { useT } from '../../lib/i18n'
import { cachedEmbedded, embeddedSession, lockEmbedded, revealPhrase, unlockEmbedded } from '../../lib/embeddedWallet'
import { preferredWalletSource } from '../../lib/walletProviders'
import { short } from '../../lib/wallet'
import { Button, LogoMark, Modal, T, inputCls } from './ui'

function PhraseGrid({ phrase }: { phrase: string }) {
  return (
    <ol className="grid grid-cols-3 gap-1.5">
      {phrase.split(' ').map((word, index) => (
        <li key={index} className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-black/25 px-2 py-1.5 text-[12.5px] font-mono"><span className={`w-5 text-right text-[10.5px] ${T.mute}`}>{index + 1}</span>{word}</li>
      ))}
    </ol>
  )
}

/** After a reload the key is gone from memory: ask for the wallet password (MetaMask-style unlock). */
export function EmbeddedUnlockGate() {
  const { mode, disconnect } = useWallet()
  const [, lang] = useT()
  const vi = lang === 'vi'
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [, force] = useState(0)
  const cached = cachedEmbedded()
  const needed = mode === 'connected' && preferredWalletSource() === 'embedded' && !embeddedSession() && !!cached
  if (!needed || !cached) return null
  const unlock = async () => {
    setBusy(true); setError('')
    try { await unlockEmbedded({ ...cached, password }); setPassword(''); force((n) => n + 1) }
    catch (e) { setError(e instanceof Error && e.message === 'Wrong wallet password.' && vi ? 'Sai mật khẩu ví.' : e instanceof Error ? e.message : 'Failed') }
    finally { setBusy(false) }
  }
  return (
    <Modal open onClose={() => { lockEmbedded({ forget: true }); disconnect() }} title={vi ? 'Mở khóa ví Makoto' : 'Unlock Makoto wallet'} width={400}>
      <form onSubmit={(e) => { e.preventDefault(); void unlock() }} className="space-y-3" data-embedded-unlock>
        <div className="flex items-center gap-3"><LogoMark size={36} /><div className="min-w-0"><div className="text-[13px] font-semibold truncate">{cached.email}</div><div className={`text-[12px] font-mono ${T.mute}`}>{short(cached.address)}</div></div></div>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={vi ? 'Mật khẩu ví' : 'Wallet password'} autoFocus autoComplete="current-password" className={inputCls} />
        {error && <p role="alert" className="text-[12.5px] text-rose-300">{error}</p>}
        <Button type="submit" variant="primary" className="w-full" disabled={!password || busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />} {vi ? 'Mở khóa' : 'Unlock'}</Button>
        <button type="button" onClick={() => { lockEmbedded({ forget: true }); disconnect() }} className={`w-full text-[12px] ${T.sub} hover:text-white`}>{vi ? 'Đăng xuất' : 'Sign out'}</button>
      </form>
    </Modal>
  )
}

/** Settings card: who is signed in, reveal recovery phrase (password re-check), lock. */
export function EmbeddedWalletSettings() {
  const { disconnect } = useWallet()
  const [, lang] = useT()
  const vi = lang === 'vi'
  const session = embeddedSession()
  const [password, setPassword] = useState('')
  const [phrase, setPhrase] = useState('')
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState('')
  if (!session) return null
  const reveal = async () => {
    setError('')
    try { setPhrase(await revealPhrase(password)); setPassword(''); setAsking(false) }
    catch (e) { setError(e instanceof Error && e.message === 'Wrong wallet password.' && vi ? 'Sai mật khẩu ví.' : e instanceof Error ? e.message : 'Failed') }
  }
  return (
    <div className="px-4 sm:px-5 py-4 space-y-3" data-embedded-settings>
      <div className="flex items-center gap-3">
        <LogoMark size={32} />
        <div className="min-w-0 flex-1"><div className="text-[13.5px] font-semibold">{vi ? 'Ví Makoto (Google)' : 'Makoto wallet (Google)'}</div><div className={`text-[12px] truncate ${T.mute}`}>{session.email} · {session.words} {vi ? 'từ' : 'words'}</div></div>
        <Button size="sm" onClick={() => { lockEmbedded(); disconnect() }}><Lock size={13} /> {vi ? 'Khóa' : 'Lock'}</Button>
      </div>
      {!phrase && !asking && <Button size="sm" onClick={() => setAsking(true)}><KeyRound size={13} /> {vi ? 'Hiện cụm từ khôi phục' : 'Show recovery phrase'}</Button>}
      {asking && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void reveal() }}>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={vi ? 'Nhập mật khẩu ví' : 'Enter wallet password'} autoFocus className={`${inputCls} h-9 flex-1`} />
          <Button size="sm" type="submit" variant="primary" disabled={!password}>{vi ? 'Hiện' : 'Show'}</Button>
        </form>
      )}
      {error && <p role="alert" className="text-[12.5px] text-rose-300">{error}</p>}
      {phrase && (
        <div className="space-y-2">
          <p className="flex gap-2 text-[12px] text-amber-300"><AlertTriangle size={14} className="shrink-0 mt-0.5" />{vi ? 'Không chia sẻ cụm từ này với bất kỳ ai, kể cả Makoto.' : 'Never share this phrase with anyone, including Makoto.'}</p>
          <PhraseGrid phrase={phrase} />
          <Button size="sm" onClick={() => setPhrase('')}>{vi ? 'Ẩn' : 'Hide'}</Button>
        </div>
      )}
    </div>
  )
}
