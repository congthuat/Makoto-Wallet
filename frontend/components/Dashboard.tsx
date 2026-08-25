"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAddress, isAddress, type Address } from "viem";
import { useConnection, useReadContract } from "wagmi";
import { AppHeader } from "./AppHeader";
import { CreateJarFlow } from "./CreateJarFlow";
import { JarCard } from "./JarCard";
import { StatePanel } from "./StatePanel";
import { useOwnerJars } from "@/hooks/useOwnerJars";
import { useHydrated } from "@/hooks/useHydrated";
import { useVerifiedWalletChain } from "@/hooks/useVerifiedWalletChain";
import { penguJarV3Abi } from "@/lib/abi/penguJarV3";
import { contractAddress, contractAddressError, EXPECTED_USDC_ADDRESS } from "@/lib/config";
import { formatUsdc } from "@/lib/format";
import { usePreferences } from "@/hooks/usePreferences";
import { summarizeSavingsJars } from "@/lib/savingsSummary";
import { bindAgentHandoffJar, consumeAgentHandoff, handoffUrl, storeAgentHandoff, type AgentActionHandoff } from "@/lib/agent/actions";

export function Dashboard({ initialOwner }: { initialOwner?: string }) {
  const { t, locale } = usePreferences();
  const normalizedInitialOwner = initialOwner && isAddress(initialOwner) ? getAddress(initialOwner) : undefined;
  const [input, setInput] = useState(normalizedInitialOwner ?? "");
  const [manualOwner, setManualOwner] = useState<Address | undefined>(normalizedInitialOwner);
  const [inputError, setInputError] = useState<string>();
  const [createOpen, setCreateOpen] = useState(false);
  const [vaultHandoff, setVaultHandoff] = useState<AgentActionHandoff>();
  const handoffStatusRef = useRef<HTMLDivElement>(null);
  const hydrated = useHydrated();
  const connection = useConnection();
  const verifiedChain = useVerifiedWalletChain();
  const walletConnected = hydrated && connection.isConnected;
  const isWrongNetwork = walletConnected && !verifiedChain.isArc;
  const owner = walletConnected
    ? (isWrongNetwork ? undefined : connection.address)
    : manualOwner;
  const { jars, isLoading, error, refetch } = useOwnerJars(owner);
  const refetchAfterCreate = useCallback(async () => { await refetch(); }, [refetch]);
  const usdcQuery = useReadContract({
    address: contractAddress,
    abi: penguJarV3Abi,
    functionName: "USDC",
    query: { enabled: Boolean(contractAddress) },
  });

  const totals = useMemo(() => summarizeSavingsJars(jars), [jars]);
  useEffect(() => { const id = new URLSearchParams(window.location.search).get("agentHandoff"); if (!id || !connection.address) return; const timer = window.setTimeout(() => { const handoff = consumeAgentHandoff(window.sessionStorage, id, connection.address); if (handoff && (handoff.action === "vault-deposit" || handoff.action === "vault-withdraw")) { setVaultHandoff(handoff); handoffStatusRef.current?.focus(); } window.history.replaceState({}, "", window.location.pathname); }, 0); return () => window.clearTimeout(timer); }, [connection.address]);

  function chooseAgentGoal(jarId: bigint) { if (!vaultHandoff) return; const selected = bindAgentHandoffJar({ ...vaultHandoff, path: `/jars/${jarId}` }, jarId); storeAgentHandoff(window.sessionStorage, selected); setVaultHandoff(undefined); window.location.assign(handoffUrl(selected)); }

  function submitAddress(event: FormEvent) {
    event.preventDefault();
    if (!isAddress(input.trim())) {
      setInputError(t("validation.address"));
      return;
    }
    const normalized = getAddress(input.trim());
    setManualOwner(normalized);
    setInputError(undefined);
    window.history.replaceState({}, "", `/savings?owner=${normalized}`);
  }

  const usdcMismatch = usdcQuery.data && usdcQuery.data.toLowerCase() !== EXPECTED_USDC_ADDRESS.toLowerCase();

  return (
    <main>
      <div className="shell">
        <AppHeader />
        <section className="savings-hero">
          <div className="savings-hero-copy">
            <span className="kicker">{walletConnected ? t("dashboard.connectedKicker") : t("dashboard.kicker")}</span>
            <h1>{walletConnected ? t("dashboard.connectedHero") : t("dashboard.hero")}</h1>
            <p>{walletConnected ? t("dashboard.syncedCopy") : t("dashboard.heroCopy")}</p>
          </div>
        </section>

        {walletConnected ? (
          <section className={`savings-status-card ${isWrongNetwork ? "network-warning" : ""}`} aria-labelledby="address-title">
            <div><p className="eyebrow">{isWrongNetwork ? t("dashboard.networkCheck") : t("dashboard.allSynced")}</p><h2 id="address-title">{isWrongNetwork ? t("dashboard.switchTitle") : t("savings.statusTitle")}</h2><p>{isWrongNetwork ? t("dashboard.switchCopy") : t("savings.statusCopy")}</p></div>
            <div className="connection-assurance"><span>{isWrongNetwork ? "!" : "✓"}</span><div><strong>{isWrongNetwork ? t("wallet.wrongNetwork") : t("dashboard.synced")}</strong>{isWrongNetwork && <button className="switch-button" onClick={() => void verifiedChain.switchToArc()} disabled={["waiting", "switching", "missing"].includes(verifiedChain.switchStatus)}>{verifiedChain.switchStatus === "waiting" || verifiedChain.switchStatus === "missing" ? t("wallet.waiting") : verifiedChain.switchStatus === "switching" ? t("wallet.switching") : t("wallet.switch")}</button>}{verifiedChain.switchMessage && <small>{verifiedChain.switchMessage}</small>}</div></div>
          </section>
        ) : (
          <section className="address-panel" aria-labelledby="address-title">
            <div><p className="eyebrow">{t("dashboard.find")}</p><h2 id="address-title">{t("dashboard.connectOrLook")}</h2><p>{t("dashboard.lookupCopy")}</p></div>
            <form onSubmit={submitAddress}>
              <label htmlFor="owner-address">{t("dashboard.walletAddress")}</label>
              <div className="address-controls">
                <input id="owner-address" value={input} onChange={(event) => setInput(event.target.value)} placeholder="0x…" spellCheck={false} />
                <button type="submit">{t("dashboard.viewSavings")}</button>
              </div>
              {inputError && <p className="field-error">{inputError}</p>}
            </form>
          </section>
        )}

        {owner && <section className="savings-overview" aria-label={t("dashboard.summaryLabel")}>
          <div className="savings-summary-grid">
            <article className="savings-metric primary"><span className="summary-icon lavender">◒</span><p>{t("dashboard.totalSaved")}</p><strong>{formatUsdc(totals.totalSaved)} <small>USDC</small></strong></article>
            <article className="savings-metric"><span className="summary-icon lavender">◇</span><p>{t("dashboard.totalJars")}</p><strong>{jars.length}</strong></article>
            <article className="savings-metric"><span className="summary-icon mint">⌁</span><p>{t("dashboard.activeJars")}</p><strong>{totals.active}</strong></article>
            <article className="savings-metric"><span className="summary-icon completed">✓</span><p>{t("dashboard.completedJars")}</p><strong>{totals.completed}</strong></article>
          </div>
          <button className="savings-create-cta" onClick={() => setCreateOpen(true)} disabled={!walletConnected || isWrongNetwork || !contractAddress}><span>＋</span><strong>{t("savings.createNew")}</strong><small>{!walletConnected ? t("dashboard.connectToCreate") : isWrongNetwork ? t("wallet.switch") : t("dashboard.startGoal")}</small></button>
        </section>}

        <section className="jars-section">
          {vaultHandoff && <div className="agent-goal-selection" ref={handoffStatusRef} tabIndex={-1} aria-live="polite"><p className="eyebrow">{t("savings.footerName")}</p><h2>{locale === "vi" ? "Chọn mục tiêu Vault" : "Choose Vault goal"}</h2><p>{vaultHandoff.action === "vault-deposit" ? `${vaultHandoff.amount} USDC · ${t("actions.deposit")}` : `${vaultHandoff.amount} USDC · ${t("actions.withdraw")}`}</p><div className="card-grid">{jars.filter((jar) => !jar.closed && jar.owner.toLowerCase() === connection.address?.toLowerCase()).map((jar) => <button type="button" className="agent-goal-option" key={jar.id.toString()} onClick={() => chooseAgentGoal(jar.id)}><strong>#{jar.id.toString()}</strong><span>{formatUsdc(jar.balance)} USDC</span><small>{Number(jar.privacyMode) === 1 ? "PRIVATE" : jar.name}</small></button>)}</div>{jars.filter((jar) => !jar.closed).length === 0 && <p role="alert">{t("dashboard.noJars")}</p>}</div>}
          <div className="section-heading"><div><p className="eyebrow">{t("dashboard.goals")}</p><h2>{t("dashboard.myJars")}</h2></div>{owner && <button className="refresh-button" onClick={() => void refetch()} disabled={isLoading} aria-busy={isLoading}>{isLoading ? t("common.refreshing") : t("common.refresh")}</button>}</div>
          {contractAddressError ? (
            <StatePanel icon="!" title={t("dashboard.configNeeded")}><p>{contractAddressError}</p></StatePanel>
          ) : usdcMismatch ? (
            <StatePanel icon="!" title={t("dashboard.safetyFailed")}><p>{t("validation.reverted")}</p></StatePanel>
          ) : usdcQuery.error ? (
            <StatePanel icon="↻" title={t("dashboard.arcBreak")}><p>{t("tx.rpc")}</p></StatePanel>
          ) : isWrongNetwork ? (
            <StatePanel icon="!" title={t("wallet.switch")}><p>{t("dashboard.switchCopy")}</p></StatePanel>
          ) : !owner ? (
            <StatePanel icon="⌕" title={t("dashboard.enterAddress")}><p>{t("dashboard.lookupCopy")}</p></StatePanel>
          ) : isLoading ? (
            <div className="card-grid" aria-label={t("savings.loadingJars")}><div className="skeleton-card" /><div className="skeleton-card" /></div>
          ) : error ? (
            <StatePanel icon="↻" title={t("dashboard.loadFailed")}><p>{t("dashboard.loadFailedCopy")}</p><button className="secondary-button" onClick={() => void refetch()}>{t("common.tryAgain")}</button></StatePanel>
          ) : jars.length === 0 ? (
            <StatePanel icon="✦" title={t("dashboard.noJars")}><p>{t("dashboard.noJarsCopy")}</p></StatePanel>
          ) : (
            <div className="card-grid">{jars.map((jar) => <JarCard key={jar.id.toString()} jar={jar} />)}</div>
          )}
        </section>
        <footer><span>Makoto Wallet · {t("savings.footerName")} · Arc Testnet</span><span>{t("footer.rule")}</span></footer>
        <CreateJarFlow open={createOpen} onClose={() => setCreateOpen(false)} onConfirmed={refetchAfterCreate} />
      </div>
    </main>
  );
}
