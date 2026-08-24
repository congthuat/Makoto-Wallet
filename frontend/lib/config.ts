import { getAddress, isAddress } from "viem";
import { getAssetById } from "./assets.ts";

export const ARC_EXPLORER_URL = "https://testnet.arcscan.app";
export const EXPECTED_USDC_ADDRESS = getAssetById("usdc")!.address;
export const DEFAULT_PENGUJAR_ADDRESS = "0x2d2C30ACe5d1f057C6eC2e2E8219A43355Dd226a";
export const DEFAULT_ARC_RPC_URL = "https://rpc.testnet.arc.network";
export const arcRpcUrl = process.env.NEXT_PUBLIC_ARC_RPC_URL?.trim() || DEFAULT_ARC_RPC_URL;
export const ARC_PUBLIC_RPC_URLS = [
  arcRpcUrl,
  "https://rpc.drpc.testnet.arc.io",
  "https://rpc.blockdaemon.testnet.arc.io",
  "https://rpc.quicknode.testnet.arc.io",
] as const;
export const PENGUJAR_DEPLOYMENT_BLOCK = 56_927_475n;

const rawContractAddress =
  process.env.NEXT_PUBLIC_PENGUJAR_ADDRESS || DEFAULT_PENGUJAR_ADDRESS;

export const contractAddress = isAddress(rawContractAddress)
  ? getAddress(rawContractAddress)
  : undefined;

export const contractAddressError = contractAddress
  ? undefined
  : "NEXT_PUBLIC_PENGUJAR_ADDRESS is not a valid address.";
