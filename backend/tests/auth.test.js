const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const express = require('express')
const { Wallet } = require('ethers')
const { SiweMessage } = require('siwe')
const { createTaskAuth, ARC_CHAIN_ID } = require('../lib/taskAuth')
const { createAuthRouter } = require('../routes/auth')

const ORIGIN = 'http://localhost:5173'
const WALLET = new Wallet(`0x${'11'.repeat(32)}`)
const OTHER = new Wallet(`0x${'22'.repeat(32)}`)
const SECRET = 'fixture-session-secret-has-at-least-32-bytes'

async function start(auth) {
  await auth.ready
  const app = express()
  app.use(express.json())
  app.use('/api/auth', createAuthRouter(auth))
  const server = await new Promise((resolve) => {
    const active = app.listen(0, '127.0.0.1', () => resolve(active))
  })
  return {
    url: `http://127.0.0.1:${server.address().port}/api/auth`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  }
}

async function request(url, method, body, cookie, origin = ORIGIN, header = '1') {
  return fetch(url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...(header ? { 'X-Makoto-Request': header } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

function cookieOf(response) {
  return response.headers.get('set-cookie')?.split(';', 1)[0]
}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'makoto-auth-test-'))
  const dbPath = path.join(dir, 'auth.sqlite')
  let clock = Date.parse('2026-09-30T00:00:00.000Z')
  const makeAuth = (options = {}) => createTaskAuth({ dbPath, publicOrigin: ORIGIN, sessionSecret: SECRET, now: () => clock, ...options })
  const cleanup = () => {
    const resolved = path.resolve(dir)
    if (!resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)) throw new Error('Refusing to remove an unexpected test directory')
    fs.rmSync(resolved, { recursive: true, force: true })
  }
  return { makeAuth, dbPath, advance: (ms) => { clock += ms }, cleanup }
}

test('SIWE challenge authenticates only its wallet and rotates a server-side session', async (t) => {
  const { makeAuth, cleanup } = fixture(t)
  const auth = makeAuth()
  const server = await start(auth)
  t.after(async () => { await server.close(); await auth.close(); cleanup() })

  const anonymous = await request(`${server.url}/session`, 'GET')
  assert.deepEqual(await anonymous.json(), { authenticated: false, address: null })
  assert.equal(anonymous.headers.get('cache-control'), 'no-store')

  const nonce = await request(`${server.url}/nonce`, 'POST', { address: WALLET.address, chainId: ARC_CHAIN_ID })
  assert.equal(nonce.status, 200)
  const { message } = await nonce.json()
  const parsed = new SiweMessage(message)
  assert.equal(parsed.domain, 'localhost:5173')
  assert.equal(parsed.uri, `${ORIGIN}/`)
  assert.equal(parsed.chainId, ARC_CHAIN_ID)
  assert.equal(parsed.address, WALLET.address)
  assert.ok(parsed.nonce.length >= 8)
  const challengeCookie = cookieOf(nonce)
  assert.ok(challengeCookie)
  assert.match(nonce.headers.get('set-cookie'), /HttpOnly/i)
  assert.match(nonce.headers.get('set-cookie'), /SameSite=Strict/i)

  const signature = await WALLET.signMessage(message)
  const missingCookie = await request(`${server.url}/verify`, 'POST', { message, signature })
  assert.equal(missingCookie.status, 401)
  assert.equal((await missingCookie.json()).code, 'AUTH_NONCE_INVALID')
  const wrongSignature = await request(`${server.url}/verify`, 'POST', { message, signature: await OTHER.signMessage(message) }, challengeCookie)
  assert.equal(wrongSignature.status, 401)
  assert.equal((await wrongSignature.json()).code, 'AUTH_INVALID_SIGNATURE')
  const verified = await request(`${server.url}/verify`, 'POST', { message, signature }, challengeCookie)
  assert.equal(verified.status, 200)
  assert.deepEqual(await verified.json(), { authenticated: true, address: WALLET.address.toLowerCase() })
  const authenticatedCookie = cookieOf(verified)
  assert.ok(authenticatedCookie)
  assert.notEqual(authenticatedCookie, challengeCookie)

  const session = await request(`${server.url}/session`, 'GET', undefined, authenticatedCookie)
  assert.deepEqual(await session.json(), { authenticated: true, address: WALLET.address.toLowerCase() })
  const replay = await request(`${server.url}/verify`, 'POST', { message, signature }, challengeCookie)
  assert.equal(replay.status, 401)
  assert.equal((await replay.json()).code, 'AUTH_NONCE_INVALID')
  const logout = await request(`${server.url}/logout`, 'POST', undefined, authenticatedCookie)
  assert.deepEqual(await logout.json(), { authenticated: false, address: null })
  const afterLogout = await request(`${server.url}/session`, 'GET', undefined, authenticatedCookie)
  assert.deepEqual(await afterLogout.json(), { authenticated: false, address: null })
})

