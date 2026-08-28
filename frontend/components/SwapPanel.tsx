"use client";

import { useState } from "react";
import { usePreferences } from "@/hooks/usePreferences";
import { WalletPanel } from "./WalletPanel";
import { RealSwapFlow } from "./RealSwapFlow";
import { UniversalBridgeFlow } from "./UniversalBridgeFlow";

type Mode = "swap" | "bridge";

export function SwapPanel({ initialValues, initialMode = "swap", onClose, onConfirmed }: { initialValues?: { amount?: string; asset?: "usdc" | "eurc"; outputAsset?: "usdc" | "eurc"; sourceChain?: string; destinationChain?: string; recipient?: string; origin?: "agent" }; initialMode?: Mode; onClose(): void; onConfirmed?(result?: { hash: `0x${string}`; amount: bigint; asset: "usdc" | "eurc"; outputAmount: bigint; outputAsset: "usdc" | "eurc" }): void }) {
  const { locale } = usePreferences();
  const [busy, setBusy] = useState(false);

  return (
    <WalletPanel title={initialMode === "bridge" ? "Bridge" : locale === "vi" ? "Hoán đổi" : "Swap"} onClose={onClose} closeDisabled={busy}>
      {initialMode === "swap" ? <RealSwapFlow locale={locale} initialValues={initialValues} onBusyChange={setBusy} onConfirmed={onConfirmed} /> : <UniversalBridgeFlow locale={locale} initialValues={initialValues} onBusyChange={setBusy} />}
    </WalletPanel>
  );
}
