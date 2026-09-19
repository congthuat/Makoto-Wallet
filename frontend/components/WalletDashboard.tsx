"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useConnection, usePublicClient } from "wagmi";
import { zeroAddress } from "viem";
import { arcTestnet } from "viem/chains";

import { AppShell } from "./AppShell";
import { ConnectedOverview } from "./ConnectedOverview";
import overviewStyles from "./ConnectedOverview.module.css";
import { CreateWalletGuide } from "./CreateWalletGuide";
import shellStyles from "./AppShell.module.css";
import foundation from "./OverviewFoundation.module.css";
import { SendFlow } from "./SendFlow";
import { ReceivePanel } from "./ReceivePanel";
import { SwapPanel } from "./SwapPanel";
import { TransactionReceiptPanel } from "./TransactionReceiptPanel";
import { ActivityHistoryPanel } from "./ActivityHistoryPanel";
import { ActionDraftCard, EvidenceBlock } from "./MakotoAgentPage";

import { useHydrated } from "@/hooks/useHydrated";
import { useOwnerJars } from "@/hooks/useOwnerJars";
import { usePreferences } from "@/hooks/usePreferences";
import { useVerifiedWalletChain } from "@/hooks/useVerifiedWalletChain";
import { useWalletActivity } from "@/hooks/useWalletActivity";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { useMakotoAgent } from "@/hooks/useMakotoAgent";

import { formatAssetAmount, getAssetById } from "@/lib/assets";
import { formatUsdc, shortAddress } from "@/lib/format";
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
  appKitViewForCreateMethod,
  ONBOARDING_INTENT_KEY,
  parseOnboardingIntent,
  shouldShowWalletReady,
  type CreateWalletMethod,
  type OnboardingPath,
} from "@/lib/onboarding";
import { getAppKit, isReownConfigured } from "@/lib/wagmi";
import styles from "./MakotoWallet.module.css";
import agentStyles from "./MakotoAgentPage.module.css";

type Action = "send" | "receive" | "swap" | "bridge";

