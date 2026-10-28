// Market data with automatic fallbacks.
//
// Surf data API is tried first. When it fails (e.g. 402 "insufficient credit")
// it is skipped for a cool-down period and free public sources are used:
//   - CoinGecko (prices, history, rankings, project profiles)
//   - OKX public API (spot candles, perpetual funding / open interest / long-short)
//   - alternative.me (Crypto Fear & Greed index)
//   - Cointelegraph / Decrypt / CoinDesk RSS (news)
//   - DefiLlama (TVL and stablecoin yields)
// Every function returns real provider data or throws. Nothing is fabricated.
const { dataApi } = require('@surf-ai/sdk/server')

const TIMEOUT_MS = 8000
const SURF_COOLDOWN_MS = 10 * 60_000
const OKX = 'https://www.okx.com/api/v5'
const UA = 'Mozilla/5.0 (compatible; MakotoAgent/1.0; +https://makotowallet.xyz)'

// ---------- tiny TTL cache (bounded) ----------
const cache = new Map()
async function cached(key, ttlMs, loader) {
  const hit = cache.get(key)
  if (hit && hit.expiresAt > Date.now()) return hit.value
  if (hit?.pending) return hit.pending
  const pending = loader().then((value) => {
    if (cache.size > 300) cache.delete(cache.keys().next().value)
    cache.set(key, { value, expiresAt: Date.now() + ttlMs })
    return value
  }, (error) => { cache.delete(key); throw error })
  cache.set(key, { ...(hit || {}), expiresAt: 0, pending })
  return pending
}

async function getJson(url, { headers = {}, timeoutMs = TIMEOUT_MS } = {}) {
  const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': UA, ...headers }, signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) { const error = new Error(`HTTP ${response.status} from ${new URL(url).host}`); error.status = response.status; throw error }
  return response.json()
}

// ---------- Surf with circuit breaker ----------
let surfDownUntil = 0
async function trySurf(fn) {
  if (!process.env.SURF_API_KEY || Date.now() < surfDownUntil) return undefined
  try { return await fn() } catch (error) {
    // Out of credit / auth / outage: stop paying the latency for a while.
    surfDownUntil = Date.now() + SURF_COOLDOWN_MS
    if (process.env.NODE_ENV !== 'test') console.warn('[marketData] Surf unavailable, using fallbacks:', String(error?.message || error).slice(0, 160))
    return undefined
  }
}
const surfStatus = () => ({ available: Boolean(process.env.SURF_API_KEY) && Date.now() >= surfDownUntil })

// ---------- CoinGecko ----------
function coingeckoBase() {
  const mode = String(process.env.COINGECKO_API_MODE || '').trim().toLowerCase()
  const key = String(process.env.COINGECKO_API_KEY || '').trim()
  if (key && mode === 'pro') return { base: 'https://pro-api.coingecko.com/api/v3', headers: { 'x-cg-pro-api-key': key } }
  if (key && mode === 'demo') return { base: 'https://api.coingecko.com/api/v3', headers: { 'x-cg-demo-api-key': key } }
  return { base: 'https://api.coingecko.com/api/v3', headers: {} }
}
function coingecko(path, params = {}) {
  const { base, headers } = coingeckoBase()
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]))
  return getJson(`${base}${path}${query.size ? `?${query}` : ''}`, { headers })
}

