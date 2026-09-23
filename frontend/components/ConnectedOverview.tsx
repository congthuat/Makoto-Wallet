import Image from "next/image";
import type { ReactNode } from "react";
import { translate, type Locale } from "../i18n";
import { SUPPORTED_ASSETS, formatAssetAmount, getAssetById, type SupportedAssetId } from "../lib/assets";
import { ARC_EXPLORER_URL } from "../lib/config";
import { shortAddress } from "../lib/format";
import { activityIdentity } from "../lib/onchainActivity";
import { arcScanTransactionUrl, type WalletActivity } from "../lib/wallet";
import styles from "./ConnectedOverview.module.css";

export type OverviewAction = "send" | "receive" | "swap" | "bridge";
type BalanceQuery = { data?: bigint; isPending: boolean; isError: boolean };
export type ConnectedOverviewProps = {
  locale: Locale;
  address?: string;
  connectorName?: string;
  chainId?: number;
  onArc: boolean;
  walletKind?: "external" | "local";
  walletStatus?: "connected" | "locked" | "unavailable";
  onUnlock?(): void;
  onLock?(): void;
  appLock?: { initialized: boolean; available: boolean; enabled: boolean; locked: boolean };
  balances: Record<SupportedAssetId, BalanceQuery>;
  activities: readonly WalletActivity[];
  activityLoading: boolean;
  activityPartial: boolean;
  activityUnavailable: boolean;
  onAction(action: OverviewAction): void;
  onHistory(): void;
  onRefresh(): void;
  onReceipt(item: WalletActivity): void;
  children: ReactNode;
};

