const { dataApi } = require('@surf-ai/sdk/server')
const { CHAIN_ID, TOKENS, TaskError, formatUnits } = require('./taskDefinitions')

const RPC = 'https://rpc.testnet.arc.network'
const EXPLORER = 'https://explorer.testnet.arc.io/api/v2'
const readOnlyMethods = new Set(['eth_chainId', 'eth_getCode', 'eth_call'])

async function rpc(method, params = []) {
  if (!readOnlyMethods.has(method)) throw new TaskError('TASK_INVALID', 'Unsupported RPC read')
  let response, body
  try {
    response = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(8000) })
    if (!response.ok) throw new Error('RPC HTTP error')
    body = await response.json()
  } catch { throw new TaskError('TASK_PROVIDER_UNAVAILABLE', 'Arc RPC unavailable', 502) }
  if (body?.error || !body || !Object.hasOwn(body, 'result')) throw new TaskError('TASK_PROVIDER_UNAVAILABLE', 'Arc RPC read failed', 502)
  return body.result
}

function rpcBigInt(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) throw new TaskError('TASK_DATA_UNAVAILABLE', 'Invalid RPC data', 502)
  return BigInt(value)
}

function decodeSymbol(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) throw new TaskError('TASK_DATA_UNAVAILABLE', 'Invalid token symbol', 502)
  const hex = value.slice(2)
  let payload
  if (hex.length === 64) payload = hex.replace(/(?:00)+$/, '')
  else {
    if (hex.length < 128 || BigInt(`0x${hex.slice(0, 64)}`) !== 32n) throw new TaskError('TASK_DATA_UNAVAILABLE', 'Invalid token symbol', 502)
    const length = Number(BigInt(`0x${hex.slice(64, 128)}`))
    if (!Number.isInteger(length) || length < 1 || length > 20 || hex.length < 128 + length * 2) throw new TaskError('TASK_DATA_UNAVAILABLE', 'Invalid token symbol', 502)
    payload = hex.slice(128, 128 + length * 2)
  }
  return Buffer.from(payload, 'hex').toString('utf8')
}

async function verifyChain() {
  if (Number(rpcBigInt(await rpc('eth_chainId'))) !== CHAIN_ID) throw new TaskError('TASK_NETWORK_UNAVAILABLE', 'Arc RPC is on the wrong chain', 502)
}

async function readBalance(account, asset) {
  const token = TOKENS[asset]
  if (!token || !/^0x[0-9a-f]{40}$/i.test(account)) throw new TaskError('TASK_INVALID')
  const address = account.slice(2).toLowerCase().padStart(64, '0')
  const [code, decimals, symbol, balance] = await Promise.all([
    rpc('eth_getCode', [token.address, 'latest']),
    rpc('eth_call', [{ to: token.address, data: '0x313ce567' }, 'latest']),
    rpc('eth_call', [{ to: token.address, data: '0x95d89b41' }, 'latest']),
    rpc('eth_call', [{ to: token.address, data: `0x70a08231${address}` }, 'latest']),
  ])
  if (typeof code !== 'string' || code === '0x' || rpcBigInt(decimals) !== BigInt(token.decimals) || decodeSymbol(symbol) !== asset) throw new TaskError('TASK_DATA_UNAVAILABLE', `${asset} metadata unavailable`, 502)
  const units = rpcBigInt(balance)
  return { asset, amount: formatUnits(units, token.decimals), units: units.toString(), decimals: token.decimals, source: 'arc-rpc', observedAt: new Date().toISOString() }
}

async function readBalances(account) {
  await verifyChain()
  const entries = await Promise.all(Object.keys(TOKENS).map(async (asset) => {
    try { return [asset, await readBalance(account, asset)] }
    catch (error) { return [asset, { errorCode: error.code || 'TASK_DATA_UNAVAILABLE' }] }
  }))
  const balances = {}, unavailable = []
  for (const [asset, value] of entries) {
    if (value.errorCode) unavailable.push(asset)
    else balances[asset] = value
  }
  return { balances, unavailable, source: 'arc-rpc', observedAt: new Date().toISOString() }
}

async function readActivity(account, since = null) {
  const rawItems = []
  let params = '', hasMore = false
  for (let page = 0; page < 3; page++) {
    let response, body
    try {
      response = await fetch(`${EXPLORER}/addresses/${account}/token-transfers${params}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000) })
      if (!response.ok) throw new Error('Explorer HTTP error')
      body = await response.json()
    } catch { throw new TaskError('TASK_PROVIDER_UNAVAILABLE', 'Arc explorer unavailable', 502) }
    if (!Array.isArray(body?.items)) throw new TaskError('TASK_DATA_UNAVAILABLE', 'Arc activity unavailable', 502)
    rawItems.push(...body.items)
    hasMore = Boolean(body.next_page_params)
    if (!hasMore) break
    params = '?' + new URLSearchParams(Object.entries(body.next_page_params).map(([key, value]) => [key, String(value)])).toString()
  }
  const lower = account.toLowerCase()
  const seen = new Set()
  const items = rawItems.flatMap((item) => {
    if (typeof item?.transaction_hash !== 'string' || typeof item?.timestamp !== 'string') return []
    const key = `${item.transaction_hash.toLowerCase()}:${item.log_index ?? ''}`
    if (seen.has(key)) return []
    seen.add(key)
    const from = item.from?.hash?.toLowerCase(), to = item.to?.hash?.toLowerCase()
    if (from !== lower && to !== lower) return []
    const timestamp = Date.parse(item.timestamp)
    if (!Number.isFinite(timestamp) || (since && timestamp < Date.parse(since))) return []
    const address = item.token?.address_hash?.toLowerCase()
    const asset = Object.keys(TOKENS).find((key) => TOKENS[key].address.toLowerCase() === address)
    if (!asset) return []
    const raw = item.total?.value
    if (typeof raw !== 'string' || !/^\d+$/.test(raw) || Number(item.total?.decimals ?? item.token?.decimals) !== TOKENS[asset].decimals) return []
    const amount = formatUnits(BigInt(raw), TOKENS[asset].decimals)
    return [{ hash: item.transaction_hash, logIndex: item.log_index ?? null, timestamp: new Date(timestamp).toISOString(), direction: from === lower ? 'out' : 'in', asset, amount }]
  }).slice(0, 100)
  return { items, source: 'arc-explorer', observedAt: new Date().toISOString(), hasMore: hasMore || rawItems.length > 100 }
}

async function readPrices() {
  const prices = {}, unavailable = []
  await Promise.all(Object.keys(TOKENS).map(async (asset) => {
    try {
      const symbol = asset === 'cirBTC' ? 'BTC' : asset
      const result = await dataApi.market.price({ symbol, time_range: '7d' })
      const rows = (result?.data ?? []).filter((row) => Number.isFinite(row?.value) && row.value > 0 && Number.isFinite(row?.timestamp))
      if (!rows.length) throw new Error('Price unavailable')
      prices[asset] = { usd: rows.at(-1).value, observedAt: new Date(rows.at(-1).timestamp * 1000).toISOString(), source: 'surf-market' }
    } catch { unavailable.push(asset) }
  }))
  return { prices, unavailable }
}

module.exports = { rpc, verifyChain, readBalance, readBalances, readActivity, readPrices }
