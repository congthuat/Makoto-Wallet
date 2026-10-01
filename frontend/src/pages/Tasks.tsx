import { useEffect, useState } from 'react'
import { ArrowUp, Pause, Play, Pencil, Trash2, ListChecks, Wallet, CalendarClock, Bell, RotateCcw } from 'lucide-react'
import { useWallet } from '../lib/store'
import { SAMPLE_PROMPTS } from '../lib/scenarios'
import { taskApi, taskBinding, taskDefinition, taskDisplayTitle, taskError, taskIntentMode, taskItemsForAccount, taskLanguageSummary, taskPriceObservations, taskResultSummary, type Task, type TaskCandidate, type TaskCondition, type TaskSchedule, type TaskStatus } from '../lib/tasks'
import { taskDate, taskText } from '../lib/taskText'
import { formatTaskTimezone } from '../lib/taskTimezone'
import { short } from '../lib/wallet'
import { Button, Card, EmptyState, Modal, PageHeader, T, inputCls } from '../components/wallet/ui'
import { TaskReviewCard } from '../components/TaskReviewCard'
import { TaskAuthGate } from '../components/TaskAuthGate'
import { useT } from '../lib/i18n'

const EXAMPLES = [SAMPLE_PROMPTS.alert, SAMPLE_PROMPTS.daily, 'Alert me when EURC balance is above 200']
type Filter = 'ALL' | 'ACTIVE' | 'PAUSED' | 'OTHER'
const STATUS_KEY: Record<TaskStatus, 'active' | 'paused' | 'triggered' | 'completed' | 'failed' | 'blocked'> = { ACTIVE: 'active', PAUSED: 'paused', TRIGGERED: 'triggered', COMPLETED: 'completed', FAILED: 'failed', BLOCKED: 'blocked' }

