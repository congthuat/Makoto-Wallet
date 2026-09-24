"use client";
/* State restoration and polling intentionally synchronize persisted/remote Bridge state. */
/* eslint-disable react-hooks/set-state-in-effect, react-hooks/preserve-manual-memoization */

import { useCallback, useEffect, useRef, useState } from "react";
import { encodeFunctionData, formatUnits, getAddress, isHash, zeroHash, type Address, type Hash } from "viem";
import { arcTestnet, baseSepolia } from "viem/chains";
import { usePublicClient, useWriteContract } from "wagmi";
import { useVerifiedWalletChain } from "@/hooks/useVerifiedWalletChain";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { useWalletAccount } from "@/hooks/useWalletAccount";
import { erc20BalanceAbi } from "@/lib/abi/erc20";
import { calculateArcFee, formatArcFeeEstimate } from "@/lib/arcFees";
import { formatAssetAmount, getAssetById, parseAssetAmount } from "@/lib/assets";
import { createBridgeOperation, findDestinationUsdcTransfer, isBridgeOperationTerminal, latestMonitorableBridgeOperation, loadBridgeOperations, saveBridgeOperation, updateBridgeOperation, updateBridgeOperationQuote, upsertBridgeTransaction, type BridgeOperation, type BridgeOperationState } from "@/lib/bridgeOperation";
import { createCctpGasEnvelope, cctpReviewedRequest, type CctpGasEnvelope } from "@/lib/cctpBridge";
import { ARC_EXPLORER_URL } from "@/lib/config";
import { addressToBytes32, BASE_SEPOLIA_CCTP_DOMAIN, BASE_SEPOLIA_EXPLORER_URL, calculateCctpForwardingAmounts, CCTP_FORWARDING_HOOK_DATA, CCTP_STANDARD_FINALITY, CCTP_TOKEN_MINTER_V2, CCTP_TOKEN_MESSENGER_ABI, CCTP_TOKEN_MESSENGER_V2, type CctpForwardingFee, type CctpTransferAmounts } from "@/lib/cctp";
import { unifiedChainById } from "@/lib/circle/chains";
import { globalReviewChecks } from "@/lib/transactionReview";
import { createAssetActivity, recordWalletActivity } from "@/lib/walletActivity";
import { classifyWalletFailure } from "@/lib/walletSafety";
import { TransactionSafetyReview } from "./TransactionSafetyReview";
import { approvalIntent, bridgeIntent, prepareFlowReview } from "@/lib/transactionFlowReview";
import { revalidateTransactionReview, ReviewSubmissionGuard, type TransactionReviewSnapshot } from "@/lib/transactionOrchestrator";
import type { TransactionIntent } from "@/lib/transactionSafety";
import type { WalletAccountKind } from "@/lib/walletAccount";

const FEE_MAX_AGE_MS = 45_000;
const MONITOR_INTERVAL_MS = 12_000;
const baseUsdc = getAddress(unifiedChainById(baseSepolia.id)!.usdc);

type Props = { locale: "en" | "vi"; onBusyChange(busy: boolean): void };
type ReviewStage = "approval" | "burn";
type PreparedReview = {
  stage: ReviewStage; account: Address; accountKind: WalletAccountKind; fee: CctpForwardingFee; amounts: CctpTransferAmounts;
  balance: bigint; allowance: bigint; intent: TransactionIntent; envelope: CctpGasEnvelope; snapshot: TransactionReviewSnapshot; operationId: string;
};
type CctpStatusPayload = { status?: string; messageStatus?: string; attestationStatus?: string; forwardingState?: string; forwardTxHash?: string; providerAvailable?: boolean };