/** Presentation-only classic dashboard. Wallet queries and transaction controllers remain in WalletDashboard. */
export function ConnectedOverview(props: ConnectedOverviewProps) {
  const { locale, onArc, balances, activities } = props;
  const vi = locale === "vi";
  const t = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) => translate(locale, key, values);
  const balance = (id: SupportedAssetId) => {
    const query = balances[id];
    if (!onArc) return t("overview.balanceWrongNetwork");
    if (query.isError) return t("overview.unavailable");
    if (query.isPending) return t("walletHome.loadingBalance");
    return query.data === undefined ? t("overview.unavailable") : formatAssetAmount(query.data, getAssetById(id)!);
  };
  const activityLabel = (item: WalletActivity) => {
    if (item.kind === "swap") return t("walletHome.swap");
    if (item.kind === "bridge") return t("walletHome.bridge");
    if (item.kind === "vault-deposit") return t("overview.vaultDeposit");
    if (item.kind === "vault-withdraw") return t("overview.vaultWithdraw");
    return t(item.direction === "receive" ? "walletHome.receive" : "walletHome.send");
  };
  const actionCopy = vi
    ? { send: "Gửi tới địa chỉ khác", receive: "Nhận vào ví của bạn", swap: "Đổi USDC và EURC", bridge: "Chuyển giữa các mạng" }
    : { send: "Send to another address", receive: "Receive to your wallet", swap: "Exchange USDC & EURC", bridge: "Move across networks" };

  return <div className={styles.overview}>
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
      </div>
      <div className={styles.agentHeroCopy}>
        <h1 id="dashboard-agent-title"><em>{t("overview.agentTitle")}</em></h1>
      </div>
      <div className={styles.agentSlot}>{props.children}</div>
    </section>

    <section className={styles.actions} aria-label={t("agentDashboard.primaryCommands")}>
      {(["send", "receive", "swap", "bridge"] as const).map((action) => <button key={action} type="button" disabled={!onArc} onClick={() => props.onAction(action)}>
        <ActionIcon action={action} />
        <span><strong>{t(`walletHome.${action}`)}</strong><small>{actionCopy[action]}</small></span>
        <span className={styles.actionChevron} aria-hidden="true">›</span>
      </button>)}
    </section>

    <section className={styles.portfolioGrid}>
      <section className={styles.assetsSection} id="assets" aria-labelledby="assets-title">
        <header className={styles.sectionHeader}><div><h2 id="assets-title">{vi ? "Tài sản" : "Assets"}</h2></div><small>{vi ? "Số dư trên Arc Testnet" : "Balances on Arc Testnet"}</small></header>
        <div className={styles.assetTableHead}><span>{vi ? "Tài sản" : "Asset"}</span><span>{vi ? "Hợp đồng" : "Contract"}</span><span>{vi ? "Số dư" : "Balance"}</span></div>
        <ul className={styles.assets}>{SUPPORTED_ASSETS.map((asset) => {
          const query = balances[asset.id];
          const artwork = asset.id === "usdc" ? "/makoto/token-usdc-3d.png" : asset.id === "eurc" ? "/makoto/token-eurc-3d.png" : undefined;
          const settledAmount = onArc && !query.isError && !query.isPending && query.data !== undefined ? query.data : undefined;
          return <li className={styles.assetRow} key={asset.id}>
            <span className={`${styles.assetLogo} ${artwork ? "" : styles.assetLogoFallback}`} aria-hidden="true">
              {artwork ? <Image src={artwork} alt="" width={52} height={52} className={styles.assetLogoArtwork} /> : "₿"}
            </span>
            <div><strong>{asset.symbol}</strong><small>{asset.name}</small></div>
            <div className={styles.assetContract}><span>{shortAddress(asset.address)}</span><a href={`${ARC_EXPLORER_URL}/address/${asset.address}`} target="_blank" rel="noreferrer">ArcScan ↗</a></div>
            <strong className={styles.assetBalance}>{settledAmount !== undefined ? <>{formatAssetAmount(settledAmount, asset)} {asset.symbol}</> : <span aria-label={t("walletHome.loadingBalance")}>{balance(asset.id)}</span>}</strong>
          </li>;
        })}</ul>
      </section>

      <section className={styles.statusCard} aria-labelledby="wallet-status-title">
        <header className={styles.sectionHeader}><div><span className={styles.sectionEyebrow}>{vi ? "TRẠNG THÁI" : "STATUS"}</span><h2 id="wallet-status-title">{vi ? "Trạng thái ví" : "Wallet Status"}</h2><small>{props.connectorName ?? (props.walletKind === "local" ? "Makoto Local Wallet" : vi ? "Ví kết nối" : "Connected wallet")}</small></div><span className={`${styles.statusBadge} ${props.onArc ? styles.statusGood : styles.statusAttention}`}>{props.onArc ? (vi ? "Được bảo vệ" : "Protected") : (vi ? "Kiểm tra mạng" : "Review network")}</span></header>
        <div className={`${styles.statusBar} ${props.onArc ? styles.statusBarGood : styles.statusBarAttention}`} data-status-kind="network" role="img" aria-label={props.onArc ? (vi ? "Đúng mạng Arc Testnet" : "Connected to Arc Testnet") : (vi ? "Cần kiểm tra mạng" : "Network review required")}><span /></div>
        <dl className={styles.statusList}>
          <div><dt>{vi ? "Mạng" : "Network"}</dt><dd>{props.onArc ? "Arc Testnet" : t("overview.wrongNetwork")}</dd></div>
          <div><dt>{vi ? "Tài khoản" : "Account"}</dt><dd>{props.address ? shortAddress(props.address) : t("overview.unavailable")}</dd></div>
          <div><dt>Chain ID</dt><dd>{props.chainId ?? t("overview.unavailable")}</dd></div>
          <div><dt>{vi ? "Ví" : "Wallet"}</dt><dd>{props.walletKind === "local" ? (props.walletStatus === "connected" ? (vi ? "Đã mở khóa" : "Unlocked") : (vi ? "Đã khóa" : "Locked")) : (props.connectorName ?? t("overview.unavailable"))}</dd></div>
          <div><dt>App Lock</dt><dd>{!props.appLock?.initialized ? (vi ? "Đang kiểm tra" : "Checking") : !props.appLock.available ? t("overview.unavailable") : props.appLock.enabled ? (props.appLock.locked ? (vi ? "Đang khóa" : "Locked") : (vi ? "Đã bật" : "Enabled")) : (vi ? "Chưa bật" : "Not enabled")}</dd></div>
        </dl>
        {props.walletKind === "local" && <div className={styles.statusActions}>{props.walletStatus === "connected" ? <button type="button" onClick={props.onLock}>{vi ? "Khóa ví" : "Lock wallet"}</button> : <button type="button" onClick={props.onUnlock}>{vi ? "Mở khóa ví" : "Unlock wallet"}</button>}</div>}
        <div className={styles.statusLinks}><a href="/settings#security">{vi ? "Mở cài đặt bảo mật" : "Open Security Settings"}</a>{props.address && <a href={`${ARC_EXPLORER_URL}/address/${props.address}`} target="_blank" rel="noreferrer">ArcScan ↗</a>}</div>
      </section>
    </section>

    <section className={styles.activityCard} id="activity" aria-labelledby="recent-activity-title">
      <header className={styles.sectionHeader}><div><h2 id="recent-activity-title">{t("walletHome.activity")}</h2></div><button type="button" onClick={props.onHistory}>{t("walletHome.viewAll")}</button></header>
      {!props.onArc ? <p className={`${styles.activityNotice} ${styles.activityNoticeWarning}`} role="status">{t("walletHome.activityWrongNetwork")}</p> : props.activityLoading ? <p className={`${styles.activityNotice} ${styles.activityNoticeInfo}`} role="status" aria-live="polite">{t("walletHome.activityLoading")}</p> : props.activityUnavailable ? <p className={`${styles.activityNotice} ${styles.activityNoticeWarning}`} role="status">{t("overview.historyUnavailable")} <button type="button" onClick={props.onRefresh}>{t("common.tryAgain")}</button></p> : props.activityPartial && <p className={`${styles.activityNotice} ${styles.activityNoticeInfo}`} role="status">{t("overview.historyPartial")}</p>}
      {props.onArc && !props.activityLoading && activities.length === 0 && !props.activityUnavailable && <div className={styles.emptyActivity}><strong>{t("walletHome.noActivity")}</strong><span>{vi ? "Hoạt động trên chuỗi của bạn sẽ xuất hiện tại đây." : "Your onchain activity will appear here as you use Makoto."}</span><div className={styles.emptyActivityActions}><button type="button" onClick={() => props.onAction("send")}>{vi ? "Gửi" : "Send"}</button><button type="button" onClick={() => props.onAction("receive")}>{vi ? "Nhận" : "Receive"}</button><a href={ARC_EXPLORER_URL} target="_blank" rel="noreferrer">{vi ? "Khám phá Arc Testnet" : "Explore Arc Testnet"} ↗</a></div></div>}
      {activities.length > 0 && <ul className={styles.activity}>{activities.slice(0, 3).map((item) => <li key={activityIdentity(item)}>
        <ActivityIcon kind={item.kind === "swap" ? "swap" : item.kind === "bridge" ? "bridge" : item.direction === "receive" ? "receive" : "send"} />
        <div className={styles.activityContext}><strong>{item.kind === "swap" && item.swapReceive ? <>{activityLabel(item)} −{formatAssetAmount(item.amount, getAssetById(item.assetId)!)} {item.assetSymbol} → +{formatAssetAmount(item.swapReceive.amount, getAssetById(item.swapReceive.assetId)!)} {item.swapReceive.assetSymbol}</> : <>{activityLabel(item)} {item.direction === "receive" ? "+" : "−"}{formatAssetAmount(item.amount, getAssetById(item.assetId)!)} {item.assetSymbol}</>}</strong><span>{item.kind === "swap" ? "XyloNet StableSwap" : item.kind === "bridge" ? t("walletHome.bridgeRoute") : <>{t(item.direction === "receive" ? "walletHome.from" : "walletHome.to")} {shortAddress(item.counterparty)}</>} · {new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.confirmedAt))}</span>{item.kind === "swap" && <span className={styles.activityEvidence}>{item.swapReceive ? t("overview.actualReceived") : t("overview.receivedUnknown")}</span>}<span className={styles.activityEvidence}>{t(item.source === "onchain" ? "overview.onchainObserved" : "overview.locallyObserved")}</span></div>
        <span className={`${styles.activityStatus} ${item.kind === "bridge" ? styles.activityStatusSource : ""}`}>{item.kind === "bridge" ? t("overview.sourceConfirmed") : t("overview.confirmed")}</span>
        <div className={styles.activityLinks}>{item.source !== "onchain" && <button type="button" onClick={() => props.onReceipt(item)}>{t("overview.receipt")}</button>}<a href={arcScanTransactionUrl(item.hash)} target="_blank" rel="noreferrer">ArcScan ↗</a></div>
      </li>)}</ul>}
    </section>
  </div>;
}