const COINGECKO_IDS = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', XRP: 'ripple', BNB: 'binancecoin', DOGE: 'dogecoin', ADA: 'cardano', USDC: 'usd-coin', USDT: 'tether',
  EURC: 'euro-coin', TRX: 'tron', AVAX: 'avalanche-2', LINK: 'chainlink', DOT: 'polkadot', TON: 'the-open-network', SUI: 'sui', HYPE: 'hyperliquid',
  LTC: 'litecoin', BCH: 'bitcoin-cash', NEAR: 'near', APT: 'aptos', ARB: 'arbitrum', OP: 'optimism', PEPE: 'pepe', SHIB: 'shiba-inu', UNI: 'uniswap',
  AAVE: 'aave', ENA: 'ethena', TAO: 'bittensor', WLD: 'worldcoin-wld', XLM: 'stellar', ATOM: 'cosmos', FIL: 'filecoin', INJ: 'injective-protocol',
  SEI: 'sei-network', TIA: 'celestia', PENDLE: 'pendle', ONDO: 'ondo-finance', VIRTUAL: 'virtual-protocol', FET: 'fetch-ai', RENDER: 'render-token',
  BONK: 'bonk', WIF: 'dogwifcoin', TRUMP: 'official-trump', POL: 'polygon-ecosystem-token', MATIC: 'polygon-ecosystem-token', ETC: 'ethereum-classic',
  HBAR: 'hedera-hashgraph', XMR: 'monero', CRO: 'crypto-com-chain', MNT: 'mantle', KAS: 'kaspa', ICP: 'internet-computer', DAI: 'dai', WBTC: 'wrapped-bitcoin',
  CIRBTC: 'circle-wrapped-btc', JUP: 'jupiter-exchange-solana', PYTH: 'pyth-network', LDO: 'lido-dao', MKR: 'maker', SKY: 'sky', CRV: 'curve-dao-token',
}

/** Resolve a ticker (or name) to a CoinGecko coin id; prefers the highest-market-cap coin with that exact symbol. */
async function coinId(symbolOrName) {
  const raw = String(symbolOrName || '').trim()
  const upper = raw.toUpperCase()
  if (COINGECKO_IDS[upper]) return COINGECKO_IDS[upper]
  return cached(`cg:id:${upper}`, 24 * 3600_000, async () => {
    const result = await coingecko('/search', { query: raw })
    const coins = Array.isArray(result?.coins) ? result.coins : []
    const exact = coins.filter((coin) => String(coin?.symbol || '').toUpperCase() === upper).sort((a, b) => (a.market_cap_rank ?? 1e9) - (b.market_cap_rank ?? 1e9))
    const byName = coins.filter((coin) => String(coin?.name || '').toLowerCase() === raw.toLowerCase())
    const pick = exact[0] || byName[0] || coins[0]
    if (!pick?.id) throw new Error('Unknown coin')
    return pick.id
  })
}

// ---------- OKX ----------
async function okx(path) {
  const payload = await getJson(`${OKX}${path}`)
  if (payload?.code !== '0') { const error = new Error(`OKX ${payload?.code}: ${String(payload?.msg || '').slice(0, 80)}`); error.code = payload?.code; throw error }
  return Array.isArray(payload.data) ? payload.data : []
}
const OKX_BAR = { '1d': ['15m', 96], '7d': ['1H', 168], '14d': ['2H', 168], '30d': ['4H', 180], '90d': ['12H', 180], '180d': ['1Dutc', 180], '365d': ['1Dutc', 300] }

/** Spot candles (oldest first): { t (ms), o, h, l, c, v (quote volume) }. */
async function okxCandles(symbol, bar, limit = 300) {
  const quote = symbol === 'USDT' ? 'USDC' : 'USDT'
  const rows = await cached(`okx:c:${symbol}:${bar}:${limit}`, 60_000, () => okx(`/market/candles?instId=${encodeURIComponent(`${symbol}-${quote}`)}&bar=${bar}&limit=${limit}`))
  return rows.map((row) => ({ t: Number(row[0]), o: Number(row[1]), h: Number(row[2]), l: Number(row[3]), c: Number(row[4]), v: Number(row[7]) }))
    .filter((row) => [row.t, row.o, row.h, row.l, row.c].every(Number.isFinite)).sort((a, b) => a.t - b.t)
}

// ---------- Public API ----------

