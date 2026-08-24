export type SwapProvider = "xylonet" | "circle-app-kit";
export type SwapMode = "smart" | "xylonet";
export type SwapRouteQuote = { provider: SwapProvider; output: bigint; fee: bigint; quotedAt: number; expiresAt: number; available: boolean };
export type SwapRouteStatus = { provider: SwapProvider; executable: boolean; reason?: string };

export const CIRCLE_BROWSER_SWAP_STATUS: SwapRouteStatus = {
  provider: "circle-app-kit",
  executable: false,
  reason: "Circle App Kit Swap requires a secret Kit Key and cannot execute safely in this browser wallet.",
};
export function selectSwapRoute(quotes: readonly SwapRouteQuote[], now: number): SwapRouteQuote | undefined {
  return quotes.filter((quote) => quote.available && quote.output > 0n && quote.expiresAt > now && quote.quotedAt <= now)
    .sort((a, b) => a.output === b.output ? (a.fee === b.fee ? a.provider.localeCompare(b.provider) : a.fee < b.fee ? -1 : 1) : a.output > b.output ? -1 : 1)[0];
}

export function selectRouteForMode(mode: SwapMode, quotes: readonly SwapRouteQuote[], now: number) {
  return selectSwapRoute(mode === "xylonet" ? quotes.filter((quote) => quote.provider === "xylonet") : quotes, now);
}

export function swapRouteLabel(provider: SwapProvider) {
  return provider === "xylonet" ? "XyloNet StableSwap" : "Circle App Kit Swap";
}