function ActionIcon({ action }: { action: OverviewAction }) {
  const paths = { send: "M7 17 17 7M8 7h9v9", receive: "m7 7 10 10M16 7v10H6", swap: "M5 8h12l-3-3M17 16H5l3 3", bridge: "M3 19v-2a9 9 0 0 1 18 0v2M7 19v-2a5 5 0 0 1 10 0v2" };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[action]} /></svg>;
}

type ActivityIconKind = "send" | "receive" | "swap" | "bridge";

function ActivityIcon({ kind }: { kind: ActivityIconKind }) {
  const paths: Record<ActivityIconKind, ReactNode> = {
    send: <><path d="M7 17 17 7" /><path d="M9 7h8v8" /></>,
    receive: <><path d="M12 5v13" /><path d="m7 13 5 5 5-5" /></>,
    swap: <><path d="M5 8h12l-3-3" /><path d="M19 16H7l3 3" /></>,
    bridge: <><circle cx="6" cy="17" r="2" /><circle cx="18" cy="17" r="2" /><path d="M4 15a8 8 0 0 1 16 0M8 15a4 4 0 0 1 8 0" /></>,
  };
  const tone = `${kind[0].toUpperCase()}${kind.slice(1)}`;
  return <span className={`${styles.activityIcon} ${styles[`activityIcon${tone}`]}`} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[kind]}</svg></span>;
}
