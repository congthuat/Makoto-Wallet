"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useConnection } from "wagmi";
import { zeroAddress } from "viem";
import { arcTestnet } from "viem/chains";

import { AppHeader } from "./AppHeader";
import { SendFlow } from "./SendFlow";
import { ReceivePanel } from "./ReceivePanel";
import { SwapPanel } from "./SwapPanel";
import { TransactionReceiptPanel } from "./TransactionReceiptPanel";
import { BalanceHistoryChart } from "./BalanceHistoryChart";
import { ActivityHistoryPanel } from "./ActivityHistoryPanel";

import { useHydrated } from "@/hooks/useHydrated";
import { useOwnerJars } from "@/hooks/useOwnerJars";
import { usePreferences } from "@/hooks/usePreferences";
import { useVerifiedWalletChain } from "@/hooks/useVerifiedWalletChain";
import { useWalletActivity } from "@/hooks/useWalletActivity";
import { useWalletBalances } from "@/hooks/useWalletBalances";

import { ARC_EXPLORER_URL } from "@/lib/config";
import { formatAssetAmount, getAssetById, SUPPORTED_ASSETS } from "@/lib/assets";
import { formatUsdc, shortAddress } from "@/lib/format";
import { summarizeSavingsJars } from "@/lib/savingsSummary";
import { arcScanTransactionUrl, type WalletActivity } from "@/lib/wallet";
import { activityIdentity } from "@/lib/onchainActivity";
import { mergeWalletActivity, recordWalletActivity } from "@/lib/walletActivity";
import { deriveNetworkSafety, deriveOverallSecurityStatus, deriveSecurityAlerts, summarizeJarProtection } from "@/lib/securityCenter";
import { loadBalanceHistory, recordBalanceSnapshot, type BalanceSnapshot } from "@/lib/balanceHistory";
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

