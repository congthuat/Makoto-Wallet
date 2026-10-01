const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const { TOKENS, OPERATORS, TaskError, decimalUnits, dailyNext, localDayStart, validateDefinition } = require('./taskDefinitions')
const defaultReads = require('./taskReads')
const { generateAgentResponse } = require('./llm')

const DAY = 86_400_000
const TICK_MS = 15_000
const DEFAULT_LEASE_MS = 120_000
const SQLITE_BUSY_TIMEOUT_MS = 5_000

function taskFingerprint(task) { return JSON.stringify([task.type, task.account, task.chainId, task.timezone, task.condition, task.schedule]) }
function json(value) { return JSON.stringify(value) }
function parse(row) { return row ? JSON.parse(row.data) : null }
function iso(now) { return new Date(now).toISOString() }
function ownerAddress(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{40}$/i.test(value) || /^0x0{40}$/i.test(value)) throw new TaskError('AUTH_REQUIRED', 'Wallet authentication required', 401)
  return value.toLowerCase()
}
function missingTask() { return new TaskError('TASK_NOT_FOUND', 'Task not found', 404) }
function claimedTask() { return new TaskError('TASK_ALREADY_CLAIMED', 'Task is already running', 409) }
function runningTask() { return new TaskError('TASK_RUNNING', 'Task is running', 409) }
function hasColumn(db, table, column) { return db.prepare(`PRAGMA table_info(${table})`).all().some((entry) => entry.name === column) }
function messageFor(task, result, locale = task.locale) {
  if (result.kind === 'TOKEN_BALANCE') {
    const comparison = { LT: locale === 'vi' ? 'dưới' : 'below', LTE: locale === 'vi' ? 'không quá' : 'at or below', GT: locale === 'vi' ? 'trên' : 'above', GTE: locale === 'vi' ? 'ít nhất' : 'at or above' }[task.condition.operator]
    return locale === 'vi' ? `Số dư ${result.asset} hiện tại: ${result.balance}. Ngưỡng: ${comparison} ${result.threshold}.` : `${result.asset} balance: ${result.balance}. Threshold: ${comparison} ${result.threshold}.`
  }
  const holdings = Object.entries(result.balances ?? {}).map(([asset, amount]) => `${asset}: ${amount}`).join(', ')
  const prices = ['AVAILABLE', 'NOT_REQUESTED'].includes(result.pricingStatus) ? '' : locale === 'vi' ? ' Giá chưa đầy đủ.' : ' Pricing incomplete.'
  const activity = result.activityStatus === 'UNAVAILABLE' ? locale === 'vi' ? ' Hoạt động chưa khả dụng.' : ' Activity unavailable.' : ''
  if (result.kind === 'ACTIVITY_SUMMARY') {
    if (result.activityStatus === 'UNAVAILABLE') return locale === 'vi' ? 'Hoạt động từ Arc explorer chưa khả dụng.' : 'Arc explorer activity unavailable.'
    const partial = result.activityStatus === 'PARTIAL' ? locale === 'vi' ? ' (dữ liệu một phần)' : ' (partial data)' : ''
    return locale === 'vi' ? `Giao dịch hôm nay được Arc explorer ghi nhận: ${result.activityCount}${partial}.` : `Arc explorer indexed transfers today: ${result.activityCount}${partial}.`
  }
  return (locale === 'vi' ? `Số dư: ${holdings || 'chưa khả dụng'}.` : `Balances: ${holdings || 'unavailable'}.`) + prices + activity
}

function titleFor(task, locale) {
  if (task.type === 'CONDITION_MONITOR') return locale === 'vi' ? `Cảnh báo số dư ${task.condition.asset}` : `${task.condition.asset} balance alert`
  const names = locale === 'vi' ? { PORTFOLIO_SUMMARY: 'Tóm tắt danh mục hằng ngày', ACTIVITY_SUMMARY: 'Tóm tắt hoạt động hằng ngày', BALANCE_CHECK: 'Kiểm tra số dư hằng ngày' } : { PORTFOLIO_SUMMARY: 'Daily portfolio summary', ACTIVITY_SUMMARY: 'Daily activity summary', BALANCE_CHECK: 'Daily balance check' }
  return names[task.schedule.action]
}

