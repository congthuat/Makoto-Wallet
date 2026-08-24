"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { encodeFunctionData, getAddress, type Hash } from "viem";
import { useConnection, usePublicClient, useWriteContract, type Connector } from "wagmi";
import { arcTestnet } from "viem/chains";
import { useVerifiedWalletChain } from "@/hooks/useVerifiedWalletChain";
import { penguJarV3Abi } from "@/lib/abi/penguJarV3";
import { ARC_EXPLORER_URL, contractAddress } from "@/lib/config";
import { formatDate, formatUsdc } from "@/lib/format";
import { confirmThenRefresh } from "@/lib/confirmedTransaction";
import { getAssetById } from "@/lib/assets";
import { createAssetActivity, recordWalletActivity } from "@/lib/walletActivity";
import type { Jar } from "@/lib/types";
import { usePreferences } from "@/hooks/usePreferences";
import { TransactionSafetyChecks, TransactionSafetyReview } from "./TransactionSafetyReview";
import { prepareFlowReview, vaultIntent } from "@/lib/transactionFlowReview";
import { revalidateTransactionReview, ReviewSubmissionGuard, type TransactionReviewSnapshot } from "@/lib/transactionOrchestrator";

type Step = "review" | "wallet" | "submitted" | "confirming" | "success" | "error";