export function WalletDashboard() {
  const { locale, t } = usePreferences();

  const hydrated = useHydrated();
  const connection = useConnection();
  const publicClient = usePublicClient({ chainId: arcTestnet.id });
  const agentPlanningServices = useMemo(() => createAgentPlanningServices(publicClient), [publicClient]);
  const onchainServices = useMemo(() => createOnchainIntelligenceServices(publicClient), [publicClient]);
  const chain = useVerifiedWalletChain();
  const walletState = deriveWalletUiState({ hydrated, connectionStatus: connection.status, isConnected: connection.isConnected, connectorChainId: chain.connectorChainId, providerChainId: chain.providerChainId, isArc: chain.isArc });
  const onArc = walletState === "arc";

  const balances = useWalletBalances(connection.address, onArc);
  const {
    jars,
    isLoading: jarsLoading,
    error: jarsError,
  } = useOwnerJars(onArc ? connection.address : undefined);

  const [action, setAction] = useState<Action>();
  const [agentHandoff, setAgentHandoff] = useState<AgentActionHandoff>();
  const agentHandoffRequestId = useSearchParams().get("agentHandoff") ?? undefined;
  const [activityHistoryOpen, setActivityHistoryOpen] = useState(false);
  const activity = useWalletActivity(connection.address, onArc, activityHistoryOpen);
  const [optimisticActivity, setOptimisticActivity] = useState<{ address: string; records: WalletActivity[] }>();
  const [receiptActivity, setReceiptActivity] = useState<WalletActivity>();
  const [activityHistoryLimit, setActivityHistoryLimit] = useState(20);
  const [createGuideOpen, setCreateGuideOpen] = useState(false);
  const [onboardingIntent, setOnboardingIntent] = useState<OnboardingPath | undefined>(() =>
    typeof window === "undefined" ? undefined : parseOnboardingIntent(window.sessionStorage.getItem(ONBOARDING_INTENT_KEY)),
  );
  const dashboardState = agentHandoffRequestId && walletState === "disconnected" ? "hydrating" : walletState;
  const connected = dashboardState === "arc" || dashboardState === "wrong-network";

  const balancesSettled = !balances.usdc.isPending && !balances.eurc.isPending;
  useEffect(() => {
    if (!agentHandoffRequestId || !connection.address || !canConsumeAgentHandoff(walletState, balancesSettled)) return;
    const timer = window.setTimeout(() => {
      const handoff = consumeAgentHandoff(window.sessionStorage, agentHandoffRequestId, connection.address);
      window.history.replaceState({}, "", window.location.pathname);
      if (!handoff || !["send", "swap", "bridge"].includes(handoff.action)) return;
      setAgentHandoff(handoff);
      setAction(handoff.action === "bridge" ? "bridge" : handoff.action === "swap" ? "swap" : "send");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [agentHandoffRequestId, balancesSettled, connection.address, walletState]);

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
    const optimistic = optimisticActivity && connection.address && optimisticActivity.address.toLowerCase() === connection.address.toLowerCase()
      ? optimisticActivity.records
      : [];
    return mergeWalletActivity(activity.data, optimistic);
  }, [activity.data, connection.address, optimisticActivity]);

  const totals = useMemo(() => summarizeSavingsJars(jars), [jars]);
  const vaultDataState = deriveFinancialDataState({ enabled: onArc, isLoading: jarsLoading, isError: Boolean(jarsError) });
  const agentSnapshot = useMemo(() => createAgentContextSnapshot({
    connected: connection.isConnected,
    account: connection.address,
    walletType: connection.connector?.name,
    verifiedChainId: chain.providerChainId,
    isArc: chain.isArc,
    balances: { usdc: balances.usdc.data, eurc: balances.eurc.data },
    activity: activities,
    activityLoadState: activity.loadState,
    activityPartial: activity.partial,
    activityUnavailable: activity.unavailable,
    vault: { available: vaultDataState === "ready", total: vaultDataState === "ready" ? totals.totalSaved : undefined, goalCount: vaultDataState === "ready" ? jars.length : undefined, activeCount: vaultDataState === "ready" ? totals.active : undefined },
  }), [activities, activity.loadState, activity.partial, activity.unavailable, balances.eurc.data, balances.usdc.data, chain.isArc, chain.providerChainId, connection.address, connection.connector?.name, connection.isConnected, jars.length, totals.active, totals.totalSaved, vaultDataState]);
  const {
    input: agentInput,
    inputRef: agentInputRef,
    messages: agentMessages,
    setInput: setAgentInput,
    ask: askAgent,
    submit: submitAgent,
  } = useMakotoAgent(agentSnapshot, locale, connection.address, agentPlanningServices, onchainServices);

  const suggestionKey = suggestionStorageKey(connection.address, chain.providerChainId);
  const agentSuggestions = useMemo(() => rankAgentSuggestions({
    activities,
    isArc: onArc,
    usage: typeof window === "undefined" ? {} : readSuggestionUsage(window.localStorage, suggestionKey),
  }), [activities, onArc, suggestionKey]);

  function selectAgentSuggestion(id: Parameters<typeof recordSuggestionUsage>[2], prompt: string) {
    recordSuggestionUsage(window.localStorage, suggestionKey, id);
    askAgent(prompt);
  }

  const guardianSetupJar = jars.find((jar) => !jar.closed && Number(jar.mode) === 1 && jar.guardian === zeroAddress);

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
    window.sessionStorage.setItem(ONBOARDING_INTENT_KEY, path);
    setOnboardingIntent(path);
    await appKit.open({ view: appKitViewForPath(path) });
  }

  async function beginCreateWallet(method: CreateWalletMethod) {
    const appKit = getAppKit();
    if (!appKit) return;
    window.sessionStorage.setItem(ONBOARDING_INTENT_KEY, "create");
    setOnboardingIntent("create");
    setCreateGuideOpen(false);
    await appKit.open({ view: appKitViewForCreateMethod(method) });
  }

  function continueToWallet() {
    window.sessionStorage.removeItem(ONBOARDING_INTENT_KEY);
    setOnboardingIntent(undefined);
  }

  const usdcBalance =
    balances.usdc.data === undefined ? "—" : formatUsdc(balances.usdc.data);
  const showWalletReady = shouldShowWalletReady(onboardingIntent, onArc, connection.connector?.id);

  return (
    <AppShell guardianSetupJarId={guardianSetupJar?.id}>
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
          <section className={foundation.disconnected}>
            <div>
              <h1>{t("walletHome.connectTitle")}</h1>
              <p>{t("walletHome.connectCopy")}</p>
              <section className={foundation.onboarding} aria-labelledby="onboarding-title">
                <h2 id="onboarding-title">{t("onboarding.title")}</h2>
                <button
                  type="button"
                  className={foundation.create}
                  onClick={() => setCreateGuideOpen(true)}
                  disabled={!isReownConfigured}
                >
                  <strong>{t("onboarding.createWallet")}</strong>
                  <span>{t("onboarding.createHelp")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void beginOnboarding("existing")}
                  disabled={!isReownConfigured}
                >
                  <strong>{t("onboarding.connectExisting")}</strong>
                  <span>{t("onboarding.connectHelp")}</span>
                </button>
                <p>{t("onboarding.noPrivateKeyStorage")}</p>
                {!isReownConfigured && <p role="status">{t("onboarding.unavailable")}</p>}
              </section>
            </div>
          </section>
          </>
        ) : showWalletReady && connection.address ? (
          <section className={styles.walletReady} aria-labelledby="wallet-ready-title">
            <span className={styles.kicker}>MAKOTO WALLET{" · "}ARC TESTNET</span>
            <div className={styles.walletReadyBadge}>Arc Testnet</div>
            <h1 id="wallet-ready-title">{t("onboarding.walletReady")}</h1>
            <p>{t("onboarding.walletReadyCopy")}</p>
            <dl>
              <div><dt>{t("onboarding.walletAddress")}</dt><dd>{shortAddress(connection.address)}</dd></div>
              <div><dt>{t("wallet.network")}</dt><dd>Arc Testnet · 5042002</dd></div>
              <div><dt>{t("wallet.usdcBalance")}</dt><dd>{usdcBalance} USDC</dd></div>
            </dl>
            <p className={styles.walletReadySafety}>{t("onboarding.noPrivateKeyStorage")}</p>
            <button type="button" onClick={continueToWallet}>{t("onboarding.continue")}</button>
          </section>
        ) : (
          <ConnectedOverview
            locale={locale}
            address={connection.address}
            connectorName={connection.connector?.name}
            chainId={chain.providerChainId}
            onArc={onArc}
            balances={balances.assets}
            activities={activities}
            activityLoading={activity.isLoading}
            activityPartial={activity.partial}
            activityUnavailable={activity.unavailable}
            onAction={setAction}
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

        <footer className={shellStyles.footer}>Makoto Wallet</footer>

      {action === "send" && (
        <SendFlow
          initialValues={agentHandoff ? { amount: agentHandoff.amount, asset: agentHandoff.asset.toLowerCase() as "usdc" | "eurc", recipient: agentHandoff.recipient } : undefined}
          origin={agentHandoff?.source === "makoto-agent" ? "agent" : undefined}
          balances={{ usdc: balances.usdc.data ?? 0n, eurc: balances.eurc.data ?? 0n }}
          onClose={() => setAction(undefined)}
          onConfirmed={(item) => {
            if (agentHandoff?.source === "makoto-agent" && connection.address) storeAgentResult(window.sessionStorage, { id: `send-${Date.now()}`, account: connection.address, action: "send", status: "confirmed", createdAt: Date.now(), amount: formatAssetAmount(item.amount, getAssetById(item.assetId)!), asset: item.assetSymbol, transactionHash: item.hash });
            if (connection.address) setOptimisticActivity({ address: connection.address, records: recordWalletActivity(connection.address, arcTestnet.id, item) });
            void balances.usdc.refetch();
            void balances.eurc.refetch();
            void activity.refetch();
          }}
          onViewReceipt={(item) => { setAction(undefined); setReceiptActivity(item); }}
        />
      )}

      {action === "receive" && connection.address && (
        <ReceivePanel
          address={connection.address}
          onClose={() => setAction(undefined)}
        />
      )}

      {(action === "swap" || action === "bridge") && (
        <SwapPanel initialMode={action} initialValues={agentHandoff ? { amount: agentHandoff.amount, asset: agentHandoff.asset.toLowerCase() as "usdc" | "eurc", outputAsset: agentHandoff.outputAsset?.toLowerCase() as "usdc" | "eurc" | undefined, sourceChain: agentHandoff.sourceChain, destinationChain: agentHandoff.destinationChain, recipient: agentHandoff.recipient, origin: "agent" } : undefined} onClose={() => setAction(undefined)} onConfirmed={() => void activity.refetch()} />
      )}

      {receiptActivity && connection.address && <TransactionReceiptPanel activity={receiptActivity} walletAddress={connection.address} onClose={() => setReceiptActivity(undefined)} />}
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
        {(dismiss) => <>
          <header>
            <h2 id="create-guide-title">{t("onboarding.createGuideTitle")}</h2>
            <button type="button" onClick={dismiss} aria-label={t("common.close")}>×</button>
          </header>
          <p>{t("onboarding.createGuideCopy")}</p>
          <div className={foundation.choices}>
            <article>
              <button type="button" onClick={() => void beginCreateWallet("email")} autoFocus data-guide-initial-focus>{t("onboarding.continueEmail")}</button>
              <p>{t("onboarding.emailGuide")}</p>
              <ol>
                <li>{t("onboarding.emailStep1")}</li>
                <li>{t("onboarding.emailStep2")}</li>
                <li>{t("onboarding.emailStep3")}</li>
              </ol>
            </article>
            <article>
              <button type="button" onClick={() => void beginCreateWallet("google")}>{t("onboarding.continueGoogle")}</button>
              <p>{t("onboarding.googleGuide")}</p>
            </article>
          </div>
          <p>{t("onboarding.noPrivateKeyStorage")}</p>
        </>}
      </CreateWalletGuide>}
    </AppShell>
  );
}
