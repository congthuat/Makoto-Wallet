"use client";

import { useEffect, useMemo, useState } from "react";
import { usePublicClient } from "wagmi";
import { arcTestnet } from "viem/chains";
import type { Address } from "viem";

import { usePreferences } from "@/hooks/usePreferences";
import { formatAssetAmount, getAssetById } from "@/lib/assets";
import { loadContacts } from "@/lib/contacts";
import { shortAddress } from "@/lib/format";
import { buildCanonicalReceiptText, classifyReceiptConfirmation, verifyTransactionReceipt, type ReceiptConfirmationStatus, type ReceiptVerification } from "@/lib/transactionReceipt";
import { arcScanTransactionUrl, type WalletActivity } from "@/lib/wallet";
import { WalletPanel } from "./WalletPanel";

type ReceiptState = { status: "loading" } | { status: "unavailable" } | { status: "ready"; verification: ReceiptVerification };

/**
 * Presentation only. Receipt evidence and its owner stay bound to the selected
 * activity below; this component never promotes a hash or expected amount into
 * confirmation evidence.
 */
export function TransactionReceiptPanel({ activity, walletAddress, onClose }: { activity: WalletActivity; walletAddress: Address; onClose(): void }) {
  const { locale, t } = usePreferences();
  const client = usePublicClient({ chainId: arcTestnet.id });
  // Match the complete verification context, including same-hash activity changes.
  const owner = useMemo(() => ({ activity, walletAddress, client }), [activity, walletAddress, client]);
  const [ownedState, setState] = useState<ReceiptState & { owner: typeof owner }>({ owner, status: "loading" });
  // Effects run after render: never expose another selection's evidence meanwhile.
  const state: ReceiptState = ownedState.owner === owner ? ownedState : { status: "loading" };
  const [copied, setCopied] = useState(false);
  const [shareAvailable, setShareAvailable] = useState(false);
  const contacts = useMemo(() => loadContacts(walletAddress, arcTestnet.id), [walletAddress]);

  useEffect(() => { queueMicrotask(() => setShareAvailable(typeof navigator.share === "function")); }, []);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) setState({ owner, status: "loading" }); });
    if (!client) { queueMicrotask(() => { if (active) setState({ owner, status: "unavailable" }); }); return () => { active = false; }; }
    void client.getTransactionReceipt({ hash: activity.hash }).then((receipt) => {
      if (!active) return;
      setState({ owner, status: "ready", verification: verifyTransactionReceipt(activity, walletAddress, receipt) });
    }).catch(() => { if (active) setState({ owner, status: "unavailable" }); });
    return () => { active = false; };
  }, [activity, client, walletAddress, owner]);

  const verification = state.status === "ready" ? state.verification : undefined;
  const confirmationStatus: ReceiptConfirmationStatus = state.status === "ready" ? classifyReceiptConfirmation(verification) : "submitted-unknown";
  const from = verification?.from ?? (activity.direction === "send" ? walletAddress : activity.counterparty);
  const to = verification?.to ?? (activity.direction === "send" ? activity.counterparty : walletAddress);
  const contactFor = (address: Address) => contacts.find((contact) => contact.address.toLowerCase() === address.toLowerCase())?.name;
  const receiptText = verification ? buildCanonicalReceiptText(activity, verification, locale) : undefined;
  const title = activity.kind === "swap" ? t("receipt.action.swap") : activity.kind === "bridge" ? t("receipt.action.bridge") : activity.direction === "send" ? t("receipt.action.send") : t("receipt.action.receive");
  const asset = getAssetById(activity.assetId)!;
  const actualSwapReceive = confirmationStatus === "confirmed-success" ? activity.swapReceive : undefined;
  const statusHeading = state.status === "unavailable" ? t("receipt.status.unavailable") : confirmationStatus === "confirmed-success" ? t("receipt.status.confirmed") : confirmationStatus === "confirmed-failure" ? t("receipt.status.failed") : t("receipt.status.unknown");
  const statusDetail = state.status === "unavailable" ? t("receipt.detail.unavailable") : confirmationStatus === "confirmed-success" ? t("receipt.detail.confirmed") : confirmationStatus === "confirmed-failure" ? t("receipt.detail.failed") : t("receipt.detail.unknown");
  const statusIcon = confirmationStatus === "confirmed-success" ? "✓" : confirmationStatus === "confirmed-failure" ? "!" : "?";
  const routeDetail = confirmationStatus === "confirmed-success" ? t("receipt.route.confirmed") : confirmationStatus === "confirmed-failure" ? t("receipt.route.failed") : t("receipt.route.unknown");
  const recordedAt = new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(activity.confirmedAt));
  const isRecoveryContext = confirmationStatus === "submitted-unknown";

  async function copyReceipt() { if (!receiptText) return; await navigator.clipboard.writeText(receiptText); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }
  async function shareReceipt() { if (!receiptText || !navigator.share) return; try { await navigator.share({ title: t("receipt.shareTitle"), text: receiptText, url: arcScanTransactionUrl(activity.hash) }); } catch { /* Cancellation is not an error state. */ } }

  return <WalletPanel title={t("receipt.title")} onClose={onClose}>
    <div className="receipt-card receipt-panel" data-receipt-panel>
      {state.status === "loading" ? <p className="receipt-loading" role="status">{t("receipt.loading")}</p> : <>
        <section className={`receipt-status receipt-status-${confirmationStatus}`} role="status" data-receipt-status={confirmationStatus} aria-live="polite">
          <span aria-hidden="true">{statusIcon}</span><div><p className="receipt-status-label">{t("receipt.confirmation")}</p><h3>{statusHeading}</h3><p role={confirmationStatus === "confirmed-success" ? undefined : "alert"}>{statusDetail}</p></div>
        </section>

        <section className="receipt-hero" aria-labelledby="receipt-intent">
          <p className="receipt-eyebrow">{t("receipt.intent")}</p><h3 id="receipt-intent">{title}</h3>
          <dl className="receipt-amounts">
            <div><dt>{activity.kind === "swap" || activity.kind === "bridge" || activity.direction === "send" ? (confirmationStatus === "confirmed-success" ? t("receipt.sent") : t("receipt.intendedAmount")) : t("receipt.amount")}</dt><dd>{formatAssetAmount(activity.amount, asset)} {activity.assetSymbol}</dd></div>
            {activity.kind === "swap" && <div data-actual-received={actualSwapReceive ? "evidenced" : "unknown"}><dt>{t("receipt.actualReceived")}</dt><dd>{actualSwapReceive ? `${formatAssetAmount(actualSwapReceive.amount, getAssetById(actualSwapReceive.assetId)!)} ${actualSwapReceive.assetSymbol}` : t("receipt.actualReceivedUnknown")}</dd></div>}
          </dl>
        </section>

        <section className="receipt-section" aria-labelledby="receipt-route">
          <h3 id="receipt-route">{t("receipt.routeTitle")}</h3><dl className="receipt-summary">
            <ReceiptAddress label={t("receipt.from")} address={from} contact={contactFor(from)} />
            <ReceiptAddress label={t("receipt.to")} address={to} contact={contactFor(to)} />
            {activity.kind === "swap" && <ReceiptFact label={t("receipt.protocol")} value={t("receipt.swapProtocol")} />}
            {activity.kind === "bridge" && <ReceiptFact label={t("receipt.route")} value={t("receipt.bridgeRoute")} detail={routeDetail} />}
            <ReceiptFact label={t("receipt.network")} value={t("network.arc")} />
            <ReceiptFact label={t("receipt.recordedAt")} value={recordedAt} />
          </dl>
        </section>

        {isRecoveryContext && <section className="receipt-recovery" aria-labelledby="receipt-recovery-title">
          <div><p className="receipt-eyebrow">{t("receipt.recoveryEyebrow")}</p><h3 id="receipt-recovery-title">{t("receipt.recoveryTitle")}</h3><p>{t("receipt.recoveryCopy")}</p></div>
          <dl><ReceiptFact label={t("receipt.transaction")} value={activity.hash} hash /><ReceiptFact label={t("receipt.network")} value={t("network.arc")} /><ReceiptFact label={t("receipt.recordedAt")} value={recordedAt} /></dl>
          <a href={arcScanTransactionUrl(activity.hash)} target="_blank" rel="noreferrer" aria-label={`${t("receipt.viewOnArcScan")}: ${activity.hash}`}>{t("receipt.viewOnArcScan")} <span aria-hidden="true">↗</span></a>
        </section>}

        {confirmationStatus === "confirmed-success" && verification?.memo && <section className="receipt-memo" aria-label={t("receipt.memo")}><small>{verification.memo.text ? t("receipt.memo") : t("receipt.memoData")}</small><strong>{verification.memo.text ?? `${verification.memo.data.slice(0, 22)}…`}</strong><span>✓ {t("receipt.memoVerified")}</span></section>}

        <details className="receipt-details"><summary>{t("receipt.evidence")}</summary><dl>
          <ReceiptFact label={t("receipt.block")} value={(verification?.blockNumber ?? activity.blockNumber).toString()} />
          <ReceiptFact label={t("receipt.transaction")} value={activity.hash} hash />
          {confirmationStatus === "confirmed-success" && verification?.memo && <><ReceiptFact label={t("receipt.memoId")} value={verification.memo.memoId} hash /><ReceiptFact label={t("receipt.memoIndex")} value={verification.memo.memoIndex.toString()} /></>}
        </dl></details>

        <div className="receipt-actions"><button type="button" onClick={() => void copyReceipt()} disabled={!receiptText}>{copied ? t("receipt.copied") : t("receipt.copy")}</button>{shareAvailable && <button type="button" onClick={() => void shareReceipt()} disabled={!receiptText}>{t("receipt.share")}</button>}<a href={arcScanTransactionUrl(activity.hash)} target="_blank" rel="noreferrer" aria-label={`${t("receipt.viewOnArcScan")}: ${activity.hash}`}>{t("receipt.viewOnArcScan")} <span aria-hidden="true">↗</span></a></div>
      </>}
    </div>
  </WalletPanel>;
}

function ReceiptAddress({ label, address, contact }: { label: string; address: Address; contact?: string }) { return <div><dt>{label}</dt><dd>{contact && <strong>{contact}</strong>}<span>{shortAddress(address)}</span><small>{address}</small></dd></div>; }
function ReceiptFact({ label, value, detail, hash = false }: { label: string; value: string; detail?: string; hash?: boolean }) { return <div><dt>{label}</dt><dd className={hash ? "receipt-hash" : undefined}>{value}{detail && <small>{detail}</small>}</dd></div>; }
