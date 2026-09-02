"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useConnection, usePublicClient } from "wagmi";
import { zeroAddress } from "viem";
import { arcTestnet } from "viem/chains";

import { AppHeader } from "./AppHeader";
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

import { ARC_EXPLORER_URL } from "@/lib/config";
import { formatAssetAmount, getAssetById, SUPPORTED_ASSETS } from "@/lib/assets";
import { formatUsdc, shortAddress } from "@/lib/format";
import { summarizeSavingsJars } from "@/lib/savingsSummary";
import { arcScanTransactionUrl, type WalletActivity } from "@/lib/wallet";
import { activityIdentity } from "@/lib/onchainActivity";
import { mergeWalletActivity, recordWalletActivity } from "@/lib/walletActivity";
import { deriveNetworkSafety, deriveOverallSecurityStatus, deriveSecurityAlerts, summarizeJarProtection } from "@/lib/securityCenter";
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

function ExternalLinkIcon() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 10 12 4M7 4h5v5" /><path d="M12 10v2H4V4h2" /></svg>;
}

function DashboardAppIcon({ name }: { name: "send" | "receive" | "swap" | "jar" | "pay" | "security" | "unified" | "agent" }) {
  const paths = {
    send: <><path d="M7 17 17 7" /><path d="M8 7h9v9" /></>,
    receive: <><path d="m7 7 10 10" /><path d="M16 7v10H6" /></>,
    swap: <><path d="M5 8h12l-3-3" /><path d="m17 16H5l3 3" /></>,
    jar: <><path d="M8 4h8l1 4v9a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3V8l1-4Z" /><path d="M7 9h10" /></>,
    pay: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M3 10h18M7 15h4" /></>,
    security: <><path d="M12 3 5 6v5c0 4.5 3 7.8 7 10 4-2.2 7-5.5 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></>,
    unified: <><circle cx="8" cy="12" r="4" /><circle cx="16" cy="12" r="4" /><path d="M10 8.6 12 5l2 3.6M10 15.4 12 19l2-3.6" /></>,
    agent: <><path d="M7 8a5 5 0 0 1 10 0v7a4 4 0 0 1-4 4h-2a4 4 0 0 1-4-4V8Z" /><path d="M9 12h.01M15 12h.01M10 15h4M12 3V1" /></>,
  };
  return <span className={styles.appIconTile}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg></span>;
}

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
  const [agentHandoffRequestId, setAgentHandoffRequestId] = useState<string | undefined>(() =>
    typeof window === "undefined" ? undefined : new URLSearchParams(window.location.search).get("agentHandoff") ?? undefined,
  );
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
      setAgentHandoffRequestId(undefined);
      window.history.replaceState({}, "", window.location.pathname);
      if (!handoff || !["send", "swap", "bridge"].includes(handoff.action)) return;
      setAgentHandoff(handoff);
      setAction(handoff.action === "bridge" ? "bridge" : handoff.action === "swap" ? "swap" : "send");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [agentHandoffRequestId, balancesSettled, connection.address, walletState]);

  useEffect(() => {
    if (!createGuideOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCreateGuideOpen(false);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [createGuideOpen]);

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
  const protection = useMemo(() => summarizeJarProtection(jars), [jars]);
  const vaultDataState = deriveFinancialDataState({ enabled: onArc, isLoading: jarsLoading, isError: Boolean(jarsError) });
  const networkSafety = deriveNetworkSafety(connected, onArc);
  const securityAlerts = deriveSecurityAlerts({
    network: networkSafety,
    protectionState: jarsLoading ? "loading" : "ready",
    summary: protection,
  });
  const securityStatus = deriveOverallSecurityStatus(networkSafety, jarsLoading ? "loading" : "ready", securityAlerts);
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
  const visibleActivities = activities.slice(0, 5);

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
    <main className={styles.page}>
      <div className={styles.shell}>
        <AppHeader guardianSetupJarId={guardianSetupJar?.id} />
        <div className={`${styles.pageHeading} ${connected ? styles.pageHeadingSupporting : ""}`}>
          <h1>{t("walletHome.pageTitle")}</h1>
          <p>{t("walletHome.pageSubtitle")}</p>
        </div>

        {dashboardState === "hydrating" ? (
          <section className={styles.disconnected} role="status" aria-live="polite" aria-busy="true">
            <div className={styles.disconnectedCopy}>
              <span className={styles.kicker}>MAKOTO WALLET{" · "}ARC TESTNET</span>
              <h1>{locale === "vi" ? "Đang khôi phục kết nối ví…" : "Restoring wallet connection…"}</h1>
              <p>{locale === "vi" ? "Makoto đang xác minh tài khoản và mạng trước khi hiển thị số dư hoặc hành động đã chuẩn bị." : "Makoto is verifying the account and network before showing balances or prepared actions."}</p>
            </div>
          </section>
        ) : !connected ? (
          <>
          <section className={styles.disconnected}>
            <div className={styles.disconnectedCopy}>
              <h1>{t("walletHome.connectTitle")}</h1>
              <p>{t("walletHome.connectCopy")}</p>
              <div className={styles.onboardingPanel} aria-labelledby="onboarding-title">
                <h2 id="onboarding-title">{t("onboarding.title")}</h2>
                <button
                  type="button"
                  className={styles.createWalletButton}
                  onClick={() => setCreateGuideOpen(true)}
                  disabled={!isReownConfigured}
                >
                  <strong>{t("onboarding.createWallet")}</strong>
                  <span>{t("onboarding.createHelp")}</span>
                </button>
                <button
                  type="button"
                  className={styles.connectExistingButton}
                  onClick={() => void beginOnboarding("existing")}
                  disabled={!isReownConfigured}
                >
                  <strong>{t("onboarding.connectExisting")}</strong>
                  <span>{t("onboarding.connectHelp")}</span>
                </button>
                <p className={styles.onboardingSafety}>{t("onboarding.noPrivateKeyStorage")}</p>
                {!isReownConfigured && <p className={styles.onboardingUnavailable} role="status">{t("onboarding.unavailable")}</p>}
              </div>
            </div>
            <div className={styles.disconnectedArt}>
              <Image
                src="/makoto/logo-pro-v2.png"
                alt=""
                width={120}
                height={120}
                priority
                className={styles.disconnectedLogo}
              />
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
          <>
            <section className={styles.agentHero} aria-labelledby="dashboard-agent-title">
              <div className={styles.agentOrbitStage}>
                <div className={styles.agentAtmosphere} aria-hidden="true">
                  <span className={styles.agentRingOuter} />
                  <span className={styles.agentRingMiddle} />
                  <span className={styles.agentRingInner} />
                  <span className={styles.agentParticleOne} />
                  <span className={styles.agentParticleTwo} />
                  <span className={styles.agentParticleThree} />
                  <span className={styles.agentParticleFour} />
                  <span className={styles.agentParticleFive} />
                  <div className={styles.agentAura} />
                  <Image className={styles.agentCharacter} src="/makoto/agent-hero-v2.png" width={768} height={512} alt="" priority />
                  <div className={styles.agentPlatform} />
                </div>
                <div className={styles.agentAmbientSuggestions} aria-label={t("agentDashboard.suggestionsLabel")}>
                  {agentSuggestions.map((suggestion) => {
                    const prompt = t(suggestion.promptKey);
                    return <button type="button" key={suggestion.id} onClick={() => selectAgentSuggestion(suggestion.id, prompt)}>{prompt}</button>;
                  })}
                </div>
              </div>
              <div className={styles.agentHeroCopy}>
                <h1 id="dashboard-agent-title" aria-label={t("agentDashboard.title")}>
                  <span className={styles.agentTitleMakoto} aria-hidden="true">Makoto</span>
                  <span className={styles.agentTitleAgent} aria-hidden="true">Agent</span>
                </h1>
              </div>
              <div className={styles.agentInteraction}>
                {agentMessages.length > 0 && <div className={styles.agentResponse} aria-live="polite">
                  {agentMessages.slice(-2).map((message) => <article key={message.id} className={message.role === "user" ? styles.agentUserMessage : styles.agentReply}>
                    <strong>{message.role === "user" ? t("agentDashboard.you") : "Makoto Agent"}</strong>
                    <p>{message.text}</p>
                    {message.intelligence && <EvidenceBlock value={message.intelligence} locale={locale} />}
                    {message.draft && <div className={`${styles.agentDraft} ${agentStyles.chat}`}><ActionDraftCard draft={message.draft} vi={locale === "vi"} /></div>}
                  </article>)}
                </div>}
                <form className={styles.agentComposer} onSubmit={submitAgent}>
                  <label htmlFor="dashboard-agent-question">{t("agentDashboard.inputLabel")}</label>
                  <div><input ref={agentInputRef} id="dashboard-agent-question" name="agent-question" value={agentInput} onChange={(event) => setAgentInput(event.target.value)} placeholder={t("agentDashboard.placeholder")} autoComplete="off" /><button type="submit" disabled={!agentInput.trim()} aria-label={t("agentDashboard.sendRequest")}><span aria-hidden="true">↗</span></button></div>
                </form>
              </div>
            </section>
            <section className={styles.quickActionsPanel} aria-label={t("agentDashboard.primaryCommands")}>
              <div className={styles.agentCommands} aria-label={t("agentDashboard.primaryCommands")}>
                <button className={styles.agentCommandPrimary} type="button" onClick={() => setAction("send")} disabled={!onArc}><DashboardAppIcon name="send" /><span>{t("walletHome.send")}</span></button>
                <button type="button" onClick={() => setAction("receive")} disabled={!onArc}><DashboardAppIcon name="receive" /><span>{t("walletHome.receive")}</span></button>
                <button type="button" onClick={() => setAction("swap")} disabled={!onArc}><DashboardAppIcon name="swap" /><span>{t("walletHome.swap")}</span></button>
                <button type="button" onClick={() => setAction("bridge")} disabled={!onArc}><DashboardAppIcon name="unified" /><span>Bridge</span></button>
              </div>
            </section>
            <section className={styles.portfolioGrid}>
            <section className={`${styles.assetsSection} ${styles.dashboardCard}`} id="assets" aria-labelledby="assets-title">
              <header className={styles.assetsHeader}><div><h2 id="assets-title">{locale === "vi" ? "Tài sản" : "Assets"}</h2></div></header>
              <div className={styles.assetTableHead}><span>{locale === "vi" ? "Tài sản" : "Asset"}</span><span>{locale === "vi" ? "Hợp đồng" : "Contract"}</span><span>{locale === "vi" ? "Số dư" : "Balance"}</span></div>
              <div className={styles.assetRows}>{SUPPORTED_ASSETS.map((asset) => {
                const query = balances.assets[asset.id];
                return <article className={`${styles.assetRow} ${asset.id === "usdc" ? styles.assetUsdc : styles.assetEurc}`} key={asset.id}>
                  <Image
                    src={asset.id === "usdc" ? "/makoto/token-usdc-3d.png" : "/makoto/token-eurc-3d.png"}
                    alt={t("walletHome.assetLogo", { symbol: asset.symbol })}
                    width={64}
                    height={64}
                    className={styles.assetLogo3d}
                  />
                  <div><strong>{asset.symbol}</strong><small>{asset.name}</small></div>
                  <div className={styles.assetContract}><span>{shortAddress(asset.address)}</span><a href={`${ARC_EXPLORER_URL}/address/${asset.address}`} target="_blank" rel="noreferrer">ArcScan <ExternalLinkIcon /></a></div>
                  <strong className={`${styles.assetBalance} ${query.data === undefined ? styles.loadingValue : ""}`}>{query.data === undefined ? <span aria-label={t("walletHome.loadingBalance")} /> : <>{formatAssetAmount(query.data, asset)} {asset.symbol}</>}</strong>
                </article>;
              })}</div>
            </section>

              <article className={`${styles.dashboardCard} ${styles.statusCard}`}>
                <header className={styles.cardHeader}><div><span>{locale === "vi" ? "Trạng thái ví" : "Wallet Status"}</span><small>{connection.connector?.name ?? (locale === "vi" ? "Ví kết nối" : "Connected wallet")}</small></div><span className={`${styles.statusBadge} ${securityStatus === "protected" ? styles.statusGood : styles.statusAttention}`}>{securityStatus === "protected" ? (locale === "vi" ? "Được bảo vệ" : "Protected") : (locale === "vi" ? "Nên kiểm tra" : "Review recommended")}</span></header>
                <div className={`${styles.walletStatusBar} ${styles[`walletStatusBar_${securityStatus}`]}`} role="img" aria-label={securityStatus === "protected" ? (locale === "vi" ? "Trạng thái bảo mật: Được bảo vệ" : "Security status: Protected") : (locale === "vi" ? "Trạng thái bảo mật: Nên kiểm tra" : "Security status: Review recommended")}><span /></div>
                <dl className={styles.statusList}>
                  <div><dt>{t("wallet.network")}</dt><dd>{onArc ? "Arc Testnet" : locale === "vi" ? "Sai mạng" : "Wrong network"}</dd></div>
                  <div><dt>{locale === "vi" ? "Tài khoản" : "Account"}</dt><dd>{connection.address ? shortAddress(connection.address) : "—"}</dd></div>
                  <div><dt>Chain ID</dt><dd>{chain.providerChainId ?? "—"}</dd></div>
                  <div><dt>{locale === "vi" ? "Bảo vệ" : "Protection"}</dt><dd>{securityStatus === "protected" ? (locale === "vi" ? "Đang bật" : "Active") : (locale === "vi" ? "Cần xem lại" : "Review")}</dd></div>
                </dl>
                <div className={styles.statusLinks}><Link className={styles.cardLink} href="/settings#security">{locale === "vi" ? "Mở Trung tâm bảo mật" : "Open Security Center"}</Link><a className={styles.cardLink} href={connection.address ? `${ARC_EXPLORER_URL}/address/${connection.address}` : ARC_EXPLORER_URL} target="_blank" rel="noreferrer">ArcScan <ExternalLinkIcon /></a></div>
              </article>
            </section>

            <section className={styles.lowerGrid}>
              <article className={styles.activityCard} id="activity">
                <div className={styles.activityHeader}>
                  <div className={styles.activityHeading}>
                    <h2 className={styles.activityTitle}>{t("walletHome.activity")}</h2>
                  </div>
                  <button className={styles.viewButton} type="button" onClick={() => { setActivityHistoryLimit(20); setActivityHistoryOpen(true); }}>
                    {t("walletHome.viewAll")}
                  </button>
                </div>

                {!onArc ? (
                  <div className={styles.emptyActivity}><strong>{t("walletHome.activityWrongNetwork")}</strong></div>
                ) : activity.isLoading ? (
                  <div className={styles.activitySkeleton} aria-label={t("walletHome.activityLoading")}>{Array.from({ length: 3 }, (_, index) => <span key={index} />)}</div>
                ) : activity.isError && activities.length === 0 ? (
                  <div className={styles.emptyActivity}><strong>{t("walletHome.activityError")}</strong><button type="button" className={styles.viewButton} onClick={() => void activity.refetch()}>{t("common.tryAgain")}</button></div>
                ) : activities.length === 0 ? (
                  <div className={styles.emptyActivity}>
                    <strong>{t("walletHome.noActivity")}</strong>
                  </div>
                ) : (
                  <ul className={styles.activityList}>
                    {visibleActivities.map((item) => (
                      <li key={activityIdentity(item)}>
                        <Image
                          src={item.kind === "swap" ? "/makoto/icon-swap-pro-v2.png" : item.direction === "receive" ? "/makoto/icon-receive-pro-v2.png" : "/makoto/icon-send-pro-v2.png"}
                          alt=""
                          width={54}
                          height={54}
                          className={styles.activityIcon}
                        />
                        <div className={styles.activityMain}>
                          <strong>
                            {item.kind === "swap" && item.swapReceive ? <>{t("walletHome.swap")} -{formatAssetAmount(item.amount, getAssetById(item.assetId)!)} {item.assetSymbol} → +{formatAssetAmount(item.swapReceive.amount, getAssetById(item.swapReceive.assetId)!)} {item.swapReceive.assetSymbol}</> : <>{dashboardActivityLabel(item, locale, t)}{" "}{item.direction === "receive" ? "+" : "-"}{formatAssetAmount(item.amount, getAssetById(item.assetId)!)} {item.assetSymbol}</>}
                          </strong>
                          <small>{item.kind === "swap" ? "XyloNet StableSwap" : item.kind === "bridge" ? t("walletHome.bridgeRoute") : <>{item.direction === "receive" ? t("walletHome.from") : t("walletHome.to")}{" "}{shortAddress(item.counterparty)}</>}{" · "}{formatActivityTime(item.confirmedAt, locale)}</small>
                        </div>
                        <span className={styles.activityStatus}>
                          {t("walletHome.confirmed")}
                        </span>
                        <div className={styles.activityActions}>{item.source !== "onchain" && <button type="button" onClick={() => setReceiptActivity(item)}>{locale === "vi" ? "Biên nhận" : "Receipt"}</button>}<a
                            href={arcScanTransactionUrl(item.hash)}
                            target="_blank"
                            rel="noreferrer"
                            className={styles.activityLink}
                          >
                            ArcScan <ExternalLinkIcon />
                          </a></div>
                      </li>
                    ))}
                  </ul>
                )}
              </article>

            </section>
          </>
        )}

        <footer className={styles.footer}>Makoto Wallet</footer>
      </div>

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
      {createGuideOpen && <div className={styles.createGuideLayer}>
        <button type="button" className={styles.createGuideBackdrop} onClick={() => setCreateGuideOpen(false)} aria-label={t("common.close")} />
        <section className={styles.createGuide} role="dialog" aria-modal="true" aria-labelledby="create-guide-title">
          <header>
            <div><span className={styles.kicker}>MAKOTO WALLET</span><h2 id="create-guide-title">{t("onboarding.createGuideTitle")}</h2></div>
            <button type="button" className={styles.createGuideClose} onClick={() => setCreateGuideOpen(false)} aria-label={t("common.close")}>×</button>
          </header>
          <p>{t("onboarding.createGuideCopy")}</p>
          <div className={styles.createGuideChoices}>
            <article className={styles.emailChoice}>
              <button type="button" onClick={() => void beginCreateWallet("email")} autoFocus>{t("onboarding.continueEmail")}</button>
              <p>{t("onboarding.emailGuide")}</p>
              <ol>
                <li>{t("onboarding.emailStep1")}</li>
                <li>{t("onboarding.emailStep2")}</li>
                <li>{t("onboarding.emailStep3")}</li>
              </ol>
            </article>
            <article className={styles.googleChoice}>
              <button type="button" onClick={() => void beginCreateWallet("google")}>{t("onboarding.continueGoogle")}</button>
              <p>{t("onboarding.googleGuide")}</p>
            </article>
          </div>
          <p className={styles.createGuideSafety}>{t("onboarding.noPrivateKeyStorage")}</p>
        </section>
      </div>}
    </main>
  );
}

function formatActivityTime(timestamp: number, locale: "en" | "vi") {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function dashboardActivityLabel(item: WalletActivity, locale: "en" | "vi", t: (key: "walletHome.bridge" | "walletHome.receive" | "walletHome.send") => string) {
  if (item.kind === "bridge") return t("walletHome.bridge");
  if (item.kind === "vault-deposit") return locale === "vi" ? "Nạp Makoto Vault" : "Makoto Vault Deposit";
  if (item.kind === "vault-withdraw") return locale === "vi" ? "Rút Makoto Vault" : "Makoto Vault Withdraw";
  return item.direction === "receive" ? t("walletHome.receive") : t("walletHome.send");
}
