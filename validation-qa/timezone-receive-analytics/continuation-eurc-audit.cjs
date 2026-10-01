const fs = require('node:fs')
const path = require('node:path')
const record = JSON.parse(fs.readFileSync(path.join(__dirname, 'continuation-data-evidence.json'), 'utf8'))
const row = record.routes.feed.data.live.find((item) => item.symbol === 'EURC')
const read = async (url) => {
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) })
  return { url, status: response.status, observedAt: new Date().toISOString(), data: await response.json() }
}
const units = (value, decimals) => {
  const integer = BigInt(value), base = 10n ** BigInt(decimals)
  return Number(integer / base) + Number(integer % base) / Number(base)
}
async function run() {
  const base = `https://explorer.testnet.arc.io/api/v2/transactions/${row.hash}`
  const [detail, transfers] = await Promise.all([read(base), read(`${base}/token-transfers`)])
  const item = transfers.data.items.find((item) => item.transaction_hash === row.hash && item.log_index === row.logIndex)
  const mapping = {
    hash: item.transaction_hash === row.hash,
    logIndex: item.log_index === row.logIndex,
    block: item.block_number === row.block,
    timestamp: (item.timestamp ?? detail.data.timestamp) === row.timestamp,
    from: item.from.hash.toLowerCase() === row.from.toLowerCase(),
    to: item.to.hash.toLowerCase() === row.to.toLowerCase(),
    asset: item.token.address_hash.toLowerCase() === '0x89b50855aa3be2f677cd6303cec089b5f319d72a' && item.token.symbol === row.symbol,
    amount: units(item.total.value, item.total.decimals ?? item.token.decimals) === row.amount,
    fromContract: !!item.from.is_contract === row.fromContract,
    toContract: !!item.to.is_contract === row.toContract,
  }
  const result = { observedAt: new Date().toISOString(), originalFeedObservedAt: record.routes.feed.observedAt, row, detail, transfers, mapping, matches: Object.values(mapping).every(Boolean), writes: 0, paidRequests: 0 }
  fs.writeFileSync(path.join(__dirname, 'continuation-eurc-evidence.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ mapping, matches: result.matches, row }, null, 2))
}
run().catch((error) => { console.error(error); process.exitCode = 1 })
