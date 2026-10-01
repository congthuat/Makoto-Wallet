import { decodeEventLog, encodeEventTopics, encodeFunctionData, getAddress, hexToBytes, isAddress, keccak256, type Address, type Hash, type Hex } from "viem";

import { ARC_MEMO_ADDRESS, arcMemoAbi } from "./arcMemo.ts";
import { erc20BalanceAbi } from "./abi/erc20.ts";
import { formatAssetAmount, getAssetById } from "./assets.ts";
import { arcScanTransactionUrl, type WalletActivity } from "./wallet.ts";

export const transferEventAbi = [{ type: "event", name: "Transfer", inputs: [{ name: "from", type: "address", indexed: true }, { name: "to", type: "address", indexed: true }, { name: "value", type: "uint256", indexed: false }] }] as const;

export type ReceiptLog = { address: Address | string; data: Hex; topics: readonly Hex[]; logIndex?: number | null; transactionHash?: Hash | null };
export type MinimalTransactionReceipt = { status: "success" | "reverted"; transactionHash: Hash; blockNumber: bigint; logs: readonly ReceiptLog[] };
export type VerifiedMemo = { text?: string; data: Hex; memoId: Hex; memoIndex: bigint };
export type ReceiptVerification = { verified: boolean; from: Address; to: Address; blockNumber: bigint; memo?: VerifiedMemo; reason?: "status" | "hash" | "block" | "transfer-missing" | "transfer-ambiguous" | "swap-sent" | "swap-receive" };

export function verifyTransactionReceipt(activity: WalletActivity, walletAddress: Address, receipt: MinimalTransactionReceipt): ReceiptVerification {
  const wallet = getAddress(walletAddress);
  const from = activity.direction === "send" ? wallet : activity.counterparty;
  const to = activity.direction === "send" ? activity.counterparty : wallet;
  const blockNumber = receipt.blockNumber;
  if (receipt.status !== "success") return { verified: false, from, to, blockNumber, reason: "status" };
  if (receipt.transactionHash.toLowerCase() !== activity.hash.toLowerCase()) return { verified: false, from, to, blockNumber, reason: "hash" };
  if (activity.blockNumber > 0n && receipt.blockNumber !== activity.blockNumber) return { verified: false, from, to, blockNumber, reason: "block" };
  const sent = findTransfer(receipt.logs, { token: activity.tokenAddress, from, to, value: activity.amount, logIndex: activity.logIndex, transactionHash: receipt.transactionHash });
  if (sent !== "matched") return { verified: false, from, to, blockNumber, reason: activity.kind === "swap" ? "swap-sent" : sent === "ambiguous" ? "transfer-ambiguous" : "transfer-missing" };
  if (activity.kind === "swap") {
    const receive = activity.swapReceive;
    if (!receive || findTransfer(receipt.logs, { token: receive.tokenAddress, to: wallet, value: receive.amount, logIndex: receive.logIndex, transactionHash: receipt.transactionHash }) !== "matched") return { verified: false, from, to, blockNumber, reason: "swap-receive" };
  }
  const memo = activity.kind === "transfer" ? findMatchingMemo(receipt.logs, { sender: from, token: activity.tokenAddress, recipient: to, amount: activity.amount }) : undefined;
  return { verified: true, from, to, blockNumber, ...(memo ? { memo } : {}) };
}

export function findMatchingMemo(logs: readonly ReceiptLog[], expected: { sender: Address; token: Address; recipient: Address; amount: bigint }): VerifiedMemo | undefined {
  const innerData = encodeFunctionData({ abi: erc20BalanceAbi, functionName: "transfer", args: [expected.recipient, expected.amount] });
  const expectedHash = keccak256(innerData);
  for (const log of logs) {
    if (!isAddress(log.address) || getAddress(log.address) !== ARC_MEMO_ADDRESS) continue;
    try {
      const decoded = decodeEventLog({ abi: arcMemoAbi, eventName: "Memo", data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      const args = decoded.args;
      if (getAddress(args.sender) !== getAddress(expected.sender) || getAddress(args.target) !== getAddress(expected.token) || args.callDataHash !== expectedHash) continue;
      return { text: decodeDisplayableUtf8(args.memo), data: args.memo, memoId: args.memoId, memoIndex: args.memoIndex };
    } catch { /* Malformed and unrelated logs are never receipt evidence. */ }
  }
  return undefined;
}

export function decodeDisplayableUtf8(value: Hex): string | undefined {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(hexToBytes(value));
    return text && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text) ? text : undefined;
  } catch { return undefined; }
}