/** Price history as [{ timestamp (s), value }], oldest first. */
async function priceSeries(symbol, timeRange = '7d') {
  const surf = await trySurf(() => dataApi.market.price({ symbol, time_range: timeRange }))
  const surfRows = (surf?.data ?? []).filter((row) => Number.isFinite(row?.value) && Number.isFinite(row?.timestamp))
  if (surfRows.length) return { source: 'Surf market data', points: surfRows.sort((a, b) => a.timestamp - b.timestamp) }
  const days = Number.parseInt(timeRange, 10) || 7
  try {
    const id = await coinId(symbol)
    const chart = await cached(`cg:chart:${id}:${days}`, 5 * 60_000, () => coingecko(`/coins/${id}/market_chart`, { vs_currency: 'usd', days }))
    const points = (chart?.prices ?? []).filter((row) => Array.isArray(row) && Number.isFinite(row[0]) && Number.isFinite(row[1])).map(([t, v]) => ({ timestamp: Math.floor(t / 1000), value: v }))
    if (points.length >= 2) return { source: 'CoinGecko', points }
  } catch { /* try OKX */ }
  const [bar, limit] = OKX_BAR[timeRange] || OKX_BAR['7d']
  const candles = await okxCandles(symbol, bar, limit)
  if (candles.length < 2) throw new Error('No price data')
  return { source: 'OKX', points: candles.map((row) => ({ timestamp: Math.floor(row.t / 1000), value: row.c })) }
}

/** Latest USD price for one symbol: { usd, observedAt, source }. */
async function latestPrice(symbol) {
  const surf = await trySurf(() => dataApi.market.price({ symbol, time_range: '1d' }))
  const rows = (surf?.data ?? []).filter((row) => Number.isFinite(row?.value) && row.value > 0 && Number.isFinite(row?.timestamp)).sort((a, b) => a.timestamp - b.timestamp)
  if (rows.length) return { usd: rows.at(-1).value, observedAt: new Date(rows.at(-1).timestamp * 1000).toISOString(), source: 'surf-market' }
  try {
    const id = await coinId(symbol)
    const data = await cached(`cg:simple:${id}`, 60_000, () => coingecko('/simple/price', { ids: id, vs_currencies: 'usd', include_last_updated_at: true }))
    const usd = Number(data?.[id]?.usd)
    if (Number.isFinite(usd) && usd > 0) return { usd, observedAt: new Date((Number(data[id].last_updated_at) || Date.now() / 1000) * 1000).toISOString(), source: 'coingecko' }
  } catch { /* try OKX */ }
  const ticker = (await okx(`/market/ticker?instId=${encodeURIComponent(`${symbol}-USDT`)}`))[0]
  const usd = Number(ticker?.last)
  if (!Number.isFinite(usd) || usd <= 0) throw new Error('Price unavailable')
  return { usd, observedAt: new Date(Number(ticker.ts) || Date.now()).toISOString(), source: 'okx' }
}

const CG_CATEGORY = { MEME: 'meme-token', AI: 'artificial-intelligence', AI_AGENTS: 'ai-agents', L1: 'layer-1', L2: 'layer-2', DEFI: 'decentralized-finance-defi', GAMING: 'gaming', STABLECOIN: 'stablecoins', RWA: 'real-world-assets-rwa', DEPIN: 'depin', SOL_ECO: 'solana-ecosystem', BASE_ECO: 'base-ecosystem', LST: 'liquid-staking-tokens' }