function EditModal({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const { updateTask, notify } = useWallet()
  const [, language] = useT(); const locale = language === 'vi' ? 'vi' : 'en'
  const [threshold, setThreshold] = useState(task?.condition?.threshold ?? '')
  const [cadence, setCadence] = useState(String(task?.condition?.checkIntervalMinutes ?? 2))
  const [time, setTime] = useState(task?.schedule?.time ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  if (!task) return null
  const timezone = formatTaskTimezone(task.timezone, locale, task.nextRunAt ?? Date.now())
  const valid = task.condition ? /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(threshold) && /^(?:[1-9]|[1-5]\d|60)$/.test(cadence) : /^([01]\d|2[0-3]):[0-5]\d$/.test(time)
  const save = async () => {
    if (!valid || pending) return
    setPending(true); setError('')
    try {
      await updateTask(task.id, task.condition ? { condition: { ...task.condition, threshold, checkIntervalMinutes: Number(cadence) } as TaskCondition } : { schedule: { ...task.schedule, time } as TaskSchedule })
      notify(taskText('updated', locale)); onClose()
    } catch (cause) { setError(taskError(cause, locale)) }
    finally { setPending(false) }
  }
  return <Modal open onClose={onClose} title={taskText('edit', locale)}>
    <p className={`mb-3 text-[13px] ${T.sub}`}>{taskDisplayTitle(task, locale)}</p>
    {task.condition ? <div className="space-y-3"><label className="block text-[12.5px]"><span className={`block mb-1.5 ${T.sub}`}>{taskText('threshold', locale)} · {task.condition.asset}</span><input value={threshold} onChange={(event) => setThreshold(event.target.value)} inputMode="decimal" className={`${inputCls} h-11 text-[14px] rounded-xl`} /></label><label className="block text-[12.5px]"><span className={`block mb-1.5 ${T.sub}`}>{taskText('check', locale)} · {locale === 'vi' ? 'phút' : 'minutes'}</span><input value={cadence} onChange={(event) => setCadence(event.target.value)} inputMode="numeric" className={`${inputCls} h-11 text-[14px] rounded-xl`} /></label></div> : <label className="block text-[12.5px]"><span title={task.timezone} className={`block mb-1.5 ${T.sub}`}>{taskText('time', locale)} · {timezone.label}</span><input type="time" value={time} onChange={(event) => setTime(event.target.value)} className={`${inputCls} h-11 text-[14px] rounded-xl`} /></label>}
    {error && <p role="alert" className="mt-3 text-[12px] text-rose-300">{error}</p>}
    <div className="mt-4 grid grid-cols-2 gap-2"><Button onClick={onClose}>{taskText('cancel', locale)}</Button><Button variant="primary" disabled={!valid || pending} onClick={() => void save()}>{taskText('save', locale)}</Button></div>
  </Modal>
}

export default function TasksPage() {
  const w = useWallet()
  const [tr, language] = useT(); const locale = language === 'vi' ? 'vi' : 'en'
  const [filter, setFilter] = useState<Filter>('ALL')
  const [text, setText] = useState('')
  const [mode, setMode] = useState<'monitor' | 'automation'>('monitor')
  const [proposal, setProposal] = useState<TaskCandidate | null>(null)
  const [missing, setMissing] = useState<string[]>([])
  const [error, setError] = useState('')
  const [parsing, setParsing] = useState(false)
  const [edit, setEdit] = useState<Task | null>(null)
  const [remove, setRemove] = useState<Task | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  useEffect(() => { setProposal(null); setEdit(null); setRemove(null); setError('') }, [w.address, w.taskAuthenticated])
  const binding = taskBinding({ mode: w.mode, address: w.address, walletChainId: w.walletChainId })
  const filtered = w.tasks.filter((task) => filter === 'ALL' || (filter === 'OTHER' ? !['ACTIVE', 'PAUSED'].includes(task.status) : task.status === filter))
  const alerts = taskItemsForAccount(w.taskNotifications, w.mode, w.address)

  const propose = async (value = text) => {
    if (!value.trim() || parsing) return
    setProposal(null); setError(''); setMissing([])
    if (!w.taskAuthenticated) { setError(taskError(new Error('AUTH_REQUIRED'), locale)); return }
    if (!binding.ok) { setError(binding.reason === 'CHAIN_REQUIRED' ? taskText('chainFirst', locale) : taskText('connectFirst', locale)); return }
    setParsing(true)
    try {
      const response = await taskApi.parse({ text: value.trim(), mode: taskIntentMode(value) ?? mode, account: binding.account, chainId: binding.chainId, timezone: binding.timezone, locale })
      setProposal(response.candidate ? { ...response.candidate, createdBy: 'USER' } : null)
      setMissing(response.missingFields ?? [])
      if (!response.candidate) setError(response.blocked?.code === 'TASK_WRITE_REQUIRES_USER' ? taskText('writeBoundary', locale) : taskText('unsupported', locale))
    } catch (cause) { setError(taskError(cause, locale)) }
    finally { setParsing(false) }
  }

  const act = async (task: Task, action: 'pause' | 'resume' | 'run' | 'delete') => {
    setBusyId(task.id)
    try {
      if (action === 'pause' || action === 'resume') await w.updateTask(task.id, { status: action === 'pause' ? 'PAUSED' : 'ACTIVE' })
      else if (action === 'run') {
        const response = await w.runTask(task.id)
        if ((response.run as { status?: string; errorCode?: string } | null)?.status === 'FAILED') throw new Error((response.run as { errorCode?: string }).errorCode || 'TASK_EXECUTION_FAILED')
      }
      else await w.deleteTask(task.id)
      w.notify(taskText(action === 'delete' ? 'removed' : action === 'run' ? 'ran' : 'updated', locale))
      if (action === 'delete') setRemove(null)
    } catch (cause) { w.notify(taskError(cause, locale), 'err') }
    finally { setBusyId(null) }
  }

  return <>
    <PageHeader title="Tasks" desc="Things Makoto will monitor or automate for you." />
    <TaskAuthGate showLogout />
    {w.taskAuthenticated && <>
    <Card className="p-4 mk-in">
      <div role="tablist" className="flex gap-2 mb-3">{(['monitor', 'automation'] as const).map((value) => <button key={value} role="tab" aria-selected={mode === value} onClick={() => setMode(value)} className={`px-3 py-1.5 rounded-lg text-[12.5px] font-semibold ${mode === value ? 'bg-neon-500 text-[#0b0b10]' : `bg-white/[0.04] ${T.sub} hover:opacity-80`}`}>{taskText(value, locale)}</button>)}</div>
      <form onSubmit={(event) => { event.preventDefault(); void propose() }} className="flex items-center gap-2"><input value={text} onChange={(event) => setText(event.target.value)} aria-label={locale === 'vi' ? 'Mô tả nhiệm vụ' : 'Describe a task'} placeholder={locale === 'vi' ? 'Ví dụ: Báo tôi khi số dư USDC dưới 500' : 'e.g. Alert me when USDC balance is below 500'} className={`${inputCls} h-11 rounded-xl text-[14px] min-w-0`} /><button disabled={!w.taskAuthenticated || !text.trim() || parsing} className="h-11 w-11 shrink-0 inline-flex items-center justify-center rounded-xl bg-neon-500 text-[#0b0b10] hover:bg-neon-400 disabled:bg-white/[0.06] disabled:text-white/30" aria-label={taskText('review', locale)}><ArrowUp size={17} /></button></form>
      {!proposal && <div className="mt-2.5 flex flex-wrap gap-1.5">{EXAMPLES.map((example) => <button key={example} onClick={() => { setText(example); void propose(example) }} className={`min-h-7 px-2.5 rounded-md border border-white/[0.06] text-[12px] ${T.sub} hover:text-white`}>{example.startsWith('Alert me when EURC') && locale === 'vi' ? 'Báo tôi khi số dư EURC trên 200' : tr(example)}</button>)}</div>}
      {parsing && <p className={`mt-3 text-[12px] ${T.sub}`}>{taskText('preparing', locale)}</p>}
      {error && <p role="alert" className="mt-3 text-[12px] text-amber-300">{error}</p>}
      {!!missing.length && <p className={`mt-2 text-[12px] ${T.sub}`}>{taskText('missing', locale)}: {missing.join(', ')}</p>}
      {proposal && <TaskReviewCard candidate={proposal} tasks={w.tasks} onCreate={async () => { await w.createTask(proposal); w.notify(taskText('created', locale)); setProposal(null); setText(''); setFilter('ACTIVE') }} />}
    </Card>

    <div className="mt-6 flex gap-1 border-b border-white/[0.06] overflow-x-auto" role="tablist">{(['ALL', 'ACTIVE', 'PAUSED', 'OTHER'] as const).map((value) => <button key={value} role="tab" aria-selected={filter === value} onClick={() => setFilter(value)} className={`relative h-10 px-3 text-[13px] font-semibold shrink-0 ${filter === value ? 'text-white' : `${T.mute} hover:text-white`}`}>{value === 'ALL' ? taskText('all', locale) : value === 'OTHER' ? locale === 'vi' ? 'Khác' : 'Other' : taskText(value === 'ACTIVE' ? 'active' : 'paused', locale)} <span className={`ml-1 text-[11px] ${T.mute}`}>{value === 'ALL' ? w.tasks.length : w.tasks.filter((task) => value === 'OTHER' ? !['ACTIVE', 'PAUSED'].includes(task.status) : task.status === value).length}</span>{filter === value && <span className="absolute left-2 right-2 -bottom-px h-[2px] rounded-full bg-neon-400" />}</button>)}</div>
    {w.tasksError && <Card className="mt-4 p-4 text-[13px] text-amber-300">{taskText('backendOffline', locale)} <button onClick={() => void w.refreshTasks()} className="text-neon-300 underline">{taskText('retry', locale)}</button></Card>}
    {w.tasksLoading && <Card className="mt-4 p-5 text-[13px] text-white/60">…</Card>}
    {!w.tasksError && !w.tasksLoading && <div className="mt-4 grid md:grid-cols-2 gap-3">{filtered.map((task) => {
      const Icon = task.type === 'CONDITION_MONITOR' ? Wallet : CalendarClock
      const otherAccount = w.mode !== 'demo' && task.account.toLowerCase() !== w.address.toLowerCase()
      const canManage = binding.ok && binding.account.toLowerCase() === task.account.toLowerCase() && binding.chainId === task.chainId
      const languageSummary = task.type === 'SCHEDULED_AUTOMATION' ? taskLanguageSummary(task.lastResult) : null
      const prices = taskPriceObservations(task.lastResult)
      const timezone = formatTaskTimezone(task.timezone, locale, task.nextRunAt ?? Date.now())
      return <Card key={task.id} className="p-4 mk-in min-w-0">
        <div className="flex items-start gap-3"><span className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0"><Icon size={16} className="text-neon-300" /></span><div className="flex-1 min-w-0"><div className="flex items-start justify-between gap-2"><h2 className="text-[14.5px] font-semibold min-w-0 break-words">{taskDisplayTitle(task, locale)}</h2><span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${task.status === 'ACTIVE' ? 'bg-live/10 text-live' : task.status === 'PAUSED' ? 'bg-amber-400/10 text-amber-200' : 'bg-white/[0.06] text-[#b4b1c0]'}`}>{taskText(STATUS_KEY[task.status], locale)}</span></div><p className={`mt-1 text-[12px] ${T.sub}`}>{taskText(task.type === 'CONDITION_MONITOR' ? 'monitor' : 'automation', locale)} · {taskDefinition(task, locale)}</p></div></div>
        <dl className="mt-3 grid grid-cols-[108px_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-[12px]">
          <dt className={T.mute}>{taskText('account', locale)}</dt><dd title={task.account} className="font-mono break-all">{short(task.account)} {otherAccount && <span className="text-amber-300 font-sans">· {taskText('otherAccount', locale)}</span>}</dd>
          <dt className={T.mute}>{taskText('chain', locale)}</dt><dd>Arc Testnet</dd>
          <dt className={T.mute}>{taskText('timezone', locale)}</dt><dd title={task.timezone} data-task-timezone={task.timezone} className="break-words">{timezone.label}</dd>
          <dt className={T.mute}>{taskText('next', locale)}</dt><dd>{taskDate(task.nextRunAt, locale, task.timezone)}</dd>
          <dt className={T.mute}>{taskText('last', locale)}</dt><dd>{taskDate(task.lastRunAt, locale, task.timezone)}</dd>
          <dt className={T.mute}>{taskText('result', locale)}</dt><dd className="break-words">{taskResultSummary(task, task.lastResult, locale)}</dd>
          {!!prices.length && <><dt className={T.mute}>{taskText('prices', locale)}</dt><dd className="break-words">{prices.map((price) => <span key={price.asset} className="block">{price.asset}: {new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 8 }).format(price.usd)} <span className={T.mute}>· {taskDate(price.observedAt, locale, task.timezone)}</span></span>)}</dd></>}
          {languageSummary && <><dt className={T.mute}>{taskText('languageSummary', locale)}</dt><dd className="break-words">{languageSummary.text}<span className={`block text-[11px] ${T.mute}`}>{taskText(languageSummary.source === 'REAL_PROVIDER' ? 'providerSummary' : 'localSummary', locale)}</span></dd></>}
          {task.lastError != null ? <><dt className={T.mute}>{taskText('error', locale)}</dt><dd className="break-words text-rose-300">{taskError(new Error(typeof task.lastError === 'object' && 'code' in task.lastError ? String(task.lastError.code) : 'TASK_EXECUTION_FAILED'), locale)}</dd></> : null}
        </dl>
        <div className="mt-4 pt-3 border-t border-white/[0.05] flex flex-wrap items-center gap-1.5">
          {task.status === 'ACTIVE' ? <Button size="sm" variant="ghost" disabled={!canManage || busyId === task.id} onClick={() => void act(task, 'pause')}><Pause size={13} /> {taskText('pause', locale)}</Button> : <Button size="sm" variant="ghost" disabled={!canManage || busyId === task.id} onClick={() => void act(task, 'resume')}><Play size={13} /> {taskText('resume', locale)}</Button>}
          <Button size="sm" variant="ghost" disabled={!canManage || busyId === task.id || task.status !== 'ACTIVE' || !['READ_ONLY', 'NOTIFY_ONLY'].includes(task.authority)} onClick={() => void act(task, 'run')}><RotateCcw size={13} /> {taskText('runNow', locale)}</Button>
          <Button size="sm" variant="ghost" disabled={!canManage} onClick={() => setEdit(task)}><Pencil size={13} /> {taskText('edit', locale)}</Button>
          <Button size="sm" variant="ghost" disabled={!canManage} className="ml-auto hover:!text-rose-300" onClick={() => setRemove(task)}><Trash2 size={13} /> {taskText('remove', locale)}</Button>
        </div>
      </Card>
    })}</div>}
    {!w.tasksError && !w.tasksLoading && !filtered.length && <Card className="mt-4"><EmptyState icon={ListChecks} title={taskText('noTasks', locale)} /></Card>}
    <Card className="mt-6"><div className="px-5 pt-4 pb-2 flex items-center gap-2"><Bell size={14} className="text-neon-300" /><h2 className="text-[14px] font-semibold">{taskText('alerts', locale)}</h2></div>{w.taskNotificationsError ? <p className="px-5 pb-4 text-[12px] text-amber-300">{taskText('backendOffline', locale)}</p> : alerts.length ? <div className="px-3 pb-3 space-y-1">{alerts.map((notification) => <div key={notification.id} className="p-3 rounded-xl bg-white/[0.03] text-[12.5px]"><div className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{locale === 'vi' ? notification.titleVi ?? notification.title : notification.titleEn ?? notification.title}</span><time className={T.mute}>{taskDate(notification.createdAt, locale)}</time></div><p className={`mt-1 break-words ${T.sub}`}>{locale === 'vi' ? notification.messageVi ?? notification.message : notification.messageEn ?? notification.message}</p><div className={`mt-1 font-mono text-[11px] ${T.mute}`}>{short(notification.account)}</div></div>)}</div> : <p className={`px-5 pb-4 text-[13px] ${T.mute}`}>{taskText('noAlerts', locale)}</p>}</Card>
    <p className={`mt-4 text-[12px] ${T.mute}`}>{taskText('backendLocal', locale)}</p>
    </>}
    {w.taskAuthenticated && <EditModal key={edit?.id} task={edit} onClose={() => setEdit(null)} />}
    {w.taskAuthenticated && <Modal open={!!remove} onClose={() => setRemove(null)} title={taskText('confirmDelete', locale)}><p className={`text-[14px] ${T.sub}`}>{remove ? taskDisplayTitle(remove, locale) : ''}</p><div className="mt-4 grid grid-cols-2 gap-2"><Button onClick={() => setRemove(null)}>{taskText('cancel', locale)}</Button><Button variant="danger" disabled={!remove || busyId === remove.id} onClick={() => { if (remove) void act(remove, 'delete') }}>{taskText('remove', locale)}</Button></div></Modal>}
  </>
}