test('challenge survives restart, is single use, and rejects altered fields and expired nonce', async (t) => {
  const { makeAuth, advance, cleanup } = fixture(t)
  let auth = makeAuth()
  let server = await start(auth)
  const nonce = await request(`${server.url}/nonce`, 'POST', { address: WALLET.address, chainId: ARC_CHAIN_ID })
  assert.equal(nonce.status, 200)
  const { message } = await nonce.json()
  const challengeCookie = cookieOf(nonce)
  await server.close()
  await auth.close()

  auth = makeAuth()
  server = await start(auth)
  t.after(async () => { await server.close(); await auth.close(); cleanup() })
  const changedUri = message.replace(`URI: ${ORIGIN}/`, `URI: ${ORIGIN}/wrong`)
  const altered = await request(`${server.url}/verify`, 'POST', { message: changedUri, signature: await WALLET.signMessage(changedUri) }, challengeCookie)
  assert.equal(altered.status, 401)
  assert.equal((await altered.json()).code, 'AUTH_DOMAIN_MISMATCH')
  const signature = await WALLET.signMessage(message)
  const attempts = await Promise.all([
    request(`${server.url}/verify`, 'POST', { message, signature }, challengeCookie),
    request(`${server.url}/verify`, 'POST', { message, signature }, challengeCookie),
  ])
  assert.deepEqual(attempts.map((response) => response.status).sort(), [200, 401])
  const replay = await request(`${server.url}/verify`, 'POST', { message, signature }, challengeCookie)
  assert.equal(replay.status, 401)
  assert.equal((await replay.json()).code, 'AUTH_NONCE_INVALID')

  const second = await request(`${server.url}/nonce`, 'POST', { address: WALLET.address, chainId: ARC_CHAIN_ID })
  const { message: expiringMessage } = await second.json()
  advance(5 * 60 * 1000)
  const expired = await request(`${server.url}/verify`, 'POST', { message: expiringMessage, signature: await WALLET.signMessage(expiringMessage) }, cookieOf(second))
  assert.equal(expired.status, 401)
  assert.equal((await expired.json()).code, 'AUTH_NONCE_EXPIRED')
})

test('auth mutations reject missing or foreign Origin and missing custom request header', async (t) => {
  const { makeAuth, cleanup } = fixture(t)
  const auth = makeAuth()
  const server = await start(auth)
  t.after(async () => { await server.close(); await auth.close(); cleanup() })
  const body = { address: WALLET.address, chainId: ARC_CHAIN_ID }
  for (const [origin, header] of [[null, '1'], ['https://attacker.example', '1'], [ORIGIN, null], [ORIGIN, '0']]) {
    const response = await request(`${server.url}/nonce`, 'POST', body, null, origin, header)
    assert.equal(response.status, 403)
    assert.equal((await response.json()).code, 'AUTH_ORIGIN_DENIED')
  }
  const wrongChain = await request(`${server.url}/nonce`, 'POST', { ...body, chainId: 1 })
  assert.equal(wrongChain.status, 400)
  assert.equal((await wrongChain.json()).code, 'AUTH_CHAIN_MISMATCH')
})

