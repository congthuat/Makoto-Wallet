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
    title: "Nhận", network: "Arc Testnet · 5042002", asset: "Tài sản", contract: "Hợp đồng token", address: "Địa chỉ ví", copy: "Sao chép địa chỉ", copied: "Đã sao chép", warning: "Chỉ gửi tài sản được hỗ trợ trên Arc Testnet đến địa chỉ này.", amount: "Số tiền (không bắt buộc)", note: "Ghi chú", addNote: "+ Thêm ghi chú", invalidAmount: "Số tiền không hợp lệ. Hãy nhập số lớn hơn 0 với tối đa 6 chữ số thập phân.", copyUri: "Sao chép URI thanh toán", copyDetails: "Sao chép chi tiết yêu cầu", copiedUri: "Đã sao chép URI", copiedDetails: "Đã sao chép chi tiết", details: "Chi tiết", addressQr: `QR địa chỉ ${selected.symbol} trên Arc Testnet`, paymentQr: `QR yêu cầu thanh toán ${displayAmount ?? ""} ${selected.symbol} trên Arc Testnet`, requestHeading: "Yêu cầu thanh toán Makoto", noteLabel: "Ghi chú",
  } : {
    title: "Receive", network: "Arc Testnet · 5042002", asset: "Asset", contract: "Token contract", address: "Wallet address", copy: "Copy address", copied: "Address copied", warning: "Only send supported assets on Arc Testnet to this address.", amount: "Amount (optional)", note: "Note", addNote: "+ Add note", invalidAmount: "Invalid amount. Enter more than 0 with at most 6 decimal places.", copyUri: "Copy payment URI", copyDetails: "Copy request details", copiedUri: "Payment URI copied", copiedDetails: "Request details copied", details: "Details", addressQr: `${selected.symbol} address QR on Arc Testnet`, paymentQr: `QR payment request for ${displayAmount ?? ""} ${selected.symbol} on Arc Testnet`, requestHeading: "Makoto payment request", noteLabel: "Note",
  };
  const requestDetails = paymentUri && displayAmount ? [copy.requestHeading, `${displayAmount} ${selected.symbol}`, "Arc Testnet", address, ...(note.trim() ? [`${copy.noteLabel}: ${note.trim()}`] : [])].join("\n") : "";

  return (
    <WalletPanel title={copy.title} onClose={onClose}>
      <div className="wallet-flow receive-flow">
        <div className="receive-network-badge"><i />{copy.network}</div>
        <div className="receive-compact-grid"><div className="receive-controls">
          <label>{copy.asset}<select className="asset-selector" value={assetId} onChange={(event) => setAssetId(event.target.value as SupportedAssetId)}>{SUPPORTED_ASSETS.map((asset) => <option key={asset.id} value={asset.id}>{asset.symbol} · {asset.name}</option>)}</select></label>
          <label>{copy.amount}<div className="wallet-field-with-action amount receive-amount"><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" aria-invalid={amountInvalid} /><span>{selected.symbol}</span></div></label>
          {amountInvalid && <p className="field-error" role="alert">{copy.invalidAmount}</p>}
          {!noteOpen ? <button className="receive-add-note" type="button" onClick={() => setNoteOpen(true)}>{copy.addNote}</button> : <label>{copy.note}<textarea value={note} maxLength={100} onChange={(event) => setNote(event.target.value)} rows={2} /><small>{note.length}/100</small></label>}
        </div><div className="receive-qr-card" role="img" aria-label={paymentUri ? copy.paymentQr : copy.addressQr}><QRCodeSVG value={qrPayload} size={204} marginSize={2} title={paymentUri ? copy.paymentQr : copy.addressQr} /><strong>{displayAmount ? `${displayAmount} ${selected.symbol}` : selected.symbol} · Arc Testnet</strong></div></div>
        <div className="receive-address"><p>{copy.address}</p><code>{address}</code><CopyButton value={address} idle={copy.copy} copiedLabel={copy.copied} /></div>
        <details className="receive-details"><summary>{copy.details}</summary><div className="receive-asset"><span>{copy.contract}</span><strong>{selected.symbol} · <a href={arcScanAddressUrl(selected.address)} target="_blank" rel="noreferrer">{shortAddress(selected.address)} ↗</a></strong></div>{paymentUri && <div className="receive-actions"><CopyButton value={paymentUri} idle={copy.copyUri} copiedLabel={copy.copiedUri} /><CopyButton value={requestDetails} idle={copy.copyDetails} copiedLabel={copy.copiedDetails} /></div>}</details>
        <p className="wallet-notice">{copy.warning}</p>
      </div>
    </WalletPanel>
  );
}