type Action = "send" | "receive" | "swap";

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
  const chain = useVerifiedWalletChain();
  const connected = hydrated && connection.isConnected;
  const onArc = connected && chain.isArc;

  const balances = useWalletBalances(connection.address, onArc);
  const {
    jars,
    isLoading: jarsLoading,
    refetch: refetchJars,
  } = useOwnerJars(onArc ? connection.address : undefined);

  const [action, setAction] = useState<Action>();
  const [agentHandoff, setAgentHandoff] = useState<{ amount?: string; asset?: "usdc" | "eurc"; recipient?: string; outputAsset?: "usdc" | "eurc" }>();
  const [activityHistoryOpen, setActivityHistoryOpen] = useState(false);
  const activity = useWalletActivity(connection.address, onArc, activityHistoryOpen);
  const [optimisticActivity, setOptimisticActivity] = useState<{ address: string; records: WalletActivity[] }>();
  const [copied, setCopied] = useState(false);
  const [receiptActivity, setReceiptActivity] = useState<WalletActivity>();
  const [activityHistoryLimit, setActivityHistoryLimit] = useState(20);
  const [createGuideOpen, setCreateGuideOpen] = useState(false);
  const [balanceHistory, setBalanceHistory] = useState<BalanceSnapshot[]>([]);
  const [onboardingIntent, setOnboardingIntent] = useState<OnboardingPath | undefined>(() =>
    typeof window === "undefined" ? undefined : parseOnboardingIntent(window.sessionStorage.getItem(ONBOARDING_INTENT_KEY)),
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("source") !== "makoto-agent") return;
    const requested = params.get("action");
    if (requested !== "send" && requested !== "swap") return;
    const asset = params.get("asset")?.toLowerCase(), outputAsset = params.get("outputAsset")?.toLowerCase();
    const timer = window.setTimeout(() => {
      setAgentHandoff({ amount: params.get("amount") ?? undefined, recipient: params.get("recipient") ?? undefined, asset: asset === "usdc" || asset === "eurc" ? asset : undefined, outputAsset: outputAsset === "usdc" || outputAsset === "eurc" ? outputAsset : undefined });
      setAction(requested);
    }, 0);
    window.history.replaceState({}, "", window.location.pathname);
    return () => window.clearTimeout(timer);
  }, []);

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
    const timer = window.setTimeout(() => {
      if (!onArc || !connection.address) return setBalanceHistory([]);
      const history = balances.usdc.data === undefined
        ? loadBalanceHistory(connection.address, arcTestnet.id, "usdc")
        : recordBalanceSnapshot(connection.address, arcTestnet.id, "usdc", balances.usdc.data);
      setBalanceHistory(history);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [balances.usdc.data, connection.address, onArc]);

  const activities = useMemo(() => {
    const optimistic = optimisticActivity && connection.address && optimisticActivity.address.toLowerCase() === connection.address.toLowerCase()
      ? optimisticActivity.records
      : [];
    return mergeWalletActivity(activity.data, optimistic);
  }, [activity.data, connection.address, optimisticActivity]);

  const totals = useMemo(() => summarizeSavingsJars(jars), [jars]);
  const protection = useMemo(() => summarizeJarProtection(jars), [jars]);
  const networkSafety = deriveNetworkSafety(connected, onArc);
  const securityAlerts = deriveSecurityAlerts({
    network: networkSafety,
    protectionState: jarsLoading ? "loading" : "ready",
    summary: protection,
  });
  const securityStatus = deriveOverallSecurityStatus(networkSafety, jarsLoading ? "loading" : "ready", securityAlerts);

  const visibleJars = jars.slice(0, 3);
  const guardianSetupJar = jars.find((jar) => !jar.closed && Number(jar.mode) === 1 && jar.guardian === zeroAddress);
  const visibleActivities = activities.slice(0, 5);
  const refreshing = balances.usdc.isFetching || balances.eurc.isFetching;

  async function copyAddress() {
    if (!connection.address) return;
    await navigator.clipboard.writeText(connection.address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  async function refresh() {
    await Promise.all([
      balances.usdc.refetch(),
      balances.eurc.refetch(),
      refetchJars(),
      activity.refetch(),
    ]);
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
        <div className={styles.pageHeading}>
          <span>{locale === "vi" ? "TỔNG QUAN VÍ" : "WALLET OVERVIEW"}</span>
          <h1>{locale === "vi" ? "Tổng quan" : "Dashboard"}</h1>
          <p>{locale === "vi" ? "Cổng kết nối an toàn của bạn tới hệ sinh thái Arc" : "Your secure gateway to the Arc ecosystem"}</p>
        </div>

        {!connected ? (
          <section className={styles.disconnected}>
            <div className={styles.disconnectedCopy}>
              <span className={styles.kicker}>MAKOTO WALLET{" · "}ARC TESTNET</span>
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
                <p className={styles.onboardingSafety}>{t("onboarding.methods")}<br />{t("onboarding.noPrivateKeyStorage")}</p>
                <p className={styles.onboardingProductStory}>{t("onboarding.payStory")}</p>
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
            <section className={styles.dashboardGrid}>
              <article className={`${styles.dashboardCard} ${styles.balanceCard} ${onArc ? "" : styles.wrongNetwork}`}>
                <div className={styles.balanceContent}>
                  <header className={styles.cardHeader}><div><span>{locale === "vi" ? "Số dư USDC" : "USDC balance"}</span><small>{onArc ? "Arc Testnet" : locale === "vi" ? "Sai mạng" : "Wrong network"}</small></div><button type="button" onClick={() => void refresh()} disabled={refreshing} aria-busy={refreshing}>{refreshing ? t("common.refreshing") : "↻"}</button></header>
                  <div className={styles.dashboardBalance}>{usdcBalance}<small>USDC</small></div>
                  <p className={styles.dataDisclosure}>{locale === "vi" ? "Số dư trực tiếp và lịch sử quan sát cục bộ của ví đang kết nối." : "Live balance with locally observed history for this connected wallet."}</p>
                  <div className={styles.primaryActions}>
                    <button type="button" onClick={() => setAction("send")} disabled={!onArc}><DashboardAppIcon name="send" /><span>{t("walletHome.send")}</span></button>
                    <button type="button" onClick={() => setAction("receive")} disabled={!onArc}><DashboardAppIcon name="receive" /><span>{t("walletHome.receive")}</span></button>
                    <button type="button" onClick={() => setAction("swap")} disabled={!onArc}><DashboardAppIcon name="swap" /><span>{t("walletHome.swap")}</span></button>
                  </div>
                  {!onArc && <button type="button" className={styles.inlineNetworkAction} onClick={() => void chain.switchToArc()}>{t("wallet.switch")}</button>}
                  {onArc && (balances.usdc.isError || balances.eurc.isError) && <p className={styles.balanceError} role="alert">{t("walletHome.balanceError")}</p>}
                </div>
                <BalanceHistoryChart history={balanceHistory} locale={locale} />
              </article>

              <article className={`${styles.dashboardCard} ${styles.statusCard}`}>
                <header className={styles.cardHeader}><div><span>{locale === "vi" ? "Trạng thái ví" : "Wallet Status"}</span><small>{connection.connector?.name ?? (locale === "vi" ? "Ví kết nối" : "Connected wallet")}</small></div><span className={`${styles.statusBadge} ${securityStatus === "protected" ? styles.statusGood : styles.statusAttention}`}>{securityStatus === "protected" ? (locale === "vi" ? "Được bảo vệ" : "Protected") : (locale === "vi" ? "Nên kiểm tra" : "Review recommended")}</span></header>
                <div className={`${styles.walletStatusBar} ${styles[`walletStatusBar_${securityStatus}`]}`} role="img" aria-label={securityStatus === "protected" ? (locale === "vi" ? "Trạng thái bảo mật: Được bảo vệ" : "Security status: Protected") : (locale === "vi" ? "Trạng thái bảo mật: Nên kiểm tra" : "Security status: Review recommended")}><span /></div>
                <dl className={styles.statusList}>
                  <div><dt>{t("wallet.network")}</dt><dd>{onArc ? "Arc Testnet" : locale === "vi" ? "Sai mạng" : "Wrong network"}</dd></div>
                  <div><dt>{locale === "vi" ? "Tài khoản" : "Account"}</dt><dd>{connection.address ? shortAddress(connection.address) : "—"}</dd></div>
                  <div><dt>{locale === "vi" ? "Người giám hộ" : "Guardian"}</dt><dd>{protection.guardianProtected ? `${protection.guardianProtected}/${protection.total}` : locale === "vi" ? "Chưa cấu hình" : "Not configured"}</dd></div>
                  <div><dt>{locale === "vi" ? "Khôi phục" : "Recovery"}</dt><dd>{protection.recoveryConfigured ? `${protection.recoveryConfigured}/${protection.total}` : locale === "vi" ? "Chưa cấu hình" : "Not configured"}</dd></div>
                </dl>
                <Link className={styles.cardLink} href="/settings">{locale === "vi" ? "Mở Trung tâm bảo mật" : "Open Security Center"}</Link>
              </article>
            </section>

            <section className={styles.portfolioGrid}>
            <section className={`${styles.assetsSection} ${styles.dashboardCard}`} id="assets" aria-labelledby="assets-title">
              <header className={styles.assetsHeader}><div><h2 id="assets-title">{locale === "vi" ? "Tài sản của tôi" : "My Assets"}</h2><p>{locale === "vi" ? "Tài sản Arc Testnet được hỗ trợ" : "Supported Arc Testnet assets"}</p></div></header>
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

              <article className={`${styles.dashboardCard} ${styles.savingsPosition}`}>
                <header className={styles.cardHeader}><div><span>Makoto Vault</span><small>{locale === "vi" ? "Vị thế tiết kiệm" : "Savings position"}</small></div><span className={`${styles.statusBadge} ${securityStatus === "protected" ? styles.statusGood : styles.statusAttention}`}>{securityStatus === "protected" ? (locale === "vi" ? "Được bảo vệ" : "Protected") : (locale === "vi" ? "Đang hoạt động" : "Active")}</span></header>
                <div className={styles.jarPositionBody}>
                  <dl><div><dt>{t("walletHome.totalSaved")}</dt><dd>{formatUsdc(totals.totalSaved)} USDC</dd></div><div><dt>{t("walletHome.activeJars")}</dt><dd>{totals.active}</dd></div><div><dt>{t("walletHome.completedJars")}</dt><dd>{totals.completed}</dd></div></dl>
                  <div className={styles.jarVault} aria-hidden="true"><span className={styles.jarLid}/><span className={styles.jarGlassHighlight}/><Image src="/makoto/logo-pro-v2.png" alt="" width={48} height={48} /></div>
                </div>
                {jarsLoading ? <div className={styles.jarSkeleton}><span /></div> : visibleJars.length ? <Link className={styles.positionJarLink} href={`/jars/${visibleJars[0].id.toString()}`}>{visibleJars[0].name || t("jar.unnamed", { id: visibleJars[0].id.toString() })}<span>{formatUsdc(visibleJars[0].balance)} USDC</span></Link> : <div className={styles.positionEmpty}>{t("walletHome.noJars")}<Link href="/savings">{t("walletHome.createJar")}</Link></div>}
                <Link className={styles.appsFooterLink} href="/savings">{t("walletHome.viewSavings")}</Link>
              </article>
            </section>

            <section className={styles.appsRow}>
              <article className={`${styles.dashboardCard} ${styles.appsPanel}`} id="apps">
                <header className={styles.cardHeader}><div><span>{locale === "vi" ? "Công cụ Makoto" : "Makoto Tools"}</span><small>{locale === "vi" ? "Công cụ và dịch vụ ví" : "Wallet tools and services"}</small></div></header>
                <div className={styles.appShortcuts}>
                  <Link href="/savings"><DashboardAppIcon name="jar" /><span className={styles.appModuleCopy}><strong>Makoto Vault</strong><small>{locale === "vi" ? "Tiết kiệm theo mục tiêu được bảo vệ." : "Goal-based protected savings."}</small></span></Link>
                  <Link href="/pay"><DashboardAppIcon name="pay" /><span className={styles.appModuleCopy}><strong>Makoto Pay</strong><small>{locale === "vi" ? "Dịch vụ thanh toán USDC hằng ngày." : "Everyday USDC payment services."}</small></span></Link>
                  <Link href="/unified-balance"><DashboardAppIcon name="unified" /><span className={styles.appModuleCopy}><strong>Unified Balance</strong><small>{locale === "vi" ? "Nạp USDC đa chuỗi và chi tiêu trên Arc." : "Deposit USDC across chains and spend on Arc."}</small></span></Link>
                  <a href="/agent"><DashboardAppIcon name="agent" /><span className={styles.appModuleCopy}><strong>Makoto Agent</strong><small>{locale === "vi" ? "Trợ lý ví chỉ đọc bằng tiếng Việt và tiếng Anh." : "Read-only wallet assistant in English and Vietnamese."}</small></span></a>
                  <Link href="/settings#security"><DashboardAppIcon name="security" /><span className={styles.appModuleCopy}><strong>{locale === "vi" ? "Trung tâm bảo mật" : "Security Center"}</strong><small>{locale === "vi" ? "Trạng thái ví, mạng, khôi phục và riêng tư." : "Wallet, network, recovery and privacy status."}</small></span></Link>
                </div>
              </article>
            </section>

            <section className={styles.lowerGrid}>
              <article className={styles.activityCard} id="activity">
                <div className={styles.activityHeader}>
                  <div className={styles.activityHeading}>
                    <span className={styles.activityEyebrow}>{t("walletHome.activityEyebrow")}</span>
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
                    <Image
                      src="/makoto/logo-pro-v2.png"
                      alt=""
                      width={62}
                      height={62}
                    />
                    <strong>{t("walletHome.noActivity")}</strong>
                    <span>{t("walletHome.noActivitySub")}</span>
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

              <div className={styles.sideStack}>
                <article className={`${styles.dashboardCard} ${styles.networkCard}`}><header className={styles.cardHeader}><div><span>{locale === "vi" ? "Mạng" : "Network"}</span><small>{onArc ? (locale === "vi" ? "Đã kết nối" : "Connected") : (locale === "vi" ? "Cần chuyển mạng" : "Switch required")}</small></div><span className={`${styles.networkDot} ${onArc ? styles.networkOnline : ""}`} /></header><dl className={styles.statusList}><div><dt>{t("wallet.network")}</dt><dd>Arc Testnet</dd></div><div><dt>Chain ID</dt><dd>{chain.providerChainId ?? "—"}</dd></div><div><dt>{locale === "vi" ? "Trình khám phá" : "Explorer"}</dt><dd><a href={ARC_EXPLORER_URL} target="_blank" rel="noreferrer">ArcScan <ExternalLinkIcon /></a></dd></div></dl>{!onArc && <button type="button" className={styles.inlineNetworkAction} onClick={() => void chain.switchToArc()}>{t("wallet.switch")}</button>}</article>
                <article className={`${styles.dashboardCard} ${styles.quickPanel}`}><header className={styles.cardHeader}><div><span>{t("walletHome.quickActions")}</span><small>{t("walletHome.quickActionsCopy")}</small></div></header><div className={styles.compactActions}><button type="button" onClick={() => void copyAddress()}>{copied ? t("walletHome.copied") : t("walletHome.copy")}</button><Link href="/savings">Makoto Vault</Link><a href={connection.address ? `${ARC_EXPLORER_URL}/address/${connection.address}` : ARC_EXPLORER_URL} target="_blank" rel="noreferrer">ArcScan</a></div></article>
              </div>
            </section>
          </>
        )}

        <footer className={styles.footer} title={t("walletHome.betaInfo")}>
          <span>Makoto Wallet{" · "}{t("walletHome.publicBeta")}{" · "}Arc Testnet</span>
          <span>{t("savings.footerName")}</span>
        </footer>
      </div>

      {action === "send" && (
        <SendFlow
          initialValues={agentHandoff}
          balances={{ usdc: balances.usdc.data ?? 0n, eurc: balances.eurc.data ?? 0n }}
          onClose={() => setAction(undefined)}
          onConfirmed={(item) => {
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

      {action === "swap" && (
        <SwapPanel initialValues={agentHandoff} onClose={() => setAction(undefined)} onConfirmed={() => void activity.refetch()} />
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
