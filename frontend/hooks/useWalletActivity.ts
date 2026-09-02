"use client";

import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { arcTestnet } from "viem/chains";

import { deserializeWalletActivityPage, normalizeWalletActivities } from "@/lib/onchainActivity";
import { deriveActivityLoadState } from "@/lib/activityLoadState";
import { loadWalletActivity, mergeWalletActivity, WALLET_ACTIVITY_UPDATED_EVENT } from "@/lib/walletActivity";

export function useWalletActivity(address?: Address, enabled = false, panelOpen = false) {
  const [localRevision, setLocalRevision] = useState(0);
  const query = useInfiniteQuery({
    queryKey: ["wallet-activity", arcTestnet.id, address?.toLowerCase()],
    enabled: Boolean(address && enabled),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      if (!address) throw new Error("Wallet address is required");
      const params = new URLSearchParams({ address });
      if (pageParam) params.set("cursor", pageParam);
      const response = await fetch(`/api/wallet-activity?${params}`, { cache: "no-store", signal });
      if (!response.ok) throw new Error("Activity could not be loaded");
      return deserializeWalletActivityPage(await response.json());
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 15_000,
    refetchInterval: panelOpen ? 25_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const refetch = query.refetch;
  useEffect(() => {
    if (!address) return;
    const normalized = address.toLowerCase();
    const handleUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ address?: string; chainId?: number }>).detail;
      if (detail?.address === normalized && detail.chainId === arcTestnet.id) {
        setLocalRevision((value) => value + 1);
        void refetch();
      }
    };
    window.addEventListener(WALLET_ACTIVITY_UPDATED_EVENT, handleUpdate);
    return () => window.removeEventListener(WALLET_ACTIVITY_UPDATED_EVENT, handleUpdate);
  }, [address, refetch]);

  const data = useMemo(() => {
    void localRevision;
    const onchain = normalizeWalletActivities(query.data?.pages.flatMap((page) => page.activities) ?? [], 250);
    const local = address ? loadWalletActivity(address, arcTestnet.id) : [];
    return mergeWalletActivity(onchain, local);
  }, [address, localRevision, query.data]);
  const loadState = deriveActivityLoadState({
    hasSuccessfulLoad: query.data !== undefined,
    requestFailed: query.isError,
    pagePartial: Boolean(query.data?.pages.some((page) => page.partial)),
  });

  useEffect(() => {
    if (!panelOpen) return;
    void refetch();
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") void refetch(); };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => document.removeEventListener("visibilitychange", refreshWhenVisible);
  }, [panelOpen, address, refetch]);

  return {
    data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    partial: loadState.partial,
    unavailable: loadState.unavailable,
    loadState: loadState.status,
    refetch,
    hasNextPage: query.hasNextPage,
    loadMore: query.fetchNextPage,
    isLoadingMore: query.isFetchingNextPage,
  };
}
