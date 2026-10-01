// Shared by the current portfolio display and authoritative backend snapshots.
// Numbers intentionally retain the existing display valuation convention.
export const PORTFOLIO_ASSETS = Object.freeze([
  { symbol: 'USDC', address: '0x3600000000000000000000000000000000000000', decimals: 6, priceKey: 'USDC', providerAssetId: 'usd-coin', source: 'DIRECT_USDC' },
  { symbol: 'EURC', address: '0x89b50855aa3be2f677cd6303cec089b5f319d72a', decimals: 6, priceKey: 'EURC', providerAssetId: 'euro-coin', source: 'DIRECT_EURC' },
  { symbol: 'cirBTC', address: '0xf0c4a4ce82a5746abaad9425360ab04fbba432bf', decimals: 8, priceKey: 'BTC', providerAssetId: 'circle-wrapped-btc', source: 'DIRECT_CIRBTC' },
].map(Object.freeze))

export function valuePortfolio(tokens, prices) {
  if (!Array.isArray(tokens)) return { complete: false, totalUsd: undefined, assets: [] }
  let complete = true
  const seen = new Set()
  const assets = tokens.filter((token) => token?.verified === true).map((token) => {
    const address = typeof token.address === 'string' ? token.address.toLowerCase() : ''
    const meta = PORTFOLIO_ASSETS.find((asset) => asset.address === address)
    const balance = token.balance
    if (!meta || seen.has(address) || token.decimals !== meta.decimals || !Number.isFinite(balance) || balance < 0) complete = false
    seen.add(address)
    const observation = meta ? prices?.[meta.priceKey] : undefined
    const usdPrice = typeof observation?.price === 'number' && Number.isFinite(observation.price) && observation.price > 0 ? observation.price : undefined
    const usdValue = balance === 0 ? 0 : usdPrice === undefined ? undefined : balance * usdPrice
    if (usdValue === undefined || !Number.isFinite(usdValue) || usdValue < 0) complete = false
    return {
      symbol: meta?.symbol ?? token.symbol,
      address,
      decimals: token.decimals,
      balance,
      ...(typeof token.rawBalance === 'string' ? { rawBalance: token.rawBalance, rawDecimals: token.rawDecimals } : {}),
      ...(meta ? { priceKey: meta.priceKey } : {}),
      ...(usdPrice === undefined ? {} : { usdPrice }),
      ...(usdValue === undefined ? {} : { usdValue }),
      ...(observation ? { price: { ...observation, history: undefined } } : {}),
    }
  }).sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0))
  if (!PORTFOLIO_ASSETS.every((asset) => seen.has(asset.address))) complete = false
  const total = assets.reduce((sum, asset) => sum + (asset.usdValue ?? 0), 0)
  if (!Number.isFinite(total) || total < 0) complete = false
  return { complete, totalUsd: complete ? total : undefined, assets }
}