/** Token ranking: [{ rank, symbol, name, price_usd, change_24h_pct, market_cap_usd, volume_24h_usd }]. */
async function marketRanking({ sort_by = 'market_cap', order = 'desc', category = null, limit = 10 }) {
  const params = { sort_by, order, limit, ...(category ? { category } : {}) }
  const surf = await trySurf(() => dataApi.market.ranking(params))
  const surfRows = (surf?.data ?? []).filter((row) => row?.symbol)
  if (surfRows.length) return { source: 'Surf market data', tokens: surfRows.map((row) => ({ rank: row.rank, symbol: row.symbol, name: row.name, price_usd: row.price_usd, change_24h_pct: row.change_24h_pct, market_cap_usd: row.market_cap_usd, volume_24h_usd: row.volume_24h_usd })) }
  // Rankings by change/volume are computed over the top 250 by market cap so tiny illiquid coins don't dominate.
  const rows = await cached(`cg:markets:${category || 'all'}`, 3 * 60_000, () => coingecko('/coins/markets', { vs_currency: 'usd', order: 'market_cap_desc', per_page: 250, page: 1, price_change_percentage: '24h,7d', ...(category && CG_CATEGORY[category] ? { category: CG_CATEGORY[category] } : {}) }))
  const field = sort_by === 'change_24h' ? 'price_change_percentage_24h' : sort_by === 'volume_24h' ? 'total_volume' : 'market_cap'
  const list = (Array.isArray(rows) ? rows : []).filter((row) => row?.symbol && Number.isFinite(row?.[field]) && (sort_by !== 'change_24h' || (row.total_volume > 1_000_000 && row.market_cap >= 25_000_000)))
  list.sort((a, b) => (order === 'asc' ? a[field] - b[field] : b[field] - a[field]))
  return {
    source: 'CoinGecko',
    tokens: list.slice(0, limit).map((row) => ({ rank: row.market_cap_rank ?? null, symbol: String(row.symbol).toUpperCase(), name: row.name, price_usd: row.current_price, change_24h_pct: row.price_change_percentage_24h, change_7d_pct: row.price_change_percentage_7d_in_currency ?? null, market_cap_usd: row.market_cap, volume_24h_usd: row.total_volume })),
  }
}

/** Fear & Greed rows newest first: [{ value, classification, timestamp (s) }]. */
async function fearGreed(days = 3) {
  const from = Math.floor(Date.now() / 1000) - days * 86400
  const surf = await trySurf(() => dataApi.market.fear_greed({ from: String(from) }))
  const surfRows = (surf?.data ?? []).filter((row) => typeof row?.value === 'number')
  if (surfRows.length) return { source: 'Surf market data', rows: surfRows.map((row) => ({ value: row.value, classification: row.classification ?? null, timestamp: row.timestamp, price: row.price ?? null })) }
  const payload = await cached(`fng:${days}`, 10 * 60_000, () => getJson(`https://api.alternative.me/fng/?limit=${Math.max(1, Math.min(days + 1, 400))}`))
  const rows = (payload?.data ?? []).map((row) => ({ value: Number(row.value), classification: row.value_classification ?? null, timestamp: Number(row.timestamp), price: null })).filter((row) => Number.isFinite(row.value) && Number.isFinite(row.timestamp))
  if (!rows.length) throw new Error('Fear & Greed unavailable')
  return { source: 'alternative.me', rows: rows.sort((a, b) => b.timestamp - a.timestamp) }
}

