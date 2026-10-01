const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { fork } = require('node:child_process')
const { once } = require('node:events')
const { DatabaseSync } = require('node:sqlite')
const { TaskEngine } = require('../lib/taskEngine')

const ACCOUNT = '0x1111111111111111111111111111111111111111'
const CREATE_TIME = Date.parse('2026-09-29T00:00:00Z')
const DUE_TIME = Date.parse('2026-09-29T09:00:00Z')
const BASE = { account: ACCOUNT, chainId: 5042002, timezone: 'UTC', locale: 'en', createdBy: 'USER' }
const summary = (time) => ({ ...BASE, type: 'SCHEDULED_AUTOMATION', schedule: { kind: 'DAILY', time, action: 'BALANCE_CHECK' } })
const monitor = (threshold) => ({ ...BASE, type: 'CONDITION_MONITOR', condition: { metric: 'TOKEN_BALANCE', asset: 'USDC', operator: 'LT', threshold: String(threshold), checkIntervalMinutes: 2 } })

function testDirectory() { return fs.mkdtempSync(path.join(os.tmpdir(), 'makoto-claims-test-')) }
function cleanup(dir) {
  const resolved = path.resolve(dir), temp = path.resolve(os.tmpdir()) + path.sep
  if (!resolved.startsWith(temp)) throw new Error('Unsafe test cleanup path')
  fs.rmSync(resolved, { recursive: true, force: true })
}

function eventBus() {
  const queued = [], waiting = []
  const stats = { readStarts: 0, workerErrors: 0, busyErrors: 0 }
  const push = (event) => {
    if (event.type === 'READ_STARTED') stats.readStarts++
    if (event.type === 'ERROR') {
      stats.workerErrors++
      if (String(event.code).includes('SQLITE_BUSY') || String(event.code).includes('SQLITE_LOCKED')) stats.busyErrors++
    }
    const index = waiting.findIndex((item) => item.match(event) || event.type === 'ERROR' || event.type === 'EXIT')
    if (index < 0) { queued.push(event); return }
    const [item] = waiting.splice(index, 1)
    clearTimeout(item.timer)
    if (event.type === 'ERROR' || event.type === 'EXIT') item.reject(new Error(`Worker ${event.type}: ${event.code || event.signal || 'unknown'}`))
    else item.resolve(event)
  }
  const take = (match, timeoutMs = 8_000) => {
    const index = queued.findIndex((event) => match(event) || event.type === 'ERROR' || event.type === 'EXIT')
    if (index >= 0) {
      const [event] = queued.splice(index, 1)
      return event.type === 'ERROR' || event.type === 'EXIT' ? Promise.reject(new Error(`Worker ${event.type}: ${event.code || event.signal || 'unknown'}`)) : Promise.resolve(event)
    }
    return new Promise((resolve, reject) => {
      const item = { match, resolve, reject, timer: null }
      item.timer = setTimeout(() => {
        waiting.splice(waiting.indexOf(item), 1)
        reject(new Error('Timed out waiting for worker event'))
      }, timeoutMs)
      waiting.push(item)
    })
  }
  return { push, take, stats }
}

