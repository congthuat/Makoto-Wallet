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

export function TransactionReceiptPanel({ activity, walletAddress, onClose }: { activity: WalletActivity; walletAddress: Address; onClose(): void }) {
  const { locale } = usePreferences();
  const vi = locale === "vi";
  const client = usePublicClient({ chainId: arcTestnet.id });
  const [state, setState] = useState<ReceiptState>({ status: "loading" });
  const [copied, setCopied] = useState(false);
  const [shareAvailable, setShareAvailable] = useState(false);
  const contacts = useMemo(() => loadContacts(walletAddress, arcTestnet.id), [walletAddress]);

  useEffect(() => { queueMicrotask(() => setShareAvailable(typeof navigator.share === "function")); }, []);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) setState({ status: "loading" }); });
    if (!client) { queueMicrotask(() => { if (active) setState({ status: "unavailable" }); }); return () => { active = false; }; }
    void client.getTransactionReceipt({ hash: activity.hash }).then((receipt) => {
      if (!active) return;
      setState({ status: "ready", verification: verifyTransactionReceipt(activity, walletAddress, receipt) });
    }).catch(() => { if (active) setState({ status: "unavailable" }); });
    return () => { active = false; };
  }, [activity, client, walletAddress]);

  const verification = state.status === "ready" ? state.verification : undefined;
  const confirmationStatus: ReceiptConfirmationStatus = state.status === "ready" ? classifyReceiptConfirmation(verification) : "submitted-unknown";
  const from = verification?.from ?? (activity.direction === "send" ? walletAddress : activity.counterparty);
  const to = verification?.to ?? (activity.direction === "send" ? activity.counterparty : walletAddress);
  const contactFor = (address: Address) => contacts.find((contact) => contact.address.toLowerCase() === address.toLowerCase())?.name;
  const receiptText = verification ? buildCanonicalReceiptText(activity, verification, locale) : undefined;
  const title = activity.kind === "swap" ? (vi ? "Hoán đổi" : "Swap") : activity.kind === "bridge" ? "Bridge" : activity.direction === "send" ? (vi ? "Gửi" : "Send") : (vi ? "Nhận" : "Receive");
  const asset = getAssetById(activity.assetId)!;
  const actualSwapReceive = confirmationStatus === "confirmed-success" ? activity.swapReceive : undefined;
  const statusHeading = state.status === "unavailable" ? (vi ? "Không thể xác định trạng thái" : "Confirmation unavailable") : confirmationStatus === "confirmed-success" ? (vi ? "Đã xác nhận" : "Confirmed") : confirmationStatus === "confirmed-failure" ? (vi ? "Xác nhận thất bại" : "Confirmed failure") : (vi ? "Đã gửi — chưa rõ trạng thái xác nhận" : "Submitted — confirmation status unknown");
  const statusDetail = state.status === "unavailable" ? (vi ? "Hiện không thể tải biên nhận này." : "This receipt is unavailable right now.") : confirmationStatus === "confirmed-success" ? (vi ? "✓ Đã xác minh trên Arc" : "✓ Verified on Arc") : confirmationStatus === "confirmed-failure" ? (vi ? "Arc trả về biên nhận giao dịch thất bại." : "Arc returned a reverted transaction receipt.") : (vi ? "Đã tìm thấy giao dịch, nhưng chưa thể xác minh đầy đủ chi tiết biên nhận." : "The transaction was found, but its receipt details could not be fully verified.");
  const statusIcon = confirmationStatus === "confirmed-success" ? "✓" : confirmationStatus === "confirmed-failure" ? "!" : "?";
  const routeDetail = confirmationStatus === "confirmed-success" ? (vi ? "Giao dịch phía Arc đã xác nhận" : "Arc-side transaction confirmed") : confirmationStatus === "confirmed-failure" ? (vi ? "Giao dịch phía Arc thất bại" : "Arc-side transaction failed") : (vi ? "Trạng thái xác nhận phía Arc chưa rõ" : "Arc-side confirmation status unknown");

  async function copyReceipt() { if (!receiptText) return; await navigator.clipboard.writeText(receiptText); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }
  async function shareReceipt() { if (!receiptText || !navigator.share) return; try { await navigator.share({ title: vi ? "Biên nhận Makoto Wallet" : "Makoto Wallet receipt", text: receiptText, url: arcScanTransactionUrl(activity.hash) }); } catch { /* Cancellation is not an error state. */ } }

  return <WalletPanel title={vi ? "Biên nhận giao dịch" : "Transaction receipt"} onClose={onClose}>
    <div className="receipt-card">
      {state.status === "loading" ? <p className="receipt-loading" role="status">{vi ? "Đang xác minh biên nhận trên Arc…" : "Verifying receipt on Arc…"}</p> : <>
        <div className={`receipt-status receipt-status-${confirmationStatus}`} role="status" data-receipt-status={confirmationStatus}>
          <span aria-hidden="true">{statusIcon}</span><div><strong>{statusHeading}</strong><p role={confirmationStatus === "confirmed-success" ? undefined : "alert"}>{statusDetail}</p></div>
        </div>
        <section className="receipt-hero" aria-labelledby="receipt-type"><small id="receipt-type">{title.toUpperCase()}</small>
          {activity.kind === "swap" ? <><strong>{formatAssetAmount(activity.amount, asset)} {activity.assetSymbol}</strong><span>→ {actualSwapReceive ? `${formatAssetAmount(actualSwapReceive.amount, getAssetById(actualSwapReceive.assetId)!)} ${actualSwapReceive.assetSymbol}` : (vi ? "Chưa rõ số tiền nhận" : "Received amount unavailable")}</span></> : <strong>{formatAssetAmount(activity.amount, asset)} {activity.assetSymbol}</strong>}
        </section>
        <dl className="receipt-summary">
          <ReceiptAddress label={vi ? "Từ" : "From"} address={from} contact={contactFor(from)} />
          <ReceiptAddress label={vi ? "Đến" : "To"} address={to} contact={contactFor(to)} />
          {activity.kind === "swap" && <div><dt>{vi ? "Giao thức" : "Protocol"}</dt><dd>XyloNet StableSwap</dd></div>}
          {activity.kind === "bridge" && <div><dt>{vi ? "Tuyến" : "Route"}</dt><dd>Arc Testnet → Base Sepolia<small>{routeDetail}</small></dd></div>}
          <div><dt>{vi ? "Mạng" : "Network"}</dt><dd>Arc Testnet</dd></div>
          <div><dt>{vi ? "Ngày" : "Date"}</dt><dd>{new Intl.DateTimeFormat(vi ? "vi-VN" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(activity.confirmedAt)}</dd></div>
        </dl>
        {verification?.memo && <section className="receipt-memo"><small>{verification.memo.text ? (vi ? "Ghi chú on-chain" : "On-chain note") : (vi ? "Dữ liệu memo on-chain" : "On-chain memo data")}</small><strong>{verification.memo.text ?? `${verification.memo.data.slice(0, 22)}…`}</strong><span>✓ {vi ? "Đã xác minh" : "Verified"}</span></section>}
        <details className="receipt-details"><summary>{vi ? "Chi tiết giao dịch" : "Transaction details"}</summary><dl><div><dt>{vi ? "Khối" : "Block"}</dt><dd>{verification?.blockNumber.toString() ?? activity.blockNumber.toString()}</dd></div><div><dt>{vi ? "Giao dịch" : "Transaction"}</dt><dd>{activity.hash}</dd></div>{verification?.memo && <><div><dt>Memo ID</dt><dd>{verification.memo.memoId}</dd></div><div><dt>Memo Index</dt><dd>{verification.memo.memoIndex.toString()}</dd></div></>}</dl></details>
        <div className="receipt-actions"><button type="button" onClick={() => void copyReceipt()} disabled={!receiptText}>{copied ? (vi ? "Đã sao chép" : "Copied") : (vi ? "Sao chép biên nhận" : "Copy receipt")}</button>{shareAvailable && <button type="button" onClick={() => void shareReceipt()} disabled={!receiptText}>{vi ? "Chia sẻ biên nhận" : "Share receipt"}</button>}<a href={arcScanTransactionUrl(activity.hash)} target="_blank" rel="noreferrer">ArcScan ↗</a></div>
      </>}
    </div>
  </WalletPanel>;
}

function ReceiptAddress({ label, address, contact }: { label: string; address: Address; contact?: string }) { return <div><dt>{label}</dt><dd>{contact && <strong>{contact}</strong>}<span>{shortAddress(address)}</span><small>{address}</small></dd></div>; }
