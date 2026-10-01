const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const session = require('express-session')
const SQLiteStore = require('connect-sqlite3')(session)
const { rateLimit } = require('express-rate-limit')
const { getAddress } = require('ethers')
const { SiweMessage } = require('siwe')

const ARC_CHAIN_ID = 5042002
const CHALLENGE_TTL_MS = 5 * 60 * 1000
const SESSION_TTL_MS = 12 * 60 * 60 * 1000
const LOOPBACK_ORIGIN = 'http://localhost:5173'

class AuthError extends Error {
  constructor(code, status = 401) {
    super(code)
    this.code = code
    this.status = status
  }
}

function publicOriginOf(value) {
  const parsed = new URL(value)
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/' || !['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('PUBLIC_APP_ORIGIN must be a bare http(s) origin')
  }
  if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
    throw new Error('PUBLIC_APP_ORIGIN must use HTTPS outside loopback development')
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new Error('Production PUBLIC_APP_ORIGIN must use HTTPS')
  }
  return parsed.origin
}

function sessionHash(sessionId) {
  return crypto.createHash('sha256').update(sessionId).digest('hex')
}

// This is only the backing store for the maintained express-rate-limit middleware.
// The single SQLite UPSERT serializes increments across processes sharing this file.
class SQLiteRateStore {
  constructor(db, bucket) {
    this.db = db
    this.bucket = bucket
  }

  init(options) { this.windowMs = options.windowMs }

  async increment(key) {
    const now = Date.now()
    const row = this.db.prepare(`
      INSERT INTO auth_rate_limits (bucket, rate_key, hits, reset_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(bucket, rate_key) DO UPDATE SET
        hits = CASE WHEN auth_rate_limits.reset_at <= ? THEN 1 ELSE auth_rate_limits.hits + 1 END,
        reset_at = CASE WHEN auth_rate_limits.reset_at <= ? THEN excluded.reset_at ELSE auth_rate_limits.reset_at END
      RETURNING hits, reset_at
    `).get(this.bucket, key, now + this.windowMs, now, now)
    return { totalHits: row.hits, resetTime: new Date(row.reset_at) }
  }

  async decrement(key) {
    this.db.prepare('UPDATE auth_rate_limits SET hits = MAX(0, hits - 1) WHERE bucket = ? AND rate_key = ? AND reset_at > ?').run(this.bucket, key, Date.now())
  }

  async resetKey(key) {
    this.db.prepare('DELETE FROM auth_rate_limits WHERE bucket = ? AND rate_key = ?').run(this.bucket, key)
  }
}

