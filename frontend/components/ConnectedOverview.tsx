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

/** Display only. Queries, eligibility and all transaction controllers stay in WalletDashboard. */
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
  const label = (item: WalletActivity) => {
    if (item.kind === "swap") return t("walletHome.swap");
    if (item.kind === "bridge") return t("walletHome.bridge");
    if (item.kind === "vault-deposit") return t("overview.vaultDeposit");
    if (item.kind === "vault-withdraw") return t("overview.vaultWithdraw");
    return t(item.direction === "receive" ? "walletHome.receive" : "walletHome.send");
  };
  return <div className={styles.overview}>

    <div className={styles.mainColumn}>
    <section className={`${styles.holdings} ${vi ? styles.vietnameseHoldings : ""}`.trim()} aria-labelledby="holdings-title">
      <div className={styles.heroArt} aria-hidden="true" />
      <div className={styles.heroCopy}>
        <p className={styles.eyebrow}>{!onArc ? t("overview.wrongNetwork") : vi ? "VÍ CỦA BẠN TRÊN ARC TESTNET" : "YOUR WALLET ON ARC TESTNET"}</p>
        <h1 id="holdings-title">{t("overview.holdings")}</h1>
        <div className={styles.holdingsSummary} aria-label={t("overview.holdings")}>
          <strong>{t("overview.assetCount", { count: SUPPORTED_ASSETS.length })}</strong>
        </div>
      </div>
      <dl className={styles.figures}>{SUPPORTED_ASSETS.map(asset => <div key={asset.id}>
        <dt><span className={styles.tokenIcon} aria-hidden="true">{asset.id === "usdc" ? "$" : asset.id === "eurc" ? "€" : "₿"}</span><span><strong>{asset.symbol}</strong><small>{asset.name}</small></span></dt>
        <dd aria-live="polite" aria-atomic="true"><span className={onArc && !balances[asset.id].isError && balances[asset.id].data !== undefined ? styles.figure : styles.balanceState}>{balance(asset.id)}</span></dd>
      </div>)}</dl>
      <p className={styles.denomination}>{t("overview.denomination")}</p>
    </section>

    <section className={styles.actions} aria-label={t("agentDashboard.primaryCommands")}>
      {(["send", "receive", "swap", "bridge"] as const).map(action => <button key={action} type="button" disabled={!onArc} onClick={() => props.onAction(action)}>
        <ActionIcon action={action} /><span><strong>{t(`walletHome.${action}`)}</strong><small>{(vi ? { send: "Gửi tới địa chỉ khác", receive: "Nhận vào ví của bạn", swap: "Đổi USDC và EURC", bridge: "Chuyển giữa các mạng" } : { send: "Send to another address", receive: "Receive to your wallet", swap: "Exchange USDC & EURC", bridge: "Move across networks" })[action]}</small></span><span className={styles.actionChevron} aria-hidden="true">›</span>
      </button>)}
    </section>

    <div className={styles.lowerGrid}>
    <section className={styles.ledger} id="activity" aria-labelledby="recent-activity-title">
      <header><h2 id="recent-activity-title">{t("overview.recentActivity")}</h2><button type="button" onClick={props.onHistory}>{t("walletHome.viewAll")}</button></header>
      {!onArc ? <p role="status">{t("walletHome.activityWrongNetwork")}</p> : <>
        <div role="status">
          {props.activityLoading && <p>{t("walletHome.activityLoading")}</p>}
          {props.activityUnavailable ? <p className={styles.attention}>{t("overview.historyUnavailable")} <button type="button" onClick={props.onRefresh}>{t("common.tryAgain")}</button></p> : props.activityPartial && <p className={styles.attention}>{t("overview.historyPartial")}</p>}
          {!props.activityLoading && !props.activityUnavailable && activities.length === 0 && <div className={styles.emptyActivity}><svg className={styles.emptyIcon} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M33 48H15V9h32v20M23 20h16M23 28h10"/><circle cx="43" cy="43" r="13"/><path d="M43 35v9l6 4"/></svg><strong>{t("walletHome.noActivity")}</strong><p>{vi ? "Hoạt động trên chuỗi của bạn sẽ xuất hiện tại đây." : "Your onchain activity will appear here as you use Makoto."}</p><a href={ARC_EXPLORER_URL} target="_blank" rel="noreferrer">{vi ? "Khám phá Arc Testnet" : "Explore Arc Testnet"} ↗</a></div>}
        </div>
        {activities.length > 0 && <ul className={styles.activity}>{activities.slice(0, 3).map(item => <li key={activityIdentity(item)}>
          <div className={styles.activityContext}><strong>{label(item)}</strong><span>{item.kind === "swap" ? "XyloNet StableSwap" : item.kind === "bridge" ? t("walletHome.bridgeRoute") : <>{t(item.direction === "receive" ? "walletHome.from" : "walletHome.to")} <span title={item.counterparty}>{shortAddress(item.counterparty)}</span></>}</span><time dateTime={new Date(item.confirmedAt).toISOString()}>{new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.confirmedAt))}</time></div>
          <div className={styles.activityAmount}>
            <strong>{item.direction === "receive" ? "+" : "−"}{formatAssetAmount(item.amount, getAssetById(item.assetId)!)} {item.assetSymbol}</strong>
            {item.kind === "swap" && (item.swapReceive ? <span>{t("overview.actualReceived")}: +{formatAssetAmount(item.swapReceive.amount, getAssetById(item.swapReceive.assetId)!)} {item.swapReceive.assetSymbol}</span> : <span>{t("overview.receivedUnknown")}</span>)}
            <span>{item.kind === "bridge" ? t("overview.sourceConfirmed") : t("overview.confirmed")} · {t(item.source === "onchain" ? "overview.onchainObserved" : "overview.locallyObserved")}</span>
          </div>
          <div className={styles.activityLinks}>{item.source !== "onchain" && <button type="button" onClick={() => props.onReceipt(item)}>{t("overview.receipt")}</button>}<a href={arcScanTransactionUrl(item.hash)} target="_blank" rel="noreferrer" aria-label={`${label(item)} · ${t("overview.viewTransaction")} · ${item.hash}`}>ArcScan ↗</a></div>
        </li>)}</ul>}
      </>}
    </section>

    <section className={styles.agent} aria-labelledby="dashboard-agent-title">
      <header><div><h2 id="dashboard-agent-title">{t("overview.agentTitle")} <span className={styles.beta}>BETA</span></h2><p>{vi ? "Đọc & chuẩn bị. Bạn xác nhận." : "Read & prepare only. You confirm."}</p></div><a href="/agent" aria-label={t("overview.openAgent")}>↗</a></header>
      <div className={styles.agentIntro}><span aria-hidden="true">✳</span><p><strong>{vi ? "Tôi là Makoto." : "I'm Makoto."}</strong>{vi ? "Tôi có thể phân tích thông tin ví và chuẩn bị giao dịch để bạn xem xét. Bạn luôn kiểm tra và ký trong ví." : "I can explain your wallet context and prepare transactions for your review. You always review and sign in your wallet."}</p></div>
      <ol className={styles.agentSteps}><li><b>1</b>{vi ? "Phân tích" : "Analyze"}</li><li><b>2</b>{vi ? "Chuẩn bị" : "Prepare"}</li><li><b>3</b>{vi ? "Xem xét" : "Review"}</li></ol>
      {props.children}
    </section>
    </div>
    <details className={styles.assetDisclosure} id="assets">
      <summary>{t("overview.assets")} / {t("overview.contractDetails")}</summary>
      <section className={styles.ledger} aria-label={t("overview.assets")}>
        <ul className={styles.assets}>{SUPPORTED_ASSETS.map(asset => <li key={asset.id}>
          <div><strong>{asset.symbol}</strong><span>{asset.name}</span></div>
          <div className={styles.assetAmount}><strong>{balance(asset.id)} {onArc && !balances[asset.id].isError && balances[asset.id].data !== undefined ? asset.symbol : ""}</strong></div>
          <a className={styles.assetDetails} href={`${ARC_EXPLORER_URL}/address/${asset.address}`} target="_blank" rel="noreferrer">{asset.address} ↗</a>
        </li>)}</ul>
      </section>
    </details>
    </div>
    <aside className={styles.rightRail} aria-label={vi ? "Ví và bảo mật" : "Wallet and security"}>
      <section className={styles.networkCard} aria-labelledby="network-wallet-title">
        <header><h2 id="network-wallet-title">{vi ? "Mạng & Ví" : "Network & Wallet"}</h2><span className={styles.connectionBadge}>{t("overview.connected")}</span></header>
        <dl className={styles.facts}>
          <div><dt>{vi ? "Mạng" : "Network"}</dt><dd>{onArc ? "Arc Testnet" : t("overview.wrongNetwork")}</dd></div>
          <div><dt>{vi ? "Địa chỉ ví" : "Wallet address"}</dt><dd>{props.address ? <a href={`${ARC_EXPLORER_URL}/address/${props.address}`} title={props.address} target="_blank" rel="noreferrer">{shortAddress(props.address)} ↗</a> : t("overview.unavailable")}</dd></div>
          <div><dt>Chain ID</dt><dd>{props.chainId ?? t("overview.unavailable")}</dd></div>
          <div><dt>{vi ? "Token gas trên Arc" : "Arc gas token"}</dt><dd>USDC <span>(Testnet)</span></dd></div>
          <div><dt>{vi ? "Nhà cung cấp" : "Wallet provider"}</dt><dd>{props.connectorName ?? t("overview.unavailable")}</dd></div>
        </dl>
        {!onArc && <p className={styles.networkNotice}>{t("overview.switchNetwork")}</p>}
        {props.walletKind === "local" && <div className={styles.accountDetails}>
          <p>Local wallet: {props.walletStatus === "connected" ? "Unlocked" : "Locked"}</p>
          {props.walletStatus === "connected"
            ? <button type="button" onClick={props.onLock}>Lock local wallet</button>
            : <button type="button" onClick={props.onUnlock}>Unlock local wallet</button>}
        </div>}
        <details className={styles.accountDetails}><summary>{t("overview.accountDetails")}</summary><p>{props.address ?? t("overview.unavailable")}</p></details>
      </section>
      <section className={styles.securityCard} aria-labelledby="overview-security-title">
        <header><h2 id="overview-security-title">{vi ? "Bảo mật" : "Security"}</h2></header>
        <dl className={styles.facts}>
          <div><dt>{vi ? "Khóa ứng dụng" : "App Lock"}</dt><dd>{!props.appLock?.initialized ? (vi ? "Đang kiểm tra" : "Checking") : !props.appLock.available ? t("overview.unavailable") : props.appLock.enabled ? (vi ? "Đã bật" : "Enabled") : (vi ? "Chưa bật" : "Not enabled")}</dd></div>
          <div><dt>{vi ? "Ký giao dịch" : "Transaction signing"}</dt><dd>{vi ? "Bạn xác nhận" : "You confirm"}</dd></div>
        </dl>
        <a className={styles.securityLink} href="/settings#security">{vi ? "Tùy chọn bảo mật" : "Security preferences"}<span aria-hidden="true">↗</span></a>
        <div className={styles.securityNote}><p>{vi ? "Khóa ứng dụng bảo vệ quyền truy cập trên trình duyệt này. Ví của bạn vẫn kiểm soát và ký mọi giao dịch." : "App Lock protects access on this browser. Your wallet remains in control of every signature."}</p></div>
        <blockquote>{vi ? "Tài sản của bạn. Quyết định của bạn." : "Your assets. Your decisions."}<cite>— MAKOTO</cite></blockquote>
      </section>
    </aside>
  </div>;
}

function ActionIcon({ action }: { action: OverviewAction }) {
  const paths = { send: "M7 17 17 7M8 7h9v9", receive: "m7 7 10 10M16 7v10H6", swap: "M5 8h12l-3-3M17 16H5l3 3", bridge: "M3 19v-2a9 9 0 0 1 18 0v2M7 19v-2a5 5 0 0 1 10 0v2" };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[action]} /></svg>;
}