function spawnWorker(bus, dbPath, now, leaseMs = 120_000) {
  const child = fork(path.join(__dirname, 'claim-worker.js'), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  child.on('message', (message) => bus.push({ worker: child, ...message }))
  child.send({ type: 'INIT', dbPath, now, leaseMs })
  return child
}

async function closeWorker(bus, child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.send({ type: 'CLOSE' })
  await bus.take((event) => event.worker === child && event.type === 'CLOSED')
  await exited
}

test('two real processes claim each scheduled and false-to-true monitor occurrence once across 100 races', { timeout: 90_000 }, async (t) => {
  const dir = testDirectory(), dbPath = path.join(dir, 'tasks.sqlite')
  const bus = eventBus(), workers = []
  let parent
  try {
    parent = new TaskEngine({
      dbPath,
      now: () => CREATE_TIME,
      reads: {
        verifyChain: async () => {},
        readBalance: async () => ({ amount: '1000', units: '1000000000', source: 'fixture', observedAt: new Date(CREATE_TIME).toISOString() }),
      },
    })
    assert.equal(parent.db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal')
    assert.equal(parent.db.prepare('PRAGMA busy_timeout').get().timeout, 5_000)
    const a = spawnWorker(bus, dbPath, DUE_TIME), b = spawnWorker(bus, dbPath, DUE_TIME)
    workers.push(a, b)
    await bus.take((event) => event.worker === a && event.type === 'READY')
    await bus.take((event) => event.worker === b && event.type === 'READY')
    let duplicateExecutions = 0, duplicateRuns = 0, duplicateNotifications = 0, successfulExecutions = 0
    for (let iteration = 0; iteration < 100; iteration++) {
      const task = iteration < 50 ? parent.create(summary(`08:${String(iteration).padStart(2, '0')}`)) : parent.create(monitor(500 + iteration))
      if (iteration >= 50) {
        const baseline = await parent.run(task.id, 'MANUAL')
        assert.equal(baseline.run.result.conditionMet, false)
        assert.equal(parent.get(task.id).previousConditionState, false)
        assert.equal(parent.notifications().filter((note) => note.taskId === task.id).length, 0)
      }
      const contenders = iteration % 2 ? [b, a] : [a, b]
      const readsBefore = bus.stats.readStarts
      for (const contender of contenders) contender.send({ type: 'GO', iteration })
      const started = await bus.take((event) => event.type === 'READ_STARTED' && event.iteration === iteration)
      const loser = started.worker === a ? b : a
      await bus.take((event) => event.worker === loser && event.type === 'DONE' && event.iteration === iteration)
      if (iteration === 0) {
        assert.throws(() => parent.update(task.id, { status: 'PAUSED' }), { code: 'TASK_RUNNING' })
        assert.throws(() => parent.delete(task.id), { code: 'TASK_RUNNING' })
      }
      started.worker.send({ type: 'RELEASE' })
      await bus.take((event) => event.worker === started.worker && event.type === 'DONE' && event.iteration === iteration)
      const readCount = bus.stats.readStarts - readsBefore
      duplicateExecutions += Math.max(0, readCount - 1)
      assert.equal(readCount, 1, `read executions at race ${iteration}`)
      const runs = parent.listRuns(task.id).filter((run) => run.source === 'SCHEDULED')
      const runCount = runs.length
      const notificationCount = parent.notifications().filter((note) => note.taskId === task.id).length
      if (runCount !== 1) duplicateRuns++
      if (notificationCount !== 1) duplicateNotifications++
      assert.equal(runCount, 1, `run count at race ${iteration}`)
      assert.equal(notificationCount, 1, `notification count at race ${iteration}`)
      assert.equal(runs[0].status, 'SUCCESS')
      assert.equal(parent.db.prepare('SELECT attempt_count AS attempts FROM runs WHERE id = ?').get(runs[0].id).attempts, 1)
      successfulExecutions++
      if (iteration >= 50) {
        assert.equal(parent.get(task.id).triggerCount, 1)
        assert.equal(parent.get(task.id).previousConditionState, true)
      }
    }
    assert.equal(successfulExecutions, 100)
    assert.equal(duplicateExecutions, 0)
    assert.equal(duplicateRuns, 0)
    assert.equal(duplicateNotifications, 0)
    assert.equal(bus.stats.workerErrors, 0)
    t.diagnostic(`100 real two-process races: 50 scheduled, 50 false-to-true monitor; successful executions ${successfulExecutions}; duplicate executions ${duplicateExecutions}; duplicate runs ${duplicateRuns}; duplicate notifications ${duplicateNotifications}; lock/busy errors ${bus.stats.busyErrors}`)
  } finally {
    for (const child of workers) {
      try { await closeWorker(bus, child) } catch { child.kill('SIGKILL') }
    }
    if (parent) await parent.close()
    cleanup(dir)
  }
})

test('a dead worker lease is reclaimed into the same run row after expiry', { timeout: 20_000 }, async () => {
  const dir = testDirectory(), dbPath = path.join(dir, 'tasks.sqlite')
  const bus = eventBus(), workers = []
  let parent
  try {
    parent = new TaskEngine({ dbPath, now: () => CREATE_TIME })
    const task = parent.create(summary('08:40'))
    const first = spawnWorker(bus, dbPath, DUE_TIME, 1_000)
    workers.push(first)
    await bus.take((event) => event.worker === first && event.type === 'READY')
    first.send({ type: 'GO', iteration: 1 })
    await bus.take((event) => event.worker === first && event.type === 'READ_STARTED')
    const originalRun = parent.listRuns(task.id)[0]
    assert.equal(originalRun.status, 'RUNNING')
    assert.equal(parent.notifications().length, 0)
    const exit = once(first, 'exit')
    first.kill('SIGKILL')
    await exit

    const second = spawnWorker(bus, dbPath, DUE_TIME + 500, 1_000)
    workers.push(second)
    await bus.take((event) => event.worker === second && event.type === 'READY')
    second.send({ type: 'RECOVER' })
    await bus.take((event) => event.worker === second && event.type === 'RECOVERED')
    assert.equal(parent.listRuns(task.id)[0].status, 'RUNNING')
    second.send({ type: 'GO', iteration: 2 })
    await bus.take((event) => event.worker === second && event.type === 'DONE' && event.iteration === 2)
    assert.equal(parent.listRuns(task.id)[0].status, 'RUNNING')

    second.send({ type: 'SET_NOW', now: DUE_TIME + 1_500 })
    await bus.take((event) => event.worker === second && event.type === 'NOW_SET')
    second.send({ type: 'GO', iteration: 3 })
    await bus.take((event) => event.worker === second && event.type === 'READ_STARTED' && event.iteration === 3)
    second.send({ type: 'RELEASE' })
    await bus.take((event) => event.worker === second && event.type === 'DONE' && event.iteration === 3)
    const runs = parent.listRuns(task.id)
    assert.equal(runs.length, 1)
    assert.equal(runs[0].id, originalRun.id)
    assert.equal(runs[0].status, 'SUCCESS')
    assert.equal(parent.db.prepare('SELECT attempt_count AS attempts FROM runs WHERE id = ?').get(originalRun.id).attempts, 2)
    assert.equal(parent.notifications().filter((note) => note.taskId === task.id).length, 1)
    assert.equal(parent.db.prepare('SELECT COUNT(*) AS n FROM task_claims WHERE task_id = ?').get(task.id).n, 0)
  } finally {
    for (const child of workers) {
      try { await closeWorker(bus, child) } catch { if (child.exitCode === null) child.kill('SIGKILL') }
    }
    if (parent) await parent.close()
    cleanup(dir)
  }
})

test('a renewed lease keeps a second worker out during a long read', { timeout: 20_000 }, async () => {
  const dir = testDirectory(), dbPath = path.join(dir, 'tasks.sqlite')
  const bus = eventBus(), workers = []
  let parent
  try {
    parent = new TaskEngine({ dbPath, now: () => CREATE_TIME })
    const task = parent.create(monitor(500))
    const first = spawnWorker(bus, dbPath, DUE_TIME, 300)
    workers.push(first)
    await bus.take((event) => event.worker === first && event.type === 'READY')
    first.send({ type: 'GO', iteration: 1 })
    await bus.take((event) => event.worker === first && event.type === 'READ_STARTED')
    first.send({ type: 'SET_NOW', now: DUE_TIME + 200 })
    await bus.take((event) => event.worker === first && event.type === 'NOW_SET')
    const deadline = Date.now() + 2_000
    while (parent.db.prepare('SELECT lease_until_ms AS untilMs FROM task_claims WHERE task_id = ?').get(task.id).untilMs <= DUE_TIME + 300) {
      if (Date.now() > deadline) throw new Error('Lease heartbeat did not renew')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    const second = spawnWorker(bus, dbPath, DUE_TIME + 350, 300)
    workers.push(second)
    await bus.take((event) => event.worker === second && event.type === 'READY')
    second.send({ type: 'GO', iteration: 2 })
    await bus.take((event) => event.worker === second && event.type === 'DONE' && event.iteration === 2)
    assert.equal(parent.listRuns(task.id).length, 1)
    assert.equal(parent.listRuns(task.id)[0].status, 'RUNNING')
    first.send({ type: 'RELEASE' })
    await bus.take((event) => event.worker === first && event.type === 'DONE' && event.iteration === 1)
    assert.equal(parent.listRuns(task.id)[0].status, 'SUCCESS')
    assert.equal(parent.notifications().filter((note) => note.taskId === task.id).length, 1)
  } finally {
    for (const child of workers) {
      try { await closeWorker(bus, child) } catch { child.kill('SIGKILL') }
    }
    if (parent) await parent.close()
    cleanup(dir)
  }
})

test('a late worker loses its token and cannot commit a duplicate monitor edge', { timeout: 20_000 }, async () => {
  const dir = testDirectory(), dbPath = path.join(dir, 'tasks.sqlite')
  const bus = eventBus(), workers = []
  let parent
  try {
    parent = new TaskEngine({ dbPath, now: () => CREATE_TIME })
    const task = parent.create(monitor(501))
    const first = spawnWorker(bus, dbPath, DUE_TIME, 1_000)
    const second = spawnWorker(bus, dbPath, DUE_TIME + 1_500, 1_000)
    workers.push(first, second)
    await bus.take((event) => event.worker === first && event.type === 'READY')
    await bus.take((event) => event.worker === second && event.type === 'READY')
    first.send({ type: 'GO', iteration: 1 })
    await bus.take((event) => event.worker === first && event.type === 'READ_STARTED')
    second.send({ type: 'GO', iteration: 2 })
    await bus.take((event) => event.worker === second && event.type === 'READ_STARTED')
    first.send({ type: 'RELEASE' })
    await bus.take((event) => event.worker === first && event.type === 'DONE' && event.iteration === 1)
    assert.equal(parent.listRuns(task.id)[0].status, 'RUNNING')
    assert.equal(parent.notifications().length, 0)
    second.send({ type: 'RELEASE' })
    await bus.take((event) => event.worker === second && event.type === 'DONE' && event.iteration === 2)
    const runs = parent.listRuns(task.id)
    assert.equal(runs.length, 1)
    assert.equal(runs[0].status, 'SUCCESS')
    assert.equal(parent.db.prepare('SELECT attempt_count AS attempts FROM runs WHERE id = ?').get(runs[0].id).attempts, 2)
    assert.equal(parent.notifications().filter((note) => note.taskId === task.id).length, 1)
    assert.equal(parent.get(task.id).triggerCount, 1)
  } finally {
    for (const child of workers) {
      try { await closeWorker(bus, child) } catch { child.kill('SIGKILL') }
    }
    if (parent) await parent.close()
    cleanup(dir)
  }
})

test('legacy task rows without verified owner remain quarantined after schema migration', async () => {
  const dir = testDirectory(), dbPath = path.join(dir, 'tasks.sqlite')
  const db = new DatabaseSync(dbPath)
  db.exec('CREATE TABLE tasks (id TEXT PRIMARY KEY, account TEXT NOT NULL, fingerprint TEXT NOT NULL, data TEXT NOT NULL); CREATE UNIQUE INDEX tasks_fingerprint ON tasks(fingerprint)')
  const legacy = { ...monitor(500), id: 'legacy', status: 'ACTIVE', nextRunAt: new Date(CREATE_TIME).toISOString() }
  db.prepare('INSERT INTO tasks (id, account, fingerprint, data) VALUES (?, ?, ?, ?)').run(legacy.id, ACCOUNT, 'legacy-fingerprint', JSON.stringify(legacy))
  db.close()
  const engine = new TaskEngine({ dbPath, now: () => DUE_TIME, reads: { verifyChain: async () => { throw new Error('Legacy task executed') } } })
  try {
    assert.equal(engine.legacyUnclaimedCount(), 1)
    assert.deepEqual(engine.listForOwner(ACCOUNT), [])
    assert.throws(() => engine.getForOwner(ACCOUNT, legacy.id), { code: 'TASK_NOT_FOUND' })
    await engine.tick()
    assert.equal(engine.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n, 0)
  } finally { await engine.close(); cleanup(dir) }
})