export function OwnerWithdrawalFlow({ jar, open, onClose, onSuccess }: { jar: Jar; open: boolean; onClose(): void; onSuccess(): Promise<void> }) {
  const { t, locale } = usePreferences();
  const vi = locale === "vi";
  const connection = useConnection();
  const verifiedChain = useVerifiedWalletChain();
  const queryClient = useQueryClient();
  const publicClient = usePublicClient({ chainId: arcTestnet.id });
  const { writeContractAsync } = useWriteContract();
  const [step, setStep] = useState<Step>("review");
  const [error, setError] = useState<string>();
  const [hash, setHash] = useState<Hash>();
  const [reviewSnapshot, setReviewSnapshot] = useState<TransactionReviewSnapshot>();
  const submissionGuard = useRef(new ReviewSubmissionGuard());

  function withdrawalIntent(amount = jar.balance) { if (!connection.address || !contractAddress) return undefined; return vaultIntent({ id: "vault-withdraw", kind: "vault-withdraw", account: connection.address, target: contractAddress, calldata: encodeFunctionData({ abi: penguJarV3Abi, functionName: "withdrawJar", args: [jar.id] }), preparedAt: reviewSnapshot?.preparedAt ?? Date.now(), assetId: "usdc", amount, jarId: jar.id }); }
  // The intent factory deliberately captures the exact render snapshot guarded by these primitives.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!open || reviewSnapshot || !connection.address || !contractAddress) return; const timeout = window.setTimeout(() => { const intent = withdrawalIntent(); if (intent) setReviewSnapshot(prepareFlowReview(intent, { connectedAccount: connection.address, connectedChainId: verifiedChain.isArc ? arcTestnet.id : undefined, simulation: "passed", expectedTarget: contractAddress })); }, 0); return () => window.clearTimeout(timeout); }, [connection.address, open, reviewSnapshot, verifiedChain.isArc]);

  async function withdraw() {
    setError(undefined);
    try {
      const owner = await assertConnectedOwner(connection.connector, jar.owner, verifiedChain.isArc);
      if (!contractAddress || !publicClient) throw new Error("Withdrawal configuration is unavailable.");
      const jarAddress = contractAddress;

      const [freshJar, latestBlock] = await Promise.all([
        publicClient.readContract({ address: jarAddress, abi: penguJarV3Abi, functionName: "getJar", args: [jar.id] }),
        publicClient.getBlock({ blockTag: "latest" }),
      ]);
      if (getAddress(freshJar.owner) !== getAddress(owner)) throw new Error("Only the savings goal owner can withdraw.");
      if (freshJar.closed) throw new Error("This savings goal has already been withdrawn.");
      if (freshJar.frozen) throw new Error("Emergency Freeze is active. Withdrawal is unavailable.");
      if (latestBlock.timestamp < freshJar.unlockTime) throw new Error(`This savings goal remains locked until ${formatDate(freshJar.unlockTime)}.`);
      if (freshJar.mode === 1 && (freshJar.withdrawalReadyAt === 0n || latestBlock.timestamp < freshJar.withdrawalReadyAt)) throw new Error("The Withdrawal Shield delay has not completed.");
      if (freshJar.balance === 0n) throw new Error("This savings goal has no balance to withdraw.");

      if (!reviewSnapshot) throw new Error("Review again.");
      const intent = withdrawalIntent(freshJar.balance)!;
      const checked = revalidateTransactionReview(reviewSnapshot, { intent, context: { connectedAccount: owner, connectedChainId: arcTestnet.id, simulation: "passed", expectedTarget: jarAddress }, now: Date.now() });
      if (!checked.valid) throw new Error("Review again.");

      setStep("wallet");
      const submittedHash = await submissionGuard.current.run(reviewSnapshot.fingerprint, () => writeContractAsync({
        address: jarAddress,
        abi: penguJarV3Abi,
        functionName: "withdrawJar",
        args: [jar.id],
        account: owner,
        chainId: arcTestnet.id,
      }));
      setHash(submittedHash);
      setStep("submitted");
      setStep("confirming");
      let replacementReason: string | undefined;
      const receiptPromise = publicClient.waitForTransactionReceipt({
        hash: submittedHash,
        confirmations: 1,
        onReplaced: (replacement) => {
          replacementReason = replacement.reason;
          setHash(replacement.transaction.hash);
        },
      }).then((receipt) => {
        if (replacementReason === "cancelled") throw new Error("The withdrawal transaction was cancelled.");
        return receipt;
      });
      const receipt = await receiptPromise;
      const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
      await confirmThenRefresh({
        receipt: Promise.resolve(receipt),
        onConfirmed: () => { const usdc = getAssetById("usdc")!; const transferLog = receipt.logs.find((log) => log.address.toLowerCase() === usdc.address.toLowerCase()); recordWalletActivity(owner, arcTestnet.id, createAssetActivity(usdc, { hash: receipt.transactionHash, logIndex: transferLog?.logIndex ?? -1, direction: "receive", kind: "vault-withdraw", amount: freshJar.balance, counterparty: jarAddress, confirmedAt: Number(block.timestamp) * 1000, blockNumber: receipt.blockNumber })); setStep("success"); },
        refresh: async () => {
          const [withdrawnJar] = await Promise.all([publicClient.readContract({ address: jarAddress, abi: penguJarV3Abi, functionName: "getJar", args: [jar.id] }), onSuccess(), queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "jar-activity" })]);
          if (!withdrawnJar.closed || withdrawnJar.balance !== 0n) throw new Error("Confirmed withdrawal state refresh has not caught up yet.");
          if (getAddress(withdrawnJar.owner) !== getAddress(jar.owner)) throw new Error("Post-withdrawal owner verification failed.");
        },
      });
    } catch (reason) {
      setError(withdrawalError(reason, t));
      setStep("error");
    }
  }

  function close() {
    if (isBusy(step)) return;
    setStep("review"); setError(undefined); setHash(undefined); setReviewSnapshot(undefined); onClose();
  }

  if (!open) return null;
  if (step === "review" && reviewSnapshot) return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section className="create-modal deposit-modal" role="dialog" aria-modal="true" aria-label={t("flow.ownerWithdrawal")}><TransactionSafetyReview title={t("flow.withdrawName", { name: jar.name })} summary={t("flow.withdrawWarning")} details={[{ label: t("jar.number", { id: jar.id.toString() }), value: jar.name }, { label: t("flow.amount"), value: `${formatUsdc(jar.balance)} USDC` }, { label: t("jar.owner"), value: <span className="full-address">{jar.owner}</span> }, { label: t("jar.unlockDate"), value: formatDate(jar.unlockTime) }, { label: t("wallet.network"), value: "Arc Testnet · 5042002" }, { label: t("flow.destination"), value: <span className="full-address">{connection.address ?? t("validation.disconnected")}</span> }]} checks={[{ code: "owner", status: connection.address?.toLowerCase() === jar.owner.toLowerCase() ? "verified" : "blocking", label: connection.address?.toLowerCase() === jar.owner.toLowerCase() ? (vi ? "Tài khoản kết nối là chủ mục tiêu" : "Connected account is the goal owner") : (vi ? "Chỉ chủ mục tiêu mới có thể rút" : "Only the goal owner may withdraw") }, { code: "network", status: verifiedChain.isArc ? "verified" : "blocking", label: verifiedChain.isArc ? "Arc Testnet · 5042002" : t("wallet.switch") }, { code: "freeze", status: jar.frozen ? "blocking" : "verified", label: jar.frozen ? (vi ? "Đóng băng khẩn cấp đang hoạt động" : "Emergency Freeze is active") : (vi ? "Không có đóng băng khẩn cấp" : "No active Emergency Freeze") }]} review={reviewSnapshot} walletNotice={vi ? "Ví sẽ yêu cầu xác nhận rút toàn bộ số dư mục tiêu. Thành công chỉ hiển thị sau biên nhận Arc." : "Your wallet will request confirmation to withdraw the full goal balance. Success appears only after the Arc receipt."} onBack={close} onContinue={() => void withdraw()} continueDisabled={connection.address?.toLowerCase() !== jar.owner.toLowerCase() || !verifiedChain.isArc || jar.frozen} /></section></div>;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section className="create-modal deposit-modal" role="dialog" aria-modal="true" aria-labelledby="withdraw-title">
    <div className="modal-header"><div><p className="eyebrow">{t("flow.ownerWithdrawal")} · {t("jar.number", { id: jar.id.toString() })}</p><h2 id="withdraw-title">{t("flow.withdrawName", { name: jar.name })}</h2></div><button onClick={close} disabled={isBusy(step)} aria-label={t("common.close")}>×</button></div>
    {step === "review" && <div className="review-panel"><dl><div><dt>{t("jar.number", { id: jar.id.toString() })}</dt><dd>{jar.name}</dd></div><div><dt>{t("flow.amount")}</dt><dd>{formatUsdc(jar.balance)} USDC</dd></div><div><dt>{t("jar.owner")}</dt><dd className="full-address">{jar.owner}</dd></div><div><dt>{t("jar.unlockDate")}</dt><dd>{formatDate(jar.unlockTime)}</dd></div><div><dt>{t("wallet.network")}</dt><dd>Arc Testnet · 5042002</dd></div><div><dt>{t("flow.destination")}</dt><dd className="full-address">{connection.address ?? t("validation.disconnected")}</dd></div></dl><TransactionSafetyChecks checks={[{ code: "owner", status: connection.address?.toLowerCase() === jar.owner.toLowerCase() ? "verified" : "blocking", label: connection.address ? (connection.address.toLowerCase() === jar.owner.toLowerCase() ? (vi ? "Tài khoản kết nối là chủ mục tiêu" : "Connected account is the goal owner") : (vi ? "Chỉ chủ mục tiêu hiện tại mới có thể rút" : "Only the current goal owner may withdraw")) : t("validation.disconnected") }, { code: "network", status: verifiedChain.isArc ? "verified" : "blocking", label: verifiedChain.isArc ? "Arc Testnet · 5042002" : t("wallet.switch") }, { code: "freeze", status: jar.frozen ? "blocking" : "verified", label: jar.frozen ? (vi ? "Đóng băng khẩn cấp đang hoạt động" : "Emergency Freeze is active") : (vi ? "Không có đóng băng khẩn cấp" : "No active Emergency Freeze") }, { code: "timelock", status: "info", label: vi ? "Giới hạn mở khóa/rút được kiểm tra lại từ Arc ngay trước khi ký" : "Unlock and withdrawal restrictions are rechecked from Arc immediately before signing" }]} /><p className="review-note">{t("flow.withdrawWarning")}</p><div className="modal-actions"><button className="cancel-action" onClick={close}>{t("common.cancel")}</button><button className="primary-action" onClick={() => void withdraw()} disabled={connection.address?.toLowerCase() !== jar.owner.toLowerCase() || !verifiedChain.isArc || jar.frozen}>{t("flow.confirmWithdrawal")}</button></div></div>}
    {step === "success" && <Panel title={t("flow.withdrawSuccess")} copy={t("tx.success")} hash={hash} action={<button className="primary-action standalone-action" onClick={close}>{t("flow.closedJar")}</button>} />}
    {step === "error" && <Panel title={t("flow.withdrawFailed")} copy={error ?? t("tx.failed")} hash={hash} action={<button className="primary-action standalone-action" onClick={() => setStep("review")}>{t("flow.reviewRetry")}</button>} />}
    {!["review", "success", "error"].includes(step) && <Panel title={step === "wallet" ? t("tx.waiting") : step === "submitted" ? t("tx.submitted") : t("tx.confirming")} copy={t("create.submittedCopy")} hash={hash} />}
  </section></div>;
}

