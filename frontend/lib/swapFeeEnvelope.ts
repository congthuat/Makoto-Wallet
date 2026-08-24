import { arcFeeToUsdcAtomic } from "./arcFees.ts";

export const PUBLIC_GAS_HEADROOM_BPS = 11_000n;
export type SwapFeeEnvelope = { gasLimit: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas?: bigint; rawMaxFee18: bigint; feeUsdc6: bigint; preparedAt: number; walletEstimateUsed: boolean };

export function selectSwapGasLimit(publicRpcGas: bigint, walletProviderGas?: bigint) {
  if (publicRpcGas <= 0n) throw new RangeError("Public gas estimate must be positive");
  if (walletProviderGas !== undefined && walletProviderGas > 0n) return { gasLimit: walletProviderGas > publicRpcGas ? walletProviderGas : publicRpcGas, walletEstimateUsed: true };
  return { gasLimit: (publicRpcGas * PUBLIC_GAS_HEADROOM_BPS + 9_999n) / 10_000n, walletEstimateUsed: false };
}

export function createSwapFeeEnvelope(publicRpcGas: bigint, walletProviderGas: bigint | undefined, maxFeePerGas: bigint, maxPriorityFeePerGas?: bigint, preparedAt = Date.now()): SwapFeeEnvelope {
  if (maxFeePerGas <= 0n) throw new RangeError("Maximum fee per gas must be positive");
  const selected = selectSwapGasLimit(publicRpcGas, walletProviderGas);
  const rawMaxFee18 = selected.gasLimit * maxFeePerGas;
  return { ...selected, maxFeePerGas, maxPriorityFeePerGas, rawMaxFee18, feeUsdc6: arcFeeToUsdcAtomic(rawMaxFee18), preparedAt };
}
