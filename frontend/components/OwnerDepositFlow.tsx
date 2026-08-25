"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { encodeFunctionData, getAddress, zeroAddress, type Address, type Hash } from "viem";
import { useConnection, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { arcTestnet } from "viem/chains";
import { useVerifiedWalletChain } from "@/hooks/useVerifiedWalletChain";
import { usePreferences } from "@/hooks/usePreferences";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { erc20BalanceAbi } from "@/lib/abi/erc20";
import { penguJarV3Abi } from "@/lib/abi/penguJarV3";
import { ARC_EXPLORER_URL, contractAddress, EXPECTED_USDC_ADDRESS } from "@/lib/config";
import { parseDepositAmount } from "@/lib/deposit";
import { formatUsdc } from "@/lib/format";
import { confirmThenRefresh } from "@/lib/confirmedTransaction";
import { getAssetById } from "@/lib/assets";
import { createAssetActivity, recordWalletActivity } from "@/lib/walletActivity";
import type { Jar } from "@/lib/types";
import { globalReviewChecks } from "@/lib/transactionReview";
import { TransactionSafetyReview } from "./TransactionSafetyReview";
import { approvalIntent, prepareFlowReview, vaultIntent } from "@/lib/transactionFlowReview";
import { revalidateTransactionReview, ReviewSubmissionGuard, type TransactionReviewSnapshot } from "@/lib/transactionOrchestrator";
import { isWalletCancellation, storeAgentResult } from "@/lib/agent/actions";

type Step = "form" | "review" | "checking" | "approval-required" | "approval-wallet" | "approval-submitted" | "approval-confirmed" | "ready" | "deposit-wallet" | "deposit-submitted" | "confirming" | "success" | "error";

export function OwnerDepositFlow({ jar, open, initialAmount, origin, onClose, onSuccess }: { jar: Jar; open: boolean; initialAmount?: string; origin?: "agent"; onClose(): void; onSuccess(): Promise<void> }) {
  const { t, locale } = usePreferences();
  const vi = locale === "vi";
  const connection = useConnection();
  const queryClient = useQueryClient();
  const verifiedChain = useVerifiedWalletChain();
  const publicClient = usePublicClient({ chainId: arcTestnet.id });
  const { writeContractAsync } = useWriteContract();
  const balances = useWalletBalances(connection.address, connection.isConnected && verifiedChain.isArc);
  const allowance = useReadContract({
    address: EXPECTED_USDC_ADDRESS,
    abi: erc20BalanceAbi,
    functionName: "allowance",
    args: connection.address && contractAddress ? [connection.address, contractAddress] : undefined,
    chainId: arcTestnet.id,
    query: { enabled: Boolean(open && connection.address && contractAddress && verifiedChain.isArc) },
  });
  const [value, setValue] = useState(initialAmount ?? "");
  const [step, setStep] = useState<Step>("form");
  const [error, setError] = useState<string>();
  const [approvalHash, setApprovalHash] = useState<Hash>();
  const [depositHash, setDepositHash] = useState<Hash>();
  const [reviewedAccount, setReviewedAccount] = useState<Address>();
  const [reviewSnapshot, setReviewSnapshot] = useState<TransactionReviewSnapshot>();
  const submissionGuard = useRef(new ReviewSubmissionGuard());
  const handoffStarted = useRef(false);
  const amount = useMemo(() => { try { return parseDepositAmount(value); } catch { return undefined; } }, [value]);

  function depositIntent(currentAmount: bigint) { if (!connection.address || !contractAddress) return undefined; return vaultIntent({ id: "vault-deposit", kind: "vault-deposit", account: connection.address, target: contractAddress, calldata: encodeFunctionData({ abi: penguJarV3Abi, functionName: "depositToJar", args: [jar.id, currentAmount] }), preparedAt: Date.now(), assetId: "usdc", amount: currentAmount, jarId: jar.id, metadata: { allowance: (allowance.data ?? 0n).toString() } }); }

  function review(event?: Pick<FormEvent, "preventDefault">) {
    event?.preventDefault();
    try {
      const parsed = parseDepositAmount(value);
      if (balances.usdc.data !== undefined && parsed > balances.usdc.data) throw new Error("Deposit exceeds your available USDC balance.");
      setError(undefined);
      setReviewedAccount(connection.address);
      const intent = depositIntent(parsed); if (intent) setReviewSnapshot(prepareFlowReview(intent, { connectedAccount: connection.address, connectedChainId: verifiedChain.isArc ? arcTestnet.id : undefined, balances: { usdc: balances.usdc.data }, allowance: allowance.data, simulation: "passed", expectedTarget: contractAddress! }));
      setStep("review");
    } catch {
      setError(t("validation.amount"));
    }
  }
  // The one-shot handoff intentionally captures the validated initial values only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!open || origin !== "agent" || !initialAmount || !connection.address || handoffStarted.current) return; handoffStarted.current = true; const timeout = window.setTimeout(() => review(), 0); return () => window.clearTimeout(timeout); }, [connection.address, initialAmount, open, origin]);

  async function checkAllowance() {
    if (!amount) return;
    setError(undefined);
    setStep("checking");
    try {
      await assertCurrentOwner(jar.owner, connection.connector, verifiedChain.isArc);
      assertJarAcceptsDeposits(jar);
      const [freshAllowance, freshBalance] = await Promise.all([allowance.refetch(), balances.usdc.refetch()]);
      if (freshBalance.data === undefined || freshBalance.data < amount) throw new Error("Your wallet does not have enough USDC for this deposit.");
      if ((freshAllowance.data ?? 0n) >= amount) {
        setStep("ready");
        return;
      }
      setStep("approval-required");
    } catch (reason) {
      setError(transactionError(reason, "approval", t));
      setStep("error");
    }
  }

  async function approve() {
    if (!amount) return;
    setError(undefined);
    try {
      await assertCurrentOwner(jar.owner, connection.connector, verifiedChain.isArc);
      assertJarAcceptsDeposits(jar);
      const [freshAllowance, freshBalance] = await Promise.all([allowance.refetch(), balances.usdc.refetch()]);
      if (freshBalance.data === undefined || freshBalance.data < amount) throw new Error("Your wallet does not have enough USDC for this deposit.");
      if ((freshAllowance.data ?? 0n) >= amount) {
        setStep("ready");
        return;
      }
      if (!contractAddress || !connection.address || !publicClient) throw new Error("Deposit configuration is unavailable.");

      setStep("approval-wallet");
      const approval = approvalIntent({ id: "vault-approval", account: connection.address, target: EXPECTED_USDC_ADDRESS, token: EXPECTED_USDC_ADDRESS, spender: contractAddress, amount, assetId: "usdc", calldata: "0x", preparedAt: Date.now() });
      const approvalSnapshot = prepareFlowReview(approval, { connectedAccount: connection.address, connectedChainId: arcTestnet.id, balances: { usdc: freshBalance.data }, allowance: freshAllowance.data, simulation: "passed", expectedTarget: EXPECTED_USDC_ADDRESS });
      const hash = await submissionGuard.current.run(approvalSnapshot.fingerprint, () => writeContractAsync({
        address: EXPECTED_USDC_ADDRESS,
        abi: erc20BalanceAbi,
        functionName: "approve",
        args: [contractAddress!, amount],
        account: connection.address!,
        chainId: arcTestnet.id,
      }));
      setApprovalHash(hash);
      setStep("approval-submitted");
      let replacementReason: string | undefined;
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, onReplaced: (replacement) => {
        replacementReason = replacement.reason;
        setApprovalHash(replacement.transaction.hash);
      } });
      if (replacementReason === "cancelled") throw new Error("The approval transaction was cancelled.");
      if (receipt.status !== "success") throw new Error("The USDC approval reverted.");
      setStep("approval-confirmed");
      const confirmedAllowance = await allowance.refetch();
      if ((confirmedAllowance.data ?? 0n) < amount) throw new Error("The confirmed USDC allowance is still too low.");
      const freshIntent = depositIntent(amount); if (freshIntent) setReviewSnapshot(prepareFlowReview(freshIntent, { connectedAccount: connection.address, connectedChainId: arcTestnet.id, balances: { usdc: freshBalance.data }, allowance: confirmedAllowance.data, simulation: "passed", expectedTarget: contractAddress }));
    } catch (reason) {
      setError(transactionError(reason, "approval", t));
      setStep("error");
    }
  }

  async function deposit() {
    if (!amount) return;
    setError(undefined);
    try {
      await assertCurrentOwner(jar.owner, connection.connector, verifiedChain.isArc);
      assertJarAcceptsDeposits(jar);
      const [freshAllowance, freshBalance] = await Promise.all([allowance.refetch(), balances.usdc.refetch()]);
      if ((freshAllowance.data ?? 0n) < amount) throw new Error("USDC allowance changed. Check it again before depositing.");
      if (freshBalance.data === undefined || freshBalance.data < amount) throw new Error("Your wallet no longer has enough USDC.");
      if (!contractAddress || !connection.address || !publicClient) throw new Error("Deposit configuration is unavailable.");

      if (!reviewSnapshot) throw new Error("Review again.");
      const intent = depositIntent(amount)!;
      const checked = revalidateTransactionReview(reviewSnapshot, { intent: { ...intent, preparedAt: reviewSnapshot.intent.preparedAt }, context: { connectedAccount: connection.address, connectedChainId: arcTestnet.id, balances: { usdc: freshBalance.data }, allowance: freshAllowance.data, simulation: "passed", expectedTarget: contractAddress }, now: Date.now() });
      if (!checked.valid) throw new Error("Review again.");

      setStep("deposit-wallet");
      const hash = await submissionGuard.current.run(reviewSnapshot.fingerprint, () => writeContractAsync({
        address: contractAddress!,
        abi: penguJarV3Abi,
        functionName: "depositToJar",
        args: [jar.id, amount],
        account: connection.address!,
        chainId: arcTestnet.id,
      }));
      setDepositHash(hash);
      setStep("deposit-submitted");
      setStep("confirming");
      let replacementReason: string | undefined;
      const receiptPromise = publicClient.waitForTransactionReceipt({ hash, confirmations: 1, onReplaced: (replacement) => {
        replacementReason = replacement.reason;
        setDepositHash(replacement.transaction.hash);
      } }).then((receipt) => {
        if (replacementReason === "cancelled") throw new Error("The deposit transaction was cancelled.");
        return receipt;
      });
      const receipt = await receiptPromise;
      const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
      await confirmThenRefresh({
        receipt: Promise.resolve(receipt),
        onConfirmed: () => { const usdc = getAssetById("usdc")!; const transferLog = receipt.logs.find((log) => log.address.toLowerCase() === usdc.address.toLowerCase()); recordWalletActivity(connection.address!, arcTestnet.id, createAssetActivity(usdc, { hash: receipt.transactionHash, logIndex: transferLog?.logIndex ?? -1, direction: "send", kind: "vault-deposit", amount: amount!, counterparty: contractAddress!, confirmedAt: Number(block.timestamp) * 1000, blockNumber: receipt.blockNumber })); if (origin === "agent") storeAgentResult(window.sessionStorage, { id: `vault-deposit-${Date.now()}`, account: connection.address!, action: "vault-deposit", status: "confirmed", createdAt: Date.now(), amount: formatUsdc(amount!), asset: "USDC", transactionHash: receipt.transactionHash }); setStep("success"); },
        refresh: () => Promise.all([onSuccess(), balances.usdc.refetch(), allowance.refetch(), queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "jar-activity" })]),
      });
    } catch (reason) {
      if (origin === "agent" && connection.address) storeAgentResult(window.sessionStorage, { id: `vault-deposit-${Date.now()}`, account: connection.address, action: "vault-deposit", status: isWalletCancellation(reason) ? "cancelled" : "failed", createdAt: Date.now() });
      setError(transactionError(reason, "deposit", t));
      setStep("error");
    }
  }

  function close() {
    if (isBusy(step)) return;
    setValue("");
    setStep("form");
    setError(undefined);
    setApprovalHash(undefined);
    setDepositHash(undefined);
    setReviewSnapshot(undefined);
    onClose();
  }

  if (!open) return null;
  const expectedBalance = amount === undefined ? undefined : jar.balance + amount;

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section className="create-modal deposit-modal" role="dialog" aria-modal="true" aria-labelledby="deposit-title">
      <div className="modal-header"><div><p className="eyebrow">{t("flow.ownerDeposit")} · {t("jar.number", { id: jar.id.toString() })}</p><h2 id="deposit-title">{t("flow.addTo", { name: jar.name })}</h2></div><button onClick={close} disabled={isBusy(step)} aria-label={t("common.close")}>×</button></div>

      {step === "form" && <form className="create-form" onSubmit={review}>
        <div className="deposit-summary"><span>{t("flow.currentBalance")}<strong>{formatUsdc(jar.balance)} USDC</strong></span><span>{t("jar.target")}<strong>{formatUsdc(jar.targetAmount)} USDC</strong></span><span>{t("flow.walletBalance")}<strong>{balances.usdc.data === undefined ? t("common.loading") : `${formatUsdc(balances.usdc.data)} USDC`}</strong></span></div>
        <label>{t("flow.depositAmount")}<div className="unit-input"><input inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} placeholder="0.00" autoFocus /><span>USDC</span></div><small>{t("create.amountHelp")}</small></label>
        {error && <p className="form-alert" role="alert">{error}</p>}
        <div className="modal-actions"><button type="button" className="cancel-action" onClick={close}>{t("common.cancel")}</button><button type="submit" className="primary-action">{t("flow.reviewDeposit")}</button></div>
      </form>}

      {step === "review" && amount && expectedBalance !== undefined && <TransactionSafetyReview
        review={reviewSnapshot}
        title={vi ? "Kiểm tra gửi tiết kiệm" : "Review Savings Deposit"}
        summary={vi ? "Giao dịch này gửi USDC vào mục tiêu Makoto Vault đã chọn. Giao dịch không cung cấp lợi suất hay lợi nhuận đầu tư." : "This transaction deposits USDC into the selected Makoto Vault savings goal. It does not provide yield or investment returns."}
        details={[{ label: t("actions.deposit"), value: `${formatUsdc(amount)} USDC` }, { label: t("jar.number", { id: jar.id.toString() }), value: `${jar.name} · #${jar.id}` }, { label: vi ? "Bảo vệ" : "Protection", value: `${Number(jar.mode) === 1 ? "SHIELDED" : "SAFE"} · ${Number(jar.privacyMode) === 1 ? "PRIVATE" : "PUBLIC"}` }, { label: "Guardian / Recovery", value: `${jar.guardian !== zeroAddress ? (vi ? "Đã cấu hình" : "Configured") : (vi ? "Chưa cấu hình" : "Not configured")} / ${jar.recoveryWallet !== zeroAddress ? (vi ? "Đã cấu hình" : "Configured") : (vi ? "Chưa cấu hình" : "Not configured")}` }, { label: t("flow.currentBalance"), value: `${formatUsdc(jar.balance)} USDC` }, { label: t("flow.expectedBalance"), value: `${formatUsdc(expectedBalance)} USDC` }, { label: t("wallet.wallet"), value: connection.address ? <span className="full-address">{connection.address}</span> : t("validation.disconnected") }, { label: t("wallet.network"), value: "Arc Testnet · 5042002" }]}
        checks={globalReviewChecks({ connected: connection.isConnected, account: connection.address, reviewedAccount, isArc: verifiedChain.isArc, amount, balance: balances.usdc.data })}
        walletNotice={vi ? "Makoto kiểm tra allowance chính xác. Nếu cần, ví có thể yêu cầu approve đúng số lượng rồi xác nhận gửi tiền." : "Makoto checks the exact allowance. If needed, the wallet may request an exact-amount approval followed by the deposit confirmation."}
        onBack={() => setStep("form")}
        onContinue={() => void checkAllowance()}
      >
        <p className="review-note">Arc network gas is paid separately in native USDC. If approval is needed, it will be limited to this deposit amount—never unlimited.</p>
        <p className="wallet-notice">{vi ? "USDC cũng dùng để trả phí mạng Arc. Gửi gần hết hoặc toàn bộ có thể khiến bạn thiếu USDC cho giao dịch sau; Makoto không tự đặt mức gas dự phòng." : "USDC also pays Arc network fees. Depositing nearly or all of it may leave too little USDC for a future transaction; Makoto does not reserve an invented gas amount."}</p>
      </TransactionSafetyReview>}

      {step === "approval-required" && <TransactionPanel title={t("flow.approvalRequired")} copy={t("flow.approvalExactCopy")} hashes={{ approvalHash }} action={<button className="primary-action standalone-action" onClick={() => void approve()}>{t("flow.approveExact")}</button>} />}
      {step === "approval-confirmed" && <TransactionPanel title={t("flow.approvalConfirmed")} copy={t("tx.success")} hashes={{ approvalHash }} action={<button className="primary-action standalone-action" onClick={() => setStep("ready")}>{t("flow.continue")}</button>} />}
      {step === "ready" && <TransactionPanel title={t("flow.readyDeposit")} copy={t("create.waitingCopy")} hashes={{ approvalHash }} action={<button className="primary-action standalone-action" onClick={() => void deposit()}>{t("flow.confirmDeposit")}</button>} />}
      {step === "success" && <TransactionPanel title={t("flow.depositSuccess")} copy={t("tx.success")} hashes={{ approvalHash, depositHash }} action={<button className="primary-action standalone-action" onClick={close}>{t("flow.updatedJar")}</button>} />}
      {step === "error" && <TransactionPanel title={t("flow.depositFailed")} copy={error ?? t("tx.failed")} hashes={{ approvalHash, depositHash }} action={<button className="primary-action standalone-action" onClick={() => setStep("review")}>{t("flow.reviewRetry")}</button>} />}
      {!["form", "review", "approval-required", "approval-confirmed", "ready", "success", "error"].includes(step) && <TransactionPanel title={stepTitle(step, t)} copy={stepCopy(step, t)} hashes={{ approvalHash, depositHash }} />}
    </section>
  </div>;
}