test('authenticated session expires in the persistent store', async (t) => {
  const { makeAuth, cleanup } = fixture(t)
  const auth = makeAuth({ sessionTtlMs: 500 })
  const server = await start(auth)
  t.after(async () => { await server.close(); await auth.close(); cleanup() })
  const nonce = await request(`${server.url}/nonce`, 'POST', { address: WALLET.address, chainId: ARC_CHAIN_ID })
  const { message } = await nonce.json()
  const verified = await request(`${server.url}/verify`, 'POST', { message, signature: await WALLET.signMessage(message) }, cookieOf(nonce))
  assert.equal(verified.status, 200)
  const authenticatedCookie = cookieOf(verified)
  await new Promise((resolve) => setTimeout(resolve, 600))
  const afterExpiry = await request(`${server.url}/session`, 'GET', undefined, authenticatedCookie)
  assert.deepEqual(await afterExpiry.json(), { authenticated: false, address: null })
})

test('signed messages with another nonce, wallet, domain, URI, chain, or issue time cannot authenticate', async (t) => {
  const { makeAuth, cleanup } = fixture(t)
  const auth = makeAuth()
  const server = await start(auth)
  t.after(async () => { await server.close(); await auth.close(); cleanup() })
  const nonce = await request(`${server.url}/nonce`, 'POST', { address: WALLET.address, chainId: ARC_CHAIN_ID })
  assert.equal(nonce.status, 200)
  const { message } = await nonce.json()
  const cookie = cookieOf(nonce)

  const alterations = [
    [message.replace(/Nonce: [^\n]+/, 'Nonce: 1234567890123456'), WALLET, 'AUTH_NONCE_INVALID'],
    [message.replace(WALLET.address, OTHER.address), OTHER, 'AUTH_NONCE_INVALID'],
    [message.replace('localhost:5173 wants', 'attacker.example wants'), WALLET, 'AUTH_DOMAIN_MISMATCH'],
    [message.replace(`URI: ${ORIGIN}/`, `URI: ${ORIGIN}/phish`), WALLET, 'AUTH_DOMAIN_MISMATCH'],
    [message.replace(`Chain ID: ${ARC_CHAIN_ID}`, 'Chain ID: 1'), WALLET, 'AUTH_CHAIN_MISMATCH'],
    [message.replace('Issued At: 2026-09-30T00:00:00.000Z', 'Issued At: 2026-10-01T00:00:00.000Z'), WALLET, 'AUTH_NONCE_INVALID'],
  ]
  for (const [changedMessage, signer, expectedCode] of alterations) {
    assert.notEqual(changedMessage, message)
    const response = await request(`${server.url}/verify`, 'POST', { message: changedMessage, signature: await signer.signMessage(changedMessage) }, cookie)
    assert.equal(response.status, 401)
    assert.equal((await response.json()).code, expectedCode)
  }

  const malformed = await request(`${server.url}/verify`, 'POST', { message: 'not a SIWE message', signature: await WALLET.signMessage(message) }, cookie)
  assert.equal(malformed.status, 401)
  assert.equal((await malformed.json()).code, 'AUTH_NONCE_INVALID')
  const valid = await request(`${server.url}/verify`, 'POST', { message, signature: await WALLET.signMessage(message) }, cookie)
  assert.equal(valid.status, 200)
})

test('foreign Origin cannot consume a challenge or log out a valid session', async (t) => {
  const { makeAuth, cleanup } = fixture(t)
  const auth = makeAuth()
  const server = await start(auth)
  t.after(async () => { await server.close(); await auth.close(); cleanup() })
  const nonce = await request(`${server.url}/nonce`, 'POST', { address: WALLET.address, chainId: ARC_CHAIN_ID })
  const { message } = await nonce.json()
  const challengeCookie = cookieOf(nonce)
  const signature = await WALLET.signMessage(message)

  const forbiddenVerify = await request(`${server.url}/verify`, 'POST', { message, signature }, challengeCookie, 'https://attacker.example')
  assert.equal(forbiddenVerify.status, 403)
  assert.equal((await forbiddenVerify.json()).code, 'AUTH_ORIGIN_DENIED')
  const verified = await request(`${server.url}/verify`, 'POST', { message, signature }, challengeCookie)
  assert.equal(verified.status, 200)
  const authenticatedCookie = cookieOf(verified)

  const forbiddenLogout = await request(`${server.url}/logout`, 'POST', undefined, authenticatedCookie, null)
  assert.equal(forbiddenLogout.status, 403)
  assert.equal((await forbiddenLogout.json()).code, 'AUTH_ORIGIN_DENIED')
  const stillAuthenticated = await request(`${server.url}/session`, 'GET', undefined, authenticatedCookie)
  assert.equal((await stillAuthenticated.json()).authenticated, true)
  const logout = await request(`${server.url}/logout`, 'POST', undefined, authenticatedCookie)
  assert.equal(logout.status, 200)
})

