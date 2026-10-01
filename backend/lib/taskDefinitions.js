const { Cron } = require('croner')

const CHAIN_ID = 5042002
const TOKENS = Object.freeze({
  USDC: { address: '0x3600000000000000000000000000000000000000', decimals: 6 },
  EURC: { address: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a', decimals: 6 },
  cirBTC: { address: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF', decimals: 8 },
})
const OPERATORS = Object.freeze({ LT: (a, b) => a < b, LTE: (a, b) => a <= b, GT: (a, b) => a > b, GTE: (a, b) => a >= b })
const ACTIONS = Object.freeze(['PORTFOLIO_SUMMARY', 'ACTIVITY_SUMMARY', 'BALANCE_CHECK'])

class TaskError extends Error {
  constructor(code, message = code, status = 400) { super(message); this.code = code; this.status = status }
}

function account(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value)) throw new TaskError('TASK_INVALID', 'Invalid account')
  return value.toLowerCase()
}

function timezone(value) {
  if (typeof value !== 'string' || value.length > 80 || !value) throw new TaskError('TASK_TIMEZONE_INVALID')
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(new Date()) }
  catch { throw new TaskError('TASK_TIMEZONE_INVALID') }
  return value
}

function decimalUnits(value, decimals) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new TaskError('TASK_INVALID', 'Invalid threshold')
  const [whole, fraction = ''] = value.split('.')
  if (fraction.length > decimals || whole.length > 30) throw new TaskError('TASK_INVALID', 'Invalid threshold precision')
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0')
}

