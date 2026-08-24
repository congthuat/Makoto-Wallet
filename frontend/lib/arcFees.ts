import { formatUnits } from "viem";

export type ArcFeeEstimate = {
  gas: bigint;
  maxFeePerGas: bigint;
  rawFee: bigint;
};

export function calculateArcFee(gas: bigint, maxFeePerGas: bigint): ArcFeeEstimate {
  if (gas < 0n || maxFeePerGas < 0n) throw new RangeError("Arc gas values cannot be negative");
  return { gas, maxFeePerGas, rawFee: gas * maxFeePerGas };
}

export function formatArcFee(rawFee: bigint, options: { maximum?: boolean } = {}): string {
  if (rawFee < 0n) throw new RangeError("Arc fee cannot be negative");
  if (rawFee > 0n && rawFee < 10_000_000_000_000_000n) return "< $0.01 USDC";
  const value = Number(formatUnits(rawFee, 18));
  return `${options.maximum ? "≤" : "~"}$${value.toFixed(2)} USDC`;
}

export function arcMaximumCost(tokenAmountUsdc6: bigint, rawFee18: bigint): { amountUsdc: number; feeUsdc: number; totalUsdc: number } {
  if (tokenAmountUsdc6 < 0n || rawFee18 < 0n) throw new RangeError("Amounts cannot be negative");
  const amountUsdc = Number(formatUnits(tokenAmountUsdc6, 6));
  const feeUsdc = Number(formatUnits(rawFee18, 18));
  return { amountUsdc, feeUsdc, totalUsdc: amountUsdc + feeUsdc };
}
