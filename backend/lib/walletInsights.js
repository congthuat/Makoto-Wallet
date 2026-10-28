// Read-only wallet insights: value change (PnL) over a period, allocation and
// concentration, plus the daily briefing (wallet + market + news).
//
// PnL method (no stored history needed, works for any public address):
//   balance_then  = balance_now − net transfers in since the start of the period
//   value change  = value_now − value_then
//                 = price effect (balance_then × (price_now − price_then))
//                 + net deposits/withdrawals (net transfers × price_now)
// Arc explorer pages are bounded; when the history is cut off the result is marked APPROXIMATE.
const reads = require('./taskReads')
const market = require('./marketData')

const DAY = 86_400_000
const PERIOD_DAYS = { '1d': 1, '7d': 7, '30d': 30 }
const STABLE = new Set(['USDC', 'EURC'])
const r = (value, digits = 2) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : null)
const priceSymbol = (asset) => (asset === 'cirBTC' ? 'BTC' : asset)

/** Allocation by USD value and plain-language concentration flags. */
function concentration(allocation) {
  const warnings = []
  const top = allocation[0]
  // USDC is the dollar itself; a large EURC share is euro exchange-rate exposure, not crypto risk.
  if (top && top.weight_pct >= 70 && top.asset !== 'USDC') warnings.push({ level: top.asset === 'EURC' ? 'LOW' : top.weight_pct >= 90 ? 'HIGH' : 'MEDIUM', code: top.asset === 'EURC' ? 'EUR_FX_EXPOSURE' : 'SINGLE_ASSET', asset: top.asset, weight_pct: top.weight_pct })
  const volatile = allocation.filter((item) => !STABLE.has(item.asset)).reduce((sum, item) => sum + item.weight_pct, 0)
  if (volatile >= 50) warnings.push({ level: volatile >= 80 ? 'HIGH' : 'MEDIUM', code: 'VOLATILE_SHARE', weight_pct: r(volatile) })
  const stable = 100 - volatile
  if (allocation.length && stable >= 95) warnings.push({ level: 'INFO', code: 'MOSTLY_STABLECOINS', weight_pct: r(stable) })
  return warnings
}

async function walletPnl(address, period = '7d', deps = {}) {
  const { readBalances = reads.readBalances, readActivity = reads.readActivity, latestPrice = market.latestPrice, priceAt = market.priceAt, now = Date.now() } = deps
  const days = PERIOD_DAYS[period] || 7
  const start = now - days * DAY
  const since = new Date(start).toISOString()
  const [balancesResult, activityResult] = await Promise.allSettled([readBalances(address), readActivity(address, since)])
  if (balancesResult.status !== 'fulfilled' || !Object.keys(balancesResult.value?.balances || {}).length) throw new Error('Wallet balances unavailable')
  const balances = balancesResult.value.balances
  const activity = activityResult.status === 'fulfilled' ? activityResult.value : null
  const netIn = {}
  for (const item of activity?.items || []) {
    const amount = Number(item.amount)
    if (!Number.isFinite(amount)) continue
    netIn[item.asset] = (netIn[item.asset] || 0) + (item.direction === 'in' ? amount : -amount)
  }
  const assets = Object.keys(balances)
  const priced = await Promise.all(assets.map(async (asset) => {
    const symbol = priceSymbol(asset)
    const [nowPrice, thenPrice] = await Promise.allSettled([latestPrice(symbol), priceAt(symbol, start)])
    return [asset, nowPrice.status === 'fulfilled' ? nowPrice.value.usd : null, thenPrice.status === 'fulfilled' ? thenPrice.value.usd : null]
  }))
  const rows = []
  let valueNow = 0, valueThen = 0, priceEffect = 0, netFlow = 0, complete = true
  for (const [asset, pNow, pThen] of priced) {
    const balanceNow = Number(balances[asset].amount)
    const flow = netIn[asset] || 0
    const balanceThen = Math.max(0, balanceNow - flow)
    if (!(pNow > 0) || !(pThen > 0)) { complete = false; rows.push({ asset, balance_now: r(balanceNow, 8), price: 'unavailable' }); continue }
    const row = {
      asset, balance_now: r(balanceNow, 8), balance_then: r(balanceThen, 8),
      price_now_usd: r(pNow, 6), price_then_usd: r(pThen, 6), price_change_pct: r(((pNow - pThen) / pThen) * 100),
      value_now_usd: r(balanceNow * pNow), value_then_usd: r(balanceThen * pThen),
      price_effect_usd: r(balanceThen * (pNow - pThen)), net_transfers: r(flow, 8), net_transfers_usd: r(flow * pNow),
    }
    rows.push(row)
    valueNow += balanceNow * pNow; valueThen += balanceThen * pThen; priceEffect += row.price_effect_usd; netFlow += flow * pNow
  }
  const allocation = rows.filter((row) => row.value_now_usd > 0).map((row) => ({ asset: row.asset, value_usd: row.value_now_usd, weight_pct: valueNow > 0 ? r((row.value_now_usd / valueNow) * 100) : 0 })).sort((a, b) => b.value_usd - a.value_usd)
  const approximate = !activity || activity.hasMore || !complete
  return {
    status: approximate ? 'APPROXIMATE' : 'OK', chain: 'Arc Testnet', period, from: since, to: new Date(now).toISOString(),
    value_now_usd: r(valueNow), value_then_usd: r(valueThen), value_change_usd: r(valueNow - valueThen),
    value_change_pct: valueThen > 0 ? r(((valueNow - valueThen) / valueThen) * 100) : null,
    price_effect_usd: r(priceEffect), price_effect_pct: valueThen > 0 ? r((priceEffect / valueThen) * 100) : null,
    net_deposits_usd: r(netFlow), transfers_counted: activity?.items?.length ?? null,
    assets: rows, allocation, concentration_warnings: concentration(allocation),
    notes: [
      'price_effect_usd is profit/loss from price moves on what the wallet held at the start; net_deposits_usd is money moved in (+) or out (−), which is not profit.',
      ...(!activity ? ['Arc explorer history was unavailable, so balance_then assumes no transfers.'] : activity.hasMore ? ['The period has more transfers than one read covers; figures are approximate.'] : []),
      ...(!complete ? ['Some assets have no price, so totals exclude them.'] : []),
      'Testnet assets have no real-world value; USD uses reference prices of the real assets.',
    ],
  }
}

