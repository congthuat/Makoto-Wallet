"use client";

import type { Address } from "viem";
import { useReadContract } from "wagmi";
import { arcTestnet } from "viem/chains";
import { erc20BalanceAbi } from "@/lib/abi/erc20";
import { getAssetById } from "@/lib/assets";

export function useWalletBalances(address?: Address, enabled = false) {
  const query = {
    enabled: Boolean(address && enabled),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchInterval: false,
    retry: 1,
  } as const;
  const usdcAsset = getAssetById("usdc")!;
  const eurcAsset = getAssetById("eurc")!;
  const cirbtcAsset = getAssetById("cirbtc")!;
  const usdc = useReadContract({
    address: usdcAsset.address,
    abi: erc20BalanceAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: arcTestnet.id,
    query,
  });
  const eurc = useReadContract({
    address: eurcAsset.address,
    abi: erc20BalanceAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: arcTestnet.id,
    query,
  });
  const cirbtc = useReadContract({
    address: cirbtcAsset.address,
    abi: erc20BalanceAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: arcTestnet.id,
    query,
  });

  return { usdc, eurc, cirbtc, assets: { usdc, eurc, cirbtc } };
}
