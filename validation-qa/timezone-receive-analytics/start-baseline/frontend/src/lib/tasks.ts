import { api } from './api.ts'

export type TaskType = 'CONDITION_MONITOR' | 'SCHEDULED_AUTOMATION'
export type TaskStatus = 'ACTIVE' | 'PAUSED' | 'TRIGGERED' | 'COMPLETED' | 'FAILED' | 'BLOCKED'
export type TaskAuthority = 'READ_ONLY' | 'NOTIFY_ONLY' | 'PREPARE_ONLY' | 'WRITE_REQUIRES_USER'
export type TaskCondition = {
  metric: 'TOKEN_BALANCE'
  asset: 'USDC' | 'EURC' | 'cirBTC'
  operator: 'LT' | 'LTE' | 'GT' | 'GTE'
  threshold: string
  checkIntervalMinutes: number
}
export type TaskSchedule = {
  kind: 'DAILY'
  time: string
  action: 'PORTFOLIO_SUMMARY' | 'ACTIVITY_SUMMARY' | 'BALANCE_CHECK'
}
export type TaskCandidate = {
  type: TaskType
  title: string
  description: string
  account: string
  chainId: number
  timezone: string
  sourceIntent: string
  locale: 'en' | 'vi'
  condition: TaskCondition | null
  schedule: TaskSchedule | null
  authority: TaskAuthority
  createdBy: 'USER' | 'AGENT'
}
export type Task = TaskCandidate & {
  id: string
  status: TaskStatus
  createdAt: string
  updatedAt: string
  nextRunAt: string | null
  lastRunAt: string | null
  lastResult: unknown
  lastError: unknown
  triggerCount: number
  previousConditionState: boolean | null
}
export type TaskNotification = {
  id: string
  taskId: string
  account: string
  chainId: number
  createdAt: string
  title: string
  message: string
  titleEn?: string
  titleVi?: string
  messageEn?: string
  messageVi?: string
  kind: 'MONITOR_TRIGGER' | 'AUTOMATION_RESULT'
  readAt: string | null
}
export type TaskParseResult = { candidate: TaskCandidate | null; missingFields: string[]; blocked?: { code: string; authority?: TaskAuthority } | null }

export function taskItemsForAccount<T extends { account: string; chainId: number }>(items: readonly T[], mode: 'demo' | 'watch' | 'connected', address: string): T[] {
  if (mode === 'demo' || !/^0x[0-9a-f]{40}$/i.test(address)) return []
  return items.filter((item) => item.chainId === 5042002 && item.account.toLowerCase() === address.toLowerCase())
}

export function taskLanguageSummary(value: unknown): { text: string; source: 'REAL_PROVIDER' | 'DETERMINISTIC_FALLBACK' } | null {
  if (value == null || typeof value !== 'object') return null
  const result = value as Record<string, unknown>
  if (typeof result.languageSummary !== 'string' || !result.languageSummary.trim() ||
    !['REAL_PROVIDER', 'DETERMINISTIC_FALLBACK'].includes(String(result.languageSource))) return null
  return { text: result.languageSummary, source: result.languageSource as 'REAL_PROVIDER' | 'DETERMINISTIC_FALLBACK' }
}

export function taskPriceObservations(value: unknown): { asset: 'USDC' | 'EURC' | 'cirBTC'; usd: number; observedAt: string }[] {
  if (value == null || typeof value !== 'object') return []
  const result = value as Record<string, unknown>
  if (result.kind !== 'PORTFOLIO_SUMMARY' || result.prices == null || typeof result.prices !== 'object') return []
  const prices = result.prices as Record<string, unknown>
  return (['USDC', 'EURC', 'cirBTC'] as const).flatMap((asset) => {
    const price = prices[asset]
    if (price == null || typeof price !== 'object') return []
    const row = price as Record<string, unknown>
    return typeof row.usd === 'number' && Number.isFinite(row.usd) && row.usd > 0 &&
      typeof row.observedAt === 'string' && Number.isFinite(Date.parse(row.observedAt))
      ? [{ asset, usd: row.usd, observedAt: row.observedAt }] : []
  })
}

