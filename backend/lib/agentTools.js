// Read-only tools for the Makoto Agent LLM loop.
//
// Safety boundary:
// - Every tool here only READS public data (Arc RPC / Arc explorer / CoinGecko /
//   Circle Iris / Surf data API). None of them can sign, submit, or hold keys.
// - `propose_action` executes nothing. It returns a structured proposal that the
//   frontend must pass through Makoto's deterministic planner, Policy/Risk review,
//   explicit user review, and the user's own wallet signature.
// - Tool outputs are untrusted data for the model and are size-bounded.
const { dataApi } = require('@surf-ai/sdk/server')

const ARC_RPC = 'https://rpc.testnet.arc.io'
const ARC_EXPLORER_API = 'https://explorer.testnet.arc.io/api/v2'
const CIRCLE_IRIS = 'https://iris-api-sandbox.circle.com'
const TOOL_TIMEOUT_MS = 10_000
const MAX_TOOL_OUTPUT_CHARS = 6000

const isAddress = (value) => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
const AMOUNT = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/
const SYMBOL = /^[A-Za-z0-9]{1,15}$/
const nowIso = () => new Date().toISOString()
const round = (value, digits = 6) => (typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(digits)) : null)

class ToolInputError extends Error {}

function withTimeout(promise, ms = TOOL_TIMEOUT_MS, label = 'tool') {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms) }),
  ]).finally(() => clearTimeout(timer))
}