test('a second wallet remains unauthenticated until its own signature replaces the session', async (t) => {
  const { makeAuth, cleanup } = fixture(t)
  const auth = makeAuth()
  const server = await start(auth)
  t.after(async () => { await server.close(); await auth.close(); cleanup() })

  const firstNonce = await request(`${server.url}/nonce`, 'POST', { address: WALLET.address, chainId: ARC_CHAIN_ID })
  const { message: firstMessage } = await firstNonce.json()
  const firstVerify = await request(`${server.url}/verify`, 'POST', {
    message: firstMessage, signature: await WALLET.signMessage(firstMessage),
  }, cookieOf(firstNonce))
  assert.equal(firstVerify.status, 200)
  const walletACookie = cookieOf(firstVerify)

  const secondNonce = await request(`${server.url}/nonce`, 'POST', { address: OTHER.address, chainId: ARC_CHAIN_ID }, walletACookie)
  assert.equal(secondNonce.status, 200)
  const { message: secondMessage } = await secondNonce.json()
  const stillWalletA = await request(`${server.url}/session`, 'GET', undefined, walletACookie)
  assert.deepEqual(await stillWalletA.json(), { authenticated: true, address: WALLET.address.toLowerCase() })

  const secondVerify = await request(`${server.url}/verify`, 'POST', {
    message: secondMessage, signature: await OTHER.signMessage(secondMessage),
  }, walletACookie)
  assert.equal(secondVerify.status, 200)
  assert.deepEqual(await secondVerify.json(), { authenticated: true, address: OTHER.address.toLowerCase() })
  const walletBCookie = cookieOf(secondVerify)
  assert.notEqual(walletBCookie, walletACookie)
  const oldSession = await request(`${server.url}/session`, 'GET', undefined, walletACookie)
  assert.deepEqual(await oldSession.json(), { authenticated: false, address: null })
})

test('nonce and verify rate limits share counters across two auth instances using one SQLite file', async (t) => {
  const { makeAuth, cleanup } = fixture(t)
  const authA = makeAuth()
  const authB = makeAuth()
  const serverA = await start(authA)
  const serverB = await start(authB)
  t.after(async () => {
    await serverA.close(); await serverB.close()
    await authA.close(); await authB.close()
    cleanup()
  })

  let firstChallenge
  for (let attempt = 0; attempt < 21; attempt += 1) {
    const server = attempt % 2 ? serverB : serverA
    const response = await request(`${server.url}/nonce`, 'POST', { address: WALLET.address, chainId: ARC_CHAIN_ID })
    if (attempt === 0) firstChallenge = { ...(await response.json()), cookie: cookieOf(response) }
    else if (attempt === 20) assert.equal((await response.json()).code, 'TASK_RATE_LIMITED')
    assert.equal(response.status, attempt === 20 ? 429 : 200)
  }

  for (let attempt = 0; attempt < 21; attempt += 1) {
    const server = attempt % 2 ? serverB : serverA
    const response = await request(`${server.url}/verify`, 'POST', { message: firstChallenge.message, signature: 'invalid' }, firstChallenge.cookie)
    assert.equal(response.status, attempt === 20 ? 429 : 400)
    if (attempt === 20) assert.equal((await response.json()).code, 'TASK_RATE_LIMITED')
  }
})

test('HTTPS session configuration uses a secure host cookie', async (t) => {
  const { makeAuth, cleanup } = fixture(t)
  const auth = makeAuth({ publicOrigin: 'https://wallet.example' })
  t.after(async () => { await auth.ready; await auth.close(); cleanup() })
  assert.equal(auth.cookieName, '__Host-mk.task.sid')
  assert.deepEqual(auth.cookieOptions, {
    path: '/', httpOnly: true, secure: true, sameSite: 'strict', maxAge: 12 * 60 * 60 * 1000,
  })
})

