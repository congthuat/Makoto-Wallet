import { encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { arcTestnet } from "viem/chains";
import { getAssetById, type SupportedAssetId } from "./assets.ts";

export const XYLO_ROUTER = getAddress("0x73742278c31a76dBb0D2587d03ef92E6E2141023");
export const XYLO_POOL = getAddress("0x3DF3966F5138143dce7a9cFDdC2c0310ce083BB1");
export const SWAP_SLIPPAGE_OPTIONS = [0.005, 0.01, 0.03] as const;
export const SWAP_QUOTE_MAX_AGE_MS = 45_000;
export const SWAP_DEADLINE_SECONDS = 300;
export type SwapQuickPercent = 25 | 50 | 75 | 100;
export const xyloRouterAbi = [
  { type: "function", name: "getAmountOut", stateMutability: "view", inputs: [{ name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" }, { name: "amountIn", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "swap", stateMutability: "nonpayable", inputs: [{ name: "params", type: "tuple", components: [{ name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" }, { name: "amountIn", type: "uint256" }, { name: "minAmountOut", type: "uint256" }, { name: "to", type: "address" }, { name: "deadline", type: "uint256" }] }], outputs: [{ name: "amountOut", type: "uint256" }] },
] as const;
export type SwapQuote = { fromAssetId: SupportedAssetId; toAssetId: SupportedAssetId; amountIn: bigint; amountOut: bigint; chainId: typeof arcTestnet.id; router: Address; pool: Address; quotedAt: number };
export type PreparedXyloSwapRequest = Readonly<{ quote: Readonly<SwapQuote>; request: ReturnType<typeof buildXyloSwapRequest>; calldata: Hex; minimumReceive: bigint; deadline: bigint; recipient: Address }>;
export function oppositeAssetId(assetId: SupportedAssetId): SupportedAssetId { return assetId === "usdc" ? "eurc" : "usdc"; }
export function swapAmountForPercent(balance: bigint, percent: SwapQuickPercent) { const safeBalance = balance > 0n ? balance : 0n; return percent === 100 ? safeBalance : safeBalance * BigInt(percent) / 100n; }
export function isSwapQuoteFresh(quotedAt: number, now = Date.now()) { return Number.isFinite(quotedAt) && quotedAt <= now && now - quotedAt <= SWAP_QUOTE_MAX_AGE_MS; }
export function exactApprovalRequired(allowance: bigint, amountIn: bigint) { return allowance < amountIn ? amountIn : undefined; }
export function minimumSwapOutput(amountOut: bigint, slippage: (typeof SWAP_SLIPPAGE_OPTIONS)[number]) { const bps = slippage === 0.005 ? 50n : slippage === 0.01 ? 100n : 300n; return amountOut * (10_000n - bps) / 10_000n; }
export function createXyloQuote(fromAssetId: SupportedAssetId, toAssetId: SupportedAssetId, amountIn: bigint, amountOut: bigint, quotedAt = Date.now()): SwapQuote {
  if (toAssetId !== oppositeAssetId(fromAssetId) || amountIn <= 0n || amountOut <= 0n) throw new Error("Invalid XyloNet quote");
  return { fromAssetId, toAssetId, amountIn, amountOut, chainId: arcTestnet.id, router: XYLO_ROUTER, pool: XYLO_POOL, quotedAt };
}
export function buildXyloSwapRequest(quote: SwapQuote, freshAmountOut: bigint, slippage: (typeof SWAP_SLIPPAGE_OPTIONS)[number], recipient: Address, nowMs = Date.now()) {
  const from = getAssetById(quote.fromAssetId); const to = getAssetById(quote.toAssetId);
  if (!isSwapQuoteFresh(quote.quotedAt, nowMs)) throw new Error("Quote expired");
  if (!from || !to || to.id !== oppositeAssetId(from.id) || quote.chainId !== arcTestnet.id || quote.router !== XYLO_ROUTER || quote.pool !== XYLO_POOL || quote.amountIn <= 0n || freshAmountOut <= 0n) throw new Error("Quote mismatch");
  return { address: XYLO_ROUTER, abi: xyloRouterAbi, functionName: "swap" as const, args: [{ tokenIn: from.address, tokenOut: to.address, amountIn: quote.amountIn, minAmountOut: minimumSwapOutput(freshAmountOut, slippage), to: getAddress(recipient), deadline: BigInt(Math.floor(nowMs / 1000) + SWAP_DEADLINE_SECONDS) }] as const, account: getAddress(recipient), chainId: arcTestnet.id };
}
export function prepareXyloSwapRequest(quote: SwapQuote, slippage: (typeof SWAP_SLIPPAGE_OPTIONS)[number], recipient: Address, nowMs = Date.now()): PreparedXyloSwapRequest {
  const request = buildXyloSwapRequest(quote, quote.amountOut, slippage, recipient, nowMs);
  const frozenRequest = Object.freeze({ ...request, args: Object.freeze([Object.freeze({ ...request.args[0] })]) as typeof request.args });
  return Object.freeze({ quote: Object.freeze({ ...quote }), request: frozenRequest, calldata: encodeFunctionData({ abi: request.abi, functionName: request.functionName, args: request.args }), minimumReceive: request.args[0].minAmountOut, deadline: request.args[0].deadline, recipient: request.args[0].to });
}
export function validatePreparedXyloSwap(prepared: PreparedXyloSwapRequest, liveAmountOut: bigint, nowMs = Date.now()): { valid: true } | { valid: false; reason: "output-below-minimum" | "deadline-expired" } {
  if (BigInt(Math.floor(nowMs / 1000)) >= prepared.deadline) return { valid: false, reason: "deadline-expired" };
  if (liveAmountOut < prepared.minimumReceive) return { valid: false, reason: "output-below-minimum" };
  return { valid: true };
}