export function buildCanonicalReceiptText(activity: WalletActivity, verification: ReceiptVerification, locale: "en" | "vi") {
  const vi = locale === "vi";
  const asset = getAssetById(activity.assetId)!;
  const type = activity.kind === "swap" ? (vi ? "Hoán đổi" : "Swap") : activity.kind === "bridge" ? (vi ? "Bridge" : "Bridge") : activity.direction === "send" ? (vi ? "Gửi" : "Send") : (vi ? "Nhận" : "Receive");
  const lines = [vi ? "Makoto Wallet — Biên nhận giao dịch" : "Makoto Wallet — Transaction Receipt", `${vi ? "Trạng thái" : "Status"}: ${vi ? "Đã xác nhận" : "Confirmed"}`, `${vi ? "Loại" : "Type"}: ${type}`];
  if (activity.kind === "swap" && activity.swapReceive) lines.push(`${vi ? "Đã gửi" : "Sent"}: ${formatAssetAmount(activity.amount, asset)} ${activity.assetSymbol}`, `${vi ? "Đã nhận" : "Received"}: ${formatAssetAmount(activity.swapReceive.amount, getAssetById(activity.swapReceive.assetId)!)} ${activity.swapReceive.assetSymbol}`);
  else lines.push(`${vi ? "Số tiền" : "Amount"}: ${formatAssetAmount(activity.amount, asset)} ${activity.assetSymbol}`);
  lines.push(`${vi ? "Từ" : "From"}: ${verification.from}`, `${vi ? "Đến" : "To"}: ${verification.to}`, `${vi ? "Mạng" : "Network"}: Arc Testnet`, `${vi ? "Khối" : "Block"}: ${verification.blockNumber}`, `${vi ? "Giao dịch" : "Transaction"}: ${activity.hash}`);
  if (verification.verified && verification.memo?.text) lines.push(`${vi ? "Ghi chú" : "Note"}: ${verification.memo.text}`);
  lines.push(`ArcScan: ${arcScanTransactionUrl(activity.hash)}`);
  return lines.join("\n");
}

function findTransfer(logs: readonly ReceiptLog[], expected: { token: Address; from?: Address; to: Address; value: bigint; logIndex: number; transactionHash: Hash }): "matched" | "missing" | "ambiguous" {
  const candidates: ReceiptLog[] = [];
  for (const log of logs) {
    if (!isAddress(log.address) || getAddress(log.address) !== getAddress(expected.token)) continue;
    if (log.transactionHash && log.transactionHash.toLowerCase() !== expected.transactionHash.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: transferEventAbi, eventName: "Transfer", data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if ((!expected.from || getAddress(decoded.args.from) === getAddress(expected.from)) && getAddress(decoded.args.to) === getAddress(expected.to) && decoded.args.value === expected.value) {
        if (expected.logIndex < 0 || log.logIndex === expected.logIndex) return "matched";
        candidates.push(log);
      }
    } catch { /* Ignore non-Transfer logs. */ }
  }
  return candidates.length === 1 ? "matched" : candidates.length > 1 ? "ambiguous" : "missing";
}

export function encodeTransferLog(input: { token: Address; from: Address; to: Address; value: bigint; logIndex: number; transactionHash?: Hash }): ReceiptLog {
  return { address: input.token, topics: encodeEventTopics({ abi: transferEventAbi, eventName: "Transfer", args: { from: input.from, to: input.to } }) as readonly Hex[], data: `0x${input.value.toString(16).padStart(64, "0")}`, logIndex: input.logIndex, transactionHash: input.transactionHash };
}
