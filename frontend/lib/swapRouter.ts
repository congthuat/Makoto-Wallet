export type SwapRouteQuote = { provider: "xylonet" | "circle-app-kit"; output: bigint; fee: bigint; quotedAt: number; expiresAt: number; available: boolean };
export function selectSwapRoute(quotes: readonly SwapRouteQuote[], now: number): SwapRouteQuote | undefined {
  return quotes.filter((quote) => quote.available && quote.output > 0n && quote.expiresAt > now && quote.quotedAt <= now)
    .sort((a, b) => a.output === b.output ? (a.fee === b.fee ? a.provider.localeCompare(b.provider) : a.fee < b.fee ? -1 : 1) : a.output > b.output ? -1 : 1)[0];
}
