"use client";

import { useState } from "react";
import type { Address } from "viem";
import { arcTestnet } from "viem/chains";
import { QRCodeSVG } from "qrcode.react";
import { usePreferences } from "@/hooks/usePreferences";
import { shortAddress } from "@/lib/format";
import { formatAssetAmount, getAssetById, parseAssetAmount, SUPPORTED_ASSETS, type SupportedAssetId } from "@/lib/assets";
import { buildAddressQrPayload, buildErc20PaymentRequest } from "@/lib/paymentRequest";
import { arcScanAddressUrl } from "@/lib/wallet";
import { CopyButton, WalletPanel } from "./WalletPanel";
import "./SendReceive.css";

export function ReceivePanel({ address, onClose }: { address: Address; onClose(): void }) {
  const { locale } = usePreferences();
  const [assetId, setAssetId] = useState<SupportedAssetId>("usdc");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const selected = getAssetById(assetId)!;
  const atomicAmount = amount.trim() ? parseAssetAmount(amount, selected) : undefined;
  const amountInvalid = Boolean(amount.trim() && atomicAmount === undefined);
  const paymentUri = atomicAmount ? buildErc20PaymentRequest({ token: selected.address, recipient: address, chainId: arcTestnet.id, amount: atomicAmount }) : undefined;
  const qrPayload = paymentUri ?? buildAddressQrPayload(address);
  const displayAmount = atomicAmount ? formatAssetAmount(atomicAmount, selected) : undefined;
  const copy = locale === "vi" ? {
    title: "Nhận", network: "Arc Testnet · 5042002", asset: "Tài sản", contract: "Hợp đồng token", address: "Địa chỉ ví", copy: "Sao chép địa chỉ", copied: "Đã sao chép", warning: "Chỉ gửi tài sản được hỗ trợ trên Arc Testnet đến địa chỉ này.", amount: "Số tiền (không bắt buộc)", note: "Ghi chú", addNote: "+ Thêm ghi chú", invalidAmount: "Số tiền không hợp lệ. Hãy nhập số lớn hơn 0 với số chữ số thập phân hợp lệ cho tài sản đã chọn.", copyUri: "Sao chép URI thanh toán", copyDetails: "Sao chép chi tiết yêu cầu", copiedUri: "Đã sao chép URI", copiedDetails: "Đã sao chép chi tiết", details: "Chi tiết", addressQr: `QR địa chỉ ${selected.symbol} trên Arc Testnet`, paymentQr: `QR yêu cầu thanh toán ${displayAmount ?? ""} ${selected.symbol} trên Arc Testnet`, requestHeading: "Yêu cầu thanh toán Makoto", noteLabel: "Ghi chú",
  } : {
    title: "Receive", network: "Arc Testnet · 5042002", asset: "Asset", contract: "Token contract", address: "Wallet address", copy: "Copy address", copied: "Address copied", warning: "Only send supported assets on Arc Testnet to this address.", amount: "Amount (optional)", note: "Note", addNote: "+ Add note", invalidAmount: "Invalid amount. Enter more than 0 with the decimal precision supported by the selected asset.", copyUri: "Copy payment URI", copyDetails: "Copy request details", copiedUri: "Payment URI copied", copiedDetails: "Request details copied", details: "Details", addressQr: `${selected.symbol} address QR on Arc Testnet`, paymentQr: `QR payment request for ${displayAmount ?? ""} ${selected.symbol} on Arc Testnet`, requestHeading: "Makoto payment request", noteLabel: "Note",
  };
  const requestDetails = paymentUri && displayAmount ? [copy.requestHeading, `${displayAmount} ${selected.symbol}`, "Arc Testnet", address, ...(note.trim() ? [`${copy.noteLabel}: ${note.trim()}`] : [])].join("\n") : "";
  const presentation = locale === "vi" ? {
    request: "Yêu cầu số tiền cụ thể (không bắt buộc)",
    requestHint: "Thêm số tiền để tạo QR thanh toán. Ghi chú chỉ nằm trong chi tiết được chia sẻ, không nằm trong QR.",
    addressMode: "QR địa chỉ", paymentMode: "QR yêu cầu thanh toán",
    notReceived: "Chia sẻ địa chỉ hoặc yêu cầu không có nghĩa là tiền đã được nhận.",
  } : {
    request: "Request an amount (optional)",
    requestHint: "Add an amount to create a payment QR. Notes appear only in shared details, not in the QR.",
    addressMode: "Address QR", paymentMode: "Payment request QR",
    notReceived: "Sharing an address or request does not mean funds have been received.",
  };

  return (
    <WalletPanel title={copy.title} onClose={onClose}>
      <div className="wallet-flow receive-flow ledger-receive">
        <p className="receive-network-context">{copy.network}</p>
        <label htmlFor="receive-asset">{copy.asset}<select id="receive-asset" className="asset-selector" value={assetId} onChange={(event) => setAssetId(event.target.value as SupportedAssetId)}>{SUPPORTED_ASSETS.map((asset) => <option key={asset.id} value={asset.id}>{asset.symbol} · {asset.name}</option>)}</select></label>
        <div className="receive-address"><p id="receive-address-label">{copy.address}</p><code aria-labelledby="receive-address-label">{address}</code><CopyButton value={address} idle={copy.copy} copiedLabel={copy.copied} /></div>
        <p className="wallet-notice">{copy.warning}</p>
        <div className="receive-compact-grid">
          <div className="receive-qr-card" role="img" aria-label={paymentUri ? copy.paymentQr : copy.addressQr}><QRCodeSVG value={qrPayload} size={204} marginSize={2} title={paymentUri ? copy.paymentQr : copy.addressQr} /><strong>{displayAmount ? `${displayAmount} ${selected.symbol}` : selected.symbol} · Arc Testnet</strong><span>{paymentUri ? presentation.paymentMode : presentation.addressMode}</span></div>
          <details className="receive-request">
            <summary>{presentation.request}</summary>
            <div className="receive-controls">
              <p>{presentation.requestHint}</p>
              <label htmlFor="receive-amount">{copy.amount}<div className="wallet-field-with-action amount receive-amount"><input id="receive-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" aria-invalid={amountInvalid} aria-describedby={amountInvalid ? "receive-amount-error" : undefined} /><span>{selected.symbol}</span></div></label>
              {amountInvalid && <p id="receive-amount-error" className="field-error" role="alert">{copy.invalidAmount}</p>}
              {!noteOpen ? <button className="receive-add-note" type="button" onClick={() => setNoteOpen(true)}>{copy.addNote}</button> : <label htmlFor="receive-note">{copy.note}<textarea id="receive-note" value={note} maxLength={100} onChange={(event) => setNote(event.target.value)} rows={2} /><small>{note.length}/100</small></label>}
            </div>
          </details>
        </div>
        <details className="receive-details"><summary>{copy.details}</summary><div className="receive-asset"><span>{copy.contract}</span><strong>{selected.symbol} · <a href={arcScanAddressUrl(selected.address)} target="_blank" rel="noreferrer">{shortAddress(selected.address)} ↗</a></strong></div>{paymentUri && <div className="receive-actions"><CopyButton value={paymentUri} idle={copy.copyUri} copiedLabel={copy.copiedUri} /><CopyButton value={requestDetails} idle={copy.copyDetails} copiedLabel={copy.copiedDetails} /></div>}</details>
        <p className="receive-explanation">{presentation.notReceived}</p>
      </div>
    </WalletPanel>
  );
}
