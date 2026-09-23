"use client";

import { useState } from "react";
import { usePreferences } from "@/hooks/usePreferences";
import { useWalletReadContext } from "@/hooks/useWalletAccount";
import { WalletPanel } from "./WalletPanel";
import { RealSwapFlow } from "./RealSwapFlow";
import { UniversalBridgeFlow } from "./UniversalBridgeFlow";
import { CctpBridgeFlow } from "./CctpBridgeFlow";
import "./SwapBridge.css";

type Mode = "swap" | "bridge";

export function SwapPanel({ initialValues, initialMode = "swap", onClose, onConfirmed }: { initialValues?: { amount?: string; asset?: "usdc" | "eurc"; outputAsset?: "usdc" | "eurc"; sourceChain?: string; destinationChain?: string; recipient?: string; origin?: "agent" }; initialMode?: Mode; onClose(): void; onConfirmed?(result?: { hash: `0x${string}`; amount: bigint; asset: "usdc" | "eurc"; outputAmount: bigint; outputAsset: "usdc" | "eurc" }): void }) {
  const { locale } = usePreferences();
  const wallet = useWalletReadContext();
  const [busy, setBusy] = useState(false);

  return (
    <WalletPanel title={initialMode === "bridge" ? "Bridge" : locale === "vi" ? "Hoán đổi" : "Swap"} onClose={onClose} closeDisabled={busy}>
      <div className="ledger-exchange">
        {initialMode === "swap" ? <RealSwapFlow locale={locale} initialValues={initialValues} onBusyChange={setBusy} onConfirmed={onConfirmed} /> : wallet.kind === "local" ? <CctpBridgeFlow locale={locale} onBusyChange={setBusy} /> : <UniversalBridgeFlow locale={locale} initialValues={initialValues} onBusyChange={setBusy} />}
      </div>
    </WalletPanel>
  );
}
