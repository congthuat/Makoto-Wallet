const fs = require('node:fs')
const path = require('node:path')

const API = 'http://localhost:3001/api/arc'
const EXPLORER = 'https://explorer.testnet.arc.io/api/v2'
const USDC = '0x3600000000000000000000000000000000000000'
const EURC = '0x89b50855aa3be2f677cd6303cec089b5f319d72a'
const read = async (url) => {
  const startedAt = new Date().toISOString()
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(url === `${API}/feed` ? 60000 : 15000) })
    return { url, startedAt, observedAt: new Date().toISOString(), status: response.status, data: await response.json() }
  } catch (error) {
    return { url, startedAt, observedAt: new Date().toISOString(), error: String(error.message) }
  }
}
const units = (value, decimals) => {
  const integer = BigInt(value)
  const base = 10n ** BigInt(decimals)
  return Number(integer / base) + Number(integer % base) / Number(base)
}
const lower = (value) => typeof value === 'string' ? value.toLowerCase() : value

async function run() {
  const [network, stats, feed, holders, rawStats, rawMetadata, rawHolders] = await Promise.all([
    read(`${API}/network`), read(`${API}/stats`), read(`${API}/feed`), read(`${API}/holders`),
    read(`${EXPLORER}/stats`), read(`${EXPLORER}/tokens/${USDC}`), read(`${EXPLORER}/tokens/${USDC}/holders`),
  ])
  const firstEurc = (feed.data?.live ?? []).find((row) => row.symbol === 'EURC')
  const sample = [...(feed.data?.live ?? []).slice(0, 3), ...(feed.data?.whales ?? []).slice(0, 3), ...(firstEurc ? [firstEurc] : [])]
    .filter((row, index, rows) => rows.findIndex((item) => item.hash === row.hash && item.logIndex === row.logIndex) === index)
  const checks = await Promise.all(sample.map(async (row) => {
    const [detail, transfers] = await Promise.all([
      read(`${EXPLORER}/transactions/${row.hash}`),
      read(`${EXPLORER}/transactions/${row.hash}/token-transfers`),
    ])
    const match = transfers.data?.items?.find((item) => item.transaction_hash === row.hash && item.log_index === row.logIndex)
    const token = lower(match?.token?.address_hash)
    const expectedSymbol = token === USDC ? 'USDC' : token === EURC ? 'EURC' : null
    const mapping = match ? {
      hash: match.transaction_hash === row.hash,
      logIndex: match.log_index === row.logIndex,
      block: match.block_number === row.block,
      // Transaction-scoped token-transfer responses omit timestamp; the same
      // real transaction detail carries its exact indexed timestamp.
      timestamp: (match.timestamp ?? detail.data?.timestamp) === row.timestamp,
      from: lower(match.from?.hash ?? null) === lower(row.from),
      to: lower(match.to?.hash ?? null) === lower(row.to),
      amount: units(match.total?.value, match.total?.decimals ?? match.token?.decimals) === row.amount,
      asset: expectedSymbol === row.symbol,
      fromContract: !!match.from?.is_contract === row.fromContract,
      toContract: !!match.to?.is_contract === row.toContract,
    } : null
    return { row, detail, transfers, mapping, matches: !!mapping && Object.values(mapping).every(Boolean) }
  }))
  const indexedHolders = rawHolders.data?.items ?? []
  const sameAddresses = (holders.data?.items ?? []).every((holder, index) => lower(holder.address) === lower(indexedHolders[index]?.address?.hash))
  const balanceChecks = (holders.data?.items ?? []).map((holder, index) => ({
    address: holder.address,
    backendBalance: holder.balance,
    rawInteger: indexedHolders[index]?.value,
    sameObservedBalance: indexedHolders[index] && units(indexedHolders[index].value, rawMetadata.data?.decimals) === holder.balance,
  }))
  const summary = {
    routeStatuses: Object.fromEntries([network, stats, feed, holders, rawStats, rawMetadata, rawHolders].map((result) => [result.url, result.status ?? result.error])),
    liveCount: feed.data?.live?.length ?? 0, largestCount: feed.data?.whales?.length ?? 0,
    liveSortedByBlockLogDescending: feed.data?.live?.every((row, index, rows) => index === 0 || row.block < rows[index - 1].block || (row.block === rows[index - 1].block && row.logIndex <= rows[index - 1].logIndex)),
    largestSortedByTokenAmountDescending: feed.data?.whales?.every((row, index, rows) => index === 0 || row.amount <= rows[index - 1].amount),
    feedDuplicates: ['live', 'whales'].map((key) => ({ key, count: (feed.data?.[key] ?? []).filter((row, index, rows) => rows.findIndex((item) => item.hash === row.hash && item.logIndex === row.logIndex) !== index).length })),
    verySmallAmounts: [...(feed.data?.live ?? []), ...(feed.data?.whales ?? [])].filter((row) => row.amount > 0 && row.amount < 0.00005),
    transferSamplesChecked: checks.length, transferSamplesMatched: checks.filter((check) => check.matches).length,
    holderCount: holders.data?.items?.length ?? 0,
    rawHoldersDescending: indexedHolders.every((holder, index, rows) => index === 0 || BigInt(holder.value) <= BigInt(rows[index - 1].value)),
    holderRankAddressesMatchRaw: sameAddresses,
    holderBalanceChecks: balanceChecks,
    metadataDecimals: rawMetadata.data?.decimals,
    circulatingSupply: rawMetadata.data?.circulating_supply,
    sourceFreshnessClaim: 'Observation times record reads only; feed/cache/explorer indexed origin freshness is not established.',
    writes: 0, paidRequests: 0,
  }
  const evidence = { observedAt: new Date().toISOString(), summary, routes: { network, stats, feed, holders }, raw: { stats: rawStats, metadata: rawMetadata, holders: rawHolders }, transferChecks: checks }
  fs.writeFileSync(path.join(__dirname, 'continuation-data-evidence.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(summary, null, 2))
}
run().catch((error) => { console.error(error); process.exitCode = 1 })