// ---------- News (RSS fallback) ----------
const FEEDS = [
  ['Cointelegraph', 'https://cointelegraph.com/rss'],
  ['Decrypt', 'https://decrypt.co/feed'],
  ['CoinDesk', 'https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml'],
]
const decode = (value) => String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/\s+/g, ' ').trim()
const tag = (xml, name) => { const match = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i')); return match ? decode(match[1]) : '' }

async function readFeed([source, url]) {
  return cached(`rss:${url}`, 5 * 60_000, async () => {
    const response = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/rss+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' })
    if (!response.ok) throw new Error(`RSS HTTP ${response.status}`)
    const xml = await response.text()
    return [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].slice(0, 40).map(([item]) => {
      const published = Date.parse(tag(item, 'pubDate'))
      const link = tag(item, 'link')
      return { title: tag(item, 'title').slice(0, 200), source, published_at: Number.isFinite(published) ? Math.floor(published / 1000) : null, summary: tag(item, 'description').slice(0, 280), url: /^https:\/\//.test(link) ? link : null, project_name: null }
    }).filter((item) => item.title)
  })
}

/** News articles newest first: [{ title, source, published_at (s), summary, url, project_name }]. */
async function news({ query = '', limit = 5 }) {
  const surf = await trySurf(() => (query ? dataApi.search.news({ q: query, limit }) : dataApi.news.feed({ sort_by: 'recency', limit })))
  const surfRows = (surf?.data ?? []).filter((item) => item?.title)
  if (surfRows.length) return { source: 'Surf news', articles: surfRows }
  const settled = await Promise.allSettled(FEEDS.map(readFeed))
  const all = settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
  if (!all.length) throw new Error('News feeds unavailable')
  const terms = String(query || '').toLowerCase().split(/[\s,]+/).filter((term) => term.length >= 2)
  const matches = terms.length ? all.filter((item) => { const text = `${item.title} ${item.summary}`.toLowerCase(); return terms.some((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text)) }) : all
  const seen = new Set()
  const unique = matches.filter((item) => { const key = item.title.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true })
  return { source: 'Cointelegraph · Decrypt · CoinDesk RSS', articles: unique.sort((a, b) => (b.published_at ?? 0) - (a.published_at ?? 0)).slice(0, limit), searched: terms.length ? 'latest ~100 headlines only' : undefined }
}

/** Project profile. */
async function projectInfo(name) {
  const surf = await trySurf(() => dataApi.project.detail({ q: name, fields: 'overview,token_info,social' }))
  if (surf?.data && Object.keys(surf.data).length) {
    const overview = surf.data.overview ?? {}
    const token = surf.data.token_info ?? {}
    return { source: 'Surf project data', name: overview.name ?? name, description: overview.description, chains: overview.chains, tags: overview.tags, token: { symbol: token.symbol ?? null, price_usd: token.price_usd ?? token.price ?? null, market_cap_usd: token.market_cap_usd ?? token.market_cap ?? null } }
  }
  const id = await coinId(name)
  const coin = await cached(`cg:coin:${id}`, 30 * 60_000, () => coingecko(`/coins/${id}`, { localization: false, tickers: false, community_data: false, developer_data: false, sparkline: false }))
  const market = coin?.market_data ?? {}
  return {
    source: 'CoinGecko', name: coin?.name ?? name, description: coin?.description?.en ?? null,
    chains: coin?.platforms ? Object.keys(coin.platforms).filter(Boolean).slice(0, 8) : null, tags: Array.isArray(coin?.categories) ? coin.categories.filter(Boolean).slice(0, 8) : null,
    token: { symbol: coin?.symbol ? String(coin.symbol).toUpperCase() : null, price_usd: market.current_price?.usd ?? null, market_cap_usd: market.market_cap?.usd ?? null, fdv_usd: market.fully_diluted_valuation?.usd ?? null, ath_usd: market.ath?.usd ?? null, ath_change_pct: market.ath_change_percentage?.usd ?? null, ath_date: market.ath_date?.usd ?? null, circulating_supply: market.circulating_supply ?? null, max_supply: market.max_supply ?? null, rank: coin?.market_cap_rank ?? null },
    links: { website: coin?.links?.homepage?.find((url) => /^https:\/\//.test(url || '')) ?? null, twitter: coin?.links?.twitter_screen_name ? `https://x.com/${coin.links.twitter_screen_name}` : null },
  }
}

// ---------- Derivatives (OKX perpetuals) ----------
async function derivatives(symbol) {
  const inst = `${symbol}-USDT-SWAP`
  const [funding, history, oi, ticker, ratio] = await Promise.allSettled([
    okx(`/public/funding-rate?instId=${inst}`),
    okx(`/public/funding-rate-history?instId=${inst}&limit=21`),
    okx(`/public/open-interest?instType=SWAP&instId=${inst}`),
    okx(`/market/ticker?instId=${inst}`),
    okx(`/rubik/stat/contracts/long-short-account-ratio?ccy=${symbol}&period=1H`),
  ])
  const value = (result) => (result.status === 'fulfilled' ? result.value : [])
  const f = value(funding)[0]
  if (!f) throw new Error(`No ${symbol} perpetual on OKX`)
  const hist = value(history).map((row) => Number(row.realizedRate ?? row.fundingRate)).filter(Number.isFinite)
  const t = value(ticker)[0]
  const o = value(oi)[0]
  const ratios = value(ratio).map((row) => Number(row[1])).filter(Number.isFinite)
  const pct = (rate) => (Number.isFinite(rate) ? Number((rate * 100).toFixed(4)) : null)
  return {
    source: 'OKX perpetuals', instrument: inst,
    funding_rate_pct_per_8h: pct(Number(f.fundingRate)), next_funding_time: Number(f.fundingTime) ? new Date(Number(f.fundingTime)).toISOString() : null,
    funding_avg_7d_pct_per_8h: hist.length ? pct(hist.reduce((s, r) => s + r, 0) / hist.length) : null,
    funding_annualized_pct: Number.isFinite(Number(f.fundingRate)) ? Number((Number(f.fundingRate) * 3 * 365 * 100).toFixed(2)) : null,
    open_interest_usd: o ? Math.round(Number(o.oiUsd)) || null : null, open_interest_coins: o ? Number(Number(o.oiCcy).toFixed(2)) || null : null,
    perp_last_price: t ? Number(t.last) : null, perp_change_24h_pct: t && Number(t.open24h) ? Number((((Number(t.last) - Number(t.open24h)) / Number(t.open24h)) * 100).toFixed(2)) : null,
    perp_volume_24h_coins: t ? Number(Number(t.volCcy24h).toFixed(2)) : null,
    long_short_account_ratio: ratios[0] ?? null, long_short_ratio_24h_ago: ratios[23] ?? ratios.at(-1) ?? null,
    observedAt: new Date().toISOString(),
    note: 'Funding > 0 means longs pay shorts (crowded longs); < 0 means shorts pay. Long/short ratio counts ACCOUNTS on OKX only (retail-heavy), not position size, whales or the whole market; there is no whale or on-chain flow data here, so never describe this as whale activity.',
  }
}

// ---------- Technical analysis ----------
const sma = (values, n) => (values.length >= n ? values.slice(-n).reduce((s, v) => s + v, 0) / n : null)
function emaSeries(values, n) {
  if (values.length < n) return []
  const k = 2 / (n + 1)
  let prev = values.slice(0, n).reduce((s, v) => s + v, 0) / n
  const out = [prev]
  for (let i = n; i < values.length; i += 1) { prev = values[i] * k + prev * (1 - k); out.push(prev) }
  return out
}
function rsi(values, n = 14) {
  if (values.length <= n) return null
  let gain = 0, loss = 0
  for (let i = 1; i <= n; i += 1) { const d = values[i] - values[i - 1]; if (d >= 0) gain += d; else loss -= d }
  gain /= n; loss /= n
  for (let i = n + 1; i < values.length; i += 1) { const d = values[i] - values[i - 1]; gain = (gain * (n - 1) + Math.max(d, 0)) / n; loss = (loss * (n - 1) + Math.max(-d, 0)) / n }
  return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)
}
function atr(candles, n = 14) {
  if (candles.length <= n) return null
  const tr = candles.slice(1).map((c, i) => Math.max(c.h - c.l, Math.abs(c.h - candles[i].c), Math.abs(c.l - candles[i].c)))
  let value = tr.slice(0, n).reduce((s, v) => s + v, 0) / n
  for (let i = n; i < tr.length; i += 1) value = (value * (n - 1) + tr[i]) / n
  return value
}
const r = (value, digits = 4) => (Number.isFinite(value) ? Number(value.toPrecision(Math.max(digits, 6))) : null)

/** Indicators computed server-side from real candles. timeframe: 1h | 4h | 1d. */
async function technicals(symbol, timeframe = '1d') {
  const bar = timeframe === '1h' ? '1H' : timeframe === '4h' ? '4H' : '1Dutc'
  let candles = []
  let source = 'OKX spot candles'
  try { candles = await okxCandles(symbol, bar, 300) } catch { candles = [] }
  if (candles.length < 30) {
    // CoinGecko fallback: daily closes only (no intraday high/low).
    const id = await coinId(symbol)
    const chart = await cached(`cg:daily:${id}`, 30 * 60_000, () => coingecko(`/coins/${id}/market_chart`, { vs_currency: 'usd', days: 300, interval: 'daily' }))
    candles = (chart?.prices ?? []).map(([t, c]) => ({ t, o: c, h: c, l: c, c, v: null })).filter((row) => Number.isFinite(row.c))
    source = 'CoinGecko daily closes'
  }
  if (candles.length < 30) throw new Error('Not enough price history')
  const closes = candles.map((c) => c.c)
  const last = closes.at(-1)
  const ema12 = emaSeries(closes, 12), ema26 = emaSeries(closes, 26)
  const macdLine = ema26.map((v, i) => ema12[i + 14] - v)
  const signal = emaSeries(macdLine, 9)
  const macd = macdLine.at(-1), macdSignal = signal.at(-1)
  const s20 = sma(closes, 20), s50 = sma(closes, 50), s200 = sma(closes, 200)
  const std20 = s20 ? Math.sqrt(closes.slice(-20).reduce((s, v) => s + (v - s20) ** 2, 0) / 20) : null
  const window = (n) => candles.slice(-n)
  const range = (n) => ({ support: r(Math.min(...window(n).map((c) => c.l))), resistance: r(Math.max(...window(n).map((c) => c.h))) })
  const returns = closes.slice(-31).slice(1).map((c, i) => Math.log(c / closes.slice(-31)[i]))
  const vol = returns.length > 5 ? Math.sqrt(returns.reduce((s, v) => s + v * v, 0) / returns.length) : null
  const rsi14 = rsi(closes)
  const trend = s50 && s200 ? (last > s50 && s50 > s200 ? 'uptrend (price > SMA50 > SMA200)' : last < s50 && s50 < s200 ? 'downtrend (price < SMA50 < SMA200)' : 'mixed / range') : s50 ? (last > s50 ? 'above SMA50' : 'below SMA50') : 'n/a'
  const a = atr(candles)
  return {
    source, symbol, timeframe, candles: candles.length, last_close: r(last), last_candle_at: new Date(candles.at(-1).t).toISOString(),
    change_pct: { last_candle: r(((last - closes.at(-2)) / closes.at(-2)) * 100, 3), over_30_candles: r(((last - closes.at(-31)) / closes.at(-31)) * 100, 3) },
    trend, sma20: r(s20), sma50: r(s50), sma200: r(s200),
    rsi14: rsi14 === null ? null : Number(rsi14.toFixed(1)), rsi_zone: rsi14 === null ? null : rsi14 >= 70 ? 'overbought' : rsi14 <= 30 ? 'oversold' : 'neutral',
    macd: { line: r(macd), signal: r(macdSignal), histogram: r(macd - macdSignal), bias: macd > macdSignal ? 'bullish' : 'bearish' },
    bollinger20: s20 && std20 ? { upper: r(s20 + 2 * std20), lower: r(s20 - 2 * std20), position_pct: Number((((last - (s20 - 2 * std20)) / (4 * std20)) * 100).toFixed(1)) } : null,
    atr14: a && source.startsWith('OKX') ? { value: r(a), pct_of_price: Number(((a / last) * 100).toFixed(2)) } : null,
    levels: { recent_20: range(20), recent_90: range(Math.min(90, candles.length)) },
    volatility_per_candle_pct: vol === null ? null : Number((vol * 100).toFixed(2)),
    note: 'Indicators are descriptive, not predictive. Present both bullish and bearish readings.',
  }
}

// ---------- DeFi (DefiLlama) ----------
const llamaProtocols = () => cached('llama:protocols', 60 * 60_000, async () => {
  const rows = await getJson('https://api.llama.fi/protocols', { timeoutMs: 15_000 })
  return (Array.isArray(rows) ? rows : []).filter((p) => p?.name && Number.isFinite(p.tvl)).map((p) => ({ name: p.name, slug: p.slug, symbol: p.symbol && p.symbol !== '-' ? p.symbol : null, category: p.category ?? null, chains: Array.isArray(p.chains) ? p.chains.slice(0, 6) : [], tvl_usd: Math.round(p.tvl), change_1d_pct: Number.isFinite(p.change_1d) ? Number(p.change_1d.toFixed(2)) : null, change_7d_pct: Number.isFinite(p.change_7d) ? Number(p.change_7d.toFixed(2)) : null, mcap_usd: Number.isFinite(p.mcap) ? Math.round(p.mcap) : null, url: p.url ?? null }))
})

async function defi({ kind, query = '', limit = 8 }) {
  const q = String(query || '').trim().toLowerCase()
  const n = Math.min(10, Math.max(1, Number(limit) || 8))
  if (kind === 'chains') {
    const rows = await cached('llama:chains', 30 * 60_000, () => getJson('https://api.llama.fi/v2/chains'))
    const list = (Array.isArray(rows) ? rows : []).filter((c) => c?.name && Number.isFinite(c.tvl)).sort((a, b) => b.tvl - a.tvl)
    const chosen = q ? list.filter((c) => c.name.toLowerCase().includes(q)) : list
    return { source: 'DefiLlama', chains: chosen.slice(0, n).map((c) => ({ name: c.name, tvl_usd: Math.round(c.tvl), token: c.tokenSymbol ?? null })) }
  }
  if (kind === 'stablecoin_yields') {
    const pools = await cached('llama:pools', 60 * 60_000, async () => {
      const payload = await getJson('https://yields.llama.fi/pools', { timeoutMs: 20_000 })
      return (payload?.data ?? []).filter((p) => p?.stablecoin && !p.outlier && p.tvlUsd >= 5_000_000 && Number.isFinite(p.apy) && p.apy > 0 && p.apy < 60)
        .map((p) => ({ project: p.project, chain: p.chain, symbol: p.symbol, apy_pct: Number(p.apy.toFixed(2)), apy_base_pct: Number.isFinite(p.apyBase) ? Number(p.apyBase.toFixed(2)) : null, apy_reward_pct: Number.isFinite(p.apyReward) ? Number(p.apyReward.toFixed(2)) : null, tvl_usd: Math.round(p.tvlUsd), impermanent_loss_risk: p.ilRisk ?? null }))
    })
    const chosen = q ? pools.filter((p) => `${p.project} ${p.chain} ${p.symbol}`.toLowerCase().includes(q)) : pools
    const half = Math.max(3, Math.ceil(n / 2))
    return {
      source: 'DefiLlama yields',
      highest_apy: [...chosen].sort((a, b) => b.apy_pct - a.apy_pct).slice(0, half),
      largest_established: chosen.filter((p) => p.tvl_usd >= 100_000_000).sort((a, b) => b.tvl_usd - a.tvl_usd).slice(0, half),
      note: 'Stablecoin pools with TVL ≥ $5M only. Mainnet DeFi, not available inside Makoto (Arc Testnet). For "safe"/conservative requests lead with largest_established (TVL ≥ $100M); present highest_apy as higher-risk (small TVL, reward tokens, new protocols). No pool is risk-free: smart-contract, depeg and protocol risks always apply.',
    }
  }
  const protocols = await llamaProtocols()
  if (kind === 'protocol') {
    if (!q) throw new Error('Missing protocol name')
    const found = protocols.filter((p) => p.name.toLowerCase() === q || p.slug === q || p.symbol?.toLowerCase() === q)
    const fuzzy = found.length ? found : protocols.filter((p) => p.name.toLowerCase().includes(q))
    return { source: 'DefiLlama', protocols: fuzzy.sort((a, b) => b.tvl_usd - a.tvl_usd).slice(0, 3) }
  }
  const chosen = q ? protocols.filter((p) => (p.category || '').toLowerCase().includes(q) || p.chains.some((c) => c.toLowerCase() === q)) : protocols.filter((p) => p.category !== 'CEX')
  return { source: 'DefiLlama', filter: q || null, protocols: chosen.sort((a, b) => b.tvl_usd - a.tvl_usd).slice(0, n) }
}

module.exports = { priceSeries, latestPrice, marketRanking, fearGreed, news, projectInfo, derivatives, technicals, defi, coinId, surfStatus, _internal: { rsi, emaSeries, sma, atr, cache } }
