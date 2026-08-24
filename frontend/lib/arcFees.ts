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

export function formatArcFeeEstimate(rawFee: bigint): string {
  if (rawFee < 0n) throw new RangeError("Arc fee cannot be negative");
  const value = Number(formatUnits(rawFee, 18));
  return `~${value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")} USDC`;
}

export function arcMaximumCost(tokenAmountUsdc6: bigint, rawFee18: bigint): { amountUsdc: number; feeUsdc: number; totalUsdc: number } {
  if (tokenAmountUsdc6 < 0n || rawFee18 < 0n) throw new RangeError("Amounts cannot be negative");
  const amountUsdc = Number(formatUnits(tokenAmountUsdc6, 6));
  const feeUsdc = Number(formatUnits(rawFee18, 18));
  return { amountUsdc, feeUsdc, totalUsdc: amountUsdc + feeUsdc };
}

const ARC_NATIVE_TO_USDC_ATOMIC_SCALE = 1_000_000_000_000n;

export function arcFeeToUsdcAtomic(rawFee18: bigint): bigint {
  if (rawFee18 < 0n) throw new RangeError("Arc fee cannot be negative");
  if (rawFee18 === 0n) return 0n;
  return (rawFee18 + ARC_NATIVE_TO_USDC_ATOMIC_SCALE - 1n) / ARC_NATIVE_TO_USDC_ATOMIC_SCALE;
}

export function sendCostWithArcFee(amountUsdc6: bigint, balanceUsdc6: bigint, rawFee18: bigint) {
  if (amountUsdc6 < 0n || balanceUsdc6 < 0n) throw new RangeError("Amounts cannot be negative");
  const feeUsdc6 = arcFeeToUsdcAtomic(rawFee18);
  const totalUsdc6 = amountUsdc6 + feeUsdc6;
  return { feeUsdc6, totalUsdc6, remainingUsdc6: totalUsdc6 <= balanceUsdc6 ? balanceUsdc6 - totalUsdc6 : undefined };
}

export function maxSendAmountAfterArcFee(balanceUsdc6: bigint, rawFee18: bigint): bigint | undefined {
  const feeUsdc6 = arcFeeToUsdcAtomic(rawFee18);
  return feeUsdc6 < balanceUsdc6 ? balanceUsdc6 - feeUsdc6 : undefined;
}

export function swapCostWithArcFee(inputAmount: bigint, inputAsset: "usdc" | "eurc", usdcBalance: bigint, rawFee18: bigint) {
  if (inputAmount < 0n || usdcBalance < 0n) throw new RangeError("Amounts cannot be negative");
  const feeUsdc6 = arcFeeToUsdcAtomic(rawFee18);
  const requiredUsdc6 = feeUsdc6 + (inputAsset === "usdc" ? inputAmount : 0n);
  return { feeUsdc6, requiredUsdc6, sufficientGasBalance: requiredUsdc6 <= usdcBalance };
}

export function maxUsdcSwapAfterArcFee(balanceUsdc6: bigint, rawFee18: bigint): bigint | undefined {
  return maxSendAmountAfterArcFee(balanceUsdc6, rawFee18);
}

export function arcFeeMateriallyChanged(reviewed: bigint, current: bigint, toleranceBps = 1_000n): boolean {
  if (reviewed < 0n || current < 0n || toleranceBps < 0n) throw new RangeError("Fee values cannot be negative");
  if (reviewed === current) return false;
  if (reviewed === 0n) return current !== 0n;
  const difference = reviewed > current ? reviewed - current : current - reviewed;
  return difference * 10_000n > reviewed * toleranceBps;
}
