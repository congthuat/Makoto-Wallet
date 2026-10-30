import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Copy, ExternalLink, Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react'
import { googleConfig, inAppBrowser, loadGoogleIdentity, openInBrowserHref, readGoogleCredential, vaultLookup, vaultSave, type LookupResult } from '../../lib/googleSignIn'
import { createRecoveryPhrase, isValidPhrase, normalizePhrase, passwordProblem, type VaultWords } from '../../lib/embeddedVault'
import { storeNewEmbedded, unlockEmbedded } from '../../lib/embeddedWallet'
import type { BrowserWallet } from '../../lib/walletProviders'
import { short } from '../../lib/wallet'
import { Button, T, inputCls } from './ui'

type Step =
  | { name: 'idle' }
  | { name: 'checking' }
  | { name: 'unlock'; found: Extract<LookupResult, { exists: true }> }
  | { name: 'create' }
  | { name: 'backup'; phrase: string }
  | { name: 'import' }

function PasswordInput({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} autoComplete="new-password" className={`${inputCls} pr-10`} />
      <button type="button" onClick={() => setShow(!show)} className={`absolute right-2 top-1/2 -translate-y-1/2 p-1.5 ${T.mute}`} aria-label={show ? 'Hide' : 'Show'}>{show ? <EyeOff size={15} /> : <Eye size={15} />}</button>
    </div>
  )
}

export function PhraseGrid({ phrase }: { phrase: string }) {
  return (
    <ol className="grid grid-cols-3 gap-1.5" data-phrase-grid>
      {phrase.split(' ').map((word, index) => (
        <li key={index} className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-black/25 px-2 py-1.5 text-[12.5px] font-mono">
          <span className={`w-5 text-right text-[10.5px] ${T.mute}`}>{index + 1}</span>{word}
        </li>
      ))}
    </ol>
  )
}

