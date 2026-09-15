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
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
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
    <header className={styles.context}>
      <div><h1>{t("overview.title")}</h1><p>{props.connectorName ?? t("overview.connectedWallet")} · {t("overview.connected")}{props.address && <> · {shortAddress(props.address)}</>}</p></div>
      <div className={styles.network}>
        <strong>{onArc ? "Arc Testnet" : t("overview.wrongNetwork")}</strong>
        {!onArc && <span>{t("overview.switchNetwork")}</span>}
        <details><summary>{t("overview.accountDetails")}</summary><dl>
          <div><dt>{t("overview.account")}</dt><dd>{props.address ?? t("overview.unavailable")}</dd></div>
          <div><dt>{t("overview.chainId")}</dt><dd>{props.chainId ?? t("overview.unavailable")}</dd></div>
        </dl><a href="/settings#security">{t("overview.securityCenter")}</a><a href={props.address ? `${ARC_EXPLORER_URL}/address/${props.address}` : ARC_EXPLORER_URL} target="_blank" rel="noreferrer" aria-label={t("overview.viewAccount")}>ArcScan ↗</a></details>
      </div>
    </header>

    <section className={styles.holdings} aria-labelledby="holdings-title">
      <h2 id="holdings-title">{t("overview.holdings")}</h2>
      <dl className={styles.figures}>{SUPPORTED_ASSETS.map(asset => <div key={asset.id}>
        <dt>{asset.symbol}</dt><dd aria-live="polite" aria-atomic="true"><span className={onArc && !balances[asset.id].isError && balances[asset.id].data !== undefined ? styles.figure : styles.balanceState}>{balance(asset.id)}</span></dd>
      </div>)}</dl>
      <p>{t("overview.denomination")}</p>
    </section>

    <section className={styles.actions} aria-label={t("agentDashboard.primaryCommands")}>
      {(["send", "receive", "swap", "bridge"] as const).map(action => <button key={action} type="button" disabled={!onArc} onClick={() => props.onAction(action)}>
        <ActionIcon action={action} /><span>{t(`walletHome.${action}`)}</span>
      </button>)}
    </section>

    <section className={styles.ledger} id="assets" aria-labelledby="assets-title">
      <header><h2 id="assets-title">{t("overview.assets")}</h2><span>Arc Testnet</span></header>
      <ul className={styles.assets}>{SUPPORTED_ASSETS.map(asset => <li key={asset.id}>
        <div><strong>{asset.symbol}</strong><span>{asset.name}</span></div>
        <div className={styles.assetAmount}><span>{t("overview.balance")}</span><strong>{balance(asset.id)} {onArc && !balances[asset.id].isError && balances[asset.id].data !== undefined ? asset.symbol : ""}</strong></div>
        <details className={styles.assetDetails}><summary>{t("overview.contractDetails")}</summary><a href={`${ARC_EXPLORER_URL}/address/${asset.address}`} target="_blank" rel="noreferrer" aria-label={`${asset.symbol} · ${t("overview.contractDetails")} · ArcScan`}>{asset.address} ↗</a></details>
      </li>)}</ul>
    </section>

    <section className={styles.ledger} id="activity" aria-labelledby="recent-activity-title">
      <header><h2 id="recent-activity-title">{t("overview.recentActivity")}</h2><button type="button" onClick={props.onHistory}>{t("walletHome.viewAll")}</button></header>
      {!onArc ? <p role="status">{t("walletHome.activityWrongNetwork")}</p> : <>
        <div role="status">
          {props.activityLoading && <p>{t("walletHome.activityLoading")}</p>}
          {props.activityUnavailable ? <p className={styles.attention}>{t("overview.historyUnavailable")} <button type="button" onClick={props.onRefresh}>{t("common.tryAgain")}</button></p> : props.activityPartial && <p className={styles.attention}>{t("overview.historyPartial")}</p>}
          {!props.activityLoading && !props.activityUnavailable && activities.length === 0 && <p>{t("walletHome.noActivity")}</p>}
        </div>
        {activities.length > 0 && <ul className={styles.activity}>{activities.slice(0, 5).map(item => <li key={activityIdentity(item)}>
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
      <header><div><h2 id="dashboard-agent-title">{t("agentDashboard.title")}</h2><p>{t("overview.agentCopy")}</p></div><a href="/agent">{t("overview.openAgent")} ↗</a></header>
      <details><summary>{t("overview.prepareAction")}</summary>{props.children}</details>
    </section>
  </div>;
}

function ActionIcon({ action }: { action: OverviewAction }) {
  const paths = { send: "M7 17 17 7M8 7h9v9", receive: "m7 7 10 10M16 7v10H6", swap: "M5 8h12l-3-3M17 16H5l3 3", bridge: "M4 16V8m16 8V8M4 12h16M8 8l4-3 4 3" };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[action]} /></svg>;
}