export function CctpBridgeFlow({ locale, onBusyChange }: Props) {
  const vi = locale === "vi";
  const { read: wallet, execution } = useWalletAccount();
  const verifiedChain = useVerifiedWalletChain();
  const arcClient = usePublicClient({ chainId: arcTestnet.id });
  const baseClient = usePublicClient({ chainId: baseSepolia.id });
  const writer = useWriteContract();
  const balances = useWalletBalances(wallet.address, wallet.isArc);
  const usdc = getAssetById("usdc")!;
  const [amount, setAmount] = useState("");
  const [prepared, setPrepared] = useState<PreparedReview>();
  const [operation, setOperation] = useState<BridgeOperation>();
  const [pending, setPending] = useState<string>();
  const [statusMessage, setStatusMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [checking, setChecking] = useState(false);
  const submissionGuard = useRef(new ReviewSubmissionGuard());
  const reviewAttempt = useRef(0);
  const checkingRef = useRef(false);
  const currentWallet = useRef(wallet);

  useEffect(() => { currentWallet.current = wallet; }, [wallet]);
  useEffect(() => onBusyChange(Boolean(pending)), [onBusyChange, pending]);
  useEffect(() => {
    if (!wallet.address) return setOperation(undefined);
    setOperation(latestMonitorableBridgeOperation(wallet.address));
  }, [wallet.address]);

  const parsed = parseAssetAmount(amount, usdc);
  const persist = useCallback((next: BridgeOperation) => { const saved = saveBridgeOperation(next); setOperation(saved); return saved; }, []);

  const monitorOperation = useCallback(async (candidate: BridgeOperation) => {
    if (checkingRef.current || !arcClient) return;
    let fresh = loadBridgeOperations(candidate.sender).find((item) => item.id === candidate.id) ?? candidate;
    checkingRef.current = true;
    setChecking(true);
    try {
      const unresolvedRole = ["approval-submitted", "approval-confirming", "approval-confirmation-unknown"].includes(fresh.state)
        ? "approval"
        : ["burn-submitted", "source-confirming", "source-confirmation-unknown"].includes(fresh.state) ? "burn" : undefined;
      if (unresolvedRole) {
        const transaction = [...fresh.transactions].reverse().find((item) => item.role === unresolvedRole);
        if (!transaction) return;
        let sourceReceipt;
        try { sourceReceipt = await arcClient.getTransactionReceipt({ hash: transaction.hash }); }
        catch {
          const unknownState: BridgeOperationState = unresolvedRole === "approval" ? "approval-confirmation-unknown" : "source-confirmation-unknown";
          persist(updateBridgeOperation(fresh, { state: unknownState }));
          setStatusMessage(vi ? "Biên nhận nguồn chưa có. Không gửi lại giao dịch này." : "The source receipt is not available yet. This transaction will not be resubmitted.");
          return;
        }
        if (sourceReceipt.status !== "success") {
          const failedState: BridgeOperationState = unresolvedRole === "approval" ? "approval-failed" : "source-failed";
          fresh = upsertBridgeTransaction(updateBridgeOperation(fresh, { state: failedState }), { ...transaction, status: "reverted", blockNumber: sourceReceipt.blockNumber.toString() });
          persist(fresh);
          setStatusMessage(unresolvedRole === "approval" ? (vi ? "Approval đã revert. Burn chưa được gửi." : "The approval reverted. No burn was submitted.") : (vi ? "Burn đã revert trên Arc." : "The burn reverted on Arc."));
          return;
        }
        const confirmedState: BridgeOperationState = unresolvedRole === "approval" ? "approval-confirmed" : "source-confirmed";
        fresh = upsertBridgeTransaction(updateBridgeOperation(fresh, { state: confirmedState }), { ...transaction, status: "confirmed", blockNumber: sourceReceipt.blockNumber.toString() });
        persist(fresh);
        if (unresolvedRole === "approval") {
          setStatusMessage(vi ? "Approval đã xác nhận. Tiếp tục để tạo Burn Review mới." : "Approval confirmed. Continue to prepare a fresh Burn Review.");
          return;
        }
      }

      const burn = [...fresh.transactions].reverse().find((item) => item.role === "burn");
      if (!burn || !["source-confirmed", "waiting-circle", "forwarding-submitted", "destination-verification-pending"].includes(fresh.state)) return;
      if (!baseClient) {
        persist(updateBridgeOperation(fresh, { state: "destination-verification-pending" }));
        setStatusMessage(vi ? "Burn nguồn đã xác nhận; RPC Base chưa sẵn sàng để xác minh đích." : "The source burn is confirmed; Base RPC is unavailable for destination verification.");
        return;
      }
      const response = await fetch(`/api/cctp-status?txHash=${burn.hash}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as CctpStatusPayload;
      let next = updateBridgeOperation(fresh, { state: fresh.state === "source-confirmed" ? "waiting-circle" : fresh.state, circle: { messageStatus: payload.messageStatus ?? payload.status, attestationStatus: payload.attestationStatus, forwardingState: payload.forwardingState, checkedAt: Date.now() } });
      if (!payload.forwardTxHash || !isHash(payload.forwardTxHash)) {
        persist(next);
        setStatusMessage(payload.providerAvailable === false ? (vi ? "Circle tạm thời chưa phản hồi; burn nguồn vẫn đã xác nhận." : "Circle is temporarily unavailable; the source burn remains confirmed.") : (vi ? "Circle đang xử lý thông điệp và forwarding." : "Circle is processing the message and forwarding."));
        return;
      }
      const forwardHash = payload.forwardTxHash as Hash;
      next = upsertBridgeTransaction(updateBridgeOperation(next, { state: "forwarding-submitted" }), { role: "forward", chainId: baseSepolia.id, hash: forwardHash, status: "submitted", explorerUrl: `${BASE_SEPOLIA_EXPLORER_URL}/tx/${forwardHash}` });
      persist(next);

      let chainId: number;
      try { chainId = await baseClient.getChainId(); }
      catch {
        persist(updateBridgeOperation(next, { state: "destination-verification-pending" }));
        setStatusMessage(vi ? "Đã có giao dịch đích; RPC Base chưa sẵn sàng để xác minh." : "Destination transaction found; Base RPC is not available for verification yet.");
        return;
      }
      if (chainId !== baseSepolia.id) {
        persist(updateBridgeOperation(next, { state: "destination-verification-pending" }));
        setStatusMessage(vi ? "Đã có giao dịch đích; chưa xác minh được đúng mạng Base Sepolia." : "Destination transaction found; Base Sepolia chain verification is pending.");
        return;
      }

      let receipt;
      try { receipt = await baseClient.getTransactionReceipt({ hash: forwardHash }); }
      catch {
        persist(updateBridgeOperation(next, { state: "destination-verification-pending" }));
        setStatusMessage(vi ? "Forwarding đã gửi; đang chờ biên nhận Base Sepolia." : "Forwarding submitted; waiting for the Base Sepolia receipt.");
        return;
      }
      if (receipt.transactionHash.toLowerCase() !== forwardHash.toLowerCase()) {
        persist(updateBridgeOperation(next, { state: "destination-verification-pending" }));
        return;
      }
      if (receipt.status === "reverted") {
        next = upsertBridgeTransaction(updateBridgeOperation(next, { state: "destination-failed" }), { role: "forward", chainId: baseSepolia.id, hash: forwardHash, status: "reverted", blockNumber: receipt.blockNumber.toString(), explorerUrl: `${BASE_SEPOLIA_EXPLORER_URL}/tx/${forwardHash}` });
        persist(next);
        setStatusMessage(vi ? "Giao dịch đích đã revert trên Base Sepolia." : "The destination transaction reverted on Base Sepolia.");
        return;
      }
      const transfer = findDestinationUsdcTransfer({ logs: receipt.logs, token: baseUsdc, recipient: fresh.recipient, transactionHash: forwardHash, expectedAmount: BigInt(fresh.requestedAmount) });
      if (!transfer) {
        persist(updateBridgeOperation(next, { state: "destination-verification-pending" }));
        setStatusMessage(vi ? "Biên nhận thành công nhưng chưa xác minh được sự kiện USDC tới đúng người nhận." : "The receipt succeeded, but the expected recipient USDC event is not verified yet.");
        return;
      }
      let destinationBalance: bigint;
      try { destinationBalance = await baseClient.readContract({ address: baseUsdc, abi: erc20BalanceAbi, functionName: "balanceOf", args: [fresh.recipient] }); }
      catch {
        next = upsertBridgeTransaction(updateBridgeOperation(next, { state: "destination-verification-pending" }), { role: "forward", chainId: baseSepolia.id, hash: forwardHash, status: "confirmed", blockNumber: receipt.blockNumber.toString(), explorerUrl: `${BASE_SEPOLIA_EXPLORER_URL}/tx/${forwardHash}` });
        persist(next);
        setStatusMessage(vi ? "Biên nhận và sự kiện USDC đã xác minh; đang chờ đọc lại số dư đích." : "Receipt and USDC event verified; destination balance re-read is pending.");
        return;
      }
      next = upsertBridgeTransaction(updateBridgeOperation(next, { state: "destination-confirmed", destinationEvidence: { transactionHash: forwardHash, transferAmount: transfer.amount.toString(), transferLogIndex: transfer.logIndex, balance: destinationBalance.toString(), verifiedAt: Date.now() } }), { role: "forward", chainId: baseSepolia.id, hash: forwardHash, status: "confirmed", blockNumber: receipt.blockNumber.toString(), explorerUrl: `${BASE_SEPOLIA_EXPLORER_URL}/tx/${forwardHash}` });
      persist(next);
      setStatusMessage(vi ? "Đích đã xác nhận bằng biên nhận, sự kiện USDC và số dư Base đọc lại." : "Destination confirmed by the receipt, USDC event, and a fresh Base balance read.");
    } catch {
      setStatusMessage(vi ? "Chưa thể xác minh đích; trạng thái vẫn đang chờ." : "Destination verification is not available yet; the operation remains pending.");
    } finally { checkingRef.current = false; setChecking(false); }
  }, [arcClient, baseClient, persist, vi]);

  useEffect(() => {
    if (!operation || !["source-confirmed", "waiting-circle", "forwarding-submitted", "destination-verification-pending"].includes(operation.state)) return;
    void monitorOperation(operation);
    const interval = window.setInterval(() => void monitorOperation(operation), MONITOR_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [monitorOperation, operation]);

  function invalidateReview(clearError = true) { reviewAttempt.current += 1; setPrepared(undefined); if (clearError) setError(undefined); setPending(undefined); }
  function reset() { invalidateReview(); setOperation(undefined); setAmount(""); setStatusMessage(undefined); }

  async function verifyArcRead() {
    if (!wallet.address || wallet.chainId !== arcTestnet.id || !wallet.isArc) throw new Error("arc");
    if (wallet.kind === "external" && !(await verifiedChain.verifyNow())) throw new Error("arc");
    return wallet.address;
  }
  async function verifyArcExecution(review: PreparedReview) {
    if (!execution || wallet.status !== "connected") throw new Error(wallet.kind === "local" ? "locked" : "wallet");
    if (execution.kind !== review.accountKind || wallet.kind !== review.accountKind) throw new Error("account-kind");
    if (!wallet.address || wallet.address.toLowerCase() !== review.account.toLowerCase()) throw new Error("account");
    if (wallet.chainId !== arcTestnet.id || !wallet.isArc) throw new Error("arc");
    if (wallet.kind === "external" && !(await verifiedChain.verifyNow())) throw new Error("arc");
    return execution;
  }
  async function loadFee() {
    const response = await fetch("/api/cctp-fees", { cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as CctpForwardingFee | { error?: string };
    if (!response.ok || !("forwardFeeMed" in payload)) throw new Error("error" in payload && payload.error ? payload.error : "CCTP fee unavailable.");
    return payload;
  }

  function burnIntent(account: Address, fee: CctpForwardingFee, amounts: CctpTransferAmounts, operationId: string, envelope?: CctpGasEnvelope) {
    const args = [amounts.totalAmount, BASE_SEPOLIA_CCTP_DOMAIN, addressToBytes32(account), usdc.address, zeroHash, amounts.maxFee, CCTP_STANDARD_FINALITY, CCTP_FORWARDING_HOOK_DATA] as const;
    return bridgeIntent({ id: `${operationId}:burn`, account, target: CCTP_TOKEN_MESSENGER_V2, calldata: encodeFunctionData({ abi: CCTP_TOKEN_MESSENGER_ABI, functionName: "depositForBurnWithHook", args }), preparedAt: fee.quotedAt, expiresAt: fee.quotedAt + FEE_MAX_AGE_MS, assetId: "usdc", amount: amounts.totalAmount, recipient: account, destinationChainId: baseSepolia.id, route: "cctp-direct-forwarding", forwardingFee: amounts.forwardingFee.toString(), protocolFee: amounts.protocolFee.toString(), gas: envelope && { gasLimit: envelope.gasLimit, maxFeePerGas: envelope.maxFeePerGas, maxPriorityFeePerGas: envelope.maxPriorityFeePerGas, maxFeeRaw18: envelope.rawMaximumFee }, metadata: { requestedAmount: amounts.transferAmount.toString(), totalBurn: amounts.totalAmount.toString(), finalityThreshold: CCTP_STANDARD_FINALITY } });
  }
  function approvalReviewIntent(account: Address, fee: CctpForwardingFee, amounts: CctpTransferAmounts, operationId: string, envelope?: CctpGasEnvelope) {
    return approvalIntent({ id: `${operationId}:approval`, account, target: usdc.address, token: usdc.address, spender: CCTP_TOKEN_MESSENGER_V2, amount: amounts.totalAmount, assetId: "usdc", calldata: "0x", preparedAt: fee.quotedAt, expiresAt: fee.quotedAt + FEE_MAX_AGE_MS, gas: envelope && { gasLimit: envelope.gasLimit, maxFeePerGas: envelope.maxFeePerGas, maxPriorityFeePerGas: envelope.maxPriorityFeePerGas, maxFeeRaw18: envelope.rawMaximumFee }, metadata: { bridgeOperationId: operationId, finiteApproval: true } });
  }
  async function estimateEnvelope(intent: TransactionIntent) {
    if (!arcClient) throw new Error("CCTP route unavailable.");
    const gasLimit = await arcClient.estimateGas({ account: intent.account, to: intent.target, data: intent.calldata, value: intent.value });
    const fees = await arcClient.estimateFeesPerGas();
    const maxFeePerGas = fees.maxFeePerGas ?? await arcClient.getGasPrice();
    return createCctpGasEnvelope(gasLimit, maxFeePerGas, fees.maxPriorityFeePerGas);
  }
  async function simulateExact(intent: TransactionIntent, envelope: CctpGasEnvelope) {
    if (!arcClient) throw new Error("CCTP simulation unavailable.");
    await arcClient.call({ account: intent.account, to: intent.target, data: intent.calldata, value: intent.value, gas: envelope.gasLimit, maxFeePerGas: envelope.maxFeePerGas, ...(envelope.maxPriorityFeePerGas === undefined ? {} : { maxPriorityFeePerGas: envelope.maxPriorityFeePerGas }) });
  }

  async function prepareStage(input: { account: Address; accountKind: WalletAccountKind; fee: CctpForwardingFee; amounts: CctpTransferAmounts; balance: bigint; allowance: bigint; operation: BridgeOperation; stage: ReviewStage; attempt: number }) {
    const baseIntent = input.stage === "approval" ? approvalReviewIntent(input.account, input.fee, input.amounts, input.operation.id) : burnIntent(input.account, input.fee, input.amounts, input.operation.id);
    const envelope = await estimateEnvelope(baseIntent);
    const intent = input.stage === "approval" ? approvalReviewIntent(input.account, input.fee, input.amounts, input.operation.id, envelope) : burnIntent(input.account, input.fee, input.amounts, input.operation.id, envelope);
    await simulateExact(intent, envelope);
    if (input.attempt !== reviewAttempt.current || currentWallet.current.kind !== input.accountKind || currentWallet.current.address?.toLowerCase() !== input.account.toLowerCase()) return;
    const snapshot = prepareFlowReview(intent, { connectedAccount: input.account, connectedChainId: arcTestnet.id, balances: { usdc: input.balance }, allowance: input.allowance, simulation: "passed", expectedTarget: input.stage === "approval" ? usdc.address : CCTP_TOKEN_MESSENGER_V2 }, cctpReviewedRequest(intent, envelope));
    const nextOperation = persist(updateBridgeOperation(input.operation, { state: input.stage === "approval" ? "approval-review" : "burn-review" }));
    setPrepared({ stage: input.stage, account: input.account, accountKind: input.accountKind, fee: input.fee, amounts: input.amounts, balance: input.balance, allowance: input.allowance, intent, envelope, snapshot, operationId: nextOperation.id });
  }

  async function prepareFreshBurn(operationToContinue: BridgeOperation, requestedAmount: bigint, attempt = ++reviewAttempt.current) {
    const account = await verifyArcRead();
    const accountKind = currentWallet.current.kind;
    if (!arcClient) throw new Error("CCTP route unavailable.");
    setPending(vi ? "Đang làm mới phí và chuẩn bị Burn Review mới…" : "Refreshing fees and preparing a new Burn Review…");
    const [freshFee, balance, allowance] = await Promise.all([loadFee(), arcClient.readContract({ address: usdc.address, abi: erc20BalanceAbi, functionName: "balanceOf", args: [account] }), arcClient.readContract({ address: usdc.address, abi: erc20BalanceAbi, functionName: "allowance", args: [account, CCTP_TOKEN_MESSENGER_V2] })]);
    const amounts = calculateCctpForwardingAmounts(requestedAmount, freshFee);
    if (balance < amounts.totalAmount) throw new Error("balance");
    const refreshedOperation = persist(updateBridgeOperationQuote(operationToContinue, { totalSourceDebit: amounts.totalAmount, protocolFee: amounts.protocolFee, forwardingFee: amounts.forwardingFee }));
    const stage: ReviewStage = allowance < amounts.totalAmount ? "approval" : "burn";
    setStatusMessage(stage === "approval" ? (vi ? "Phí đã đổi; cần một Approval hữu hạn mới trước Burn." : "Fees changed; a new finite Approval is required before Burn.") : (vi ? "Đã đọc lại allowance, số dư và phí. Burn Review mới đã sẵn sàng." : "Allowance, balance, and fees were re-read. A fresh Burn Review is ready."));
    await prepareStage({ account, accountKind, fee: freshFee, amounts, balance, allowance, operation: refreshedOperation, stage, attempt });
  }

  async function resumeAfterApproval(operationToContinue: BridgeOperation) {
    setError(undefined);
    try { await prepareFreshBurn(operationToContinue, BigInt(operationToContinue.requestedAmount)); }
    catch (caught) { setError(reviewError(caught, vi)); }
    finally { setPending(undefined); }
  }

  async function review() {
    if (pending) return;
    if (!parsed) return setError(vi ? "Nhập số USDC hợp lệ." : "Enter a valid USDC amount.");
    const attempt = ++reviewAttempt.current;
    setPending(vi ? "Đang lấy phí CCTP hiện tại…" : "Loading current CCTP fees…"); setError(undefined); setPrepared(undefined);
    try {
      const account = await verifyArcRead();
      const accountKind = currentWallet.current.kind;
      if (!arcClient) throw new Error("CCTP route unavailable.");
      const [fee, balance, allowance] = await Promise.all([loadFee(), arcClient.readContract({ address: usdc.address, abi: erc20BalanceAbi, functionName: "balanceOf", args: [account] }), arcClient.readContract({ address: usdc.address, abi: erc20BalanceAbi, functionName: "allowance", args: [account, CCTP_TOKEN_MESSENGER_V2] })]);
      const amounts = calculateCctpForwardingAmounts(parsed, fee);
      if (balance < amounts.totalAmount) throw new Error("balance");
      const stage: ReviewStage = allowance < amounts.totalAmount ? "approval" : "burn";
      const nextOperation = persist(createBridgeOperation({ sender: account, requestedAmount: parsed, totalSourceDebit: amounts.totalAmount, protocolFee: amounts.protocolFee, forwardingFee: amounts.forwardingFee, state: stage === "approval" ? "approval-review" : "burn-review" }));
      await prepareStage({ account, accountKind, fee, amounts, balance, allowance, operation: nextOperation, stage, attempt });
    } catch (caught) { if (attempt === reviewAttempt.current) setError(reviewError(caught, vi)); }
    finally { if (attempt === reviewAttempt.current) setPending(undefined); }
  }

  async function executePrepared() {
    if (!prepared || !operation || !arcClient || pending) return;
    const review = prepared;
    let submittedHash: Hash | undefined;
    let sourceReverted = false;
    setError(undefined);
    try {
      const adapter = await verifyArcExecution(review);
      if (Date.now() > review.snapshot.expiresAt || Date.now() - review.fee.quotedAt > FEE_MAX_AGE_MS) throw new Error("expired");
      if (review.stage === "burn") {
        const currentFee = await loadFee().catch(() => undefined);
        if (!currentFee || !Number.isFinite(currentFee.quotedAt) || currentFee.quotedAt > Date.now() || Date.now() - currentFee.quotedAt > FEE_MAX_AGE_MS) throw new Error("changed");
        let currentAmounts: CctpTransferAmounts;
        try { currentAmounts = calculateCctpForwardingAmounts(review.amounts.transferAmount, currentFee); }
        catch { throw new Error("changed"); }
        if (currentAmounts.totalAmount !== review.amounts.totalAmount || currentAmounts.maxFee !== review.amounts.maxFee || currentAmounts.protocolFee !== review.amounts.protocolFee || currentAmounts.forwardingFee !== review.amounts.forwardingFee) throw new Error("changed");
      }
      const [balance, allowance] = await Promise.all([arcClient.readContract({ address: usdc.address, abi: erc20BalanceAbi, functionName: "balanceOf", args: [review.account] }), arcClient.readContract({ address: usdc.address, abi: erc20BalanceAbi, functionName: "allowance", args: [review.account, CCTP_TOKEN_MESSENGER_V2] })]);
      if (balance < review.amounts.totalAmount) throw new Error("balance");
      if (review.stage === "approval" && allowance >= review.amounts.totalAmount) { setPrepared(undefined); await prepareFreshBurn(operation, review.amounts.transferAmount); return; }
      if (review.stage === "approval" && allowance !== review.allowance) throw new Error("allowance-changed");
      if (review.stage === "burn" && allowance < review.amounts.totalAmount) throw new Error("allowance");
      await simulateExact(review.intent, review.envelope);
      const context = { connectedAccount: review.account, connectedChainId: arcTestnet.id, balances: { usdc: balance }, allowance, simulation: "passed" as const, expectedTarget: review.stage === "approval" ? usdc.address : CCTP_TOKEN_MESSENGER_V2 };
      const exactRequest = cctpReviewedRequest(review.intent, review.envelope);
      const checked = revalidateTransactionReview(review.snapshot, { intent: review.intent, context, request: exactRequest, now: Date.now() });
      if (!checked.valid) throw new Error(checked.reason === "expired" ? "expired" : "changed");
      setPending(review.stage === "approval" ? (vi ? "Đang chờ xác nhận approval hữu hạn…" : "Waiting for explicit finite approval confirmation…") : (vi ? "Đang chờ xác nhận burn CCTP…" : "Waiting for explicit CCTP burn confirmation…"));
      const legacySubmit = review.stage === "approval"
        ? () => writer.writeContractAsync({ address: usdc.address, abi: erc20BalanceAbi, functionName: "approve", args: [CCTP_TOKEN_MESSENGER_V2, review.amounts.totalAmount], account: review.account, chainId: arcTestnet.id, gas: review.envelope.gasLimit, maxFeePerGas: review.envelope.maxFeePerGas, ...(review.envelope.maxPriorityFeePerGas === undefined ? {} : { maxPriorityFeePerGas: review.envelope.maxPriorityFeePerGas }) })
        : () => writer.writeContractAsync({ address: CCTP_TOKEN_MESSENGER_V2, abi: CCTP_TOKEN_MESSENGER_ABI, functionName: "depositForBurnWithHook", args: [review.amounts.totalAmount, BASE_SEPOLIA_CCTP_DOMAIN, addressToBytes32(review.account), usdc.address, zeroHash, review.amounts.maxFee, CCTP_STANDARD_FINALITY, CCTP_FORWARDING_HOOK_DATA], account: review.account, chainId: arcTestnet.id, gas: review.envelope.gasLimit, maxFeePerGas: review.envelope.maxFeePerGas, ...(review.envelope.maxPriorityFeePerGas === undefined ? {} : { maxPriorityFeePerGas: review.envelope.maxPriorityFeePerGas }) });
      submittedHash = await submissionGuard.current.run(review.snapshot.fingerprint, () => adapter.submitReviewed(review.snapshot.request, legacySubmit));
      let next = upsertBridgeTransaction(updateBridgeOperation(operation, { state: review.stage === "approval" ? "approval-submitted" : "burn-submitted" }), { role: review.stage, chainId: arcTestnet.id, hash: submittedHash, status: "submitted", explorerUrl: `${ARC_EXPLORER_URL}/tx/${submittedHash}` });
      next = upsertBridgeTransaction(updateBridgeOperation(next, { state: review.stage === "approval" ? "approval-confirming" : "source-confirming" }), { role: review.stage, chainId: arcTestnet.id, hash: submittedHash, status: "confirming", explorerUrl: `${ARC_EXPLORER_URL}/tx/${submittedHash}` });
      persist(next); setPrepared(undefined);
      setPending(review.stage === "approval" ? (vi ? "Approval đã gửi; đang chờ biên nhận Arc…" : "Approval submitted; waiting for its Arc receipt…") : (vi ? "Burn đã gửi; đang chờ biên nhận Arc…" : "Burn submitted; waiting for its Arc receipt…"));
      let receipt;
      try { receipt = await arcClient.waitForTransactionReceipt({ hash: submittedHash }); }
      catch {
        const unknownState: BridgeOperationState = review.stage === "approval" ? "approval-confirmation-unknown" : "source-confirmation-unknown";
        next = upsertBridgeTransaction(updateBridgeOperation(next, { state: unknownState }), { role: review.stage, chainId: arcTestnet.id, hash: submittedHash, status: "unknown", explorerUrl: `${ARC_EXPLORER_URL}/tx/${submittedHash}` });
        persist(next);
        setError(review.stage === "approval" ? (vi ? "Approval đã gửi nhưng trạng thái chưa rõ. Kiểm tra ArcScan trước khi tiếp tục." : "Approval was submitted but confirmation is unknown. Check ArcScan before continuing.") : (vi ? "Burn đã gửi nhưng trạng thái chưa rõ. Không thử lại tự động; hãy kiểm tra ArcScan." : "The burn was submitted but confirmation is unknown. It will not be retried automatically; check ArcScan."));
        return;
      }
      if (receipt.status !== "success") {
        sourceReverted = true;
        const failedState: BridgeOperationState = review.stage === "approval" ? "approval-failed" : "source-failed";
        next = upsertBridgeTransaction(updateBridgeOperation(next, { state: failedState }), { role: review.stage, chainId: arcTestnet.id, hash: submittedHash, status: "reverted", blockNumber: receipt.blockNumber.toString(), explorerUrl: `${ARC_EXPLORER_URL}/tx/${submittedHash}` });
        persist(next); throw new Error("reverted");
      }
      next = upsertBridgeTransaction(updateBridgeOperation(next, { state: review.stage === "approval" ? "approval-confirmed" : "source-confirmed" }), { role: review.stage, chainId: arcTestnet.id, hash: submittedHash, status: "confirmed", blockNumber: receipt.blockNumber.toString(), explorerUrl: `${ARC_EXPLORER_URL}/tx/${submittedHash}` });
      persist(next);
      if (review.stage === "approval") {
        setStatusMessage(vi ? "Approval đã xác nhận. Burn chưa được gửi." : "Approval confirmed. No burn has been submitted.");
        try { await prepareFreshBurn(next, review.amounts.transferAmount); }
        catch (caught) { setError(reviewError(caught, vi)); }
        return;
      }
      const block = await arcClient.getBlock({ blockNumber: receipt.blockNumber });
      const transferLog = receipt.logs.find((log) => log.address.toLowerCase() === usdc.address.toLowerCase());
      recordWalletActivity(review.account, arcTestnet.id, createAssetActivity(usdc, { hash: receipt.transactionHash, logIndex: transferLog?.logIndex ?? -1, direction: "send", kind: "bridge", amount: review.amounts.totalAmount, counterparty: CCTP_TOKEN_MINTER_V2, confirmedAt: Number(block.timestamp) * 1000, blockNumber: receipt.blockNumber }));
      await balances.usdc.refetch();
      next = persist(updateBridgeOperation(next, { state: "waiting-circle", circle: { checkedAt: Date.now() } }));
      setStatusMessage(vi ? "Burn nguồn đã xác nhận. Đang chờ Circle forwarding." : "Source burn confirmed. Waiting for Circle forwarding.");
      void monitorOperation(next);
    } catch (caught) {
      if (submittedHash && !sourceReverted) return;
      setError(executionError(caught, vi, review.stage));
      if (!submittedHash && ["expired", "changed", "account", "account-kind", "allowance", "allowance-changed"].includes(caught instanceof Error ? caught.message : "")) setPrepared(undefined);
    } finally { setPending(undefined); }
  }

  const monitoring = operation && !prepared && operation.transactions.length > 0;
  if (monitoring) return <BridgeOperationStatus operation={operation} checking={checking} statusMessage={statusMessage} error={error} vi={vi} onCheck={() => void monitorOperation(operation)} onResume={() => void resumeAfterApproval(operation)} onReset={reset} />;

  if (prepared) {
    const approval = prepared.stage === "approval";
    const networkFee = calculateArcFee(prepared.envelope.gasLimit, prepared.envelope.maxFeePerGas);
    const details = approval ? [
      { label: vi ? "Người gửi" : "Sender", value: <span className="full-address">{prepared.account}</span> }, { label: vi ? "Mạng" : "Network", value: `Arc Testnet · ${arcTestnet.id}` }, { label: "USDC", value: <span className="full-address">{usdc.address}</span> }, { label: "Spender", value: <span className="full-address">{CCTP_TOKEN_MESSENGER_V2}</span> }, { label: vi ? "Approval hữu hạn" : "Finite approval", value: `${formatUnits(prepared.amounts.totalAmount, 6)} USDC` },
    ] : [
      { label: vi ? "Nguồn" : "Source", value: `Arc Testnet · ${arcTestnet.id}` }, { label: vi ? "Đích" : "Destination", value: `Base Sepolia · ${baseSepolia.id}` }, { label: vi ? "Tài sản" : "Asset", value: "USDC" }, { label: vi ? "Số tiền yêu cầu" : "Requested amount", value: `${formatUnits(prepared.amounts.transferAmount, 6)} USDC` }, { label: vi ? "Phí CCTP" : "CCTP fee", value: `${formatUnits(prepared.amounts.protocolFee, 6)} USDC` }, { label: vi ? "Phí forwarding" : "Forwarding fee", value: `${formatUnits(prepared.amounts.forwardingFee, 6)} USDC` }, { label: vi ? "Tổng trừ nguồn" : "Total source debit", value: `${formatUnits(prepared.amounts.totalAmount, 6)} USDC` }, { label: vi ? "Người nhận" : "Recipient", value: <span className="full-address">{prepared.account}</span> }, { label: "Finality", value: `Standard · ${CCTP_STANDARD_FINALITY}` },
    ];
    return <TransactionSafetyReview
      title={approval ? (vi ? "Kiểm tra Approval CCTP" : "Review CCTP Approval") : (vi ? "Kiểm tra CCTP Burn" : "Review CCTP Burn")}
      summary={approval ? (vi ? "Approval hữu hạn này là giao dịch riêng. Burn chỉ xuất hiện trong Review mới sau khi approval xác nhận." : "This finite approval is a separate transaction. Burn appears only in a new Review after approval confirms.") : (vi ? "Xác nhận riêng để burn USDC trên Arc. Forwarding đích không cần chữ ký Base." : "Explicitly confirm the Arc USDC burn. Destination forwarding does not require a Base signature.")}
      details={details}
      costDetails={[{ label: vi ? "Phí mạng tối đa" : "Maximum network fee", value: formatArcFeeEstimate(networkFee.rawFee) }]}
      technicalDetails={[{ label: "Operation ID", value: <code>{prepared.operationId}</code> }, { label: vi ? "Contract đích" : "Contract target", value: <span className="full-address">{prepared.intent.target}</span> }, { label: "Gas limit", value: prepared.envelope.gasLimit.toString() }, { label: "maxFeePerGas", value: prepared.envelope.maxFeePerGas.toString() }, { label: "maxPriorityFeePerGas", value: prepared.envelope.maxPriorityFeePerGas?.toString() ?? "0" }, { label: vi ? "Dấu vân tay" : "Fingerprint", value: <code>{prepared.snapshot.fingerprint}</code> }, { label: vi ? "Hết hạn" : "Expires", value: new Date(prepared.snapshot.expiresAt).toLocaleTimeString() }]}
      checks={[...globalReviewChecks({ connected: wallet.status === "connected", account: wallet.address, reviewedAccount: prepared.account, isArc: wallet.isArc, amount: prepared.amounts.totalAmount, balance: balances.usdc.data }), { code: "route", status: "verified", label: "Arc Testnet → Base Sepolia · Circle CCTP V2" }, { code: "approval", status: "info", label: approval ? (vi ? "Approval đúng tổng số tiền hiện tại; không vô hạn" : "Exact current total approval; never unlimited") : (vi ? "Allowance đã được đọc lại trước Burn Review" : "Allowance re-read before Burn Review") }]}
      review={prepared.snapshot}
      walletNotice={wallet.kind === "local" ? (wallet.status === "connected" ? (vi ? "Makoto Local Wallet chỉ ký sau khi bạn bấm xác nhận." : "Makoto Local Wallet signs only after you explicitly confirm.") : (vi ? "Ví local đang khóa. Bạn vẫn có thể xem Review, nhưng phải mở khóa để ký." : "The local wallet is locked. You can inspect this Review, but must unlock before signing.")) : (vi ? "Reown/Wagmi sẽ yêu cầu xác nhận giao dịch chính xác này." : "Reown/Wagmi will request confirmation for this exact transaction.")}
      onBack={() => { if (!pending) invalidateReview(); }} onContinue={() => void executePrepared()} continueDisabled={Boolean(pending) || !execution || wallet.status !== "connected"} continueLabel={approval ? (vi ? "Xác nhận Approval" : "Confirm Approval") : (vi ? "Xác nhận Burn" : "Confirm Burn")}>
      {statusMessage && <p className="wallet-notice" role="status" aria-live="polite">{statusMessage}</p>}
      {pending && <p className="transaction-progress" role="status" aria-live="polite" aria-atomic="true">{pending}</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
    </TransactionSafetyReview>;
  }

  const balance = balances.usdc.data ?? 0n;
  return <form className="create-form wallet-flow" onSubmit={(event) => { event.preventDefault(); void review(); }}>
    <label>{vi ? "Số USDC muốn nhận trên Base Sepolia" : "USDC to receive on Base Sepolia"}<div className="wallet-field-with-action amount"><input inputMode="decimal" value={amount} disabled={Boolean(pending)} onChange={(event) => { setAmount(event.target.value); invalidateReview(); }} placeholder="0.00" /><span>USDC</span><button type="button" disabled={Boolean(pending)} onClick={() => { setAmount(formatAssetAmount(balance, usdc)); invalidateReview(); }}>MAX</button></div><small>{vi ? "Khả dụng trên Arc" : "Available on Arc"}: {formatAssetAmount(balance, usdc)} USDC</small></label>
    <dl className="bridge-context-grid">
      <div><dt>{vi ? "Tuyến" : "Route"}</dt><dd>Arc Testnet → Base Sepolia</dd></div>
      <div><dt>{vi ? "Nhà cung cấp" : "Provider"}</dt><dd>Circle CCTP V2</dd></div>
      <div><dt>{vi ? "Tài sản" : "Asset"}</dt><dd>USDC</dd></div>
      <div><dt>{vi ? "Trạng thái ví" : "Wallet status"}</dt><dd>{wallet.kind === "local" ? wallet.status === "connected" ? (vi ? "Đã mở khóa" : "Unlocked") : (vi ? "Đã khóa" : "Locked") : (vi ? "Ví ngoài" : "External wallet")}</dd></div>
    </dl>
    {wallet.kind === "local" && wallet.status !== "connected" && <p className="wallet-notice">{vi ? "Ví local đang khóa: đọc phí và chuẩn bị Review vẫn khả dụng; ký bị chặn." : "Local wallet locked: fee reads and Review preparation remain available; signing is blocked."}</p>}
    {pending && <p className="transaction-progress" role="status" aria-live="polite" aria-atomic="true">{pending}</p>}
    {error && <p className="field-error" role="alert">{error}</p>}
    {!wallet.isArc && <p className="field-error">{vi ? "Cần kết nối Arc Testnet." : "Arc Testnet is required."}</p>}
    <div className="modal-actions"><button type="submit" className="primary-action" disabled={Boolean(pending) || !wallet.address || !wallet.isArc}>{vi ? "Kiểm tra phí" : "Review fees"}</button></div>
  </form>;
}

function BridgeOperationStatus({ operation, checking, statusMessage, error, vi, onCheck, onResume, onReset }: { operation: BridgeOperation; checking: boolean; statusMessage?: string; error?: string; vi: boolean; onCheck(): void; onResume(): void; onReset(): void }) {
  const burn = operation.transactions.find((item) => item.role === "burn");
  const forward = operation.transactions.find((item) => item.role === "forward");
  const complete = operation.state === "destination-confirmed";
  const canResume = ["approval-review", "approval-confirmed", "burn-review"].includes(operation.state) && !burn;
  const canCheck = ["approval-submitted", "approval-confirming", "approval-confirmation-unknown", "burn-submitted", "source-confirming", "source-confirmation-unknown", "source-confirmed", "waiting-circle", "forwarding-submitted", "destination-verification-pending"].includes(operation.state);
  const canReset = isBridgeOperationTerminal(operation.state);
  return <div className="transaction-state"><span aria-hidden="true">{complete ? "✓" : operation.state.includes("failed") ? "!" : "…"}</span><h3>{bridgeStateTitle(operation.state, vi)}</h3><p>{vi ? "Một BridgeOperation giữ approval, burn và giao dịch đích dưới các hash riêng biệt." : "One BridgeOperation keeps approval, burn, and destination transactions under distinct hashes."}</p><p className="wallet-notice">Operation ID: <code>{operation.id}</code></p><ol className="transaction-steps" aria-label={vi ? "Tiến trình bridge" : "Bridge progress"}><li>{vi ? "Nguồn Arc" : "Arc source"}: {sourceStep(operation.state, vi)}</li><li>Circle: {circleStep(operation.state, vi)}</li><li>{vi ? "Đích Base" : "Base destination"}: {destinationStep(operation.state, vi)}</li></ol><p className="wallet-notice" role="status" aria-live="polite" aria-atomic="true">{statusMessage ?? bridgeStateTitle(operation.state, vi)}</p>{operation.destinationEvidence && <dl className="wallet-review"><div><dt>{vi ? "USDC nhận được trong sự kiện" : "USDC received event"}</dt><dd>{formatUnits(BigInt(operation.destinationEvidence.transferAmount), 6)} USDC</dd></div><div><dt>{vi ? "Số dư Base đọc lại" : "Fresh Base balance"}</dt><dd>{formatUnits(BigInt(operation.destinationEvidence.balance), 6)} USDC</dd></div></dl>}<div className="transaction-links">{burn && <a href={burn.explorerUrl} target="_blank" rel="noreferrer">ArcScan ↗</a>}{forward && <a href={forward.explorerUrl} target="_blank" rel="noreferrer">BaseScan ↗</a>}</div>{error && <p className="field-error" role="alert">{error}</p>}<div className="modal-actions">{canCheck && <button type="button" className="secondary-action" onClick={onCheck} disabled={checking}>{checking ? (vi ? "Đang kiểm tra…" : "Checking…") : (vi ? "Kiểm tra lại" : "Check again")}</button>}{canResume && <button type="button" className="primary-action" onClick={onResume} disabled={checking}>{vi ? "Tạo Review mới" : "Prepare fresh Review"}</button>}{canReset && <button type="button" className="primary-action" onClick={onReset}>{vi ? "Bridge tiếp" : "Bridge again"}</button>}</div>{!canCheck && !canResume && !canReset && <p className="wallet-notice">{vi ? "Không gửi lại giao dịch khi trạng thái biên nhận chưa rõ." : "This transaction will not be resubmitted while its receipt is unresolved."}</p>}</div>;
}

function bridgeStateTitle(state: BridgeOperationState, vi: boolean) {
  const labels: Record<BridgeOperationState, [string, string]> = {
    "approval-review": ["Approval Review", "Approval Review"], "approval-submitted": ["Approval đã gửi", "Approval submitted"], "approval-confirming": ["Đang xác nhận approval", "Confirming approval"], "approval-confirmed": ["Approval đã xác nhận", "Approval confirmed"], "approval-failed": ["Approval thất bại", "Approval failed"], "approval-confirmation-unknown": ["Trạng thái approval chưa rõ", "Approval confirmation unknown"], "burn-review": ["Burn Review", "Burn Review"], "burn-submitted": ["Burn đã gửi", "Burn submitted"], "source-confirming": ["Đang xác nhận nguồn", "Confirming source"], "source-confirmed": ["Nguồn đã xác nhận", "Source confirmed"], "source-failed": ["Bridge thất bại ở nguồn", "Bridge failed at source"], "source-confirmation-unknown": ["Xác nhận nguồn chưa rõ", "Source confirmation unknown"], "waiting-circle": ["Đang chờ Circle", "Waiting for Circle"], "forwarding-submitted": ["Forwarding đã gửi", "Forwarding submitted"], "destination-verification-pending": ["Đang chờ xác minh đích", "Destination verification pending"], "destination-confirmed": ["Đích đã xác nhận", "Destination confirmed"], "destination-failed": ["Giao dịch đích thất bại", "Destination failed"],
  };
  return labels[state][vi ? 0 : 1];
}
function sourceStep(state: BridgeOperationState, vi: boolean) { if (state === "source-failed") return vi ? "thất bại" : "failed"; if (state === "source-confirmation-unknown") return vi ? "chưa rõ" : "unknown"; return ["source-confirmed", "waiting-circle", "forwarding-submitted", "destination-verification-pending", "destination-confirmed", "destination-failed"].includes(state) ? (vi ? "đã xác nhận" : "confirmed") : (vi ? "đang xử lý" : "in progress"); }
function circleStep(state: BridgeOperationState, vi: boolean) { return ["forwarding-submitted", "destination-verification-pending", "destination-confirmed", "destination-failed"].includes(state) ? (vi ? "đã gửi forwarding" : "forwarding submitted") : (vi ? "đang chờ" : "waiting"); }
function destinationStep(state: BridgeOperationState, vi: boolean) { return state === "destination-confirmed" ? (vi ? "đã xác nhận" : "confirmed") : state === "destination-failed" ? (vi ? "thất bại" : "failed") : (vi ? "đang chờ" : "pending"); }
function reviewError(caught: unknown, vi: boolean) { if (caught instanceof Error && caught.message === "arc") return vi ? "Cần Arc Testnet để chuẩn bị bridge." : "Arc Testnet is required to prepare the bridge."; if (caught instanceof Error && caught.message === "balance") return vi ? "Số dư USDC không đủ cho số tiền và phí." : "USDC balance is insufficient for the amount and fees."; return caught instanceof Error ? caught.message : (vi ? "Không thể chuẩn bị CCTP Review." : "Could not prepare the CCTP Review."); }
function executionError(caught: unknown, vi: boolean, stage: ReviewStage) {
  const code = caught instanceof Error ? caught.message : "";
  if (code === "locked") return vi ? "Ví local đã khóa. Mở khóa rồi tạo Review mới." : "The local wallet locked. Unlock it and create a fresh Review.";
  if (code === "account" || code === "account-kind") return vi ? "Tài khoản hoặc loại ví đã thay đổi. Cần Review mới." : "The account or wallet kind changed. A fresh Review is required.";
  if (code === "arc") return vi ? "Cần Arc Testnet. Chưa có giao dịch nào được gửi." : "Arc Testnet is required. Nothing was submitted.";
  if (code === "expired") return vi ? "Review hoặc báo giá đã hết hạn. Cần làm mới." : "The Review or fee quote expired. Refresh it.";
  if (code === "allowance" || code === "allowance-changed") return vi ? "Allowance đã thay đổi. Cần Review mới." : "Allowance changed. A fresh Review is required.";
  if (code === "balance") return vi ? "Số dư đã thay đổi và không còn đủ." : "The balance changed and is no longer sufficient.";
  if (code === "reverted") return stage === "burn" ? (vi ? "Burn đã revert; bridge thất bại ở nguồn." : "The burn reverted; the bridge failed at source.") : (vi ? "Approval đã revert. Burn chưa được gửi." : "The approval reverted. No burn was submitted.");
  const kind = classifyWalletFailure(caught, false);
  const messages = { rejected: vi ? "Bạn đã từ chối yêu cầu." : "You rejected the request.", "wrong-network": vi ? "Ví không còn ở Arc Testnet." : "The wallet is no longer on Arc Testnet.", "insufficient-gas": vi ? "Không đủ USDC để trả gas Arc." : "Not enough USDC for Arc gas.", reverted: vi ? "Giao dịch đã revert." : "The transaction reverted.", "confirmation-unknown": vi ? "Trạng thái xác nhận chưa rõ." : "Confirmation is unknown.", rpc: vi ? "Ví hoặc RPC đang gặp lỗi." : "The wallet or RPC failed." } as const;
  return messages[kind];
}
