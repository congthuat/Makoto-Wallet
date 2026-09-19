"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { translate, type Locale, type TranslationKey } from "../i18n";
import { formatAssetAmount, getAssetById } from "../lib/assets";
import { shortAddress } from "../lib/format";
import { filterActivity, type ActivityFilter } from "../lib/indexer/filter";
import { modalTabStops, modalWrapTarget } from "../lib/modalFocus";
import { activityIdentity } from "../lib/onchainActivity";
import { arcScanTransactionUrl, type WalletActivity } from "../lib/wallet";
import styles from "./MakotoWallet.module.css";

type Props = {
  activities: WalletActivity[];
  locale: Locale;
  limit: number;
  loading: boolean;
  loadingMore: boolean;
  partial: boolean;
  unavailable: boolean;
  canLoadMore: boolean;
  onClose(): void;
  onLoadMore(): void;
  onRefresh(): void;
  onReceipt(activity: WalletActivity): void;
};

type Copy = (key: TranslationKey) => string;

const FILTERS: ActivityFilter[] = ["all", "send", "receive", "swap", "bridge", "vault"];
const FILTER_KEYS: Record<ActivityFilter, TranslationKey> = {
  all: "activityHistory.filter.all",
  send: "activityHistory.filter.send",
  receive: "activityHistory.filter.receive",
  swap: "activityHistory.filter.swap",
  bridge: "activityHistory.filter.bridge",
  vault: "activityHistory.filter.vault",
};

/**
 * Display-only, confirmed activity history. Loading and receipt ownership remain
 * in the dashboard so this panel cannot imply a submission or add a retry path.
 */
export function ActivityHistoryPanel({ activities, locale, limit, loading, loadingMore, partial, unavailable, canLoadMore, onClose, onLoadMore, onRefresh, onReceipt }: Props) {
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [search, setSearch] = useState("");
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const t: Copy = (key) => translate(locale, key);
  const filtered = useMemo(() => filterActivity(activities, filter, search), [activities, filter, search]);

  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (panelRef.current) panelRef.current.scrollTop = 0;
    panelRef.current?.focus();

    const handleKey = (event: KeyboardEvent) => {
      const panel = panelRef.current;
      // A receipt can sit above this history. Let its own modal own the keyboard.
      if (!panel?.contains(document.activeElement)) return;
      if (event.key === "Escape") { closeRef.current(); return; }
      if (event.key !== "Tab") return;
      const target = modalWrapTarget(modalTabStops(panel), document.activeElement, event.shiftKey, panel);
      if (target instanceof HTMLElement) { event.preventDefault(); target.focus(); }
    };

    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousBodyOverflow;
      previous?.focus();
    };
  }, []);

  return <div className={styles.activityHistoryLayer} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panelRef} tabIndex={-1} className={styles.activityHistoryPanel} role="dialog" aria-modal="true" aria-labelledby="activity-history-title" aria-describedby="activity-history-context">
      <header>
        <div>
          <small id="activity-history-context">{t("network.arc")} · {partial ? t("activityHistory.partial") : t("activityHistory.synced")}</small>
          <h2 id="activity-history-title">{t("activityHistory.title")}</h2>
        </div>
        <div className={styles.activityHeaderActions}>
          <button type="button" onClick={onRefresh} disabled={loading}>{loading ? t("common.refreshing") : t("common.refresh")}</button>
          <button type="button" onClick={onClose} aria-label={t("common.close")}>×</button>
        </div>
      </header>

      <div className={styles.activityTools}>
        <div className={styles.activityFilters} role="group" aria-label={t("activityHistory.title")}>
          {FILTERS.map((value) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{t(FILTER_KEYS[value])}</button>)}
        </div>
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("activityHistory.searchPlaceholder")} aria-label={t("activityHistory.searchLabel")} aria-controls="activity-history-results" />
      </div>

      <div id="activity-history-results" className={styles.activityHistoryResults} aria-busy={loading}>
        {loading && activities.length === 0 ? <div className={styles.activitySkeleton} role="status" aria-live="polite" aria-label={t("activityHistory.loading")}>{Array.from({ length: 5 }, (_, index) => <span key={index} />)}</div>
          : unavailable && activities.length === 0 ? <p className={styles.activityPartialWarning} role="status">{t("activityHistory.partialUnavailable")}</p>
            : activities.length === 0 ? <div className={styles.emptyActivity} role="status"><strong>{t("activityHistory.emptyTitle")}</strong><span>{t("activityHistory.emptyCopy")}</span></div>
              : <>
                {partial && <p className={styles.activityPartialWarning} role="status">{unavailable ? t("activityHistory.partialUnavailable") : t("activityHistory.partialCopy")}</p>}
                {filtered.length === 0 ? <div className={styles.emptyActivity} role="status"><strong>{t("activityHistory.noResults")}</strong></div>
                  : <ul className={styles.activityList}>{filtered.slice(0, limit).map((item) => <ActivityRow key={activityIdentity(item)} item={item} locale={locale} t={t} onReceipt={onReceipt} />)}</ul>}
                {canLoadMore && <button type="button" className={styles.activityLoadMore} onClick={onLoadMore} disabled={loadingMore}>{loadingMore ? t("activityHistory.loadingMore") : t("activityHistory.loadMore")}</button>}
              </>}
      </div>
    </section>
  </div>;
}