async function rpc(method, params = []) {
  const response = await fetch(ARC_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(`Arc RPC HTTP ${response.status}`)
  const payload = await response.json()
  if (payload?.error) throw new Error('Arc RPC error')
  return payload.result
}

async function explorer(path) {
  const response = await fetch(`${ARC_EXPLORER_API}${path}`, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`Arc explorer HTTP ${response.status}`)
  return response.json()
}

function seriesSummary(rows) {
  const points = (Array.isArray(rows) ? rows : []).filter((row) => typeof row?.value === 'number' && typeof row?.timestamp === 'number').sort((a, b) => a.timestamp - b.timestamp)
  if (!points.length) return null
  const first = points[0].value
  const last = points[points.length - 1].value
  const values = points.map((point) => point.value)
  return {
    last: round(last, 6), first: round(first, 6),
    change_pct: first ? round(((last - first) / first) * 100, 2) : null,
    high: round(Math.max(...values), 6), low: round(Math.min(...values), 6),
    latest_at: new Date(points[points.length - 1].timestamp * 1000).toISOString(),
    points: points.length,
  }
}

const strip = (value, max = 280) => (typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : null)

/** Tool registry. `source` is the human-facing data source label shown in the UI. */
const TOOLS = {
  get_wallet_overview: {
    source: 'Arc explorer',
    description: 'Read the current Arc Testnet balances (USDC, EURC, cirBTC and other tokens) and the 10 most recent token transfers for a wallet address. Defaults to the user\'s own wallet when address is omitted.',
    parameters: { type: 'object', properties: { address: { type: ['string', 'null'], description: '0x wallet address. Use null for the user\'s own connected or watched wallet.' } }, required: ['address'], additionalProperties: false },
    async run(args, ctx) {
      const address = args.address || ctx.address
      if (!isAddress(address)) return { status: 'UNAVAILABLE', reason: 'No wallet address is connected or watched. Ask the user to connect a wallet or provide a 0x address.' }
      const { readWallet } = require('../routes/arc')
      const { getPrices } = require('../routes/prices')
      const [wallet, prices] = await Promise.all([readWallet(address), getPrices().catch(() => ({}))])
      // Server-side valuation so the model never does the arithmetic itself.
      const priceOf = (symbol) => { const item = prices?.[symbol === 'cirBTC' ? 'BTC' : symbol]; return item?.status === 'FRESH' || item?.status === 'STALE' ? item.price : undefined }
      const balances = wallet.tokens.filter((token) => token.verified || token.balance > 0).slice(0, 12).map((token) => {
        const price = token.verified ? priceOf(token.symbol) : undefined
        return { symbol: token.symbol, balance: round(token.balance, 8), verified: token.verified, ...(typeof price === 'number' ? { price_usd: price, value_usd: round(token.balance * price, 2) } : {}) }
      })
      const valued = balances.filter((item) => item.verified && typeof item.value_usd === 'number')
      const allVerifiedPriced = balances.filter((item) => item.verified).every((item) => typeof item.value_usd === 'number' || item.balance === 0)
      return {
        status: 'OK', chain: 'Arc Testnet', observedAt: wallet.observedAt, txCount: wallet.txCount,
        total_value_usd: valued.length && allVerifiedPriced ? round(valued.reduce((sum, item) => sum + item.value_usd, 0), 2) : 'unavailable (prices missing)',
        valuation_note: 'USD values use CoinGecko reference prices for verified assets only; testnet assets have no real-world value.',
        balances,
        recentTransfers: wallet.activity.slice(0, 10).map((item) => ({ time: item.timestamp, direction: item.direction, symbol: item.symbol, amount: round(item.amount, 6), counterparty: item.direction === 'out' ? item.to : item.from, verified: item.verified, hash: item.hash })),
        note: 'Unverified tokens may be spam. On Arc Testnet, USDC is also the native gas token.',
      }
    },
  },
  get_token_prices: {
    source: 'CoinGecko',
    description: 'Read current USD prices and 24h change for the wallet assets USDC, EURC and cirBTC (BTC). Use this to value Makoto wallet balances.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    async run() {
      const { getPrices } = require('../routes/prices')
      const prices = await getPrices()
      return Object.fromEntries(Object.entries(prices || {}).map(([key, item]) => [key === 'BTC' ? 'cirBTC' : key, { price_usd: item?.price ?? null, change_24h_pct: round(item?.change24h, 3), status: item?.status, observedAt: item?.observedAt }]))
    },
  },
  get_arc_network: {
    source: 'Arc RPC + Arc explorer',
    description: 'Read Arc Testnet network health: latest block, gas price, typical transfer fee in USDC, RPC latency, and chain-wide statistics (transactions today, total addresses, utilization).',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    async run() {
      const started = Date.now()
      const [block, gas] = await Promise.all([rpc('eth_blockNumber'), rpc('eth_gasPrice')])
      const latency = Date.now() - started
      const gasWei = BigInt(gas)
      const stats = await explorer('/stats').catch(() => null)
      return {
        status: 'OK', chain: 'Arc Testnet', chainId: 5042002, observedAt: nowIso(),
        blockNumber: Number(BigInt(block)), gasPriceGwei: Number(gasWei) / 1e9,
        nativeTransferFeeUsdc: round(Number(gasWei * 21000n) / 1e18, 8), tokenTransferFeeUsdc: round(Number(gasWei * 65000n) / 1e18, 8),
        rpcLatencyMs: latency,
        stats: stats ? { transactionsToday: Number(stats.transactions_today ?? 0) || null, totalTransactions: Number(stats.total_transactions ?? 0) || null, totalAddresses: Number(stats.total_addresses ?? 0) || null, utilizationPct: round(Number(stats.network_utilization_percentage), 2) } : 'unavailable',
      }
    },
  },
  get_bridge_fees: {
    source: 'Circle CCTP v2',
    description: 'Read the current Circle CCTP v2 fees for bridging USDC from Arc Testnet to Base Sepolia (the only supported bridge route). Exact fees are re-quoted live during the user review.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    async run() {
      const response = await fetch(`${CIRCLE_IRIS}/v2/burn/USDC/fees/26/6?forward=true`, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error('Circle fee request failed')
      const rows = await response.json()
      const pick = (threshold) => (Array.isArray(rows) ? rows.find((row) => Number(row?.finalityThreshold) === threshold) : undefined)
      const describe = (row) => row ? { minimumFeeBps: Number(row.minimumFee), forwardFeeUsdcMedian: row.forwardFee?.med != null ? round(Number(row.forwardFee.med) / 1e6, 6) : null } : 'unavailable'
      return { status: 'OK', route: 'Arc Testnet → Base Sepolia (USDC only)', observedAt: nowIso(), fast: describe(pick(1000)), standard: describe(pick(2000)), note: 'Indicative only; the review screen fetches a fresh official quote.' }
    },
  },
  get_market_overview: {
    source: 'Surf market data',
    description: 'Read the crypto market overview: top tokens ranked by market cap, 24h change or 24h volume (optionally filtered by category), plus the Crypto Fear & Greed index.',
    parameters: {
      type: 'object',
      properties: {
        sort_by: { type: 'string', enum: ['market_cap', 'change_24h', 'volume_24h'], description: 'Ranking field.' },
        order: { type: 'string', enum: ['desc', 'asc'], description: 'desc = top gainers/largest first, asc = top losers/smallest first.' },
        category: { type: ['string', 'null'], enum: ['MEME', 'AI', 'AI_AGENTS', 'L1', 'L2', 'DEFI', 'GAMING', 'STABLECOIN', 'RWA', 'DEPIN', 'SOL_ECO', 'BASE_ECO', 'LST', null], description: 'Optional category filter.' },
        limit: { type: 'integer', description: 'Number of tokens, 1-15.' },
      },
      required: ['sort_by', 'order', 'category', 'limit'],
      additionalProperties: false,
    },
    async run(args) {
      const limit = Math.min(15, Math.max(1, Number(args.limit) || 10))
      const params = { sort_by: args.sort_by || 'market_cap', order: args.order === 'asc' ? 'asc' : 'desc', limit }
      if (args.category) params.category = args.category
      const [ranking, fearGreed] = await Promise.all([
        dataApi.market.ranking(params),
        dataApi.market.fear_greed({ from: String(Math.floor(Date.now() / 1000) - 3 * 86400) }).catch(() => null),
      ])
      const fg = (fearGreed?.data ?? []).filter((row) => typeof row?.value === 'number')[0]
      return {
        status: 'OK', observedAt: nowIso(),
        tokens: (ranking?.data ?? []).filter((row) => row?.symbol).map((row) => ({ rank: row.rank, symbol: row.symbol, name: row.name, price_usd: row.price_usd, change_24h_pct: round(row.change_24h_pct, 2), market_cap_usd: row.market_cap_usd, volume_24h_usd: row.volume_24h_usd })),
        fearGreed: fg ? { value: fg.value, label: fg.classification ?? null } : 'unavailable',
      }
    },
  },
  get_token_market_data: {
    source: 'Surf market data',
    description: 'Read the price history summary of one crypto token by ticker (e.g. BTC, ETH, SOL, USDC) over a time range: last price, % change, high and low. Use for price analysis questions.',
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Single ticker symbol like BTC, ETH, SOL.' },
        time_range: { type: 'string', enum: ['1d', '7d', '14d', '30d', '90d', '180d', '365d'] },
      },
      required: ['symbol', 'time_range'],
      additionalProperties: false,
    },
    async run(args) {
      const symbol = String(args.symbol || '').trim().toUpperCase()
      if (!SYMBOL.test(symbol)) throw new ToolInputError('Invalid symbol')
      const timeRange = ['1d', '7d', '14d', '30d', '90d', '180d', '365d'].includes(args.time_range) ? args.time_range : '7d'
      const result = await dataApi.market.price({ symbol, time_range: timeRange })
      const summary = seriesSummary(result?.data)
      return summary ? { status: 'OK', symbol, time_range: timeRange, currency: 'USD', ...summary } : { status: 'UNAVAILABLE', symbol, reason: 'No price data for this symbol' }
    },
  },
  get_crypto_news: {
    source: 'Surf news',
    description: 'Read recent crypto news headlines. With a query, searches articles about a topic or project (e.g. "Circle", "USDC", "Arc", "Bitcoin ETF"); without a query, returns the latest market headlines.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: ['string', 'null'], description: 'Topic or project to search for, or null for latest headlines.' },
        limit: { type: 'integer', description: 'Number of articles, 1-8.' },
      },
      required: ['query', 'limit'],
      additionalProperties: false,
    },
    async run(args) {
      const limit = Math.min(8, Math.max(1, Number(args.limit) || 5))
      const query = typeof args.query === 'string' ? args.query.trim().slice(0, 80) : ''
      const result = query ? await dataApi.search.news({ q: query, limit }) : await dataApi.news.feed({ sort_by: 'recency', limit })
      const all = (result?.data ?? []).filter((item) => item?.title).sort((a, b) => (b.published_at ?? 0) - (a.published_at ?? 0))
      // Search is relevance-ranked and can return old articles; prefer the last 120 days when enough exist.
      const recent = all.filter((item) => typeof item.published_at === 'number' && Date.now() / 1000 - item.published_at < 120 * 86400)
      const items = (recent.length >= Math.min(2, all.length) ? recent : all).slice(0, limit)
      return {
        status: 'OK', observedAt: nowIso(), query: query || null, note: 'Always state each article publication date; do not present older articles as today\'s news.',
        articles: items.map((item) => ({ title: strip(item.title, 200), source: item.source ?? null, published_at: item.published_at ? new Date(item.published_at * 1000).toISOString() : null, summary: strip(item.summary, 280), project: item.project_name ?? null, url: typeof item.url === 'string' && /^https:\/\//.test(item.url) ? item.url : null })),
      }
    },
  },
  get_project_info: {
    source: 'Surf project data',
    description: 'Read a crypto project profile by name (e.g. "Circle", "Ethereum", "Uniswap"): description, chains, token info and social links.',
    parameters: { type: 'object', properties: { name: { type: 'string', description: 'Project or token name.' } }, required: ['name'], additionalProperties: false },
    async run(args) {
      const name = String(args.name || '').trim().slice(0, 60)
      if (!name) throw new ToolInputError('Missing project name')
      const result = await dataApi.project.detail({ q: name, fields: 'overview,token_info,social' })
      const data = result?.data ?? {}
      const overview = data.overview ?? {}
      const token = data.token_info ?? {}
      return {
        status: data && Object.keys(data).length ? 'OK' : 'UNAVAILABLE', observedAt: nowIso(),
        name: overview.name ?? name, description: strip(overview.description, 600), chains: Array.isArray(overview.chains) ? overview.chains.slice(0, 8) : null,
        tags: Array.isArray(overview.tags) ? overview.tags.slice(0, 8) : null,
        token: token && typeof token === 'object' ? { symbol: token.symbol ?? null, price_usd: token.price_usd ?? token.price ?? null, market_cap_usd: token.market_cap_usd ?? token.market_cap ?? null } : null,
      }
    },
  },
  propose_action: {
    source: 'Makoto planner',
    description: 'Propose ONE wallet action for the user to review in Makoto: send (ERC-20 transfer on Arc), swap (USDC <-> EURC on Arc) or bridge (USDC Arc Testnet -> Base Sepolia). This executes NOTHING; Makoto validates it deterministically and the user must review and sign in their own wallet. Only call when the user clearly asked to do the action. Never use MAX/all — ask for an exact amount instead.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['send', 'swap', 'bridge'] },
        asset: { type: 'string', enum: ['USDC', 'EURC', 'cirBTC'] },
        amount: { type: 'string', description: 'Exact positive decimal amount, e.g. "5" or "12.5".' },
        recipient: { type: ['string', 'null'], description: 'Full 0x recipient address for send, otherwise null.' },
        output_asset: { type: ['string', 'null'], enum: ['USDC', 'EURC', null], description: 'Asset to receive for swap, otherwise null.' },
      },
      required: ['kind', 'asset', 'amount', 'recipient', 'output_asset'],
      additionalProperties: false,
    },
    async run(args, ctx) {
      const proposal = validateProposal(args)
      if (!proposal.ok) return { status: 'REJECTED', reason: proposal.reason }
      ctx.proposal = proposal.value
      return { status: 'PROPOSED_FOR_USER_REVIEW', proposal: proposal.value, note: 'Nothing was executed. The user will see a review card, Makoto re-checks balance and policy, and the user signs in their own wallet.' }
    },
  },
}

