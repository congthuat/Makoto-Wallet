// Live Arc Testnet data: network status (RPC) + wallet balances & activity (Arc explorer / Blockscout API)
const { Router } = require('express')
const router = Router()

const RPC = 'https://rpc.testnet.arc.network'
const EXPLORER_API = 'https://explorer.testnet.arc.io/api/v2'

// Verified Circle assets on Arc Testnet (anything else is treated as unverified / possible spam)
const VERIFIED = {
  '0x3600000000000000000000000000000000000000': 'USDC',
  '0x89b50855aa3be2f677cd6303cec089b5f319d72a': 'EURC',
  '0xf0c4a4ce82a5746abaad9425360ab04fbba432bf': 'cirBTC',
}

const isAddr = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a)

async function rpc(method, params = []) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(8000),
  })
  const j = await r.json()
  if (j.error) throw new Error(j.error.message)
  return j.result
}

async function explorer(path) {
  const r = await fetch(`${EXPLORER_API}${path}`, { signal: AbortSignal.timeout(10000), headers: { accept: 'application/json' } })
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`explorer ${r.status}`)
  return r.json()
}

// Convert integer string + decimals into a JS number (safe for display)
function units(value, decimals) {
  try {
    const v = BigInt(value ?? '0')
    const d = BigInt(10) ** BigInt(Number(decimals ?? 18))
    return Number(v / d) + Number(v % d) / Number(d)
  } catch {
    return 0
  }
}

router.get('/network', async (_req, res) => {
  try {
    const t0 = Date.now()
    const [block, gas] = await Promise.all([rpc('eth_blockNumber'), rpc('eth_gasPrice')])
    const latency = Date.now() - t0
    const gasWei = BigInt(gas)
    // Arc uses USDC as the native gas token (18 decimals at the native layer)
    const transferFee = Number(gasWei * 21000n) / 1e18
    const tokenTransferFee = Number(gasWei * 65000n) / 1e18
    res.json({
      chainId: 5042002,
      blockNumber: Number(BigInt(block)),
      gasPriceGwei: Number(gasWei) / 1e9,
      transferFeeUsdc: transferFee,
      tokenTransferFeeUsdc: tokenTransferFee,
      rpcLatencyMs: latency,
      updatedAt: Date.now(),
    })
  } catch (e) {
    console.error('arc/network', e?.message)
    res.status(502).json({ error: 'Arc RPC unavailable' })
  }
})

async function readWallet(address) {
  if (!isAddr(address)) throw new Error('Invalid address')
  const [info, balances, transfers] = await Promise.all([
    explorer(`/addresses/${address}`),
    explorer(`/addresses/${address}/token-balances`),
    explorer(`/addresses/${address}/token-transfers`),
  ])
  if (!info || typeof info.coin_balance !== 'string' || !/^\d+$/.test(info.coin_balance) || !Array.isArray(balances)) {
    throw new Error('Wallet balances unavailable')
  }

  const tokens = []
  // Native USDC (gas token)
  tokens.push({
    symbol: 'USDC',
    name: 'USD Coin',
    address: '0x3600000000000000000000000000000000000000',
    decimals: 6,
    balance: units(info.coin_balance, 18),
    verified: true,
    rawBalance: info.coin_balance,
    rawDecimals: 18,
  })
  for (const b of Array.isArray(balances) ? balances : []) {
    const addr = b?.token?.address_hash
    if (!addr || b?.token?.type !== 'ERC-20') continue
    if (addr.toLowerCase() === '0x3600000000000000000000000000000000000000') continue
    if (VERIFIED[addr.toLowerCase()] && (typeof b.value !== 'string' || !/^\d+$/.test(b.value) || !Number.isInteger(Number(b.token?.decimals)))) {
      throw new Error('Verified token balance unavailable')
    }
    tokens.push({
      symbol: b.token?.symbol ?? '???',
      name: b.token?.name ?? 'Unknown token',
      address: addr,
      decimals: Number(b.token?.decimals ?? 18),
      balance: units(b.value, b.token?.decimals),
      verified: Boolean(VERIFIED[addr.toLowerCase()]),
      ...(VERIFIED[addr.toLowerCase()] ? { rawBalance: b.value, rawDecimals: Number(b.token.decimals) } : {}),
    })
  }
  // make sure every verified asset is listed (even at 0)
  for (const [addr, sym] of Object.entries(VERIFIED)) {
    if (!tokens.some((t) => t.address.toLowerCase() === addr)) {
      tokens.push({ symbol: sym, name: sym, address: addr, decimals: sym === 'cirBTC' ? 8 : 6, balance: 0, verified: true, rawBalance: '0', rawDecimals: sym === 'cirBTC' ? 8 : 6 })
    }
  }

  const lower = address.toLowerCase()
  const activity = (transfers?.items ?? [])
    .filter((t) => t?.transaction_hash && t?.token)
    .map((t) => {
      const from = t.from?.hash ?? ''
      const to = t.to?.hash ?? ''
      const tokenAddr = t.token?.address_hash ?? ''
      return {
        hash: t.transaction_hash,
        logIndex: t.log_index,
        block: t.block_number,
        timestamp: t.timestamp,
        direction: from.toLowerCase() === lower ? 'out' : 'in',
        from,
        to,
        fromName: t.from?.name ?? null,
        toName: t.to?.name ?? null,
        method: t.method ?? null,
        symbol: t.token?.symbol ?? '???',
        tokenAddress: tokenAddr,
        amount: units(t.total?.value, t.total?.decimals ?? t.token?.decimals),
        verified: Boolean(VERIFIED[tokenAddr.toLowerCase()]),
      }
    })

  return { address, chainId: 5042002, observedAt: new Date().toISOString(), txCount: Number(info?.transactions_count ?? 0) || null, tokens, activity }
}

