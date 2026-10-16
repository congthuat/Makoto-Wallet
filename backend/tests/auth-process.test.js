const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { fork } = require('node:child_process')
const { DatabaseSync } = require('node:sqlite')
const { Wallet } = require('ethers')
const { SiweMessage } = require('siwe')

const ORIGIN = 'http://localhost:5173'
const ARC_CHAIN_ID = 5042002
const SECRET = 'cross-process-fixture-secret-at-least-32-bytes'
// Public deterministic test key: used only for offline SIWE message signatures.
const WALLET = new Wallet(`0x${'11'.repeat(32)}`)

async function bounded(promise, ms, message) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms)
    })])
  } finally { clearTimeout(timer) }
}

async function stopWorker(worker) {
  if (!worker.exitResult && worker.child.connected) {
    worker.child.send({ type: 'stop' }, () => {})
  }
  let result
  try {
    result = await bounded(worker.exited, 5000, 'Auth worker did not stop after closing HTTP and auth')
  } catch (error) {
    worker.child.kill('SIGKILL')
    await bounded(worker.exited, 5000, 'Auth worker could not be terminated')
    throw error
  }
  assert.equal(result.code, 0, `Worker exit: ${JSON.stringify(result)}\n${worker.output}`)
  assert.equal(result.signal, null, `Worker was terminated: ${worker.output}`)
}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'makoto-auth-process-'))
  const dbPath = path.join(dir, 'auth.sqlite')
  const workers = new Set()
  t.after(async () => {
    const stopped = await Promise.allSettled([...workers].map(stopWorker))
    const errors = stopped.filter((result) => result.status === 'rejected').map((result) => result.reason)
    // Never remove storage while a child still owns it, including test failures.
    if ([...workers].every((worker) => worker.exitResult)) {
      const resolved = path.resolve(dir)
      assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()))
      assert.ok(path.basename(resolved).startsWith('makoto-auth-process-'))
      fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    }
    if (errors.length) throw new AggregateError(errors, 'Auth worker cleanup failed')
  })
  return {
    dbPath,
    async open() {
      const child = fork(path.join(__dirname, 'auth-worker.cjs'), [], {
        execArgv: [],
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env, NODE_ENV: 'test', TASK_AUTH_DB_PATH: dbPath, TASK_SESSION_SECRET: SECRET, PUBLIC_APP_ORIGIN: ORIGIN },
      })
      const worker = { child, output: '', exitResult: null }
      worker.exited = new Promise((resolve) => child.once('exit', (code, signal) => {
        worker.exitResult = { code, signal }
        resolve(worker.exitResult)
      }))
      workers.add(worker)
      for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { worker.output += chunk.toString() })
      const ready = new Promise((resolve, reject) => {
        child.on('message', (message) => { if (message?.type === 'ready') resolve(message) })
        child.once('error', reject)
        child.once('exit', (code, signal) => reject(new Error(`Auth worker exited before ready (${code}, ${signal})\n${worker.output}`)))
      })
      const message = await bounded(ready, 10000, 'Auth worker did not become ready')
      assert.equal(message.dbPath, dbPath)
      assert.equal(message.pid, child.pid)
      return { pid: child.pid, url: message.url, close: () => stopWorker(worker) }
    },
    inspect(callback) {
      const db = new DatabaseSync(dbPath)
      try {
        db.exec('PRAGMA busy_timeout = 5000')
        return callback(db)
      } finally { db.close() }
    },
    async closeAll() {
      await Promise.all([...workers].map(stopWorker))
      // Racing cross-process closes can leave sidecars. Reopen and checkpoint
      // the existing file to prove intact state and no remaining WAL readers.
      const db = new DatabaseSync(dbPath)
      try { assertIntegrity(db) } finally { db.close() }
      assert.deepEqual(fs.readdirSync(dir), ['auth.sqlite'], 'Final SQLite connections close WAL and shared-memory handles')
    },
  }
}