/** Daily briefing: majors, sentiment, top headlines and (when an address is given) the wallet's 24h change. */
async function dailyBriefing(address, deps = {}) {
  const { majorsSnapshot = market.majorsSnapshot, fearGreed = market.fearGreed, news = market.news, pnl = walletPnl } = deps
  const [majors, sentiment, headlines, wallet] = await Promise.allSettled([
    majorsSnapshot(['BTC', 'ETH', 'SOL']),
    fearGreed(2),
    news({ limit: 8, preferFeeds: true }),
    address ? pnl(address, '1d', deps) : Promise.resolve(null),
  ])
  const items = headlines.status === 'fulfilled' ? (headlines.value?.articles || []).filter((item) => item?.title).sort((a, b) => (b.published_at ?? 0) - (a.published_at ?? 0)) : []
  const fg = sentiment.status === 'fulfilled' ? sentiment.value?.rows || [] : []
  const result = {
    status: 'OK', observedAt: new Date().toISOString(), news_source: headlines.status === 'fulfilled' ? headlines.value?.source || null : null,
    market: majors.status === 'fulfilled' ? majors.value.rows : 'unavailable',
    market_source: majors.status === 'fulfilled' ? majors.value.source : null,
    fear_greed: fg.length ? { value: fg[0].value, classification: fg[0].classification, previous: fg[1]?.value ?? null } : 'unavailable',
    headlines: items.slice(0, 5).map((item) => ({ title: String(item.title || '').slice(0, 160), source: item.source || null, published_at: Number.isFinite(item.published_at) ? new Date(item.published_at * 1000).toISOString() : null })).filter((item) => item.title),
    wallet: address ? (wallet.status === 'fulfilled' && wallet.value ? {
      value_now_usd: wallet.value.value_now_usd, change_24h_usd: wallet.value.value_change_usd, change_24h_pct: wallet.value.value_change_pct,
      price_effect_usd: wallet.value.price_effect_usd, net_deposits_usd: wallet.value.net_deposits_usd,
      allocation: wallet.value.allocation, concentration_warnings: wallet.value.concentration_warnings, approximate: wallet.value.status !== 'OK',
    } : 'unavailable') : 'no wallet connected',
  }
  if (result.market === 'unavailable' && result.fear_greed === 'unavailable' && !result.headlines.length && (!address || result.wallet === 'unavailable')) throw new Error('Briefing data unavailable')
  return result
}

module.exports = { walletPnl, dailyBriefing, concentration, PERIOD_DAYS }