function ActivityRow({ item, locale, t, onReceipt }: { item: WalletActivity; locale: Locale; t: Copy; onReceipt(activity: WalletActivity): void }) {
  const asset = getAssetById(item.assetId)!;
  const amount = formatAssetAmount(item.amount, asset);
  const action = activityAction(item, t);
  const context = activityContext(item, t);
  const dateTime = new Date(item.confirmedAt).toISOString();
  const time = formatTime(item.confirmedAt, locale);
  const status = item.source === "local" ? t("activityHistory.status.confirmedLocal") : t("activityHistory.status.confirmed");
  const evidence = item.source === "local" ? t("overview.locallyObserved") : item.source === "onchain" ? t("overview.onchainObserved") : t("activityHistory.status.confirmed");
  const signedAmount = `${item.direction === "receive" ? "+" : "−"}${amount} ${item.assetSymbol}`;

  return <li className={styles.activityHistoryRow}>
    <Image src={item.kind === "swap" ? "/makoto/icon-swap-pro-v2.png" : item.direction === "receive" ? "/makoto/icon-receive-pro-v2.png" : "/makoto/icon-send-pro-v2.png"} alt="" width={54} height={54} className={styles.activityIcon} />
    <div className={styles.activityMain}>
      <div className={styles.activityHeadline}><strong>{action}</strong><strong className={styles.activityAmount}>{signedAmount}</strong></div>
      <span className={styles.activityContext} title={context.fullValue}>{context.label}: {context.value}</span>
      {item.kind === "swap" && <span className={styles.activitySwapReceive}>{item.swapReceive ? `${t("overview.actualReceived")}: +${formatAssetAmount(item.swapReceive.amount, getAssetById(item.swapReceive.assetId)!)} ${item.swapReceive.assetSymbol}` : t("overview.receivedUnknown")}</span>}
      <time dateTime={dateTime}>{time}</time>
    </div>
    <span className={styles.activityStatus}>{status}</span>
    <div className={styles.activityActions}>
      {item.source !== "onchain" && <button type="button" onClick={() => onReceipt(item)}>{t("overview.receipt")}</button>}
      <a href={arcScanTransactionUrl(item.hash)} target="_blank" rel="noreferrer" className={styles.activityLink} aria-label={`${action} · ${t("activityHistory.viewOnArcScan")} · ${item.hash}`}>{t("activityHistory.viewOnArcScan")} ↗</a>
    </div>
    <details className={styles.activityEvidence}>
      <summary>{t("activityHistory.evidenceSummary")}</summary>
      <dl>
        <div><dt>{t("activityHistory.network")}</dt><dd>{t("network.arc")}</dd></div>
        <div><dt>{context.label}</dt><dd>{context.fullValue ?? context.value}</dd></div>
        <div><dt>{t("activityHistory.time")}</dt><dd><time dateTime={dateTime}>{time}</time></dd></div>
        <div><dt>{t("activityHistory.transaction")}</dt><dd><code>{item.hash}</code></dd></div>
        <div><dt>{t("activityHistory.evidence")}</dt><dd>{evidence}</dd></div>
      </dl>
    </details>
  </li>;
}

function activityAction(item: WalletActivity, t: Copy) {
  if (item.kind === "swap") return t("activityHistory.action.swap");
  if (item.kind === "bridge") return t("activityHistory.action.bridge");
  if (item.kind === "vault-deposit") return t("activityHistory.action.vaultDeposit");
  if (item.kind === "vault-withdraw") return t("activityHistory.action.vaultWithdraw");
  return t(item.direction === "receive" ? "activityHistory.action.receive" : "activityHistory.action.send");
}

function activityContext(item: WalletActivity, t: Copy) {
  if (item.kind === "swap") return { label: t("activityHistory.protocol"), value: t("activityHistory.swapProtocol") };
  if (item.kind === "bridge") return { label: t("activityHistory.route"), value: t("activityHistory.bridgeRoute") };
  if (item.kind === "vault-deposit" || item.kind === "vault-withdraw") return { label: t("activityHistory.route"), value: t("activityHistory.vaultName") };
  const fullValue = item.counterparty;
  return { label: t(item.direction === "receive" ? "activityHistory.from" : "activityHistory.to"), value: shortAddress(fullValue), fullValue };
}

function formatTime(timestamp: number, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp));
}