async function request(server, route, body, cookie) {
  const response = await fetch(`${server.url}/${route}`, {
    method: body ? 'POST' : 'GET',
    signal: AbortSignal.timeout(10000),
    headers: {
      Origin: ORIGIN,
      'X-Makoto-Request': '1',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';', 1)[0], body: await response.json() }
}

function assertIntegrity(db) {
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal')
  assert.deepEqual(db.prepare('PRAGMA integrity_check').all().map((row) => row.integrity_check), ['ok'])
  assert.deepEqual({ ...db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() }, { busy: 0, log: 0, checkpointed: 0 })
}

test('separate auth processes consume one nonce once and share the rotated session across restart', { timeout: 30000 }, async (t) => {
  const state = fixture(t)
  const first = await state.open()
  const second = await state.open()
  assert.notEqual(first.pid, second.pid)
  const challenge = await request(first, 'nonce', { address: WALLET.address, chainId: ARC_CHAIN_ID })
  assert.equal(challenge.status, 200)
  assert.ok(challenge.cookie)
  const message = challenge.body.message
  const signature = await WALLET.signMessage(message)
  const attempts = await Promise.all([first, second].map((server) => request(server, 'verify', { message, signature }, challenge.cookie)))
  assert.deepEqual(attempts.map((response) => response.status).sort(), [200, 401])
  const winner = attempts.find((response) => response.status === 200)
  assert.deepEqual(winner.body, { authenticated: true, address: WALLET.address.toLowerCase() })
  assert.equal(attempts.find((response) => response.status === 401).body.code, 'AUTH_NONCE_INVALID')
  assert.ok(winner.cookie)
  assert.notEqual(winner.cookie, challenge.cookie)
  for (const server of [first, second]) {
    const session = await request(server, 'session', undefined, winner.cookie)
    assert.equal(session.status, 200)
    assert.deepEqual(session.body, winner.body)
    const oldSession = await request(server, 'session', undefined, challenge.cookie)
    assert.deepEqual(oldSession.body, { authenticated: false, address: null })
    const replay = await request(server, 'verify', { message, signature }, challenge.cookie)
    assert.equal(replay.status, 401)
    assert.equal(replay.body.code, 'AUTH_NONCE_INVALID')
  }
  state.inspect((db) => {
    assertIntegrity(db)
    assert.ok(db.prepare('SELECT consumed_at FROM auth_challenges WHERE nonce = ?').get(new SiweMessage(message).nonce).consumed_at)
    assert.equal(db.prepare('SELECT hits FROM auth_rate_limits WHERE bucket = ?').get('verify').hits, 4)
  })
  await first.close()
  assert.deepEqual((await request(second, 'session', undefined, winner.cookie)).body, winner.body)
  const restarted = await state.open()
  assert.deepEqual((await request(restarted, 'session', undefined, winner.cookie)).body, winner.body)
  await state.closeAll()
  state.inspect(assertIntegrity)
})

test('separate auth processes enforce exact shared nonce and verify limits with persisted counters', { timeout: 30000 }, async (t) => {
  const state = fixture(t)
  const servers = [await state.open(), await state.open()]
  assert.notEqual(servers[0].pid, servers[1].pid)
  const challenges = await Promise.all(Array.from({ length: 20 }, async (_unused, index) => {
    const challenge = await request(servers[index % 2], 'nonce', { address: WALLET.address, chainId: ARC_CHAIN_ID })
    assert.equal(challenge.status, 200, `Allowed nonce request ${index + 1}`)
    assert.ok(challenge.cookie)
    return challenge
  }))
  const nonceLimited = await request(servers[1], 'nonce', { address: WALLET.address, chainId: ARC_CHAIN_ID })
  assert.equal(nonceLimited.status, 429)
  assert.equal(nonceLimited.body.code, 'TASK_RATE_LIMITED')

  const signatures = await Promise.all(challenges.map((challenge) => WALLET.signMessage(challenge.body.message)))
  const verified = await Promise.all(challenges.map((challenge, index) => request(servers[(index + 1) % 2], 'verify', {
    message: challenge.body.message, signature: signatures[index],
  }, challenge.cookie)))
  for (const [index, response] of verified.entries()) {
    assert.equal(response.status, 200, `Allowed verify request ${index + 1}`)
    assert.deepEqual(response.body, { authenticated: true, address: WALLET.address.toLowerCase() })
  }
  const verifyLimited = await request(servers[0], 'verify', {
    message: challenges[0].body.message, signature: signatures[0],
  }, challenges[0].cookie)
  assert.equal(verifyLimited.status, 429)
  assert.equal(verifyLimited.body.code, 'TASK_RATE_LIMITED')
  state.inspect((db) => {
    assertIntegrity(db)
    const counters = db.prepare('SELECT bucket, rate_key, hits FROM auth_rate_limits ORDER BY bucket').all()
    assert.deepEqual(counters.map((row) => ({ ...row })), [
      { bucket: 'nonce', rate_key: '127.0.0.1', hits: 21 },
      { bucket: 'verify', rate_key: '127.0.0.1', hits: 21 },
    ])
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM auth_challenges WHERE consumed_at IS NOT NULL').get().count, 20)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 20)
  })
  await state.closeAll()
  state.inspect(assertIntegrity)
})