function Panel({ title, copy, hash, action }: { title: string; copy: string; hash?: Hash; action?: React.ReactNode }) {
  const { t } = usePreferences();
  return <div className="transaction-state"><span>↻</span><h3>{title}</h3><p>{copy}</p>{hash && <div className="transaction-links"><a href={`${ARC_EXPLORER_URL}/tx/${hash}`} target="_blank" rel="noreferrer">{t("tx.arcscan")} ↗</a></div>}{action}</div>;
}

function isBusy(step: Step) { return ["wallet", "submitted", "confirming"].includes(step); }

async function assertConnectedOwner(connector: Connector | undefined, owner: `0x${string}`, verifiedArc: boolean) {
  if (!connector || !verifiedArc) throw new Error("Switch the connected owner wallet to Arc Testnet before withdrawing.");
  const provider = await connector.getProvider() as { request(args: { method: string }): Promise<unknown> } | undefined;
  if (!provider) throw new Error("The connected wallet provider is unavailable.");
  const [accountsValue, providerChainValue, connectorChainId] = await Promise.all([provider.request({ method: "eth_accounts" }), provider.request({ method: "eth_chainId" }), connector.getChainId()]);
  const accounts = Array.isArray(accountsValue) ? accountsValue : [];
  if (typeof accounts[0] !== "string" || getAddress(accounts[0]) !== getAddress(owner)) throw new Error("Only the savings goal owner can withdraw.");
  const providerChainId = typeof providerChainValue === "string" ? Number.parseInt(providerChainValue, 16) : Number(providerChainValue);
  if (providerChainId !== arcTestnet.id || connectorChainId !== arcTestnet.id) throw new Error("The connected wallet is not verified on Arc Testnet.");
  return getAddress(accounts[0]);
}

function withdrawalError(reason: unknown, t: ReturnType<typeof usePreferences>["t"]) {
  const message = reason instanceof Error ? reason.message : "";
  if (/reject|denied|4001|replac|cancel/i.test(message)) return t("tx.rejected");
  if (/owner/i.test(message)) return t("actions.onlyOwnerWithdraw");
  if (/balance/i.test(message)) return t("actions.noBalance");
  if (/network|Arc|provider/i.test(message)) return t("wallet.switch");
  if (/revert|execution/i.test(message)) return t("validation.reverted");
  return t("tx.rpc");
}