function persistentFixture(t) {
  const state = fixture(t)
  const running = new Set()
  const active = new Set()
  t.after(async () => {
    for (const server of running) await server.close()
    for (const auth of active) { await auth.ready; await auth.close() }
    state.cleanup()
  })
  return {
    ...state,
    async open() {
      const auth = state.makeAuth()
      active.add(auth)
      const server = await start(auth)
      running.add(server)
      return { auth, ...server, async close() {
        await server.close()
        running.delete(server)
        await auth.close()
        active.delete(auth)
      } }
    },
    inspect(callback) {
      const db = new DatabaseSync(state.dbPath)
      try { return callback(db) } finally { db.close() }
    },
  }
}

test('two auth instances consume one nonce atomically and share the rotated session across restart', async (t) => {
  const state = persistentFixture(t)
  const first = await state.open()
  const second = await state.open()
  const nonce = await request(`${first.url}/nonce`, 'POST', { address: WALLET.address, chainId: ARC_CHAIN_ID })
  assert.equal(nonce.status, 200)
  const { message } = await nonce.json()
  const cookie = cookieOf(nonce)
  const signature = await WALLET.signMessage(message)
  const attempts = await Promise.all([first, second].map((server) => request(`${server.url}/verify`, 'POST', { message, signature }, cookie)))
  assert.deepEqual(attempts.map((response) => response.status).sort(), [200, 401])
  const authenticatedCookie = cookieOf(attempts.find((response) => response.status === 200))
  assert.ok(authenticatedCookie)
  assert.notEqual(authenticatedCookie, cookie)
  for (const server of [first, second]) {
    const session = await request(`${server.url}/session`, 'GET', undefined, authenticatedCookie)
    assert.equal(session.status, 200)
    assert.deepEqual(await session.json(), { authenticated: true, address: WALLET.address.toLowerCase() })
    const replay = await request(`${server.url}/verify`, 'POST', { message, signature }, cookie)
    assert.equal(replay.status, 401)
    assert.equal((await replay.json()).code, 'AUTH_NONCE_INVALID')
  }
  await first.close()
  await second.close()
  const restarted = await state.open()
  const persisted = await request(`${restarted.url}/session`, 'GET', undefined, authenticatedCookie)
  assert.deepEqual(await persisted.json(), { authenticated: true, address: WALLET.address.toLowerCase() })
})

test('repeated overlapping auth open and close preserves integrity, sessions, and WAL cleanup', async (t) => {
  const state = persistentFixture(t)
  let cookie
  for (let cycle = 0; cycle < 12; cycle += 1) {
    const first = await state.open()
    const second = await state.open()
    if (cookie) {
      const persisted = await request(`${first.url}/session`, 'GET', undefined, cookie)
      assert.deepEqual(await persisted.json(), { authenticated: true, address: WALLET.address.toLowerCase() })
    }
    const nonce = await request(`${first.url}/nonce`, 'POST', { address: WALLET.address, chainId: ARC_CHAIN_ID }, cookie)
    assert.equal(nonce.status, 200, `nonce on cycle ${cycle}`)
    const { message } = await nonce.json()
    const verified = await request(`${second.url}/verify`, 'POST', { message, signature: await WALLET.signMessage(message) }, cookieOf(nonce) || cookie)
    assert.equal(verified.status, 200, `verify on cycle ${cycle}`)
    cookie = cookieOf(verified)
    assert.ok(cookie)
    await first.close()
    const siblingSession = await request(`${second.url}/session`, 'GET', undefined, cookie)
    assert.deepEqual(await siblingSession.json(), { authenticated: true, address: WALLET.address.toLowerCase() })
    state.inspect((db) => {
      assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal')
      assert.deepEqual(db.prepare('PRAGMA integrity_check').all().map((row) => row.integrity_check), ['ok'])
      assert.equal(db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get().busy, 0)
    })
    await second.close()
    assert.deepEqual(fs.readdirSync(path.dirname(state.dbPath)), [path.basename(state.dbPath)], `closed WAL handles on cycle ${cycle}`)
  }
})