function formatUnits(value, decimals) {
  const base = 10n ** BigInt(decimals)
  const fraction = (value % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${value / base}${fraction ? `.${fraction}` : ''}`
}

function dailyNext(schedule, zone, after) {
  const match = typeof schedule?.time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(schedule.time)
  if (schedule?.kind !== 'DAILY' || !match || !ACTIONS.includes(schedule.action)) throw new TaskError('TASK_SCHEDULE_INVALID')
  const [hour, minute] = schedule.time.split(':').map(Number)
  const cron = new Cron(`${minute} ${hour} * * *`, { timezone: timezone(zone), paused: true })
  const next = cron.nextRun(new Date(after))
  if (!next || !Number.isFinite(next.getTime())) throw new TaskError('TASK_SCHEDULE_INVALID')
  return next.toISOString()
}

function localDayStart(zone, now) {
  const cron = new Cron('0 0 * * *', { timezone: timezone(zone), paused: true })
  let cursor = new Date(now - 48 * 60 * 60_000), latest = null
  for (let i = 0; i < 4; i++) {
    const next = cron.nextRun(cursor)
    if (!next || next.getTime() > now) break
    latest = next
    cursor = next
  }
  if (!latest) throw new TaskError('TASK_SCHEDULE_INVALID')
  return latest.toISOString()
}

function validateDefinition(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TaskError('TASK_INVALID')
  const type = input.type
  const boundAccount = account(input.account)
  if (input.chainId !== CHAIN_ID) throw new TaskError('TASK_NETWORK_UNAVAILABLE', 'Only Arc Testnet tasks are supported')
  const zone = timezone(input.timezone)
  const locale = input.locale === 'vi' ? 'vi' : input.locale === 'en' ? 'en' : null
  if (!locale) throw new TaskError('TASK_INVALID', 'Invalid locale')
  const createdBy = input.createdBy === 'AGENT' ? 'AGENT' : input.createdBy === 'USER' ? 'USER' : null
  if (!createdBy) throw new TaskError('TASK_INVALID', 'Invalid creator')

  let condition = null, schedule = null, authority = 'NOTIFY_ONLY', title, description, sourceIntent
  if (type === 'CONDITION_MONITOR') {
    const raw = input.condition
    if (!raw || raw.metric !== 'TOKEN_BALANCE' || !TOKENS[raw.asset] || !OPERATORS[raw.operator]) throw new TaskError('TASK_INVALID', 'Unsupported monitor condition')
    const threshold = formatUnits(decimalUnits(raw.threshold, TOKENS[raw.asset].decimals), TOKENS[raw.asset].decimals)
    const checkIntervalMinutes = raw.checkIntervalMinutes === undefined ? 2 : Number(raw.checkIntervalMinutes)
    if (!Number.isInteger(checkIntervalMinutes) || checkIntervalMinutes < 1 || checkIntervalMinutes > 60) throw new TaskError('TASK_INVALID', 'Invalid monitor cadence')
    condition = { metric: 'TOKEN_BALANCE', asset: raw.asset, operator: raw.operator, threshold, checkIntervalMinutes }
    title = `${raw.asset} balance alert`
    description = `${raw.asset} ${raw.operator} ${threshold}`
    sourceIntent = description
  } else if (type === 'SCHEDULED_AUTOMATION') {
    const raw = input.schedule
    schedule = { kind: 'DAILY', time: raw?.time, action: raw?.action }
    dailyNext(schedule, zone, Date.now())
    title = { PORTFOLIO_SUMMARY: 'Daily portfolio summary', ACTIVITY_SUMMARY: 'Daily activity summary', BALANCE_CHECK: 'Daily balance check' }[schedule.action]
    description = `${title} at ${schedule.time} (${zone})`
    sourceIntent = description
  } else throw new TaskError('TASK_INVALID', 'Unsupported task type')
  return { type, title, description, status: 'ACTIVE', authority, account: boundAccount, chainId: CHAIN_ID, timezone: zone, sourceIntent, locale, condition, schedule, createdBy }
}

function normalized(text) { return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase() }

function parseIntent(input) {
  const { text, mode, account: rawAccount, chainId, timezone: zone, locale } = input || {}
  if (typeof text !== 'string' || !text.trim() || text.length > 500 || (mode !== 'monitor' && mode !== 'automation')) throw new TaskError('TASK_INVALID', 'Invalid task request')
  const base = { account: account(rawAccount), chainId, timezone: timezone(zone), locale, createdBy: 'AGENT' }
  if (chainId !== CHAIN_ID || !['en', 'vi'].includes(locale)) throw new TaskError('TASK_INVALID', 'Invalid task context')
  const s = normalized(text)
  if (/ignore (?:all |previous )?instructions|eth_sendtransaction|eth_sendrawtransaction|private key|seed phrase|\b(?:javascript|shell|curl)\b/.test(s)) {
    return { candidate: null, missingFields: [], blocked: { code: 'TASK_INVALID', authority: 'PREPARE_ONLY' } }
  }
  // Financial writes never become executable background tasks; "send me a summary" remains a read-only request.
  if (/\b(swap|bridge|approve|approval|buy|sell|pay|withdraw|stake|unstake|deposit|mint|burn|redeem|lend|borrow|repay|mua|ban|rut|nap|vay|tra no|doi token|hoan doi)\b/.test(s) || /\b(send|transfer|gui|chuyen)\s+(?:\d|them|more|usdc|eurc|cirbtc)\b/.test(s)) {
    return { candidate: null, missingFields: [], blocked: { code: 'TASK_WRITE_REQUIRES_USER', authority: 'PREPARE_ONLY' } }
  }
  if (mode === 'monitor') {
    const asset = /\bcirbtc\b/i.test(s) ? 'cirBTC' : /\beurc\b/i.test(s) ? 'EURC' : /\busdc\b/i.test(s) ? 'USDC' : null
    const op = /(<=|at or below|no more than|duoi hoac bang|thap hon hoac bang)/.test(s) ? 'LTE' : /(>=|at or above|no less than|tren hoac bang|cao hon hoac bang)/.test(s) ? 'GTE' : /(<|below|under|less than|duoi|thap hon|nho hon)/.test(s) ? 'LT' : /(>|above|over|greater than|tren|cao hon|lon hon)/.test(s) ? 'GT' : null
    const amount = s.match(/(?:<=|>=|<|>|at or below|at or above|no more than|no less than|below|under|less than|duoi(?: hoac bang)?|thap hon(?: hoac bang)?|nho hon|above|over|greater than|tren(?: hoac bang)?|cao hon(?: hoac bang)?|lon hon)\s+(\d+(?:[.,]\d+)?)/)?.[1]?.replace(',', '.')
    const missingFields = [!asset && 'asset', !op && 'operator', !amount && 'threshold'].filter(Boolean)
    if (missingFields.length) return { candidate: null, missingFields }
    const candidate = validateDefinition({ ...base, type: 'CONDITION_MONITOR', condition: { metric: 'TOKEN_BALANCE', asset, operator: op, threshold: amount, checkIntervalMinutes: 2 } })
    return { candidate, missingFields: [] }
  }
  const rawTime = s.match(/\b([01]?\d|2[0-3])(?::([0-5]\d)|h([0-5]?\d)?)\b/)
  const time = rawTime ? `${rawTime[1].padStart(2, '0')}:${(rawTime[2] ?? rawTime[3] ?? '00').padStart(2, '0')}` : null
  const action = /(portfolio|danh muc|tai san)/.test(s) ? 'PORTFOLIO_SUMMARY' : /(activity|transaction|giao dich|hoat dong)/.test(s) ? 'ACTIVITY_SUMMARY' : /(balance|so du)/.test(s) ? 'BALANCE_CHECK' : null
  const recurrence = /(daily|every day|moi ngay|hang ngay|moi sang|moi toi)/.test(s)
  const missingFields = [!time && 'time', !action && 'action', !recurrence && 'recurrence'].filter(Boolean)
  if (missingFields.length) return { candidate: null, missingFields }
  return { candidate: validateDefinition({ ...base, type: 'SCHEDULED_AUTOMATION', schedule: { kind: 'DAILY', time, action } }), missingFields: [] }
}

module.exports = { CHAIN_ID, TOKENS, OPERATORS, ACTIONS, TaskError, decimalUnits, formatUnits, dailyNext, localDayStart, validateDefinition, parseIntent }
