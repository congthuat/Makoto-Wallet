"use client";

import { useState } from "react";
import { usePreferences } from "@/hooks/usePreferences";
import { WalletPanel } from "./WalletPanel";
import { RealSwapFlow } from "./RealSwapFlow";
import { UniversalBridgeFlow } from "./UniversalBridgeFlow";

type Mode = "swap" | "bridge";

export function SwapPanel({ initialValues, initialMode = "swap", onClose, onConfirmed }: { initialValues?: { amount?: string; asset?: "usdc" | "eurc"; outputAsset?: "usdc" | "eurc"; sourceChain?: string; destinationChain?: string; recipient?: string; origin?: "agent" }; initialMode?: Mode; onClose(): void; onConfirmed?(result?: { hash: `0x${string}`; amount: bigint; asset: "usdc" | "eurc"; outputAmount: bigint; outputAsset: "usdc" | "eurc" }): void }) {
  const { locale } = usePreferences();
  const vi = locale === "vi";
  const [mode, setMode] = useState<Mode>(initialMode);
  const [busy, setBusy] = useState(false);

  return (
    <WalletPanel title={vi ? "Hoán đổi & Bridge" : "Swap & Bridge"} onClose={onClose} closeDisabled={busy}>
      <div className="modal-actions" style={{ justifyContent: "center", marginBottom: 20 }}>
        <button type="button" className={mode === "swap" ? "primary-action" : "secondary-action"} onClick={() => setMode("swap")} disabled={busy}>
          {vi ? "Hoán đổi" : "Swap"}
        </button>
        <button type="button" className={mode === "bridge" ? "primary-action" : "secondary-action"} onClick={() => setMode("bridge")} disabled={busy}>
          Bridge USDC
        </button>
      </div>
      {mode === "swap" ? <RealSwapFlow locale={locale} initialValues={initialValues} onBusyChange={setBusy} onConfirmed={onConfirmed} /> : <UniversalBridgeFlow locale={locale} initialValues={initialValues} onBusyChange={setBusy} />}
    </WalletPanel>
  );
}
