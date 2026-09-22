"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useConnection, usePublicClient } from "wagmi";
import { arcTestnet } from "viem/chains";

import { AppShell } from "./AppShell";
import { ConnectedOverview } from "./ConnectedOverview";
import overviewStyles from "./ConnectedOverview.module.css";
import { CreateWalletGuide } from "./CreateWalletGuide";
import { NativeWalletOnboarding } from "./NativeWalletOnboarding";
import shellStyles from "./AppShell.module.css";
import foundation from "./OverviewFoundation.module.css";
import { SendFlow } from "./SendFlow";
import { ReceivePanel } from "./ReceivePanel";
import { SwapPanel } from "./SwapPanel";
import { TransactionReceiptPanel } from "./TransactionReceiptPanel";
import { ActivityHistoryPanel } from "./ActivityHistoryPanel";
import { ActionDraftCard, EvidenceBlock } from "./MakotoAgentPage";
import { MakotoTerrain } from "./MakotoTerrain";

import { useAppLock } from "@/hooks/useAppLock";
import { useHydrated } from "@/hooks/useHydrated";
import { useOwnerJars } from "@/hooks/useOwnerJars";
import { usePreferences } from "@/hooks/usePreferences";
import { useVerifiedWalletChain } from "@/hooks/useVerifiedWalletChain";
import { useWalletActivity } from "@/hooks/useWalletActivity";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { useLocalWalletControls, useWalletReadContext } from "@/hooks/useWalletAccount";
import { useMakotoAgent } from "@/hooks/useMakotoAgent";

import { formatAssetAmount, getAssetById } from "@/lib/assets";
import { summarizeSavingsJars } from "@/lib/savingsSummary";
import type { WalletActivity } from "@/lib/wallet";
import { mergeWalletActivity, recordWalletActivity } from "@/lib/walletActivity";
import { consumeAgentHandoff, storeAgentResult, type AgentActionHandoff } from "@/lib/agent/actions";
import { canConsumeAgentHandoff, deriveFinancialDataState, deriveWalletUiState } from "@/lib/walletHydration";
import { createAgentContextSnapshot } from "@/lib/agent/context";
import { createAgentPlanningServices } from "@/lib/agent/planning";
import { createOnchainIntelligenceServices } from "@/lib/agent/intelligence/onchain";
import { rankAgentSuggestions, readSuggestionUsage, recordSuggestionUsage, suggestionStorageKey } from "@/lib/agent/suggestions";
import {
  appKitViewForPath,
  type OnboardingPath,
} from "@/lib/onboarding";
import { getAppKit, isReownConfigured } from "@/lib/wagmi";
import styles from "./MakotoWallet.module.css";
import agentStyles from "./MakotoAgentPage.module.css";

type Action = "send" | "receive" | "swap" | "bridge";