function validateProposal(args) {
  const kind = args?.kind
  if (!['send', 'swap', 'bridge'].includes(kind)) return { ok: false, reason: 'Unsupported action kind' }
  const amount = typeof args.amount === 'string' ? args.amount.trim().replace(',', '.') : ''
  if (!AMOUNT.test(amount) || Number(amount) <= 0) return { ok: false, reason: 'An exact positive amount is required (MAX/all is not allowed for the Agent).' }
  const asset = ['USDC', 'EURC', 'cirBTC'].includes(args.asset) ? args.asset : undefined
  if (!asset) return { ok: false, reason: 'Unsupported asset' }
  if (kind === 'send') {
    if (!isAddress(args.recipient)) return { ok: false, reason: 'A full 0x recipient address is required for send.' }
    return { ok: true, value: { kind, asset, amount, recipient: args.recipient } }
  }
  if (kind === 'swap') {
    if (asset === 'cirBTC') return { ok: false, reason: 'Swap supports USDC <-> EURC only.' }
    const output = args.output_asset === 'USDC' || args.output_asset === 'EURC' ? args.output_asset : asset === 'USDC' ? 'EURC' : 'USDC'
    if (output === asset) return { ok: false, reason: 'Choose a different output asset.' }
    return { ok: true, value: { kind, asset, amount, outputAsset: output } }
  }
  if (asset !== 'USDC') return { ok: false, reason: 'Bridge supports USDC only (Arc Testnet -> Base Sepolia).' }
  return { ok: true, value: { kind, asset: 'USDC', amount, destination: 'Base Sepolia' } }
}