function TransactionPanel({ title, copy, hashes, action }: { title: string; copy: string; hashes: { approvalHash?: Hash; depositHash?: Hash }; action?: React.ReactNode }) {
  const { t } = usePreferences();
  return <div className="transaction-state"><span>↻</span><h3>{title}</h3><p>{copy}</p><div className="transaction-links">{hashes.approvalHash && <a href={`${ARC_EXPLORER_URL}/tx/${hashes.approvalHash}`} target="_blank" rel="noreferrer">{t("tx.arcscan")} ↗</a>}{hashes.depositHash && <a href={`${ARC_EXPLORER_URL}/tx/${hashes.depositHash}`} target="_blank" rel="noreferrer">{t("tx.arcscan")} ↗</a>}</div>{action}</div>;
}

function stepTitle(step: Step, t: ReturnType<typeof usePreferences>["t"]) {
  const labels: Partial<Record<Step, string>> = { checking: t("flow.checkAllowance"), "approval-wallet": t("tx.waiting"), "approval-submitted": t("tx.submitted"), "approval-confirmed": t("flow.approvalConfirmed"), "deposit-wallet": t("tx.waiting"), "deposit-submitted": t("tx.submitted"), confirming: t("tx.confirming") };
  return labels[step] ?? "Working…";
}

