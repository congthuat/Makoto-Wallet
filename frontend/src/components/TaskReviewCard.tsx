import { useState } from 'react'
import { Check, ListChecks } from 'lucide-react'
import { useT } from '../lib/i18n'
import { useWallet } from '../lib/store'
import { taskBinding, taskDefinition, taskDisplayTitle, taskError, type Task, type TaskCandidate } from '../lib/tasks'
import { taskText } from '../lib/taskText'
import { formatTaskTimezone } from '../lib/taskTimezone'
import { TaskAuthGate } from './TaskAuthGate'
import { Badge, Button, T } from './wallet/ui'

export function TaskReviewCard({ candidate, tasks, onCreate, created = false }: {
  candidate: TaskCandidate
  tasks: readonly Task[]
  onCreate: () => Promise<void>
  created?: boolean
}) {
  const [, language] = useT()
  const wallet = useWallet()
  const locale = language === 'vi' ? 'vi' : 'en'
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const duplicate = tasks.some((task) => task.account.toLowerCase() === candidate.account.toLowerCase() && task.chainId === candidate.chainId && task.timezone === candidate.timezone && task.type === candidate.type && JSON.stringify(task.condition) === JSON.stringify(candidate.condition) && JSON.stringify(task.schedule) === JSON.stringify(candidate.schedule))
  const create = async () => {
    if (pending || duplicate || created || !wallet.taskAuthenticated) return
    const binding = taskBinding({ mode: wallet.mode, address: wallet.address, walletChainId: wallet.walletChainId })
    if (!binding.ok || binding.account.toLowerCase() !== candidate.account.toLowerCase() || binding.chainId !== candidate.chainId) { setError(taskError(new Error('TASK_ACCOUNT_MISMATCH'), locale)); return }
    setPending(true); setError('')
    try { await onCreate() }
    catch (cause) { setError(taskError(cause, locale)) }
    finally { setPending(false) }
  }
  const timezone = formatTaskTimezone(candidate.timezone, locale)
  const definition = `${taskDefinition(candidate, locale)}${candidate.schedule && timezone.isLocal ? ` ${taskText('localTimeSuffix', locale)}` : ''}`
  const rows: [string, string][] = [
    [taskText('type', locale), taskText(candidate.type === 'CONDITION_MONITOR' ? 'monitor' : 'automation', locale)],
    [taskText('account', locale), candidate.account],
    [taskText('chain', locale), candidate.chainId === 5042002 ? 'Arc Testnet' : String(candidate.chainId)],
    [taskText(candidate.type === 'CONDITION_MONITOR' ? 'condition' : 'schedule', locale), definition],
    [taskText('timezone', locale), timezone.label],
  ]
  if (candidate.condition) rows.push([taskText('check', locale), `${candidate.condition.checkIntervalMinutes} ${locale === 'vi' ? 'phút' : 'min'}`])
  return (
    <div className="mt-3 rounded-xl border border-white/[0.08] bg-[#0e0e13] overflow-hidden min-w-0">
      <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center justify-between gap-2">
        <span className={`text-[11px] font-bold tracking-[0.12em] ${T.mute}`}>{taskText('review', locale).toUpperCase()}</span>
        {created ? <Badge tone="ai"><Check size={10} /> {taskText('created', locale)}</Badge> : <Badge><ListChecks size={10} /> {locale === 'vi' ? 'Chỉ đọc · thông báo' : 'Read only · notify'}</Badge>}
      </div>
      <div className="px-4 pt-3 text-[13.5px] font-semibold break-words">{taskDisplayTitle(candidate, locale)}</div>
      <dl className="p-4 grid grid-cols-[80px_minmax(0,1fr)] sm:grid-cols-[96px_minmax(0,1fr)] gap-y-2 gap-x-3 text-[12.5px]">
        {rows.map(([label, value]) => <div key={label} className="contents"><dt className={T.mute}>{label}</dt><dd title={label === taskText('timezone', locale) ? candidate.timezone : undefined} data-task-timezone={label === taskText('timezone', locale) ? candidate.timezone : undefined} className="min-w-0 break-words font-medium">{value}</dd></div>)}
      </dl>
      <p className={`px-4 pb-3 text-[11.5px] ${T.mute}`}>{taskText('taskCreationNote', locale)}</p>
      {!wallet.taskAuthenticated && <div className="px-4 pb-3"><TaskAuthGate compact /></div>}
      {duplicate && !created && <p className="px-4 pb-3 text-[12px] text-amber-300" role="alert">{taskText('duplicate', locale)}</p>}
      {error && <p className="px-4 pb-3 text-[12px] text-rose-300" role="alert">{error}</p>}
      <div className="px-4 pb-4"><Button variant="primary" disabled={pending || duplicate || created || !wallet.taskAuthenticated} onClick={() => void create()}>{created ? taskText('created', locale) : pending ? '…' : taskText('create', locale)}</Button></div>
    </div>
  )
}