function legacyCookie(cookieName, sessionId) {
  const signature = crypto.createHmac('sha256', SECRET).update(sessionId).digest('base64').replace(/=+$/, '')
  return `${cookieName}=${encodeURIComponent(`s:${sessionId}.${signature}`)}`
}

test('legacy session, nonce, and rate records remain usable in the same database schema', async (t) => {
  const state = persistentFixture(t)
  const nonce = '1234567890abcdef1234567890abcdef'
  const sessionId = 'legacy-preauth-session'
  const issuedAt = Date.parse('2026-09-30T00:00:00.000Z')
  const expiresAt = issuedAt + 5 * 60 * 1000
  const message = new SiweMessage({
    scheme: 'http', domain: 'localhost:5173', address: WALLET.address, uri: `${ORIGIN}/`,
    version: '1', chainId: ARC_CHAIN_ID, nonce, issuedAt: new Date(issuedAt).toISOString(), expirationTime: new Date(expiresAt).toISOString(),
  }).prepareMessage()
  const sessionExpiry = Date.now() + 12 * 60 * 60 * 1000
  state.inspect((db) => {
    db.exec(`PRAGMA journal_mode = WAL;
      CREATE TABLE sessions (sid PRIMARY KEY, expired, sess);
      CREATE TABLE auth_challenges (nonce TEXT PRIMARY KEY, message TEXT NOT NULL, address TEXT NOT NULL, chain_id INTEGER NOT NULL,
        session_hash TEXT NOT NULL, issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER);
      CREATE TABLE auth_rate_limits (bucket TEXT NOT NULL, rate_key TEXT NOT NULL, hits INTEGER NOT NULL, reset_at INTEGER NOT NULL,
        PRIMARY KEY (bucket, rate_key));`)
    const cookie = { originalMaxAge: 12 * 60 * 60 * 1000, expires: new Date(sessionExpiry).toISOString(), httpOnly: true, path: '/', secure: false, sameSite: 'strict' }
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(sessionId, sessionExpiry, JSON.stringify({ cookie, challengeNonce: nonce }))
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run('legacy-authenticated-session', sessionExpiry, JSON.stringify({ cookie, address: OTHER.address.toLowerCase(), chainId: ARC_CHAIN_ID }))
    db.prepare('INSERT INTO auth_challenges VALUES (?, ?, ?, ?, ?, ?, ?, NULL)').run(nonce, message, WALLET.address.toLowerCase(), ARC_CHAIN_ID,
      crypto.createHash('sha256').update(sessionId).digest('hex'), issuedAt, expiresAt)
    db.prepare('INSERT INTO auth_rate_limits VALUES (?, ?, ?, ?)').run('nonce', '127.0.0.1', 19, Date.now() + 15 * 60 * 1000)
  })
  const server = await state.open()
  const oldSession = await request(`${server.url}/session`, 'GET', undefined, legacyCookie(server.auth.cookieName, 'legacy-authenticated-session'))
  assert.deepEqual(await oldSession.json(), { authenticated: true, address: OTHER.address.toLowerCase() })
  const verified = await request(`${server.url}/verify`, 'POST', { message, signature: await WALLET.signMessage(message) }, legacyCookie(server.auth.cookieName, sessionId))
  assert.equal(verified.status, 200)
  assert.deepEqual(await verified.json(), { authenticated: true, address: WALLET.address.toLowerCase() })
  state.inspect((db) => assert.equal(db.prepare('SELECT consumed_at FROM auth_challenges WHERE nonce = ?').get(nonce).consumed_at, issuedAt))
  const allowed = await request(`${server.url}/nonce`, 'POST', { address: WALLET.address, chainId: ARC_CHAIN_ID })
  assert.equal(allowed.status, 200)
  const limited = await request(`${server.url}/nonce`, 'POST', { address: WALLET.address, chainId: ARC_CHAIN_ID })
  assert.equal(limited.status, 429)
  state.inspect((db) => {
    assert.deepEqual(db.prepare('PRAGMA table_info(sessions)').all().map((row) => row.name), ['sid', 'expired', 'sess'])
    assert.equal(db.prepare('SELECT hits FROM auth_rate_limits WHERE bucket = ? AND rate_key = ?').get('nonce', '127.0.0.1').hits, 21)
    assert.ok(db.prepare('SELECT 1 FROM sessions WHERE sid = ?').get('legacy-authenticated-session'))
  })
})

