export type PortfolioPrice = {
  price?: number
  change24h?: number
  change7d?: number
  history?: [number, number][]
  provider?: string
  providerAssetId?: string
  source?: string
  status?: 'FRESH' | 'STALE' | 'UNAVAILABLE'
  observedAt?: string
  providerUpdatedAt?: string
  error?: string
  staleReason?: string
}
export type PortfolioToken = { symbol: string; address: string; decimals: number; balance: number; verified: boolean; rawBalance?: string; rawDecimals?: number }
export type PortfolioAssetValue = {
  symbol: string
  address: string
  decimals: number
  balance: number
  rawBalance?: string
  rawDecimals?: number
  priceKey?: string
  usdPrice?: number
  usdValue?: number
  price?: PortfolioPrice
}
export const PORTFOLIO_ASSETS: readonly { symbol: string; address: string; decimals: number; priceKey: string; providerAssetId: string; source: string }[]
export function valuePortfolio(tokens: readonly PortfolioToken[] | undefined, prices: Record<string, PortfolioPrice | undefined> | undefined): { complete: boolean; totalUsd: number | undefined; assets: PortfolioAssetValue[] }