function createTaskAuth(options = {}) {
  const publicOrigin = publicOriginOf(options.publicOrigin || process.env.PUBLIC_APP_ORIGIN || LOOPBACK_ORIGIN)
  if (process.env.NODE_ENV === 'production' && !options.publicOrigin && !process.env.PUBLIC_APP_ORIGIN) {
    throw new Error('PUBLIC_APP_ORIGIN is required in production')
  }
  const sessionSecret = options.sessionSecret || process.env.TASK_SESSION_SECRET || (process.env.NODE_ENV === 'production' ? null : crypto.randomBytes(32).toString('hex'))
  if (!sessionSecret || Buffer.byteLength(sessionSecret) < 32) throw new Error('TASK_SESSION_SECRET must contain at least 32 bytes')
  const dbPath = path.resolve(options.dbPath || process.env.TASK_AUTH_DB_PATH || path.join(__dirname, '..', 'data', 'task-auth.sqlite'))
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_challenges (
      nonce TEXT PRIMARY KEY,
      message TEXT NOT NULL,
      address TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      session_hash TEXT NOT NULL,
      issued_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS auth_challenges_expires ON auth_challenges(expires_at);
    CREATE TABLE IF NOT EXISTS auth_rate_limits (
      bucket TEXT NOT NULL,
      rate_key TEXT NOT NULL,
      hits INTEGER NOT NULL,
      reset_at INTEGER NOT NULL,
      PRIMARY KEY (bucket, rate_key)
    );
  `)

  const sessionStore = new SQLiteStore({ db: path.basename(dbPath), dir: path.dirname(dbPath), concurrentDb: true })
  sessionStore.db.configure('busyTimeout', 5000)
  const ready = new Promise((resolve) => sessionStore.client.once('connect', resolve))
  const cookieName = publicOrigin.startsWith('https:') ? '__Host-mk.task.sid' : 'mk.task.sid'
  const sessionTtlMs = options.sessionTtlMs || SESSION_TTL_MS
  if (!Number.isSafeInteger(sessionTtlMs) || sessionTtlMs < 1) throw new Error('Session TTL must be a positive integer')
  const cookieOptions = { path: '/', httpOnly: true, secure: publicOrigin.startsWith('https:'), sameSite: 'strict', maxAge: sessionTtlMs }
  const taskSession = session({
    name: cookieName,
    secret: sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    rolling: false,
    cookie: cookieOptions,
  })
  const now = options.now || Date.now

  function mutationOrigin(req, res, next) {
    if (req.get('Origin') !== publicOrigin || req.get('X-Makoto-Request') !== '1') {
      return res.status(403).json({ code: 'AUTH_ORIGIN_DENIED', error: 'Request origin was not accepted' })
    }
    next()
  }

  function requireTaskAuth(req, res, next) {
    const address = req.session?.address
    if (typeof address !== 'string' || !/^0x[0-9a-f]{40}$/.test(address) || req.session.chainId !== ARC_CHAIN_ID) {
      return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Wallet verification required' })
    }
    req.taskOwner = address
    next()
  }

  const makeLimit = (bucket, windowMs, limit) => rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    passOnStoreError: false,
    store: new SQLiteRateStore(db, bucket),
    message: { code: 'TASK_RATE_LIMITED', error: 'Please retry later' },
  })
  const nonceRateLimit = makeLimit('nonce', 15 * 60 * 1000, 20)
  const verifyRateLimit = makeLimit('verify', 15 * 60 * 1000, 20)
  const taskMutationRateLimit = makeLimit('task_mutation', 15 * 60 * 1000, 120)

  function issueChallenge(address, chainId, sessionId) {
    if (chainId !== ARC_CHAIN_ID) throw new AuthError('AUTH_CHAIN_MISMATCH', 400)
    if (typeof sessionId !== 'string' || !sessionId) throw new AuthError('AUTH_INVALID_REQUEST', 400)
    let canonical
    try { canonical = getAddress(address) } catch { throw new AuthError('AUTH_INVALID_REQUEST', 400) }
    const issuedAt = now()
    const expiresAt = issuedAt + CHALLENGE_TTL_MS
    const nonce = crypto.randomBytes(16).toString('hex')
    const origin = new URL(publicOrigin)
    const message = new SiweMessage({
      scheme: origin.protocol.slice(0, -1),
      domain: origin.host,
      address: canonical,
      uri: `${publicOrigin}/`,
      version: '1',
      chainId: ARC_CHAIN_ID,
      nonce,
      issuedAt: new Date(issuedAt).toISOString(),
      expirationTime: new Date(expiresAt).toISOString(),
    }).prepareMessage()
    db.prepare('DELETE FROM auth_challenges WHERE expires_at < ? OR consumed_at IS NOT NULL').run(issuedAt - 24 * 60 * 60 * 1000)
    db.prepare(`INSERT INTO auth_challenges (nonce, message, address, chain_id, session_hash, issued_at, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`).run(nonce, message, canonical.toLowerCase(), ARC_CHAIN_ID, sessionHash(sessionId), issuedAt, expiresAt)
    return { message, nonce }
  }

  async function verifyChallenge(message, signature, sessionId, sessionNonce) {
    if (typeof message !== 'string' || message.length > 4096 || typeof signature !== 'string' || signature.length > 4096 || !/^0x(?:[0-9a-fA-F]{2})+$/.test(signature)) {
      throw new AuthError('AUTH_INVALID_REQUEST', 400)
    }
    let parsed
    try { parsed = new SiweMessage(message) } catch { throw new AuthError('AUTH_NONCE_INVALID') }
    const row = db.prepare('SELECT * FROM auth_challenges WHERE nonce = ?').get(parsed.nonce)
    const checkedAt = now()
    const origin = new URL(publicOrigin)
    if (!row || row.consumed_at !== null || row.session_hash !== sessionHash(sessionId || '') || sessionNonce !== parsed.nonce) throw new AuthError('AUTH_NONCE_INVALID')
    if (row.expires_at <= checkedAt) throw new AuthError('AUTH_NONCE_EXPIRED')
    if (parsed.domain !== origin.host || parsed.scheme !== origin.protocol.slice(0, -1) || parsed.uri !== `${publicOrigin}/`) throw new AuthError('AUTH_DOMAIN_MISMATCH')
    if (row.chain_id !== ARC_CHAIN_ID || parsed.chainId !== ARC_CHAIN_ID) throw new AuthError('AUTH_CHAIN_MISMATCH')
    if (row.issued_at > checkedAt + 60_000 || row.message !== message || row.address !== parsed.address.toLowerCase() ||
        parsed.version !== '1' || Date.parse(parsed.issuedAt) !== row.issued_at || Date.parse(parsed.expirationTime) !== row.expires_at) throw new AuthError('AUTH_NONCE_INVALID')
    let result
    try {
      result = await parsed.verify({ signature, scheme: origin.protocol.slice(0, -1), domain: origin.host, nonce: row.nonce, time: new Date(checkedAt).toISOString() }, { suppressExceptions: true })
    } catch { throw new AuthError('AUTH_INVALID_SIGNATURE') }
    if (!result?.success) throw new AuthError('AUTH_INVALID_SIGNATURE')
    const consumed = db.prepare(`UPDATE auth_challenges SET consumed_at = ?
      WHERE nonce = ? AND consumed_at IS NULL AND expires_at > ? AND session_hash = ? AND message = ?
      RETURNING address`).get(checkedAt, row.nonce, checkedAt, row.session_hash, message)
    if (!consumed) throw new AuthError('AUTH_NONCE_INVALID')
    return consumed.address
  }

  async function close() {
    await new Promise((resolve, reject) => sessionStore.db.close((error) => error ? reject(error) : resolve()))
    db.close()
  }

  return {
    publicOrigin,
    cookieName,
    cookieOptions,
    taskSession,
    requireTaskAuth,
    mutationOrigin,
    nonceRateLimit,
    verifyRateLimit,
    taskMutationRateLimit,
    issueChallenge,
    verifyChallenge,
    ready,
    close,
  }
}

// Route modules are loaded before requests. Construct limiters here, since
// express-rate-limit intentionally rejects creation inside a request handler.
// Test workers use an isolated file and close it at the end of their suite.
const testDbPath = process.env.NODE_TEST_CONTEXT
  ? path.join(os.tmpdir(), `makoto-task-auth-worker-${process.pid}-${crypto.randomUUID()}.sqlite`)
  : null
const singleton = createTaskAuth(testDbPath ? { dbPath: testDbPath, sessionSecret: crypto.randomBytes(32).toString('hex') } : {})
if (testDbPath) {
  require('node:test').after(async () => {
    await singleton.ready
    await singleton.close()
    const resolved = path.resolve(testDbPath)
    if (path.dirname(resolved) !== path.resolve(os.tmpdir())) throw new Error('Refusing to remove an unexpected test database')
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${resolved}${suffix}`, { force: true })
  })
}
function getTaskAuth() { return singleton }

module.exports = {
  ARC_CHAIN_ID,
  AuthError,
  createTaskAuth,
  getTaskAuth,
  taskSession: singleton.taskSession,
  requireTaskAuth: singleton.requireTaskAuth,
  mutationOrigin: singleton.mutationOrigin,
  taskMutationRateLimit: singleton.taskMutationRateLimit,
}