router.get('/wallet', async (req, res) => {
  const address = String(req.query.address || '')
  if (!isAddr(address)) return res.status(400).json({ error: 'Invalid address' })
  try {
    res.json(await readWallet(address))
  } catch (e) {
    console.error('arc/wallet', e?.message)
    res.status(502).json({ error: 'Could not load wallet from Arc explorer' })
  }
})

// ---- Market pulse (Alphio-style home widgets) ----
const USDC = '0x3600000000000000000000000000000000000000'
const EURC = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a'
const cache = new Map()
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.t < ttlMs) return hit.v
  const v = await fn()
  cache.set(key, { t: Date.now(), v })
  return v
}

function mapTransfer(i) {
  const addr = (i?.token?.address_hash ?? '').toLowerCase()
  return {
    hash: i?.transaction_hash,
    logIndex: i?.log_index,
    block: i?.block_number,
    timestamp: i?.timestamp,
    from: i?.from?.hash ?? null,
    to: i?.to?.hash ?? null,
    fromName: i?.from?.name ?? null,
    toName: i?.to?.name ?? null,
    fromContract: !!i?.from?.is_contract,
    toContract: !!i?.to?.is_contract,
    symbol: VERIFIED[addr] ?? i?.token?.symbol ?? '?',
    amount: units(i?.total?.value, i?.total?.decimals ?? i?.token?.decimals),
    method: i?.method ?? null,
  }
}

async function transferPages(token, pages) {
  let out = [], params = ''
  for (let p = 0; p < pages; p++) {
    const d = await explorer(`/tokens/${token}/transfers${params}`)
    if (!d?.items) break
    out = out.concat(d.items.map(mapTransfer))
    const n = d.next_page_params
    if (!n) break
    params = '?' + new URLSearchParams(Object.entries(n).map(([k, v]) => [k, String(v)])).toString()
  }
  return out
}

// GET /api/arc/feed — latest stablecoin transfers on Arc + whale transfers (>= min USD)
router.get('/feed', async (req, res) => {
  try {
    const min = Math.max(0, Number(req.query.min ?? 0))
    const data = await cached('feed', 10000, async () => {
      const [usdc, eurc] = await Promise.all([transferPages(USDC, 3), transferPages(EURC, 1)])
      return [...usdc, ...eurc].sort((a, b) => (b.block ?? 0) - (a.block ?? 0) || (b.logIndex ?? 0) - (a.logIndex ?? 0))
    })
    const whales = await cached('whales', 60000, async () => {
      const big = await transferPages(USDC, 8)
      return big
    })
    const whaleList = [...data, ...whales]
      .filter((t, i, arr) => t.amount >= min && arr.findIndex((x) => x.hash === t.hash && x.logIndex === t.logIndex) === i)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 12)
    const volume = data.reduce((s, t) => s + (t.symbol === 'USDC' || t.symbol === 'EURC' ? t.amount : 0), 0)
    res.json({ live: data.slice(0, 30), whales: whaleList, sampled: data.length, sampledVolume: volume, updatedAt: Date.now() })
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) })
  }
})

// GET /api/arc/holders — top USDC holders on Arc Testnet
router.get('/holders', async (_req, res) => {
  try {
    const data = await cached('holders', 120000, async () => {
      const [h, t] = await Promise.all([explorer(`/tokens/${USDC}/holders`), explorer(`/tokens/${USDC}`)])
      const supply = units(t?.total_supply, t?.decimals ?? 6)
      return {
        holdersCount: Number(t?.holders_count ?? 0),
        totalSupply: supply,
        items: (h?.items ?? []).slice(0, 10).map((x) => {
          const bal = units(x?.value, t?.decimals ?? 6)
          return { address: x?.address?.hash, name: x?.address?.name ?? null, contract: !!x?.address?.is_contract, balance: bal, share: supply ? (bal / supply) * 100 : 0 }
        }),
      }
    })
    res.json(data)
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) })
  }
})

// GET /api/arc/stats — chain-wide stats
router.get('/stats', async (_req, res) => {
  try {
    const s = await cached('stats', 30000, () => explorer('/stats'))
    res.json({
      totalTransactions: Number(s?.total_transactions ?? 0),
      transactionsToday: Number(s?.transactions_today ?? 0),
      totalAddresses: Number(s?.total_addresses ?? 0),
      totalBlocks: Number(s?.total_blocks ?? 0),
      utilization: Number(s?.network_utilization_percentage ?? 0),
      gas: s?.gas_prices ?? null,
    })
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) })
  }
})

module.exports = router
module.exports.readWallet = readWallet