export function taskBinding(input: { mode: 'demo' | 'watch' | 'connected'; address: string; walletChainId?: number; timezone?: string }):
  | { ok: true; account: string; chainId: number; timezone: string }
  | { ok: false; reason: 'ACCOUNT_REQUIRED' | 'CHAIN_REQUIRED' | 'TIMEZONE_REQUIRED' } {
  if (input.mode === 'demo' || !/^0x[0-9a-f]{40}$/i.test(input.address)) return { ok: false, reason: 'ACCOUNT_REQUIRED' }
  const chainId = input.mode === 'watch' ? 5042002 : input.walletChainId
  if (chainId !== 5042002) return { ok: false, reason: 'CHAIN_REQUIRED' }
  const timezone = input.timezone ?? (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '')
  if (!timezone) return { ok: false, reason: 'TIMEZONE_REQUIRED' }
  return { ok: true, account: input.address, chainId, timezone }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(api(path), {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.method && init.method !== 'GET' ? { 'X-Makoto-Request': '1' } : {}), ...init?.headers },
  })
  if (response.status === 204) return undefined as T
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const code = typeof body?.code === 'string' ? body.code : typeof body?.error === 'string' ? body.error : 'TASK_EXECUTION_FAILED'
    throw new Error(code)
  }
  return body as T
}

