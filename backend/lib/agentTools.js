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
    async run(args, ctx) {
      const symbol = String(args.symbol || '').trim().toUpperCase()
      if (!SYMBOL.test(symbol)) throw new ToolInputError('Invalid symbol')
      const timeRange = ['1d', '7d', '14d', '30d', '90d', '180d', '365d'].includes(args.time_range) ? args.time_range : '7d'
      const result = await dataApi.market.price({ symbol, time_range: timeRange })
      const summary = seriesSummary(result?.data)
      if (!summary) return { status: 'UNAVAILABLE', symbol, reason: 'No price data for this symbol' }
      // The UI draws this series as a chart; the model only receives the summary.
      const points = downsample(result.data, 60)
      if (points.length >= 2 && ctx && Array.isArray(ctx.charts) && ctx.charts.length < 3) ctx.charts.push({ symbol, time_range: timeRange, currency: 'USD', points })
      return { status: 'OK', symbol, time_range: timeRange, currency: 'USD', ...summary, chart: 'shown to the user' }
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
  explain_transaction: {
    source: 'Arc explorer',
    description: 'Look up one Arc Testnet transaction by its 0x hash and return what happened: status, method, sender, receiver, token transfers, fee and time. Use it when the user pastes a transaction hash or asks what a transaction did.',
    parameters: { type: 'object', properties: { hash: { type: 'string', description: '0x + 64 hex characters.' } }, required: ['hash'], additionalProperties: false },
    async run(args) {
      const hash = String(args.hash || '').trim()
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new ToolInputError('Invalid transaction hash')
      const response = await fetch(`${ARC_EXPLORER_API}/transactions/${hash}`, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } })
      if (response.status === 404 || response.status === 422) return { status: 'NOT_FOUND', hash, note: 'This hash was not found on Arc Testnet (it may be on another chain or still pending).' }
      if (!response.ok) throw new Error(`Arc explorer HTTP ${response.status}`)
      const tx = await response.json()
      const party = (item) => item ? { address: item.hash ?? null, name: item.name ?? null, contract: Boolean(item.is_contract), verified: Boolean(item.is_verified), flaggedScam: Boolean(item.is_scam) } : null
      const transfers = (Array.isArray(tx.token_transfers) ? tx.token_transfers : []).slice(0, 10).map((item) => ({
        token: item?.token?.symbol ?? '?', verifiedAsset: ['0x3600000000000000000000000000000000000000', '0x89b50855aa3be2f677cd6303cec089b5f319d72a', '0xf0c4a4ce82a5746abaad9425360ab04fbba432bf'].includes(String(item?.token?.address_hash ?? '').toLowerCase()),
        from: item?.from?.hash ?? null, to: item?.to?.hash ?? null,
        amount: item?.total?.value != null ? round(Number(BigInt(item.total.value)) / 10 ** Number(item.total.decimals ?? item.token?.decimals ?? 18), 6) : null,
      }))
      const native = (value) => { try { return round(Number(BigInt(value ?? '0')) / 1e18, 8) } catch { return null } }
      return {
        status: 'OK', chain: 'Arc Testnet', hash,
        result: tx.result ?? tx.status ?? null, method: tx.method ?? null, time: tx.timestamp ?? null, block: tx.block_number ?? null, confirmations: tx.confirmations ?? null,
        from: party(tx.from), to: party(tx.to), nativeUsdcValue: native(tx.value), feeUsdc: native(tx.fee?.value), types: Array.isArray(tx.tx_types) ? tx.tx_types.slice(0, 5) : null,
        tokenTransfers: transfers, explorerUrl: `https://testnet.arcscan.app/tx/${hash}`,
        note: 'Explain in plain language. Unverified tokens may be spam; never present them as real value.',
      }
    },
  },
  inspect_address: {
    source: 'Arc explorer',
    description: 'Inspect an Arc Testnet address: whether it is a contract or a normal wallet, its name/verification, scam flag, token info, balance and activity counts. Use it when the user asks who/what an address is or whether it is safe to send to it.',
    parameters: { type: 'object', properties: { address: { type: 'string', description: 'Full 0x address.' } }, required: ['address'], additionalProperties: false },
    async run(args) {
      const address = String(args.address || '').trim()
      if (!isAddress(address)) throw new ToolInputError('Invalid address')
      const [info, counters] = await Promise.all([
        fetch(`${ARC_EXPLORER_API}/addresses/${address}`, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } }).then(async (r) => r.status === 404 ? null : r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))),
        explorer(`/addresses/${address}/counters`).catch(() => null),
      ])
      if (!info) return { status: 'OK', address, seenOnChain: false, note: 'No on-chain history for this address on Arc Testnet. A brand-new address is not necessarily unsafe, but double-check it before sending.' }
      const txCount = Number(counters?.transactions_count ?? 0)
      return {
        status: 'OK', address, seenOnChain: true,
        type: info.is_contract ? 'contract' : 'wallet', name: info.name ?? null, verifiedContract: info.is_contract ? Boolean(info.is_verified) : null, flaggedScam: Boolean(info.is_scam),
        token: info.token ? { symbol: info.token.symbol ?? null, name: info.token.name ?? null, holders: Number(info.token.holders_count ?? 0) || null } : null,
        nativeUsdcBalance: (() => { try { return round(Number(BigInt(info.coin_balance ?? '0')) / 1e18, 6) } catch { return null } })(),
        transactions: Number.isFinite(txCount) ? txCount : null, tokenTransfers: Number(counters?.token_transfers_count ?? 0) || 0,
        explorerUrl: `https://testnet.arcscan.app/address/${address}`,
        note: 'Facts only. Remind the user to compare the FULL address (not just the first/last characters) before sending.',
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
        recipient_contact: { type: ['string', 'null'], description: 'For send to a saved contact: the contact name exactly as listed in the user memory (Makoto resolves the address on the device). Otherwise null.' },
        output_asset: { type: ['string', 'null'], enum: ['USDC', 'EURC', null], description: 'Asset to receive for swap, otherwise null.' },
      },
      required: ['kind', 'asset', 'amount', 'recipient', 'recipient_contact', 'output_asset'],
      additionalProperties: false,
    },
    async run(args, ctx) {
      if (ctx.plan) return { status: 'REJECTED', reason: 'A multi-step plan was already proposed in this reply.' }
      const proposal = validateProposal(args)
      if (!proposal.ok) return { status: 'REJECTED', reason: proposal.reason }
      ctx.proposal = proposal.value
      return { status: 'PROPOSED_FOR_USER_REVIEW', proposal: proposal.value, note: 'Nothing was executed. The user will see a review card, Makoto re-checks balance and policy, and the user signs in their own wallet.' }
    },
  },
  propose_plan: {
    source: 'Makoto planner',
    description: 'Propose a SEQUENCE of 2-3 wallet actions the user asked for in one message (e.g. "swap 10 USDC to EURC then send 5 EURC to Lan"). Executes NOTHING. Makoto shows a step list; each step is validated, reviewed and signed separately, and a step only starts after the previous one is confirmed on-chain. Every step needs an exact amount; do not chain an unknown output amount.',
    parameters: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          description: '2 or 3 steps in order.',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['send', 'swap', 'bridge'] },
              asset: { type: 'string', enum: ['USDC', 'EURC', 'cirBTC'] },
              amount: { type: 'string' },
              recipient: { type: ['string', 'null'] },
              recipient_contact: { type: ['string', 'null'] },
              output_asset: { type: ['string', 'null'], enum: ['USDC', 'EURC', null] },
            },
            required: ['kind', 'asset', 'amount', 'recipient', 'recipient_contact', 'output_asset'],
            additionalProperties: false,
          },
        },
      },
      required: ['steps'],
      additionalProperties: false,
    },
    async run(args, ctx) {
      const steps = Array.isArray(args.steps) ? args.steps : []
      if (steps.length < 2 || steps.length > 3) return { status: 'REJECTED', reason: 'A plan needs 2 or 3 steps; use propose_action for a single action.' }
      const checked = steps.map(validateProposal)
      const bad = checked.findIndex((item) => !item.ok)
      if (bad >= 0) return { status: 'REJECTED', reason: `Step ${bad + 1}: ${checked[bad].reason}` }
      if (ctx.proposal) return { status: 'REJECTED', reason: 'A single action was already proposed in this reply.' }
      ctx.plan = checked.map((item) => item.value)
      return { status: 'PLAN_PROPOSED_FOR_USER_REVIEW', steps: ctx.plan, note: 'Nothing was executed. Each step is reviewed and signed separately, in order.' }
    },
  },
  remember_note: {
    source: 'Makoto memory',
    description: 'Save a short preference or fact the user explicitly asked Makoto to remember (e.g. "remember I prefer standard bridge speed", "nhớ là mình thích trả lời ngắn"). Stored only on the user\'s device. Never store secrets, seed phrases, private keys or addresses here.',
    parameters: { type: 'object', properties: { note: { type: 'string', description: 'The preference in one short sentence (max 200 characters).' } }, required: ['note'], additionalProperties: false },
    async run(args, ctx) {
      const note = typeof args.note === 'string' ? args.note.replace(/\s+/g, ' ').trim().slice(0, 200) : ''
      if (!note) return { status: 'REJECTED', reason: 'Empty note' }
      if (/0x[0-9a-fA-F]{40}|seed|mnemonic|private key|khóa riêng|cụm từ khôi phục/i.test(note)) return { status: 'REJECTED', reason: 'Do not store addresses or secrets in memory; use save_contact for addresses.' }
      if (ctx.memory.length >= 3) return { status: 'REJECTED', reason: 'Too many memory updates in one reply' }
      ctx.memory.push({ type: 'note', note })
      return { status: 'SAVED_ON_DEVICE', note }
    },
  },
  save_contact: {
    source: 'Makoto memory',
    description: 'Offer to save a named address book contact when the user asks (e.g. "save 0xabc... as Nam"). The user confirms with a button before it is saved on their device.',
    parameters: { type: 'object', properties: { name: { type: 'string' }, address: { type: 'string', description: 'Full 0x address.' } }, required: ['name', 'address'], additionalProperties: false },
    async run(args, ctx) {
      const name = typeof args.name === 'string' ? args.name.replace(/\s+/g, ' ').trim().slice(0, 40) : ''
      if (!name) return { status: 'REJECTED', reason: 'A contact name is required' }
      if (!isAddress(args.address)) return { status: 'REJECTED', reason: 'A full 0x address is required' }
      if (ctx.memory.length >= 3) return { status: 'REJECTED', reason: 'Too many memory updates in one reply' }
      ctx.memory.push({ type: 'contact', name, address: args.address })
      return { status: 'AWAITING_USER_CONFIRMATION', name, note: 'The user must press a button to save this contact.' }
    },
  },
}

