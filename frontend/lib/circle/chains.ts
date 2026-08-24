export type UnifiedEvmChain = { id: number; sdk: "Arc_Testnet" | "Base_Sepolia"; name: string; usdc: `0x${string}`; explorer: string; nativeGas: string };
export const UNIFIED_EVM_CHAINS: readonly UnifiedEvmChain[] = [
  { id: 5_042_002, sdk: "Arc_Testnet", name: "Arc Testnet", usdc: "0x3600000000000000000000000000000000000000", explorer: "https://testnet.arcscan.app", nativeGas: "USDC" },
  { id: 84_532, sdk: "Base_Sepolia", name: "Base Sepolia", usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", explorer: "https://sepolia.basescan.org", nativeGas: "ETH" },
] as const;
export const unifiedChainById = (id: number) => UNIFIED_EVM_CHAINS.find((chain) => chain.id === id);
export const unifiedChainBySdk = (sdk: string) => UNIFIED_EVM_CHAINS.find((chain) => chain.sdk === sdk);
