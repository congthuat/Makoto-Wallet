import { getAddress, type Address } from "viem";
import { arcTestnet } from "viem/chains";
import { ARC_MEMO_ADDRESS } from "./arcMemo.ts";
import { SUPPORTED_ASSETS } from "./assets.ts";
import { CCTP_TOKEN_MESSENGER_V2, CCTP_TOKEN_MINTER_V2 } from "./cctp.ts";
import { GATEWAY_MINTER, GATEWAY_WALLET } from "./circle/appKit.ts";
import { contractAddress } from "./config.ts";
import { XYLO_POOL, XYLO_ROUTER } from "./swap.ts";

export type KnownContractCategory = "token" | "makoto" | "xylo" | "circle";
export type KnownContract = { address: Address; chainId: number; label: string; category: KnownContractCategory };

const configured: Array<KnownContract | undefined> = [
  ...SUPPORTED_ASSETS.map((asset) => ({ address: asset.address, chainId: asset.chainId, label: `${asset.symbol} token`, category: "token" as const })),
  { address: XYLO_ROUTER, chainId: arcTestnet.id, label: "XyloNet Router", category: "xylo" },
  { address: XYLO_POOL, chainId: arcTestnet.id, label: "XyloNet StablePool", category: "xylo" },
  { address: ARC_MEMO_ADDRESS, chainId: arcTestnet.id, label: "Arc Transaction Memo", category: "makoto" },
  contractAddress ? { address: contractAddress, chainId: arcTestnet.id, label: "Makoto Vault", category: "makoto" } : undefined,
  { address: CCTP_TOKEN_MESSENGER_V2, chainId: arcTestnet.id, label: "Circle CCTP TokenMessenger V2", category: "circle" },
  { address: CCTP_TOKEN_MINTER_V2, chainId: arcTestnet.id, label: "Circle CCTP TokenMinter V2", category: "circle" },
  { address: getAddress(GATEWAY_WALLET), chainId: arcTestnet.id, label: "Circle Gateway Wallet", category: "circle" },
  { address: getAddress(GATEWAY_MINTER), chainId: arcTestnet.id, label: "Circle Gateway Minter", category: "circle" },
];

export const KNOWN_CONTRACTS = configured.filter((item): item is KnownContract => Boolean(item));
export function findKnownContract(address: Address | string, chainId: number) { const normalized = getAddress(address); return KNOWN_CONTRACTS.find((item) => item.chainId === chainId && item.address === normalized); }