function downsample(rows, maxPoints) {
  const points = (Array.isArray(rows) ? rows : []).filter((row) => typeof row?.value === 'number' && Number.isFinite(row.value) && typeof row?.timestamp === 'number').sort((a, b) => a.timestamp - b.timestamp)
  if (points.length <= maxPoints) return points.map((row) => [row.timestamp, round(row.value, 6)])
  const step = (points.length - 1) / (maxPoints - 1)
  return Array.from({ length: maxPoints }, (_, index) => points[Math.round(index * step)]).map((row) => [row.timestamp, round(row.value, 6)])
}

function validateProposal(args) {
  const kind = args?.kind
  if (!['send', 'swap', 'bridge'].includes(kind)) return { ok: false, reason: 'Unsupported action kind' }
  const amount = typeof args.amount === 'string' ? args.amount.trim().replace(',', '.') : ''
  if (!AMOUNT.test(amount) || Number(amount) <= 0) return { ok: false, reason: 'An exact positive amount is required (MAX/all is not allowed for the Agent).' }
  const asset = ['USDC', 'EURC', 'cirBTC'].includes(args.asset) ? args.asset : undefined
  if (!asset) return { ok: false, reason: 'Unsupported asset' }
  if (kind === 'send') {
    if (isAddress(args.recipient)) return { ok: true, value: { kind, asset, amount, recipient: args.recipient } }
    const contact = typeof args.recipient_contact === 'string' ? args.recipient_contact.replace(/\s+/g, ' ').trim() : ''
    if (contact && contact.length <= 40) return { ok: true, value: { kind, asset, amount, recipientContact: contact } }
    return { ok: false, reason: 'A full 0x recipient address or a saved contact name is required for send.' }
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

module.exports = { TOOLS, toolDefinitions, runTool, validateProposal, seriesSummary, downsample, isAddress }
