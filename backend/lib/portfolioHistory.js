const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')

const CHAIN_ID = 5042002
const CAPTURE_INTERVAL_MS = 300_000
const RETENTION_MS = 366 * 86_400_000
const MAX_DATASET_ROWS = Math.ceil(RETENTION_MS / CAPTURE_INTERVAL_MS) + 1
const MAX_DISPLAY_POINTS = 2048
const RANGE_MS = { '1d': 86_400_000, '1w': 7 * 86_400_000, '1m': 30 * 86_400_000, '1y': 365 * 86_400_000, all: null }
const valuation = import('../../shared/portfolioValuation.mjs')

class PortfolioError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status }
}

function normalizeWallet(address) {
  if (typeof address !== 'string' || !/^0x[0-9a-f]{40}$/i.test(address) || /^0x0{40}$/i.test(address)) throw new PortfolioError('PORTFOLIO_INVALID_WALLET')
  return address.toLowerCase()
}
function validateScope(owner, address, chainId) {
  if (typeof owner !== 'string' || !/^(?:[a-f0-9]{64}|wallet:0x[a-f0-9]{40})$/.test(owner)) throw new PortfolioError('PORTFOLIO_ACCESS_DENIED', 403)
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new PortfolioError('PORTFOLIO_INVALID_CHAIN')
  return normalizeWallet(address)
}
function validObservationTime(value, now, maxAge) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && timestamp <= now + 1000 && timestamp >= now - maxAge && new Date(timestamp).toISOString() === value
}
function snapshotOf(row) {
  if (!row) return null
  return {
    id: row.id, walletAddress: row.wallet_address, chainId: row.chain_id,
    capturedAt: row.captured_at, totalUsd: row.total_usd,
    assets: JSON.parse(row.asset_payload_json), priceProvider: row.price_provider,
    priceStatus: row.price_status, priceObservedAt: row.price_observed_at,
    balanceObservedAt: row.balance_observed_at,
  }
}

function selectDisplayRows(rows) {
  if (rows.length <= MAX_DISPLAY_POINTS) return rows
  const bucketSize = Math.ceil(rows.length / (MAX_DISPLAY_POINTS / 4))
  const selected = new Map()
  for (let offset = 0; offset < rows.length; offset += bucketSize) {
    const bucket = rows.slice(offset, offset + bucketSize)
    let min = bucket[0], max = bucket[0]
    for (const row of bucket) { if (row.total_usd < min.total_usd) min = row; if (row.total_usd > max.total_usd) max = row }
    for (const row of [bucket[0], min, max, bucket[bucket.length - 1]]) selected.set(row.id, row)
  }
  return [...selected.values()].sort((a, b) => a.captured_at_ms - b.captured_at_ms)
}