test('database failures fail closed for session reads, malformed sessions, rate limits, challenge reads, nonce consumption, and session writes', async (t) => {
  for (const failure of ['session read', 'malformed session', 'rate limit', 'challenge read', 'nonce consume', 'session write']) {
    await t.test(failure, async (t) => {
      const state = persistentFixture(t)
      const server = await state.open()
      const nonce = await request(`${server.url}/nonce`, 'POST', { address: WALLET.address, chainId: ARC_CHAIN_ID })
      assert.equal(nonce.status, 200)
      const { message } = await nonce.json()
      const signature = await WALLET.signMessage(message)
      const sessionReadFailure = failure === 'session read' || failure === 'malformed session'
      let cookie = cookieOf(nonce)
      if (sessionReadFailure) {
        const verified = await request(`${server.url}/verify`, 'POST', { message, signature }, cookie)
        assert.equal(verified.status, 200)
        cookie = cookieOf(verified)
      }
      state.inspect((db) => {
        if (failure === 'session read') db.exec('DROP TABLE sessions')
        if (failure === 'malformed session') db.prepare('UPDATE sessions SET sess = ?').run('{invalid-json')
        if (failure === 'rate limit') db.exec('DROP TABLE auth_rate_limits')
        if (failure === 'challenge read') db.exec('DROP TABLE auth_challenges')
        if (failure === 'nonce consume') db.exec(`CREATE TRIGGER reject_nonce_consume BEFORE UPDATE ON auth_challenges BEGIN SELECT RAISE(ABORT, 'fixture nonce storage unavailable'); END`)
        if (failure === 'session write') db.exec(`CREATE TRIGGER reject_session_write BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT, 'fixture session storage unavailable'); END`)
      })
      const response = sessionReadFailure
        ? await request(`${server.url}/session`, 'GET', undefined, cookie)
        : await request(`${server.url}/verify`, 'POST', { message, signature }, cookie)
      assert.equal(response.status, 503)
      const body = await response.json()
      assert.equal(body.code, 'TASK_AUTH_UNAVAILABLE')
      assert.notEqual(body.authenticated, true)
      if (!sessionReadFailure) {
        const session = await request(`${server.url}/session`, 'GET', undefined, cookie)
        assert.deepEqual(await session.json(), { authenticated: false, address: null })
        if (cookieOf(response)) {
          const attemptedSession = await request(`${server.url}/session`, 'GET', undefined, cookieOf(response))
          assert.deepEqual(await attemptedSession.json(), { authenticated: false, address: null })
        }
      }
    })
  }
})

test('auth startup rejects corrupt storage without replacing the database', (t) => {
  const { dbPath, makeAuth, cleanup } = fixture(t)
  t.after(cleanup)
  const corrupt = Buffer.alloc(4096, 0x61)
  fs.writeFileSync(dbPath, corrupt)
  assert.throws(() => makeAuth(), { code: 'ERR_SQLITE_ERROR' })
  assert.deepEqual(fs.readFileSync(dbPath), corrupt)
})

test('failed session initialization closes its handle and preserves existing rows', (t) => {
  const { dbPath, makeAuth, cleanup } = fixture(t)
  t.after(cleanup)
  const db = new DatabaseSync(dbPath)
  db.exec(`CREATE TABLE sessions (sid PRIMARY KEY, expired, sess);
    INSERT INTO sessions VALUES ('preserved', 1, '{"cookie":{}}');
    CREATE TRIGGER reject_cleanup BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'fixture cleanup unavailable'); END;`)
  db.close()
  assert.throws(() => makeAuth(), { code: 'ERR_SQLITE_ERROR' })
  const reopened = new DatabaseSync(dbPath)
  try { assert.equal(reopened.prepare('SELECT sid FROM sessions').get().sid, 'preserved') } finally { reopened.close() }
  // On Windows removal also fails if initialization leaked a database handle.
  cleanup()
})