/** "Continue with Google" → unlock existing Makoto wallet, or create / import one. Keys stay on this device. */
export function GoogleWallet({ vi, onReady, disabled }: { vi: boolean; onReady: (wallet: BrowserWallet) => void; disabled?: boolean }) {
  const L = (en: string, viText: string) => (vi ? viText : en)
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [step, setStep] = useState<Step>({ name: 'idle' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [words, setWords] = useState<VaultWords>(12)
  const [ack, setAck] = useState(false)
  const [saved, setSaved] = useState(false)
  const [imported, setImported] = useState('')
  const [copied, setCopied] = useState(false)
  const credential = useRef<string>('')
  const who = useRef<{ sub: string; email: string }>({ sub: '', email: '' })
  const buttonRef = useRef<HTMLDivElement>(null)
  const [inApp] = useState(inAppBrowser)
  const [loadFailed, setLoadFailed] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)

  const onCredentialRef = useRef<(token: string) => void>(() => {})
  // Load config + Google script and initialise once.
  useEffect(() => {
    let alive = true
    void googleConfig().then(async (config) => {
      if (!alive) return
      if (!config.enabled || !config.clientId) { setEnabled(false); return }
      try { await loadGoogleIdentity() } catch { if (alive) { setLoadFailed(true); setEnabled(true) } return }
      if (!alive) return
      if (!window.google?.accounts?.id) { setLoadFailed(true); setEnabled(true); return }
      window.google.accounts.id.initialize({
        client_id: config.clientId, auto_select: false, ux_mode: 'popup', use_fedcm_for_button: true,
        callback: (response: { credential?: string }) => { if (response.credential) onCredentialRef.current(response.credential) },
      })
      setEnabled(true)
    }).catch(() => { if (alive) setEnabled(false) })
    return () => { alive = false }
  }, [])
  // (Re)draw Google's official button whenever the idle step is visible.
  useEffect(() => {
    if (enabled !== true || inApp || loadFailed || step.name !== 'idle' || !buttonRef.current || !window.google?.accounts?.id) return
    buttonRef.current.innerHTML = ''
    window.google.accounts.id.renderButton(buttonRef.current, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', logo_alignment: 'left', width: Math.min(buttonRef.current.clientWidth || 360, 400), locale: vi ? 'vi' : 'en' })
  }, [enabled, inApp, loadFailed, step.name, vi])

  const reset = () => { setPassword(''); setConfirm(''); setAck(false); setSaved(false); setImported(''); setError('') }

  const onCredential = async (token: string) => {
    credential.current = token
    who.current = readGoogleCredential(token)
    reset(); setStep({ name: 'checking' })
    try {
      const found = await vaultLookup(token)
      setStep(found.exists ? { name: 'unlock', found } : { name: 'create' })
    } catch (e) { setError(e instanceof Error ? e.message : 'Sign-in failed'); setStep({ name: 'idle' }) }
  }

  onCredentialRef.current = (token: string) => { void onCredential(token) }

  const run = async (task: () => Promise<BrowserWallet>) => {
    setBusy(true); setError('')
    try { onReady(await task()) } catch (e) { setError(e instanceof Error ? L(e.message, e.message === 'Wrong wallet password.' ? 'Sai mật khẩu ví.' : e.message) : 'Failed') } finally { setBusy(false) }
  }
  const save = (address: string, vault: Parameters<typeof vaultSave>[2]) => vaultSave(credential.current, address, vault).then(() => undefined)
  const newPasswordProblem = passwordProblem(password)
  const canCreate = !newPasswordProblem && password === confirm && ack

  if (enabled === false) return null
  return (
    <div className="rounded-2xl border border-white/[0.09] bg-white/[0.02] p-3.5" data-google-wallet>
      {step.name === 'idle' && inApp && enabled === true && (() => {
        const href = openInBrowserHref()
        const browser = /iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'Safari' : 'Chrome'
        const appName = inApp === 'app' ? L('this app', 'ứng dụng này') : inApp
        return (
          <div className="space-y-2.5" data-google-inapp>
            <p className="flex gap-2 text-[12.5px] leading-5 text-amber-300"><AlertTriangle size={15} className="shrink-0 mt-0.5" />
              {L(`Google does not allow sign-in inside ${appName}'s built-in browser. Open Makoto in ${browser} to continue with Google.`, `Google không cho đăng nhập trong trình duyệt của ${appName}. Hãy mở Makoto bằng ${browser} để đăng nhập Google.`)}
            </p>
            {href && <a href={href} className="mk-primary h-10 w-full rounded-xl bg-neon-500 text-[#0b0b10] text-[13px] font-semibold inline-flex items-center justify-center gap-2"><ExternalLink size={15} /> {L(`Open in ${browser}`, `Mở bằng ${browser}`)}</a>}
            <button type="button" onClick={() => { void navigator.clipboard?.writeText(window.location.href).then(() => { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1800) }) }}
              className="h-10 w-full rounded-xl border border-white/[0.08] bg-white/[0.05] text-[13px] font-semibold inline-flex items-center justify-center gap-2">
              {linkCopied ? <Check size={15} /> : <Copy size={15} />} {linkCopied ? L('Link copied — paste it in your browser', 'Đã sao chép — dán vào trình duyệt') : L('Copy link', 'Sao chép liên kết')}
            </button>
            <p className={`text-center text-[11.5px] ${T.mute}`}>{L('Or tap ⋯ in the corner and choose “Open in browser”.', 'Hoặc bấm ⋯ ở góc màn hình rồi chọn “Mở bằng trình duyệt”.')}</p>
          </div>
        )
      })()}
      {step.name === 'idle' && !inApp && loadFailed && (
        <p className="flex gap-2 text-[12.5px] leading-5 text-amber-300" role="alert"><AlertTriangle size={15} className="shrink-0 mt-0.5" />
          {L('Google sign-in could not load. Turn off content blockers / private relay for this site, check your connection, then reload.', 'Không tải được nút đăng nhập Google. Hãy tắt trình chặn quảng cáo cho trang này, kiểm tra mạng rồi tải lại trang.')}
        </p>
      )}
      {step.name === 'idle' && !inApp && !loadFailed && (
        <>
          <div ref={buttonRef} className="w-full min-h-[44px] flex justify-center" aria-label={L('Continue with Google', 'Tiếp tục với Google')} />
          {enabled === null && <div className="h-11 rounded-full bg-white/[0.04] animate-pulse" />}
          <p className={`mt-2 text-center text-[11.5px] ${T.mute}`}>{L('Get a Makoto wallet with your Google account. Your keys stay on your device.', 'Tạo ví Makoto bằng tài khoản Google. Chìa khóa ví nằm trên máy bạn.')}</p>
        </>
      )}
      {step.name === 'checking' && <p className={`flex items-center justify-center gap-2 py-3 text-[13px] ${T.sub}`}><Loader2 size={15} className="animate-spin" /> {L('Checking your account…', 'Đang kiểm tra tài khoản…')}</p>}

      {step.name === 'unlock' && (
        <form className="space-y-2.5" onSubmit={(e) => { e.preventDefault(); void run(() => unlockEmbedded({ ...who.current, address: step.found.address, vault: step.found.vault, password })) }}>
          <p className="text-[13.5px] font-semibold">{L('Unlock your Makoto wallet', 'Mở khóa ví Makoto')}</p>
          <p className={`text-[12px] ${T.mute}`}>{step.found.email} · <span className="font-mono">{short(step.found.address)}</span></p>
          <PasswordInput value={password} onChange={setPassword} placeholder={L('Wallet password', 'Mật khẩu ví')} autoFocus />
          <Button type="submit" variant="primary" className="w-full" disabled={busy || disabled || !password}>{busy ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />} {L('Unlock', 'Mở khóa')}</Button>
        </form>
      )}

      {step.name === 'create' && (
        <div className="space-y-2.5">
          <p className="text-[13.5px] font-semibold">{L('Create your Makoto wallet', 'Tạo ví Makoto')}</p>
          <p className={`text-[12px] ${T.mute}`}>{who.current.email}</p>
          <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label={L('Recovery phrase length', 'Độ dài cụm từ khôi phục')}>
            {([12, 24] as VaultWords[]).map((n) => (
              <button key={n} type="button" role="radio" aria-checked={words === n} onClick={() => setWords(n)} className={`h-9 rounded-lg border text-[12.5px] font-semibold ${words === n ? 'border-neon-500/60 bg-neon-500/10 text-neon-300' : 'border-white/[0.08]'}`}>{n} {L('words', 'từ')}{n === 12 ? ` · ${L('standard', 'phổ biến')}` : ''}</button>
            ))}
          </div>
          <PasswordInput value={password} onChange={setPassword} placeholder={L('Wallet password (min 8 characters)', 'Mật khẩu ví (tối thiểu 8 ký tự)')} />
          <PasswordInput value={confirm} onChange={setConfirm} placeholder={L('Repeat password', 'Nhập lại mật khẩu')} />
          {password && newPasswordProblem && <p className="text-[12px] text-amber-300">{L(newPasswordProblem, newPasswordProblem.startsWith('Use') ? 'Dùng ít nhất 8 ký tự.' : 'Mật khẩu này quá dễ đoán.')}</p>}
          {confirm && password !== confirm && <p className="text-[12px] text-amber-300">{L('Passwords do not match.', 'Mật khẩu không khớp.')}</p>}
          <label className="flex items-start gap-2 text-[12px] leading-5"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1 accent-[var(--nb)]" /><span>{L('I understand Makoto cannot recover this password. If I lose it and my recovery phrase, the wallet is lost.', 'Tôi hiểu Makoto không thể khôi phục mật khẩu này. Mất cả mật khẩu và cụm từ khôi phục thì mất ví.')}</span></label>
          <Button variant="primary" className="w-full" disabled={!canCreate || busy} onClick={() => setStep({ name: 'backup', phrase: createRecoveryPhrase(words) })}>{L('Create wallet', 'Tạo ví')}</Button>
          <button type="button" className={`w-full text-[12px] ${T.sub} hover:text-white`} onClick={() => { setError(''); setStep({ name: 'import' }) }}>{L('I already have a recovery phrase', 'Tôi đã có cụm từ khôi phục')}</button>
        </div>
      )}

      {step.name === 'backup' && (
        <div className="space-y-2.5">
          <p className="text-[13.5px] font-semibold">{L('Your recovery phrase', 'Cụm từ khôi phục của bạn')}</p>
          <p className="flex gap-2 text-[12px] text-amber-300"><AlertTriangle size={14} className="shrink-0 mt-0.5" />{L('Write these words down in order and keep them offline. Anyone with them controls your wallet.', 'Chép các từ này theo đúng thứ tự và cất ngoại tuyến. Ai có chúng sẽ kiểm soát ví của bạn.')}</p>
          <PhraseGrid phrase={step.phrase} />
          <button type="button" className={`inline-flex items-center gap-1.5 text-[12px] ${T.sub} hover:text-white`} onClick={() => { void navigator.clipboard?.writeText(step.phrase).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }}>{copied ? <Check size={13} /> : <Copy size={13} />} {L('Copy (then clear your clipboard)', 'Sao chép (rồi xóa bộ nhớ tạm)')}</button>
          <label className="flex items-start gap-2 text-[12px]"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-0.5 accent-[var(--nb)]" />{L('I wrote down my recovery phrase.', 'Tôi đã chép lại cụm từ khôi phục.')}</label>
          <Button variant="primary" className="w-full" disabled={!saved || busy || disabled} onClick={() => void run(() => storeNewEmbedded({ ...who.current, phrase: step.phrase, password, save }))}>{busy ? <Loader2 size={15} className="animate-spin" /> : null} {L('Finish', 'Hoàn tất')}</Button>
        </div>
      )}

      {step.name === 'import' && (
        <div className="space-y-2.5">
          <p className="text-[13.5px] font-semibold">{L('Import recovery phrase', 'Nhập cụm từ khôi phục')}</p>
          <textarea value={imported} onChange={(e) => setImported(e.target.value)} rows={3} placeholder={L('12 or 24 words separated by spaces', '12 hoặc 24 từ, cách nhau bằng dấu cách')} className={`${inputCls} h-auto py-2 font-mono text-[12.5px]`} autoComplete="off" spellCheck={false} />
          {imported && !isValidPhrase(imported) && <p className="text-[12px] text-amber-300">{L('Not a valid 12/24-word phrase yet.', 'Chưa phải cụm 12/24 từ hợp lệ.')}</p>}
          <PasswordInput value={password} onChange={setPassword} placeholder={L('New wallet password', 'Mật khẩu ví mới')} />
          <PasswordInput value={confirm} onChange={setConfirm} placeholder={L('Repeat password', 'Nhập lại mật khẩu')} />
          <label className="flex items-start gap-2 text-[12px] leading-5"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1 accent-[var(--nb)]" /><span>{L('I understand Makoto cannot recover this password.', 'Tôi hiểu Makoto không thể khôi phục mật khẩu này.')}</span></label>
          <Button variant="primary" className="w-full" disabled={!isValidPhrase(imported) || !canCreate || busy || disabled} onClick={() => void run(() => storeNewEmbedded({ ...who.current, phrase: normalizePhrase(imported), password, save }))}>{busy ? <Loader2 size={15} className="animate-spin" /> : null} {L('Import wallet', 'Nhập ví')}</Button>
          <button type="button" className={`w-full text-[12px] ${T.sub} hover:text-white`} onClick={() => { setError(''); setStep({ name: 'create' }) }}>{L('Back', 'Quay lại')}</button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-[12.5px] text-rose-300">{error}</p>}
    </div>
  )
}