class PortfolioHistory {
  constructor(options = {}) {
    const filename = options.dbPath || process.env.PORTFOLIO_HISTORY_DB_PATH || path.join(__dirname, '..', 'data', 'portfolio-history.sqlite')
    if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true })
    this.db = new DatabaseSync(filename, { timeout: 5000 })
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS portfolio_history (
          id TEXT PRIMARY KEY,
          owner_key TEXT NOT NULL,
          wallet_address TEXT NOT NULL,
          chain_id INTEGER NOT NULL,
          captured_at TEXT NOT NULL,
          captured_at_ms INTEGER NOT NULL,
          total_usd REAL NOT NULL CHECK(total_usd >= 0),
          asset_payload_json TEXT NOT NULL,
          price_provider TEXT NOT NULL CHECK(price_provider = 'COINGECKO'),
          price_status TEXT NOT NULL CHECK(price_status = 'FRESH'),
          price_observed_at TEXT NOT NULL,
          balance_observed_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(owner_key, wallet_address, chain_id, captured_at_ms)
        );
        CREATE INDEX IF NOT EXISTS portfolio_history_scope_time ON portfolio_history(owner_key, wallet_address, chain_id, captured_at_ms);
        CREATE INDEX IF NOT EXISTS portfolio_history_retention ON portfolio_history(captured_at_ms);
      `)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); this.db.close(); throw error }
    this.now = options.now || Date.now
    this.readWallet = options.readWallet || require('../routes/arc').readWallet
    this.getPrices = options.getPrices || require('../routes/prices').getPrices
    this.inFlight = new Map()
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE')
    try { const value = fn(); this.db.exec('COMMIT'); return value }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  prune(now) { this.db.prepare('DELETE FROM portfolio_history WHERE captured_at_ms < ?').run(now - RETENTION_MS) }
  latestRow(owner, address, chainId) {
    return this.db.prepare('SELECT * FROM portfolio_history WHERE owner_key = ? AND wallet_address = ? AND chain_id = ? ORDER BY captured_at_ms DESC LIMIT 1').get(owner, address, chainId)
  }
  nextCaptureAt(row) { return row ? new Date(row.captured_at_ms + CAPTURE_INTERVAL_MS).toISOString() : null }
  history(owner, address, chainId, range = '1d') {
    const walletAddress = validateScope(owner, address, chainId)
    if (typeof range !== 'string' || !Object.hasOwn(RANGE_MS, range)) throw new PortfolioError('PORTFOLIO_INVALID_RANGE')
    const now = this.now()
    return this.transaction(() => {
      this.prune(now)
      const since = RANGE_MS[range] === null ? now - RETENTION_MS : now - RANGE_MS[range]
      const observed = this.db.prepare('SELECT id, captured_at_ms, total_usd FROM portfolio_history WHERE owner_key = ? AND wallet_address = ? AND chain_id = ? AND captured_at_ms >= ? AND captured_at_ms <= ? ORDER BY captured_at_ms ASC').all(owner, walletAddress, chainId, since, now)
      const selected = selectDisplayRows(observed)
      const rows = selected.length ? this.db.prepare(`SELECT * FROM portfolio_history WHERE id IN (${selected.map(() => '?').join(',')}) ORDER BY captured_at_ms ASC`).all(...selected.map((row) => row.id)) : []
      const totalSnapshots = this.db.prepare('SELECT COUNT(*) AS n FROM portfolio_history WHERE owner_key = ? AND wallet_address = ? AND chain_id = ?').get(owner, walletAddress, chainId).n
      return { walletAddress, chainId, range, snapshots: rows.map(snapshotOf), totalSnapshots, rangeSnapshots: observed.length, downsampled: selected.length < observed.length, nextCaptureAt: this.nextCaptureAt(this.latestRow(owner, walletAddress, chainId)) }
    })
  }
  async capture(owner, address, chainId) {
    const walletAddress = validateScope(owner, address, chainId)
    if (chainId !== CHAIN_ID) throw new PortfolioError('PORTFOLIO_UNSUPPORTED_CHAIN')
    const key = JSON.stringify([owner, walletAddress, chainId])
    if (this.inFlight.has(key)) return this.inFlight.get(key)
    const pending = this.captureOnce(owner, walletAddress, chainId)
    this.inFlight.set(key, pending)
    try { return await pending } finally { this.inFlight.delete(key) }
  }
  async captureOnce(owner, walletAddress, chainId) {
    const early = this.transaction(() => { this.prune(this.now()); return this.latestRow(owner, walletAddress, chainId) })
    if (early && this.now() - early.captured_at_ms < CAPTURE_INTERVAL_MS) return { status: 'THROTTLED', snapshot: snapshotOf(early), nextCaptureAt: this.nextCaptureAt(early) }
    let wallet, prices
    try { [wallet, prices] = await Promise.all([this.readWallet(walletAddress), this.getPrices()]) }
    catch { throw new PortfolioError('PORTFOLIO_DATA_UNAVAILABLE', 502) }
    const now = this.now()
    const { valuePortfolio, PORTFOLIO_ASSETS } = await valuation
    const result = valuePortfolio(wallet?.tokens, prices)
    const skip = (reason) => ({ status: 'SKIPPED', reason, snapshot: null, nextCaptureAt: this.nextCaptureAt(early) })
    if (!wallet || wallet.address?.toLowerCase() !== walletAddress || wallet.chainId !== chainId || !validObservationTime(wallet.observedAt, now, 30_000)) return skip('PORTFOLIO_BALANCE_UNVERIFIED')
    if (!result.complete || !Number.isFinite(result.totalUsd)) return skip('PORTFOLIO_INCOMPLETE')
    for (const asset of result.assets) {
      const meta = PORTFOLIO_ASSETS.find((entry) => entry.address === asset.address)
      if (!meta || typeof asset.rawBalance !== 'string' || !/^\d+$/.test(asset.rawBalance) || asset.rawDecimals !== (asset.symbol === 'USDC' ? 18 : meta.decimals)) return skip('PORTFOLIO_BALANCE_UNVERIFIED')
      const raw = BigInt(asset.rawBalance), divisor = 10n ** BigInt(asset.rawDecimals)
      const balance = Number(raw / divisor) + Number(raw % divisor) / Number(divisor)
      if (!Number.isFinite(balance) || balance !== asset.balance) return skip('PORTFOLIO_BALANCE_UNVERIFIED')
      const price = asset.price
      if (!price || price.provider !== 'CoinGecko' || price.providerAssetId !== meta.providerAssetId || price.source !== meta.source || price.status !== 'FRESH' || !validObservationTime(price.observedAt, now, CAPTURE_INTERVAL_MS) || !Number.isFinite(price.price) || price.price <= 0) return skip('PORTFOLIO_PRICE_NOT_FRESH')
    }
    // Time is recorded after the provider observations complete, never supplied by callers.
    const capturedAt = new Date(now).toISOString()
    const priceObservedAt = result.assets.map((asset) => asset.price.observedAt).sort()[0]
    return this.transaction(() => {
      this.prune(now)
      const latest = this.latestRow(owner, walletAddress, chainId)
      if (latest && now - latest.captured_at_ms < CAPTURE_INTERVAL_MS) return { status: 'THROTTLED', snapshot: snapshotOf(latest), nextCaptureAt: this.nextCaptureAt(latest) }
      const id = randomUUID()
      this.db.prepare(`INSERT INTO portfolio_history (id, owner_key, wallet_address, chain_id, captured_at, captured_at_ms, total_usd, asset_payload_json, price_provider, price_status, price_observed_at, balance_observed_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'COINGECKO', 'FRESH', ?, ?, ?)`).run(id, owner, walletAddress, chainId, capturedAt, now, result.totalUsd, JSON.stringify(result.assets), priceObservedAt, wallet.observedAt, capturedAt)
      this.db.prepare(`DELETE FROM portfolio_history WHERE id IN (SELECT id FROM portfolio_history WHERE owner_key = ? AND wallet_address = ? AND chain_id = ? ORDER BY captured_at_ms DESC LIMIT -1 OFFSET ?)`).run(owner, walletAddress, chainId, MAX_DATASET_ROWS)
      const row = this.latestRow(owner, walletAddress, chainId)
      return { status: 'SAVED', snapshot: snapshotOf(row), nextCaptureAt: this.nextCaptureAt(row), wallet, prices }
    })
  }
  close() { this.db.close() }
}

let singleton
function getPortfolioHistory() { if (!singleton) singleton = new PortfolioHistory(); return singleton }
module.exports = { PortfolioHistory, PortfolioError, getPortfolioHistory, normalizeWallet, CHAIN_ID, CAPTURE_INTERVAL_MS, RETENTION_MS, MAX_DATASET_ROWS, MAX_DISPLAY_POINTS, RANGE_MS, selectDisplayRows }