function toolDefinitions() {
  return Object.entries(TOOLS).map(([name, tool]) => ({ type: 'function', name, description: tool.description, parameters: tool.parameters, strict: true }))
}

function boundOutput(value) {
  const text = JSON.stringify(value)
  return text.length <= MAX_TOOL_OUTPUT_CHARS ? text : `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}…[truncated]`
}

/** Execute one model tool call. Never throws; failures become an UNAVAILABLE result (never fabricated data). */
async function runTool(name, rawArguments, ctx) {
  const tool = Object.prototype.hasOwnProperty.call(TOOLS, name) ? TOOLS[name] : undefined
  if (!tool) return { ok: false, output: boundOutput({ status: 'ERROR', reason: `Unknown tool ${String(name).slice(0, 40)}` }) }
  let args
  try { args = rawArguments ? JSON.parse(rawArguments) : {} } catch { return { ok: false, output: boundOutput({ status: 'ERROR', reason: 'Invalid tool arguments' }) } }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return { ok: false, output: boundOutput({ status: 'ERROR', reason: 'Invalid tool arguments' }) }
  try {
    const result = await withTimeout(Promise.resolve(tool.run(args, ctx)), TOOL_TIMEOUT_MS, name)
    return { ok: true, source: tool.source, output: boundOutput(result) }
  } catch (error) {
    const reason = error instanceof ToolInputError ? error.message : 'Data source unavailable right now'
    return { ok: false, source: tool.source, output: boundOutput({ status: 'UNAVAILABLE', reason }) }
  }
}

module.exports = { TOOLS, toolDefinitions, runTool, validateProposal, seriesSummary, isAddress }