function summaryContext(result, locale) {
  const rows = [['Task', result.kind]]
  for (const [asset, amount] of Object.entries(result.balances ?? {})) {
    if (!TOKENS[asset] || typeof amount !== 'string') continue
    const price = result.prices?.[asset]?.usd
    rows.push([`${asset} balance${Number.isFinite(price) && price > 0 ? ' and USD unit price' : ''}`, `${amount}${Number.isFinite(price) && price > 0 ? `; ${price}` : ''}`])
  }
  rows.push(['Pricing status', result.pricingStatus], ['Activity status', result.activityStatus])
  if (Number.isInteger(result.activityCount) && result.activityCount >= 0) rows.push(['Explorer indexed transfer count', String(result.activityCount)])
  if (Array.isArray(result.unavailableBalances) && result.unavailableBalances.length) rows.push(['Unavailable balance reads', result.unavailableBalances.filter((asset) => TOKENS[asset]).join(', ')])
  return { locale, chain: 'Arc Testnet', intent: 'INFORMATION', toolResult: { status: 'OBSERVED', source: 'TASK_SCHEDULED_READ', observedAt: result.observedAt, rows: rows.slice(0, 8) } }
}

class TaskEngine {
  constructor(options = {}) {
    const filename = options.dbPath || path.join(__dirname, '..', 'data', 'tasks.sqlite')
    if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true })
    this.db = new DatabaseSync(filename, { timeout: SQLITE_BUSY_TIMEOUT_MS })
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.exec('CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, account TEXT NOT NULL, fingerprint TEXT NOT NULL, data TEXT NOT NULL, owner_address TEXT); CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, source TEXT NOT NULL, result TEXT, error_code TEXT, occurrence_key TEXT, attempt_count INTEGER NOT NULL DEFAULT 1, FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE); CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, account TEXT NOT NULL, chain_id INTEGER NOT NULL, data TEXT NOT NULL, run_id TEXT, FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE); CREATE TABLE IF NOT EXISTS task_claims (task_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, occurrence_key TEXT NOT NULL, claim_token TEXT NOT NULL, worker_id TEXT NOT NULL, lease_until_ms INTEGER NOT NULL, source TEXT NOT NULL, FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE);')
      if (!hasColumn(this.db, 'tasks', 'owner_address')) this.db.exec('ALTER TABLE tasks ADD COLUMN owner_address TEXT')
      if (!hasColumn(this.db, 'runs', 'occurrence_key')) this.db.exec('ALTER TABLE runs ADD COLUMN occurrence_key TEXT')
      if (!hasColumn(this.db, 'runs', 'attempt_count')) this.db.exec('ALTER TABLE runs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 1')
      if (!hasColumn(this.db, 'notifications', 'run_id')) this.db.exec('ALTER TABLE notifications ADD COLUMN run_id TEXT')
      // Legacy rows have no verified provenance. NULL owners remain quarantined.
      this.db.exec("DROP INDEX IF EXISTS tasks_fingerprint; CREATE UNIQUE INDEX IF NOT EXISTS tasks_owner_fingerprint ON tasks(owner_address, fingerprint) WHERE owner_address IS NOT NULL; CREATE INDEX IF NOT EXISTS tasks_owner ON tasks(owner_address); CREATE TRIGGER IF NOT EXISTS tasks_owner_immutable BEFORE UPDATE OF owner_address ON tasks WHEN OLD.owner_address IS NOT NEW.owner_address BEGIN SELECT RAISE(ABORT, 'TASK_OWNER_IMMUTABLE'); END; CREATE INDEX IF NOT EXISTS runs_task ON runs(task_id, started_at DESC); CREATE UNIQUE INDEX IF NOT EXISTS runs_occurrence ON runs(task_id, occurrence_key) WHERE occurrence_key IS NOT NULL; CREATE INDEX IF NOT EXISTS notifications_account ON notifications(account); CREATE UNIQUE INDEX IF NOT EXISTS notifications_run ON notifications(run_id) WHERE run_id IS NOT NULL;")
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); this.db.close(); throw error }
    this.reads = options.reads || defaultReads
    this.generateSummary = options.generateSummary || generateAgentResponse
    this.now = options.now || (() => Date.now())
    this.leaseMs = Number.isSafeInteger(options.leaseMs) && options.leaseMs >= 100 ? options.leaseMs : DEFAULT_LEASE_MS
    this.workerId = randomUUID()
    this.timer = null
    this.inFlight = new Set()
    this.tickPromise = null
  }

  list() { return this.db.prepare('SELECT data FROM tasks WHERE owner_address IS NOT NULL ORDER BY rowid DESC').all().map(parse) }
  listForOwner(owner) { return this.db.prepare('SELECT data FROM tasks WHERE owner_address = ? ORDER BY rowid DESC').all(ownerAddress(owner)).map(parse) }
  get(id) { const task = parse(this.db.prepare('SELECT data FROM tasks WHERE id = ? AND owner_address IS NOT NULL').get(id)); if (!task) throw missingTask(); return task }
  getForOwner(owner, id) { const task = parse(this.db.prepare('SELECT data FROM tasks WHERE id = ? AND owner_address = ?').get(id, ownerAddress(owner))); if (!task) throw missingTask(); return task }
  save(task) { this.db.prepare('UPDATE tasks SET account = ?, fingerprint = ?, data = ? WHERE id = ? AND owner_address = ?').run(task.account, taskFingerprint(task), json(task), task.id, task.ownerAddress); return task }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE')
    try { const value = fn(); this.db.exec('COMMIT'); return value }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  legacyUnclaimedCount() { return this.db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE owner_address IS NULL').get().n }

  create(input, verifiedOwner) {
    const def = validateDefinition(input)
    const owner = ownerAddress(verifiedOwner ?? def.account)
    if (def.account !== owner) throw new TaskError('TASK_FORBIDDEN', 'Task account does not match verified wallet', 403)
    const now = this.now()
    const task = { ...def, ownerAddress: owner, id: randomUUID(), createdAt: iso(now), updatedAt: iso(now), nextRunAt: def.type === 'CONDITION_MONITOR' ? iso(now) : dailyNext(def.schedule, def.timezone, now), lastRunAt: null, lastResult: null, lastError: null, triggerCount: 0, previousConditionState: null }
    try { this.transaction(() => {
      if (this.db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE owner_address = ?').get(owner).n >= 100) throw new TaskError('TASK_LIMIT', 'Wallet task limit reached', 409)
      this.db.prepare('INSERT INTO tasks (id, account, fingerprint, data, owner_address) VALUES (?, ?, ?, ?, ?)').run(task.id, task.account, taskFingerprint(task), json(task), owner)
    }) }
    catch (error) { if (String(error?.message).includes('UNIQUE')) throw new TaskError('TASK_DUPLICATE', 'Identical task already exists', 409); throw error }
    return task
  }
  createForOwner(owner, input) {
    const verified = ownerAddress(owner)
    if (input?.account != null && ownerAddress(input.account) !== verified) throw new TaskError('TASK_FORBIDDEN', 'Task account does not match verified wallet', 403)
    return this.create({ ...input, account: verified }, verified)
  }

  update(id, patch) { return this.updateOwned(null, id, patch) }
  updateForOwner(owner, id, patch) { return this.updateOwned(ownerAddress(owner), id, patch) }
  updateOwned(owner, id, patch) { return this.transaction(() => {
    const row = owner ? this.db.prepare('SELECT data FROM tasks WHERE id = ? AND owner_address = ?').get(id, owner) : this.db.prepare('SELECT data FROM tasks WHERE id = ? AND owner_address IS NOT NULL').get(id)
    const old = parse(row)
    if (!old) throw missingTask()
    this.rejectOrExpireClaim(id, this.now())
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TaskError('TASK_INVALID')
    const allowed = new Set(['status', 'condition', 'schedule'])
    if (Object.keys(patch).some((key) => !allowed.has(key))) throw new TaskError('TASK_INVALID', 'Unsupported task edit')
    if (patch.status !== undefined && !['ACTIVE', 'PAUSED'].includes(patch.status)) throw new TaskError('TASK_INVALID', 'Invalid task status')
    if (patch.condition && old.type !== 'CONDITION_MONITOR' || patch.schedule && old.type !== 'SCHEDULED_AUTOMATION') throw new TaskError('TASK_INVALID')
    const def = validateDefinition({ ...old, condition: patch.condition ? { ...old.condition, ...patch.condition } : old.condition, schedule: patch.schedule ? { ...old.schedule, ...patch.schedule } : old.schedule })
    const definitionChanged = Boolean(patch.condition || patch.schedule)
    const status = patch.status || old.status
    const now = this.now()
    const updated = { ...old, ...def, status, updatedAt: iso(now), previousConditionState: definitionChanged ? null : old.previousConditionState }
    if (status === 'PAUSED') updated.nextRunAt = null
    else if (old.status === 'PAUSED' || definitionChanged) updated.nextRunAt = updated.type === 'CONDITION_MONITOR' ? iso(now) : dailyNext(updated.schedule, updated.timezone, now)
    try { return this.save(updated) }
    catch (error) { if (String(error?.message).includes('UNIQUE')) throw new TaskError('TASK_DUPLICATE', 'Identical task already exists', 409); throw error }
  }) }

  rejectOrExpireClaim(id, now) {
    const claim = this.db.prepare('SELECT run_id AS runId, lease_until_ms AS leaseUntilMs FROM task_claims WHERE task_id = ?').get(id)
    if (!claim) return
    if (claim.leaseUntilMs > now) throw runningTask()
    this.db.prepare("UPDATE runs SET status = 'FAILED', finished_at = ?, error_code = 'TASK_EXECUTION_INTERRUPTED' WHERE id = ? AND status = 'RUNNING'").run(iso(now), claim.runId)
    this.db.prepare('DELETE FROM task_claims WHERE task_id = ?').run(id)
  }
  delete(id) { return this.deleteOwned(null, id) }
  deleteForOwner(owner, id) { return this.deleteOwned(ownerAddress(owner), id) }
  deleteOwned(owner, id) { return this.transaction(() => {
    const row = owner ? this.db.prepare('SELECT id FROM tasks WHERE id = ? AND owner_address = ?').get(id, owner) : this.db.prepare('SELECT id FROM tasks WHERE id = ? AND owner_address IS NOT NULL').get(id)
    if (!row) throw missingTask()
    this.rejectOrExpireClaim(id, this.now())
    if (owner) this.db.prepare('DELETE FROM tasks WHERE id = ? AND owner_address = ?').run(id, owner)
    else this.db.prepare('DELETE FROM tasks WHERE id = ? AND owner_address IS NOT NULL').run(id)
  }) }
  listRuns(id) { this.get(id); return this.db.prepare('SELECT id, task_id AS taskId, started_at AS startedAt, finished_at AS finishedAt, status, source, result, error_code AS errorCode FROM runs WHERE task_id = ? ORDER BY started_at DESC LIMIT 50').all(id).map((r) => ({ ...r, result: r.result ? JSON.parse(r.result) : null })) }
  listRunsForOwner(owner, id) {
    const canonical = ownerAddress(owner)
    this.getForOwner(canonical, id)
    return this.db.prepare('SELECT r.id, r.task_id AS taskId, r.started_at AS startedAt, r.finished_at AS finishedAt, r.status, r.source, r.result, r.error_code AS errorCode FROM runs r JOIN tasks t ON t.id = r.task_id WHERE r.task_id = ? AND t.owner_address = ? ORDER BY r.started_at DESC LIMIT 50').all(id, canonical).map((r) => ({ ...r, result: r.result ? JSON.parse(r.result) : null }))
  }
  notifications() { return this.db.prepare('SELECT data FROM notifications ORDER BY rowid DESC LIMIT 200').all().map(parse) }
  notificationsForOwner(owner) { return this.db.prepare('SELECT n.data FROM notifications n JOIN tasks t ON t.id = n.task_id WHERE t.owner_address = ? ORDER BY n.rowid DESC LIMIT 200').all(ownerAddress(owner)).map(parse) }

  recover() {
    const now = this.now()
    this.transaction(() => {
      // A live worker's claim is never failed by another process starting up.
      for (const claim of this.db.prepare('SELECT task_id AS taskId, run_id AS runId FROM task_claims WHERE source = ? AND lease_until_ms <= ?').all('MANUAL', now)) {
        this.db.prepare("UPDATE runs SET status = 'FAILED', finished_at = ?, error_code = 'TASK_EXECUTION_INTERRUPTED' WHERE id = ? AND status = 'RUNNING'").run(iso(now), claim.runId)
        this.db.prepare('DELETE FROM task_claims WHERE task_id = ?').run(claim.taskId)
      }
      this.db.prepare("UPDATE runs SET status = 'FAILED', finished_at = ?, error_code = 'TASK_EXECUTION_INTERRUPTED' WHERE status = 'RUNNING' AND NOT EXISTS (SELECT 1 FROM task_claims c WHERE c.run_id = runs.id)").run(iso(now))
      for (const task of this.list()) {
        if (task.status !== 'ACTIVE') continue
        if (task.type === 'CONDITION_MONITOR') {
          if (!task.nextRunAt) this.save({ ...task, nextRunAt: iso(now) })
          continue
        }
        const due = task.nextRunAt ? Date.parse(task.nextRunAt) : NaN
        if (Number.isFinite(due) && due <= now && now - due <= DAY) continue
        const claim = this.db.prepare('SELECT lease_until_ms AS leaseUntilMs FROM task_claims WHERE task_id = ?').get(task.id)
        if (claim?.leaseUntilMs > now) continue
        this.rejectOrExpireClaim(task.id, now)
        this.save({ ...task, nextRunAt: dailyNext(task.schedule, task.timezone, now) })
      }
    })
  }

  start() {
    if (this.timer) return
    this.recover()
    this.timer = setInterval(() => { void this.tick().catch((error) => console.error('task scheduler tick', error?.code || 'TASK_EXECUTION_FAILED')) }, TICK_MS)
    this.timer.unref?.()
    void this.tick().catch((error) => console.error('task scheduler startup tick', error?.code || 'TASK_EXECUTION_FAILED'))
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null }
  async close() { this.stop(); if (this.tickPromise) await this.tickPromise; this.db.close() }

  tick() {
    if (this.tickPromise) return this.tickPromise
    this.tickPromise = Promise.resolve().then(async () => {
      const now = this.now()
      for (const task of this.list()) {
        if (task.status !== 'ACTIVE' || !task.nextRunAt || Date.parse(task.nextRunAt) > now || this.inFlight.has(task.id)) continue
        try { await this.run(task.id, 'SCHEDULED') }
        catch (error) { if (error?.code !== 'TASK_ALREADY_CLAIMED' && error?.code !== 'TASK_NOT_FOUND') throw error }
      }
    }).finally(() => { this.tickPromise = null })
    return this.tickPromise
  }

  claim(id, source, owner) { return this.transaction(() => {
    const row = owner ? this.db.prepare('SELECT data FROM tasks WHERE id = ? AND owner_address = ?').get(id, owner) : this.db.prepare('SELECT data FROM tasks WHERE id = ? AND owner_address IS NOT NULL').get(id)
    const task = parse(row)
    if (!task) throw missingTask()
    if (task.status !== 'ACTIVE') throw new TaskError('TASK_PAUSED', 'Task is paused', 409)
    const now = this.now()
    const due = task.nextRunAt ? Date.parse(task.nextRunAt) : NaN
    const existing = this.db.prepare('SELECT run_id AS runId, occurrence_key AS occurrenceKey, lease_until_ms AS leaseUntilMs FROM task_claims WHERE task_id = ?').get(id)
    if (existing?.leaseUntilMs > now) {
      if (source === 'SCHEDULED') return null
      throw claimedTask()
    }
    if (source === 'SCHEDULED') {
      if (!Number.isFinite(due) || due > now) return null
      if (task.type === 'SCHEDULED_AUTOMATION' && now - due > DAY) {
        this.rejectOrExpireClaim(id, now)
        this.save({ ...task, nextRunAt: dailyNext(task.schedule, task.timezone, now) })
        return null
      }
    }
    const candidateRunId = randomUUID()
    const occurrenceKey = source === 'SCHEDULED' ? `${task.type}:${id}:${task.nextRunAt}` : `MANUAL:${candidateRunId}`
    const token = randomUUID(), startedAt = iso(now)
    let runId = candidateRunId
    if (existing) {
      if (existing.occurrenceKey === occurrenceKey) {
        runId = existing.runId
        this.db.prepare("UPDATE runs SET started_at = ?, finished_at = NULL, status = 'RUNNING', result = NULL, error_code = NULL, attempt_count = attempt_count + 1 WHERE id = ?").run(startedAt, runId)
        this.db.prepare('UPDATE task_claims SET claim_token = ?, worker_id = ?, lease_until_ms = ? WHERE task_id = ?').run(token, this.workerId, now + this.leaseMs, id)
        return { task, id, runId, token, startedAt, source }
      }
      this.rejectOrExpireClaim(id, now)
    }
    const prior = this.db.prepare('SELECT id, status FROM runs WHERE task_id = ? AND occurrence_key = ?').get(id, occurrenceKey)
    if (prior?.status === 'SUCCESS' || prior?.status === 'FAILED') {
      if (source === 'SCHEDULED') this.save({ ...task, nextRunAt: task.type === 'CONDITION_MONITOR' ? iso(now + task.condition.checkIntervalMinutes * 60_000) : dailyNext(task.schedule, task.timezone, now) })
      return null
    }
    if (prior) {
      runId = prior.id
      this.db.prepare("UPDATE runs SET started_at = ?, finished_at = NULL, status = 'RUNNING', result = NULL, error_code = NULL, attempt_count = attempt_count + 1 WHERE id = ?").run(startedAt, runId)
    } else this.db.prepare('INSERT INTO runs (id, task_id, started_at, status, source, occurrence_key) VALUES (?, ?, ?, ?, ?, ?)').run(runId, id, startedAt, 'RUNNING', source, occurrenceKey)
    this.db.prepare('INSERT INTO task_claims (task_id, run_id, occurrence_key, claim_token, worker_id, lease_until_ms, source) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, runId, occurrenceKey, token, this.workerId, now + this.leaseMs, source)
    return { task, id, runId, token, startedAt, source }
  }) }

  renewClaim(claim) {
    return this.db.prepare('UPDATE task_claims SET lease_until_ms = ? WHERE task_id = ? AND run_id = ? AND claim_token = ?').run(this.now() + this.leaseMs, claim.id, claim.runId, claim.token).changes === 1
  }
  checkedClaim(claim) {
    const row = this.db.prepare('SELECT data FROM tasks WHERE id = ? AND owner_address = ? AND EXISTS (SELECT 1 FROM task_claims WHERE task_id = ? AND run_id = ? AND claim_token = ?)').get(claim.id, claim.task.ownerAddress, claim.id, claim.runId, claim.token)
    const task = parse(row)
    if (!task) throw claimedTask()
    return task
  }
  finishSuccess(claim, result) { return this.transaction(() => {
    const task = this.checkedClaim(claim), now = this.now()
    const updated = { ...task, lastRunAt: iso(now), lastResult: result, lastError: null }
    if (task.type === 'CONDITION_MONITOR') {
      updated.previousConditionState = result.conditionMet
      updated.nextRunAt = iso(now + task.condition.checkIntervalMinutes * 60_000)
      if (result.triggered) updated.triggerCount++
    } else if (claim.source === 'SCHEDULED') updated.nextRunAt = dailyNext(task.schedule, task.timezone, now)
    let notification = null
    if (result.triggered || task.type === 'SCHEDULED_AUTOMATION') notification = { id: randomUUID(), taskId: claim.id, account: task.account, chainId: task.chainId, createdAt: iso(now), title: titleFor(task, task.locale), titleEn: titleFor(task, 'en'), titleVi: titleFor(task, 'vi'), message: messageFor(task, result), messageEn: messageFor(task, result, 'en'), messageVi: messageFor(task, result, 'vi'), kind: result.triggered ? 'MONITOR_TRIGGER' : 'AUTOMATION_RESULT', readAt: null }
    this.save(updated)
    this.db.prepare("UPDATE runs SET finished_at = ?, status = 'SUCCESS', result = ? WHERE id = ? AND status = 'RUNNING'").run(iso(now), json(result), claim.runId)
    if (notification) this.db.prepare('INSERT INTO notifications (id, task_id, account, chain_id, data, run_id) VALUES (?, ?, ?, ?, ?, ?)').run(notification.id, claim.id, task.account, task.chainId, json(notification), claim.runId)
    this.db.prepare('DELETE FROM task_claims WHERE task_id = ? AND claim_token = ?').run(claim.id, claim.token)
    return { task: updated, run: { id: claim.runId, taskId: claim.id, startedAt: claim.startedAt, finishedAt: iso(now), status: 'SUCCESS', source: claim.source, result, errorCode: null } }
  }) }
  finishFailure(claim, error) { return this.transaction(() => {
    const task = this.checkedClaim(claim), now = this.now()
    const code = error instanceof TaskError ? error.code : 'TASK_EXECUTION_FAILED'
    const updated = { ...task, lastRunAt: iso(now), lastError: { code, at: iso(now) }, nextRunAt: task.type === 'CONDITION_MONITOR' ? iso(now + task.condition.checkIntervalMinutes * 60_000) : claim.source === 'SCHEDULED' ? dailyNext(task.schedule, task.timezone, now) : task.nextRunAt }
    this.save(updated)
    this.db.prepare("UPDATE runs SET finished_at = ?, status = 'FAILED', error_code = ? WHERE id = ? AND status = 'RUNNING'").run(iso(now), code, claim.runId)
    this.db.prepare('DELETE FROM task_claims WHERE task_id = ? AND claim_token = ?').run(claim.id, claim.token)
    return { task: updated, run: { id: claim.runId, taskId: claim.id, startedAt: claim.startedAt, finishedAt: iso(now), status: 'FAILED', source: claim.source, result: null, errorCode: code } }
  }) }
  async runForOwner(owner, id, source = 'MANUAL') { return this.run(id, source, ownerAddress(owner)) }
  async run(id, source = 'MANUAL', owner = null) {
    if (source !== 'MANUAL' && source !== 'SCHEDULED') throw new TaskError('TASK_INVALID', 'Invalid run source')
    const claim = this.claim(id, source, owner)
    if (!claim) return null
    this.inFlight.add(id)
    const heartbeat = setInterval(() => { try { this.renewClaim(claim) } catch { /* Finishing checks the claim token. */ } }, Math.max(50, Math.floor(this.leaseMs / 3)))
    heartbeat.unref?.()
    try {
      let result
      try {
        if (claim.task.type === 'CONDITION_MONITOR') result = await this.evaluateMonitor(claim.task)
        else result = await this.withLanguageSummary(claim.task, await this.summarize(claim.task))
      } catch (error) { return this.finishFailure(claim, error) }
      return this.finishSuccess(claim, result)
    } finally { clearInterval(heartbeat); this.inFlight.delete(id) }
  }

  async evaluateMonitor(task) {
    if (task.chainId !== 5042002) throw new TaskError('TASK_NETWORK_UNAVAILABLE')
    await this.reads.verifyChain()
    const observation = await this.reads.readBalance(task.account, task.condition.asset)
    if (!observation || typeof observation.units !== 'string' || !/^\d+$/.test(observation.units)) throw new TaskError('TASK_DATA_UNAVAILABLE')
    const threshold = decimalUnits(task.condition.threshold, TOKENS[task.condition.asset].decimals)
    const conditionMet = OPERATORS[task.condition.operator](BigInt(observation.units), threshold)
    return { kind: 'TOKEN_BALANCE', asset: task.condition.asset, balance: observation.amount, threshold: task.condition.threshold, operator: task.condition.operator, conditionMet, triggered: conditionMet && task.previousConditionState !== true, previousConditionState: task.previousConditionState, source: observation.source || 'arc-rpc', observedAt: observation.observedAt || iso(this.now()) }
  }

  async withLanguageSummary(task, result) {
    const fallback = messageFor(task, result)
    try {
      const response = await this.generateSummary({
        message: 'Summarize only the observed task rows. State partial or unavailable data clearly. Do not estimate a portfolio total, infer transactions, or add unobserved facts.',
        locale: task.locale,
        context: summaryContext(result, task.locale),
      })
      const text = response?.ok && typeof response.text === 'string' ? response.text.trim().slice(0, 600).trim() : ''
      if (text) return { ...result, languageSummary: text, languageSource: 'REAL_PROVIDER' }
    } catch { /* A language failure cannot fail the scheduled read. */ }
    return { ...result, languageSummary: fallback, languageSource: 'DETERMINISTIC_FALLBACK' }
  }

  async summarize(task) {
    if (task.chainId !== 5042002) throw new TaskError('TASK_NETWORK_UNAVAILABLE')
    const action = task.schedule.action
    const since = action === 'ACTIVITY_SUMMARY' ? localDayStart(task.timezone, this.now()) : iso(this.now() - DAY)
    if (action === 'ACTIVITY_SUMMARY') {
      try {
        const activity = await this.reads.readActivity(task.account, since)
        return { kind: action, balances: {}, activityCount: activity.items.length, activity: activity.items, activityStatus: activity.hasMore ? 'PARTIAL' : 'AVAILABLE', pricingStatus: 'NOT_REQUESTED', summary: activity.items.length ? `${activity.items.length} explorer-indexed transfers since local midnight` : 'No explorer-indexed transfers in the fetched page since local midnight', observedAt: activity.observedAt }
      } catch (error) {
        return { kind: action, balances: {}, activityCount: null, activity: [], activityStatus: 'UNAVAILABLE', pricingStatus: 'NOT_REQUESTED', summary: 'Arc explorer activity unavailable', observedAt: iso(this.now()) }
      }
    }
    const observed = await this.reads.readBalances(task.account)
    if (!observed || !observed.balances || !Object.keys(observed.balances).length) throw new TaskError('TASK_DATA_UNAVAILABLE', 'Wallet balances unavailable', 502)
    const balances = Object.fromEntries(Object.entries(observed.balances).map(([asset, value]) => [asset, value.amount]))
    let prices = {}, pricingStatus = 'NOT_REQUESTED', activityStatus = 'NOT_REQUESTED', activityCount = null, activity = []
    if (action === 'PORTFOLIO_SUMMARY') {
      try { const p = await this.reads.readPrices(); prices = p.prices; pricingStatus = !p.unavailable.length ? 'AVAILABLE' : Object.keys(prices).length ? 'PARTIAL' : 'UNAVAILABLE' }
      catch { pricingStatus = 'UNAVAILABLE' }
      try { const a = await this.reads.readActivity(task.account, since); activity = a.items; activityCount = a.items.length; activityStatus = a.hasMore ? 'PARTIAL' : 'AVAILABLE' }
      catch { activityStatus = 'UNAVAILABLE' }
    }
    return { kind: action, balances, unavailableBalances: observed.unavailable, prices, pricingStatus, activityStatus, activityCount, activity, summary: Object.entries(balances).map(([asset, amount]) => `${asset}: ${amount}`).join(', '), observedAt: observed.observedAt }
  }
}

let singleton
function getTaskEngine() { if (!singleton) singleton = new TaskEngine({ dbPath: process.env.TASK_DB_PATH }); return singleton }
module.exports = { TaskEngine, getTaskEngine }