export const taskApi = {
  list: () => request<{ tasks: Task[] }>('tasks'),
  notifications: () => request<{ notifications: TaskNotification[] }>('tasks/notifications'),
  parse: (input: { text: string; mode: 'monitor' | 'automation'; account: string; chainId: number; timezone: string; locale: 'en' | 'vi' }) =>
    request<TaskParseResult>('tasks/parse', { method: 'POST', body: JSON.stringify(input) }),
  create: (candidate: TaskCandidate) => request<{ task: Task }>('tasks', { method: 'POST', body: JSON.stringify(candidate) }),
  update: (id: string, change: Partial<Pick<TaskCandidate, 'condition' | 'schedule'>> & { status?: TaskStatus }) =>
    request<{ task: Task }>(`tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(change) }),
  remove: (id: string) => request<void>(`tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  run: (id: string) => request<{ task: Task; run: unknown }>(`tasks/${encodeURIComponent(id)}/run`, { method: 'POST' }),
}

export function taskDefinition(task: Pick<TaskCandidate, 'type' | 'condition' | 'schedule'>, locale: 'en' | 'vi'): string {
  if (task.type === 'CONDITION_MONITOR' && task.condition) {
    const sign = { LT: '<', LTE: '\u2264', GT: '>', GTE: '\u2265' }[task.condition.operator]
    return `${task.condition.asset} ${sign} ${task.condition.threshold}`
  }
  if (task.type === 'SCHEDULED_AUTOMATION' && task.schedule) {
    const action = {
      PORTFOLIO_SUMMARY: locale === 'vi' ? 'T\u00f3m t\u1eaft danh m\u1ee5c' : 'Portfolio summary',
      ACTIVITY_SUMMARY: locale === 'vi' ? 'T\u00f3m t\u1eaft ho\u1ea1t \u0111\u1ed9ng' : 'Activity summary',
      BALANCE_CHECK: locale === 'vi' ? 'Ki\u1ec3m tra s\u1ed1 d\u01b0' : 'Balance check',
    }[task.schedule.action]
    return `${action} \u00b7 ${locale === 'vi' ? 'H\u1eb1ng ng\u00e0y' : 'Daily'} ${task.schedule.time}`
  }
  return '\u2014'
}

export function taskDisplayTitle(task: Pick<TaskCandidate, 'type' | 'condition' | 'schedule' | 'title'>, locale: 'en' | 'vi'): string {
  if (task.type === 'CONDITION_MONITOR' && task.condition) return locale === 'vi' ? `Theo dõi số dư ${task.condition.asset}` : `${task.condition.asset} balance alert`
  if (task.schedule) {
    const titles = {
      PORTFOLIO_SUMMARY: ['Daily portfolio summary', 'Tóm tắt danh mục hằng ngày'],
      ACTIVITY_SUMMARY: ['Daily activity summary', 'Tóm tắt giao dịch hằng ngày'],
      BALANCE_CHECK: ['Daily balance check', 'Kiểm tra số dư hằng ngày'],
    } as const
    return titles[task.schedule.action][locale === 'vi' ? 1 : 0]
  }
  return task.title
}

export function taskResultSummary(task: Pick<TaskCandidate, 'type' | 'condition' | 'schedule'>, value: unknown, locale: 'en' | 'vi'): string {
  if (value == null || typeof value !== 'object') return locale === 'vi' ? 'Chưa có kết quả' : 'No result yet'
  const result = value as Record<string, unknown>
  if (result.kind === 'TOKEN_BALANCE') {
    const balance = typeof result.balance === 'string' ? result.balance : '—'
    return locale === 'vi' ? `Số dư ${result.asset}: ${balance}. Điều kiện ${taskDefinition(task, locale)} ${result.conditionMet ? 'đã đạt' : 'chưa đạt'}.` : `${result.asset} balance: ${balance}. Condition ${taskDefinition(task, locale)} ${result.conditionMet ? 'met' : 'not met'}.`
  }
  if (result.kind === 'ACTIVITY_SUMMARY') {
    if (result.activityStatus === 'UNAVAILABLE') return locale === 'vi' ? 'Hoạt động từ Arc explorer chưa khả dụng.' : 'Arc explorer activity unavailable.'
    const partial = result.activityStatus === 'PARTIAL' ? locale === 'vi' ? ' (dữ liệu một phần)' : ' (partial data)' : ''
    return locale === 'vi' ? `Giao dịch hôm nay được Arc explorer ghi nhận: ${result.activityCount ?? '—'}${partial}.` : `Arc explorer indexed transfers today: ${result.activityCount ?? '—'}${partial}.`
  }
  if (result.kind === 'PORTFOLIO_SUMMARY' || result.kind === 'BALANCE_CHECK') {
    const balances = result.balances && typeof result.balances === 'object' ? Object.entries(result.balances as Record<string, unknown>).map(([asset, amount]) => `${asset}: ${amount}`).join(', ') : ''
    const missingBalances = Array.isArray(result.unavailableBalances) && result.unavailableBalances.length ? locale === 'vi' ? ' Một số số dư chưa khả dụng.' : ' Some balances unavailable.' : ''
    const prices = result.pricingStatus === 'UNAVAILABLE' ? locale === 'vi' ? ' Giá chưa khả dụng.' : ' Pricing unavailable.' : result.pricingStatus === 'PARTIAL' ? locale === 'vi' ? ' Giá chỉ có một phần.' : ' Pricing partial.' : ''
    const activity = result.activityStatus === 'UNAVAILABLE' ? locale === 'vi' ? ' Hoạt động chưa khả dụng.' : ' Activity unavailable.' : result.activityStatus === 'PARTIAL' ? locale === 'vi' ? ' Hoạt động chỉ có một phần.' : ' Activity partial.' : ''
    return (locale === 'vi' ? `Số dư: ${balances || 'chưa khả dụng'}.` : `Balances: ${balances || 'unavailable'}.`) + missingBalances + prices + activity
  }
  return locale === 'vi' ? 'Có kết quả mới.' : 'New result available.'
}

export function taskError(error: unknown, locale: 'en' | 'vi'): string {
  const code = error instanceof Error ? error.message : String(error ?? '')
  const labels: Record<string, [string, string]> = {
    TASK_INVALID: ['Invalid task definition.', 'Nhi\u1ec7m v\u1ee5 kh\u00f4ng h\u1ee3p l\u1ec7.'],
    TASK_PAUSED: ['Task is paused.', 'Nhi\u1ec7m v\u1ee5 \u0111ang t\u1ea1m d\u1eebng.'],
    TASK_DATA_UNAVAILABLE: ['Task data is unavailable.', 'D\u1eef li\u1ec7u nhi\u1ec7m v\u1ee5 hi\u1ec7n kh\u00f4ng kh\u1ea3 d\u1ee5ng.'],
    TASK_PROVIDER_UNAVAILABLE: ['Task provider is unavailable.', 'Ngu\u1ed3n d\u1eef li\u1ec7u nhi\u1ec7m v\u1ee5 kh\u00f4ng kh\u1ea3 d\u1ee5ng.'],
    TASK_ACCOUNT_MISMATCH: ['This task belongs to another account.', 'Nhi\u1ec7m v\u1ee5 n\u00e0y thu\u1ed9c t\u00e0i kho\u1ea3n kh\u00e1c.'],
    TASK_NETWORK_UNAVAILABLE: ['Network is unavailable.', 'M\u1ea1ng hi\u1ec7n kh\u00f4ng kh\u1ea3 d\u1ee5ng.'],
    TASK_SCHEDULE_INVALID: ['Schedule is invalid.', 'L\u1ecbch kh\u00f4ng h\u1ee3p l\u1ec7.'],
    TASK_TIMEZONE_INVALID: ['Timezone is invalid.', 'M\u00fai gi\u1edd kh\u00f4ng h\u1ee3p l\u1ec7.'],
    TASK_DUPLICATE: ['An identical task already exists.', '\u0110\u00e3 c\u00f3 nhi\u1ec7m v\u1ee5 tr\u00f9ng l\u1eb7p.'],
    TASK_RUNNING: ['Task is already running.', 'Nhi\u1ec7m v\u1ee5 \u0111ang ch\u1ea1y.'],
    AUTH_REQUIRED: ['Verify your wallet to manage tasks.', 'X\u00e1c minh v\u00ed \u0111\u1ec3 qu\u1ea3n l\u00fd nhi\u1ec7m v\u1ee5.'],
    AUTH_SESSION_EXPIRED: ['Your task session expired. Verify your wallet again.', 'Phi\u00ean nhi\u1ec7m v\u1ee5 \u0111\u00e3 h\u1ebft h\u1ea1n. H\u00e3y x\u00e1c minh v\u00ed l\u1ea1i.'],
    AUTH_WALLET_REQUIRED: ['Connect your wallet to verify it.', 'K\u1ebft n\u1ed1i v\u00ed \u0111\u1ec3 x\u00e1c minh.'],
    AUTH_WALLET_MISMATCH: ['The connected wallet changed. Verify the current wallet.', 'V\u00ed \u0111\u00e3 k\u1ebft n\u1ed1i \u0111\u00e3 thay \u0111\u1ed5i. H\u00e3y x\u00e1c minh v\u00ed hi\u1ec7n t\u1ea1i.'],
    AUTH_SIGNATURE_REJECTED: ['Wallet verification was cancelled.', '\u0110\u00e3 h\u1ee7y x\u00e1c minh v\u00ed.'],
    AUTH_SIGN_UNSUPPORTED: ['This wallet does not support message signing.', 'V\u00ed n\u00e0y kh\u00f4ng h\u1ed7 tr\u1ee3 k\u00fd th\u00f4ng \u0111i\u1ec7p.'],
    AUTH_SIGN_FAILED: ['Wallet message signing failed.', 'K\u00fd th\u00f4ng \u0111i\u1ec7p v\u00ed th\u1ea5t b\u1ea1i.'],
    AUTH_INVALID_SIGNATURE: ['Wallet signature could not be verified.', 'Kh\u00f4ng th\u1ec3 x\u00e1c minh ch\u1eef k\u00fd v\u00ed.'],
    TASK_WRITE_REQUIRES_USER: ['Financial writes require review and your wallet signature.', 'Giao d\u1ecbch c\u1ea7n xem l\u1ea1i v\u00e0 ch\u1eef k\u00fd v\u00ed c\u1ee7a b\u1ea1n.'],
  }
  const pair = labels[code] ?? ['Task request failed. Please retry.', 'Y\u00eau c\u1ea7u nhi\u1ec7m v\u1ee5 th\u1ea5t b\u1ea1i. H\u00e3y th\u1eed l\u1ea1i.']
  return pair[locale === 'vi' ? 1 : 0]
}

export function taskIntentMode(text: string): 'monitor' | 'automation' | null {
  const value = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase()
  if (/\b(daily|every day|every morning|every evening|schedule)\b|hang ngay|moi ngay|moi sang|moi toi|luc\s*\d{1,2}/.test(value)) return 'automation'
  if (/\b(alert|notify|monitor|watch)\b|\bwhen\b.*\b(usdc|eurc|cirbtc|balance)\b.*(?:\b(below|above|under|over|less|more)\b|[<>]=?)|bao toi khi|thong bao khi|theo doi|\bkhi\b.{0,120}\b(usdc|eurc|cirbtc|so du)\b.{0,120}(?:\b(duoi|tren|thap hon|cao hon|nho hon|lon hon)\b|[<>]=?)/.test(value)) return 'monitor'
  return null
}
