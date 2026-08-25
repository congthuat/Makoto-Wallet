"use client";

import { useState } from "react";
import { usePreferences } from "@/hooks/usePreferences";
import { WalletPanel } from "./WalletPanel";
import { RealSwapFlow } from "./RealSwapFlow";
import { UniversalBridgeFlow } from "./UniversalBridgeFlow";

type Mode = "swap" | "bridge";

export function SwapPanel({ initialValues, onClose, onConfirmed }: { initialValues?: { amount?: string; asset?: "usdc" | "eurc"; outputAsset?: "usdc" | "eurc" }; onClose(): void; onConfirmed?(): void }) {
  const { locale } = usePreferences();
  const vi = locale === "vi";
  const [mode, setMode] = useState<Mode>("swap");
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
      {mode === "swap" ? <RealSwapFlow locale={locale} initialValues={initialValues} onBusyChange={setBusy} onConfirmed={onConfirmed} /> : <UniversalBridgeFlow locale={locale} onBusyChange={setBusy} />}
    </WalletPanel>
  );
}
