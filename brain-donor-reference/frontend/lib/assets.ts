import { formatUnits, getAddress, parseUnits, type Address } from "viem";
import { arcTestnet } from "viem/chains";
import { normalizeDecimalInput } from "./decimalInput.ts";

export type SupportedAssetId = "usdc" | "eurc";

export type SupportedAsset = {
  id: SupportedAssetId;
  symbol: "USDC" | "EURC";
  name: "USD Coin" | "Euro Coin";
  address: Address;
  decimals: 6;
  chainId: typeof arcTestnet.id;
};

export const SUPPORTED_ASSETS: readonly SupportedAsset[] = [
  { id: "usdc", symbol: "USDC", name: "USD Coin", address: getAddress("0x3600000000000000000000000000000000000000"), decimals: 6, chainId: arcTestnet.id },
  { id: "eurc", symbol: "EURC", name: "Euro Coin", address: getAddress("0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a"), decimals: 6, chainId: arcTestnet.id },
] as const;

export function getAssetById(id: string) {
  return SUPPORTED_ASSETS.find((asset) => asset.id === id);
}

export function getAssetByAddress(address: string) {
  return SUPPORTED_ASSETS.find((asset) => asset.address.toLowerCase() === address.toLowerCase());
}

export function formatAssetAmount(amount: bigint, asset: SupportedAsset) {
  return formatUnits(amount, asset.decimals);
}

export function parseAssetAmount(value: string, asset: SupportedAsset): bigint | undefined {
  const normalized = normalizeDecimalInput(value, asset.decimals);
  if (!normalized) return undefined;
  try {
    const amount = parseUnits(normalized, asset.decimals);
    return amount > 0n ? amount : undefined;
  } catch { return undefined; }
}
