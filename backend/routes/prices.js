const { Router } = require('express')

const router = Router()

const ASSETS = [
  { key: 'USDC', id: 'usd-coin', source: 'DIRECT_USDC' },
  { key: 'EURC', id: 'euro-coin', source: 'DIRECT_EURC' },
  { key: 'BTC', id: 'circle-wrapped-btc', source: 'DIRECT_CIRBTC' },
]
const PRICE_TTL_MS = 5 * 60_000
const ERROR_COOLDOWN_MS = 60_000
const REQUEST_TIMEOUT_MS = 10_000
const state = {
  value: undefined,
  expiresAt: 0,
  retryAt: 0,
  inFlight: undefined,
  lastError: undefined,
}

class ProviderError extends Error {
  constructor(code, status) {
    super(code)
    this.name = 'ProviderError'
    this.code = code
    this.status = status
  }
}

function config() {
  const mode = String(process.env.COINGECKO_API_MODE || '').trim().toLowerCase()
  const key = String(process.env.COINGECKO_API_KEY || '').trim()
  if (!key || !mode) throw new ProviderError('COINGECKO_CONFIG_REQUIRED')
  if (mode !== 'demo' && mode !== 'pro') throw new ProviderError('COINGECKO_CONFIG_REQUIRED')
  return {
    baseUrl: mode === 'pro' ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3',
    header: mode === 'pro' ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key',
    key,
  }
}

function nowIso() {
  return new Date(Date.now()).toISOString()
}

function emptyPrices(status, error) {
  const observedAt = nowIso()
  return Object.fromEntries(ASSETS.map((asset) => [asset.key, {
    provider: 'CoinGecko',
    providerAssetId: asset.id,
    source: asset.source,
    status,
    observedAt,
    ...(error ? { error } : {}),
  }]))
}

function normalize(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ProviderError('COINGECKO_MALFORMED_RESPONSE')
  }
  const observedAt = nowIso()
  const out = {}
  for (const asset of ASSETS) {
    const row = payload[asset.id]
    const value = Number(row?.usd)
    const updated = Number(row?.last_updated_at)
    const change24h = Number(row?.usd_24h_change)
    if (!Number.isFinite(value) || value <= 0) {
      out[asset.key] = {
        provider: 'CoinGecko',
        providerAssetId: asset.id,
        source: asset.source,
        status: 'UNAVAILABLE',
        observedAt,
        error: 'COINGECKO_PRICE_UNAVAILABLE',
      }
      continue
    }
    out[asset.key] = {
      price: value,
      ...(Number.isFinite(change24h) ? { change24h } : {}),
      history: [],
      provider: 'CoinGecko',
      providerAssetId: asset.id,
      source: asset.source,
      status: 'FRESH',
      observedAt,
      ...(Number.isFinite(updated) && updated > 0 ? { providerUpdatedAt: new Date(updated * 1000).toISOString() } : {}),
    }
  }
  return out
}

function errorCode(error) {
  if (error instanceof ProviderError) return error.code
  return 'COINGECKO_UNAVAILABLE'
}

function responseError(response) {
  if (response.status === 401 || response.status === 403) return 'COINGECKO_AUTH_ERROR'
  if (response.status === 429) return 'COINGECKO_RATE_LIMITED'
  if (response.status >= 500) return 'COINGECKO_UNAVAILABLE'
  return 'COINGECKO_REQUEST_FAILED'
}

async function requestFresh() {
  const provider = config()
  const url = new URL(`${provider.baseUrl}/simple/price`)
  url.searchParams.set('ids', ASSETS.map((asset) => asset.id).join(','))
  url.searchParams.set('vs_currencies', 'usd')
  url.searchParams.set('include_last_updated_at', 'true')
  url.searchParams.set('include_24hr_change', 'true')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json', [provider.header]: provider.key },
      signal: controller.signal,
    })
    if (!response.ok) throw new ProviderError(responseError(response), response.status)
    let payload
    try { payload = await response.json() } catch { throw new ProviderError('COINGECKO_MALFORMED_RESPONSE') }
    return normalize(payload)
  } catch (error) {
    if (error?.name === 'AbortError') throw new ProviderError('COINGECKO_TIMEOUT')
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function stalePrices(prices, error) {
  return Object.fromEntries(Object.entries(prices).map(([key, value]) => [key, {
    ...value,
    status: value.price != null ? 'STALE' : value.status,
    ...(value.price != null ? { staleReason: error } : { error: value.error || error }),
  }]))
}

async function getPrices() {
  const now = Date.now()
  if (state.value && state.expiresAt > now) return state.value
  if (state.inFlight) return state.inFlight
  if (state.value && state.retryAt > now) return stalePrices(state.value, state.lastError || 'COINGECKO_UNAVAILABLE')

  state.inFlight = (async () => {
    try {
      const fresh = await requestFresh()
      state.value = fresh
      state.expiresAt = Date.now() + PRICE_TTL_MS
      state.retryAt = 0
      state.lastError = undefined
      return fresh
    } catch (error) {
      const code = errorCode(error)
      state.retryAt = Date.now() + ERROR_COOLDOWN_MS
      state.lastError = code
      if (state.value) return stalePrices(state.value, code)
      return emptyPrices('UNAVAILABLE', code)
    } finally {
      state.inFlight = undefined
    }
  })()
  return state.inFlight
}

router.get('/', async (_req, res) => {
  res.json(await getPrices())
})

// Test-only reset keeps the production route state private while allowing deterministic adapter tests.
router.resetForTests = () => {
  state.value = undefined
  state.expiresAt = 0
  state.retryAt = 0
  state.inFlight = undefined
  state.lastError = undefined
}

router.constants = { ASSETS, PRICE_TTL_MS, ERROR_COOLDOWN_MS }
// Internal consumers share this exact normalized cache; no second provider flow.
router.getPrices = getPrices

module.exports = router
