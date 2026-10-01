import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useWallet } from '../lib/store'
import { taskError } from '../lib/tasks'
import { taskText } from '../lib/taskText'
import { useT } from '../lib/i18n'
import { Button, Card, T } from './wallet/ui'

export function TaskAuthGate({ compact = false, showLogout = false }: { compact?: boolean; showLogout?: boolean }) {
  const wallet = useWallet()
  const [, language] = useT()
  const locale = language === 'vi' ? 'vi' : 'en'
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  if (wallet.taskAuthenticated && !showLogout) return null

  const act = async (kind: 'verify' | 'logout') => {
    if (pending) return
    setPending(true); setError('')
    try { if (kind === 'verify') await wallet.verifyTaskWallet(); else await wallet.logoutTaskWallet() }
    catch (cause) { setError(taskError(cause, locale)) }
    finally { setPending(false) }
  }
  if (wallet.taskAuthenticated) return <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-[12px]">
    <span className="inline-flex items-center gap-1.5 text-neon-300"><ShieldCheck size={15} />{taskText('verifiedWallet', locale)}</span>
    <Button size="sm" variant="ghost" disabled={pending} onClick={() => void act('logout')}>{taskText('taskLogout', locale)}</Button>
    {error && <span role="alert" className="text-rose-300">{error}</span>}
  </div>

  const mismatch = wallet.taskSessionAddress && wallet.mode === 'connected' && wallet.taskSessionAddress.toLowerCase() !== wallet.address.toLowerCase()
  return <Card className={`${compact ? 'p-3' : 'p-4 mb-4'} border-amber-400/20`}>
    <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
      <div className="min-w-0 w-full sm:w-auto sm:flex-1">
        <p className="flex items-center gap-2 text-[13px] font-semibold"><ShieldCheck size={16} className="text-neon-300 shrink-0" />{taskText('verifyWallet', locale)}</p>
        <p className={`mt-1 text-[12px] ${T.sub}`}>{wallet.mode !== 'connected' ? taskText('verifyConnect', locale) : mismatch ? taskText('verifyMismatch', locale) : taskText('verifyDetails', locale)}</p>
      </div>
      {wallet.mode === 'connected' && <Button size="sm" variant="primary" className="w-full sm:w-auto" disabled={pending || !wallet.taskWalletReady || wallet.taskAuthLoading} onClick={() => void act('verify')}>{pending ? '…' : taskText('verifyWallet', locale)}</Button>}
    </div>
    {wallet.taskAuthError && <p role="alert" className="mt-2 text-[12px] text-amber-300">{taskText('backendOffline', locale)}</p>}
    {error && <p role="alert" className="mt-2 text-[12px] text-rose-300">{error}</p>}
  </Card>
}