function stepCopy(step: Step, t: ReturnType<typeof usePreferences>["t"]) {
  if (step.startsWith("approval")) return t("flow.approvalExactCopy");
  if (step === "checking") return t("flow.checkAllowance");
  return t("create.submittedCopy");
}

function isBusy(step: Step) {
  return ["checking", "approval-wallet", "approval-submitted", "deposit-wallet", "deposit-submitted", "confirming"].includes(step);
}

async function assertCurrentOwner(owner: Address, connector: ReturnType<typeof useConnection>["connector"], verifiedArc: boolean) {
  if (!connector || !verifiedArc) throw new Error("Switch the connected wallet to Arc Testnet before depositing.");
  const provider = await connector.getProvider() as { request(args: { method: string }): Promise<unknown> } | undefined;
  if (!provider) throw new Error("The connected wallet provider is unavailable.");
  const [accountsValue, providerChainValue, connectorChainId] = await Promise.all([
    provider.request({ method: "eth_accounts" }),
    provider.request({ method: "eth_chainId" }),
    connector.getChainId(),
  ]);
  const accounts = Array.isArray(accountsValue) ? accountsValue : [];
  if (typeof accounts[0] !== "string" || getAddress(accounts[0]) !== getAddress(owner)) throw new Error("Only the savings goal owner can deposit into this goal.");
  const providerChainId = typeof providerChainValue === "string" ? Number.parseInt(providerChainValue, 16) : Number(providerChainValue);
  if (providerChainId !== arcTestnet.id || connectorChainId !== arcTestnet.id) throw new Error("The connected wallet is not verified on Arc Testnet.");
}

function transactionError(reason: unknown, action: "approval" | "deposit", t: ReturnType<typeof usePreferences>["t"]) {
  const message = reason instanceof Error ? reason.message : "";
  if (/reject|denied|4001|replac|cancel/i.test(message)) return t("tx.rejected");
  if (/balance/i.test(message)) return t("validation.balance");
  if (/owner/i.test(message)) return t("common.ownerOnly");
  if (/network|Arc|provider/i.test(message)) return t("wallet.switch");
  if (/revert|execution/i.test(message)) return t("validation.reverted");
  return action === "approval" ? t("flow.approvalRequired") : t("tx.rpc");
}

function assertJarAcceptsDeposits(jar: Jar) {
  if (jar.closed) throw new Error("This savings goal is closed and cannot receive deposits.");
  if (BigInt(Math.floor(Date.now() / 1000)) >= jar.unlockTime) throw new Error("This savings goal has reached its unlock time and cannot receive deposits.");
}