export function WalletDashboard() {
  const { locale, t } = usePreferences();

  const appLock = useAppLock();
  const hydrated = useHydrated();
  const connection = useConnection();
  const wallet = useWalletReadContext();
  const localWallet = useLocalWalletControls();
  const publicClient = usePublicClient({ chainId: arcTestnet.id });
  const agentPlanningServices = useMemo(() => createAgentPlanningServices(publicClient), [publicClient]);
  const onchainServices = useMemo(() => createOnchainIntelligenceServices(publicClient), [publicClient]);
  const chain = useVerifiedWalletChain();
  const externalWalletState = deriveWalletUiState({ hydrated, connectionStatus: connection.status, isConnected: connection.isConnected, connectorChainId: chain.connectorChainId, providerChainId: chain.providerChainId, isArc: chain.isArc });
  const walletState = wallet.kind === "local" ? (!hydrated ? "hydrating" : wallet.address ? "arc" : "disconnected") : externalWalletState;
  const onArc = walletState === "arc";

  const balances = useWalletBalances(wallet.address, onArc);
  const {
    jars,
    isLoading: jarsLoading,
    error: jarsError,
  } = useOwnerJars(onArc ? wallet.address : undefined);

  const [action, setAction] = useState<Action>();
  const [agentHandoff, setAgentHandoff] = useState<AgentActionHandoff>();
  const agentHandoffRequestId = useSearchParams().get("agentHandoff") ?? undefined;
  const [activityHistoryOpen, setActivityHistoryOpen] = useState(false);
  const activity = useWalletActivity(wallet.address, onArc, activityHistoryOpen);
  const [optimisticActivity, setOptimisticActivity] = useState<{ address: string; records: WalletActivity[] }>();
  const [receiptActivity, setReceiptActivity] = useState<WalletActivity>();
  const [activityHistoryLimit, setActivityHistoryLimit] = useState(20);
  const [createGuideOpen, setCreateGuideOpen] = useState(false);
  const dashboardState = agentHandoffRequestId && walletState === "disconnected" ? "hydrating" : walletState;
  const connected = dashboardState === "arc" || dashboardState === "wrong-network";

  const balancesSettled = !balances.usdc.isPending && !balances.eurc.isPending && !balances.cirbtc.isPending;
  useEffect(() => {
    if (!agentHandoffRequestId || wallet.status !== "connected" || !wallet.address || !canConsumeAgentHandoff(walletState, balancesSettled)) return;
    const timer = window.setTimeout(() => {
      const handoff = consumeAgentHandoff(window.sessionStorage, agentHandoffRequestId, wallet.address);
      window.history.replaceState({}, "", window.location.pathname);
      if (!handoff || !["send", "swap", "bridge"].includes(handoff.action)) return;
      if (wallet.kind === "local" && handoff.action !== "send") return;
      setAgentHandoff(handoff);
      setAction(handoff.action === "bridge" ? "bridge" : handoff.action === "swap" ? "swap" : "send");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [agentHandoffRequestId, balancesSettled, wallet.address, wallet.kind, wallet.status, walletState]);

  useEffect(() => {
    const settleDashboardFragment = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!(["assets", "activity"] as const).includes(id as "assets" | "activity")) return;
      window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
    };
    settleDashboardFragment();
    window.addEventListener("hashchange", settleDashboardFragment);
    return () => window.removeEventListener("hashchange", settleDashboardFragment);
  }, [connected]);

  const activities = useMemo(() => {
    const optimistic = optimisticActivity && wallet.address && optimisticActivity.address.toLowerCase() === wallet.address.toLowerCase()
      ? optimisticActivity.records
      : [];
    return mergeWalletActivity(activity.data, optimistic);
  }, [activity.data, wallet.address, optimisticActivity]);

  const totals = useMemo(() => summarizeSavingsJars(jars), [jars]);
  const vaultDataState = deriveFinancialDataState({ enabled: onArc, isLoading: jarsLoading, isError: Boolean(jarsError) });
  const agentSnapshot = useMemo(() => createAgentContextSnapshot({
    connected: wallet.status === "connected",
    account: wallet.address,
    walletType: wallet.providerName,
    accountKind: wallet.kind,
    walletStatus: wallet.status,
    verifiedChainId: wallet.providerChainId,
    isArc: wallet.isArc,
    balances: { usdc: balances.usdc.data, eurc: balances.eurc.data, cirbtc: balances.cirbtc.data },
    activity: activities,
    activityLoadState: activity.loadState,
    activityPartial: activity.partial,
    activityUnavailable: activity.unavailable,
    vault: { available: vaultDataState === "ready", total: vaultDataState === "ready" ? totals.totalSaved : undefined, goalCount: vaultDataState === "ready" ? jars.length : undefined, activeCount: vaultDataState === "ready" ? totals.active : undefined },
  }), [activities, activity.loadState, activity.partial, activity.unavailable, balances.cirbtc.data, balances.eurc.data, balances.usdc.data, jars.length, totals.active, totals.totalSaved, vaultDataState, wallet.address, wallet.isArc, wallet.kind, wallet.providerChainId, wallet.providerName, wallet.status]);
  const {
    input: agentInput,
    inputRef: agentInputRef,
    messages: agentMessages,
    setInput: setAgentInput,
    ask: askAgent,
    submit: submitAgent,
  } = useMakotoAgent(agentSnapshot, locale, wallet.address, agentPlanningServices, onchainServices);

  const suggestionKey = suggestionStorageKey(wallet.address, wallet.providerChainId);
  const agentSuggestions = useMemo(() => rankAgentSuggestions({
    activities,
    isArc: onArc,
    usage: typeof window === "undefined" ? {} : readSuggestionUsage(window.localStorage, suggestionKey),
  }), [activities, onArc, suggestionKey]);

  function selectAgentSuggestion(id: Parameters<typeof recordSuggestionUsage>[2], prompt: string) {
    recordSuggestionUsage(window.localStorage, suggestionKey, id);
    askAgent(prompt);
  }

  async function showMoreActivity() {
    if (activityHistoryLimit < activities.length) {
      setActivityHistoryLimit((current) => current + 20);
      return;
    }
    if (activity.hasNextPage) await activity.loadMore();
    setActivityHistoryLimit((current) => current + 20);
  }

  async function beginOnboarding(path: OnboardingPath) {
    const appKit = getAppKit();
    if (!appKit) return;
    await appKit.open({ view: appKitViewForPath(path) });
  }

  return (
    <AppShell>
        {dashboardState === "hydrating" ? (
          <section className={foundation.disconnected} role="status" aria-live="polite" aria-busy="true">
            <div className={styles.disconnectedCopy}>
              <span className={styles.kicker}>MAKOTO WALLET{" · "}ARC TESTNET</span>
              <h1>{locale === "vi" ? "Đang khôi phục kết nối ví…" : "Restoring wallet connection…"}</h1>
              <p>{locale === "vi" ? "Makoto đang xác minh tài khoản và mạng trước khi hiển thị số dư hoặc hành động đã chuẩn bị." : "Makoto is verifying the account and network before showing balances or prepared actions."}</p>
            </div>
          </section>
        ) : !connected ? (
          <>
          <section className={`${foundation.disconnected} ${locale === "vi" ? foundation.vietnamese : ""}`.trim()} aria-labelledby="landing-title">
            <div className={foundation.disconnectedCopy}>
              <span className={foundation.disconnectedKicker}>{t("walletHome.landingKicker")}</span>
              <h1 id="landing-title">{t("walletHome.landingTitle")}</h1>
              <p className={foundation.disconnectedIntro}>{t("walletHome.landingCopy")}</p>
              <p className={foundation.disconnectedFeatures} role="list" aria-label={t("walletHome.landingCapabilitiesLabel")}>
                {t("walletHome.landingCapabilities").split(" · ").map((capability) => <span role="listitem" key={capability}>{capability}</span>)}
              </p>
              <p className={foundation.disconnectedSafety}>{t("walletHome.landingSafety")}</p>
              <div className={foundation.landingActions}>
                <button
                  type="button"
                  className={foundation.primaryAction}
                  onClick={() => void beginOnboarding("existing")}
                  disabled={!isReownConfigured}
                >
                  {t("onboarding.connectExisting")}
                </button>
                <button
                  type="button"
                  onClick={() => setCreateGuideOpen(true)}
                >
                  {t("onboarding.createWallet")}
                </button>
              </div>
              <p className={foundation.landingSupport}>{!isReownConfigured ? t("onboarding.externalUnavailable") : t("walletHome.landingActionSupport")}</p>
            </div>
            <div className={foundation.disconnectedArt} aria-hidden="true"><MakotoTerrain /></div>
          </section>
          <section className={`${foundation.landingValues} ${locale === "vi" ? foundation.vietnameseValues : ""}`.trim()} aria-label={t("walletHome.landingValuesLabel")}>
            <article className={foundation.landingValue}><strong>{t("walletHome.landingNonCustodialLabel")}</strong><p>{t("walletHome.landingNonCustodialCopy")}</p></article>
            <article className={foundation.landingValue}><strong>{t("walletHome.landingArcLabel")}</strong><p>{t("walletHome.landingArcCopy")}</p></article>
            <article className={foundation.landingValue}><strong>{t("walletHome.landingBuilderLabel")}</strong><p>{t("walletHome.landingBuilderCopy")}</p></article>
          </section>
          </>
        ) : (
          <ConnectedOverview
            locale={locale}
            address={wallet.address}
            connectorName={wallet.providerName}
            chainId={wallet.providerChainId}
            onArc={onArc}
            walletKind={wallet.kind}
            walletStatus={wallet.status}
            onUnlock={() => setCreateGuideOpen(true)}
            onLock={localWallet.lock}
            appLock={{ initialized: appLock.initialized, available: appLock.available, enabled: appLock.enabled, locked: appLock.locked }}
            balances={balances.assets}
            activities={activities}
            activityLoading={activity.isLoading}
            activityPartial={activity.partial}
            activityUnavailable={activity.unavailable}
            onAction={(next) => {
              if (wallet.kind === "local" && next === "send" && wallet.status !== "connected") {
                setCreateGuideOpen(true);
                return;
              }
              setAction(next);
            }}
            onHistory={() => { setActivityHistoryLimit(20); setActivityHistoryOpen(true); }}
            onRefresh={() => void activity.refetch()}
            onReceipt={setReceiptActivity}
          >
            <div className={overviewStyles.suggestions} aria-label={t("agentDashboard.suggestionsLabel")}>
              {agentSuggestions.map((suggestion) => {
                const prompt = t(suggestion.promptKey);
                return <button type="button" key={suggestion.id} onClick={() => selectAgentSuggestion(suggestion.id, prompt)}>{prompt}</button>;
              })}
            </div>
            <div className={overviewStyles.agentBody}>
              {agentMessages.length > 0 && <div className={overviewStyles.messages} aria-live="polite">
                {agentMessages.slice(-2).map((message) => <article key={message.id}>
                  <strong>{message.role === "user" ? t("agentDashboard.you") : "Makoto Agent"}</strong>
                  <p>{message.text}</p>
                  {message.intelligence && <EvidenceBlock value={message.intelligence} locale={locale} />}
                  {message.draft && <div className={`${styles.agentDraft} ${agentStyles.chat}`}><ActionDraftCard draft={message.draft} draftContext={message.draftContext} vi={locale === "vi"} /></div>}
                </article>)}
              </div>}
              <form className={overviewStyles.composer} onSubmit={submitAgent}>
                <label htmlFor="dashboard-agent-question">{t("agentDashboard.inputLabel")}</label>
                <div><input ref={agentInputRef} id="dashboard-agent-question" name="agent-question" value={agentInput} onChange={(event) => setAgentInput(event.target.value)} placeholder={t("agentDashboard.placeholder")} autoComplete="off" /><button type="submit" disabled={!agentInput.trim()} aria-label={t("agentDashboard.sendRequest")}><span aria-hidden="true">↗</span></button></div>
              </form>
            </div>
          </ConnectedOverview>
        )}

        <footer className={shellStyles.footer}><span>{"// MAKOTO WALLET　 // ARC TESTNET"}</span><span>{locale === "vi" ? "XÂY DỰNG CHO MỘT INTERNET CỞI MỞ HƠN." : "BUILT FOR A MORE OPEN INTERNET."}</span></footer>

      {action === "send" && (
        <SendFlow
          initialValues={agentHandoff ? { amount: agentHandoff.amount, asset: agentHandoff.asset.toLowerCase() as "usdc" | "eurc", recipient: agentHandoff.recipient } : undefined}
          origin={agentHandoff?.source === "makoto-agent" ? "agent" : undefined}
          balances={{ usdc: balances.usdc.data ?? 0n, eurc: balances.eurc.data ?? 0n, cirbtc: balances.cirbtc.data ?? 0n }}
          onClose={() => setAction(undefined)}
          onConfirmed={(item) => {
            if (agentHandoff?.source === "makoto-agent" && wallet.address) storeAgentResult(window.sessionStorage, { id: `send-${Date.now()}`, account: wallet.address, action: "send", status: "confirmed", createdAt: Date.now(), amount: formatAssetAmount(item.amount, getAssetById(item.assetId)!), asset: item.assetSymbol, transactionHash: item.hash });
            if (wallet.address) setOptimisticActivity({ address: wallet.address, records: recordWalletActivity(wallet.address, arcTestnet.id, item) });
            void balances.usdc.refetch();
            void balances.eurc.refetch();
            void balances.cirbtc.refetch();
            void activity.refetch();
          }}
          onViewReceipt={(item) => { setAction(undefined); setReceiptActivity(item); }}
        />
      )}

      {action === "receive" && wallet.address && (
        <ReceivePanel
          address={wallet.address}
          onClose={() => setAction(undefined)}
        />
      )}

      {(action === "swap" || action === "bridge") && (
        <SwapPanel initialMode={action} initialValues={agentHandoff ? { amount: agentHandoff.amount, asset: agentHandoff.asset.toLowerCase() as "usdc" | "eurc", outputAsset: agentHandoff.outputAsset?.toLowerCase() as "usdc" | "eurc" | undefined, sourceChain: agentHandoff.sourceChain, destinationChain: agentHandoff.destinationChain, recipient: agentHandoff.recipient, origin: "agent" } : undefined} onClose={() => setAction(undefined)} onConfirmed={() => void activity.refetch()} />
      )}

      {receiptActivity && wallet.address && <TransactionReceiptPanel activity={receiptActivity} walletAddress={wallet.address} onClose={() => setReceiptActivity(undefined)} />}
      {activityHistoryOpen && <ActivityHistoryPanel
        activities={activities}
        locale={locale}
        limit={activityHistoryLimit}
        loading={activity.isLoading}
        loadingMore={activity.isLoadingMore}
        partial={activity.partial}
        unavailable={activity.unavailable}
        canLoadMore={activityHistoryLimit < activities.length || Boolean(activity.hasNextPage)}
        onClose={() => setActivityHistoryOpen(false)}
        onLoadMore={() => void showMoreActivity()}
        onRefresh={() => void activity.refetch()}
        onReceipt={(item) => setReceiptActivity(item)}
      />}
      {createGuideOpen && <CreateWalletGuide onClose={() => setCreateGuideOpen(false)}>
        {(dismiss) => <NativeWalletOnboarding onClose={dismiss} />}
      </CreateWalletGuide>}
    </AppShell>
  );
}
