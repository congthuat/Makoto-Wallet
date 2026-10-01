import { formatUnits, getAddress, parseUnits, type Address } from "viem";
import { arcTestnet } from "viem/chains";
import { normalizeDecimalInput } from "./decimalInput.ts";
import { TOKENS } from "../lib/wallet.ts";

export type SupportedAssetId = "usdc" | "eurc" | "cirbtc";

export type SupportedAsset = {
  id: SupportedAssetId;
  symbol: "USDC" | "EURC" | "cirBTC";
  name: "USD Coin" | "Euro Coin" | "Circle Wrapped Bitcoin";
  address: Address;
  decimals: 6 | 8;
  chainId: typeof arcTestnet.id;
};

// Bind the migrated donor asset model to the canonical Vite registry.
export const SUPPORTED_ASSETS: readonly SupportedAsset[] = TOKENS.map((token) => ({
  id: token.sym.toLowerCase() as SupportedAssetId,
  symbol: token.sym as SupportedAsset["symbol"],
  name: token.name as SupportedAsset["name"],
  address: getAddress(token.address),
  decimals: token.decimals as SupportedAsset["decimals"],
  chainId: arcTestnet.id,
}));

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
