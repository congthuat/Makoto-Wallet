"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { decodeEventLog, encodeFunctionData, formatUnits, getAddress, isAddress, zeroAddress, type Hex } from "viem";
import { useConnection, useSignMessage, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { arcTestnet } from "viem/chains";
import { penguJarV3Abi } from "@/lib/abi/penguJarV3";
import { ARC_EXPLORER_URL, contractAddress } from "@/lib/config";
import { defaultUnlockLocal, minimumUnlockLocal, parseCreateJar, type CreateJarValues } from "@/lib/createJar";
import { formatLocalDateTime, formatUsdc, shortAddress } from "@/lib/format";
import { confirmThenRefresh } from "@/lib/confirmedTransaction";
import { useVerifiedWalletChain } from "@/hooks/useVerifiedWalletChain";
import { usePreferences } from "@/hooks/usePreferences";
import {
  encryptPrivateMetadata,
  privateMetadataSigningMessage,
  finalizePendingEncryptedMetadata,
  savePendingEncryptedMetadata,
  type PendingEncryptedMetadata,
} from "@/lib/privateMetadata";
import { TransactionSafetyChecks, TransactionSafetyReview } from "./TransactionSafetyReview";
import { prepareFlowReview } from "@/lib/transactionFlowReview";
import { revalidateTransactionReview, ReviewSubmissionGuard, type TransactionReviewSnapshot } from "@/lib/transactionOrchestrator";
import type { TransactionIntent } from "@/lib/transactionSafety";

type Step = "form" | "review" | "wallet" | "submitted" | "success" | "error";

export function CreateJarFlow({ open, onClose, onConfirmed }: { open: boolean; onClose(): void; onConfirmed(): Promise<void> }) {
  const { t, locale } = usePreferences();
  const vi = locale === "vi";
  const connection = useConnection();
  const verifiedChain = useVerifiedWalletChain();
  const write = useWriteContract();
  const signMessage = useSignMessage();
  const [values, setValues] = useState<CreateJarValues>({ name: "", target: "", unlockLocal: defaultUnlockLocal() });
  const [note, setNote] = useState("");
  const [privacy, setPrivacy] = useState<"public" | "private">("public");
  const [jarMode, setJarMode] = useState<"safe" | "shielded">("safe");
  const [withdrawalDelayHours, setWithdrawalDelayHours] = useState("24");
  const [guardianProtection, setGuardianProtection] = useState(false);
  const [guardianWallet, setGuardianWallet] = useState("");
  const [recoveryWallet, setRecoveryWallet] = useState("");
  const [minimumUnlock] = useState(minimumUnlockLocal);
  const [step, setStep] = useState<Step>("form");
  const [formError, setFormError] = useState<string>();
  const [transactionError, setTransactionError] = useState<string>();
  const [confirmedHash, setConfirmedHash] = useState<`0x${string}`>();
  const [reviewedAccount, setReviewedAccount] = useState<`0x${string}`>();
  const [reviewSnapshot, setReviewSnapshot] = useState<TransactionReviewSnapshot>();
  const submissionGuard = useRef(new ReviewSubmissionGuard());
  const finalizedHash = useRef<`0x${string}` | undefined>(undefined);
  const pendingEncrypted = useRef<PendingEncryptedMetadata | undefined>(undefined);
  const receipt = useWaitForTransactionReceipt({ hash: write.data, chainId: arcTestnet.id, query: { enabled: Boolean(write.data) } });
  const parsed = useMemo(() => { try { return parseCreateJar(values); } catch { return undefined; } }, [values]);
  const unlockParts = splitLocalDateTime(values.unlockLocal);
  const onArc = connection.status === "connected" && verifiedChain.isArc;

  function goalIntent(safe: ReturnType<typeof parseCreateJar>, commitment?: Hex): TransactionIntent | undefined {
    if (!connection.address || !contractAddress) return undefined;
    const withdrawalDelay = BigInt(withdrawalDelayHours) * 60n * 60n;
    const protection = guardianProtection ? validateProtectionWallets(guardianWallet, recoveryWallet, connection.address, t("create.walletsError"), t("create.distinctWalletsError")) : undefined;
    let calldata: Hex;
    if (privacy === "private") {
      if (!commitment) return undefined;
      calldata = jarMode === "shielded" ? protection ? encodeFunctionData({ abi: penguJarV3Abi, functionName: "createPrivateGuardianShieldedJar", args: [commitment, safe.unlockTime, 0n, withdrawalDelay, protection.guardian, protection.recovery] }) : encodeFunctionData({ abi: penguJarV3Abi, functionName: "createPrivateShieldedJar", args: [commitment, safe.unlockTime, 0n, withdrawalDelay] }) : encodeFunctionData({ abi: penguJarV3Abi, functionName: "createPrivateJar", args: [commitment, safe.unlockTime, 0n] });
    } else calldata = jarMode === "shielded" ? protection ? encodeFunctionData({ abi: penguJarV3Abi, functionName: "createGuardianShieldedJar", args: [safe.name, safe.targetAmount, safe.unlockTime, 0n, withdrawalDelay, protection.guardian, protection.recovery] }) : encodeFunctionData({ abi: penguJarV3Abi, functionName: "createShieldedJar", args: [safe.name, safe.targetAmount, safe.unlockTime, 0n, withdrawalDelay] }) : encodeFunctionData({ abi: penguJarV3Abi, functionName: "createJar", args: [safe.name, safe.targetAmount, safe.unlockTime, 0n] });
    return { id: "vault-goal-create", kind: "vault-create", chainId: arcTestnet.id, account: connection.address, target: contractAddress, calldata, value: 0n, preparedAt: reviewNow(), metadata: { targetAmount: safe.targetAmount.toString(), unlockTime: safe.unlockTime.toString(), privacy, jarMode, guardianProtection } };
  }

  function review(event: FormEvent) {
    event.preventDefault();
    try {
      const parsedReview = parseCreateJar(values);
      if (jarMode === "shielded") {
        const hours = Number(withdrawalDelayHours);
        if (!Number.isInteger(hours) || hours < 1 || hours > 720) {
          throw new Error(t("create.delayError"));
        }
        if (guardianProtection) validateProtectionWallets(guardianWallet, recoveryWallet, connection.address, t("create.walletsError"), t("create.distinctWalletsError"));
      }
      setFormError(undefined);
      setReviewedAccount(connection.address);
      if (privacy === "public") { const intent = goalIntent(parsedReview); if (intent) setReviewSnapshot(prepareFlowReview(intent, { connectedAccount: connection.address, connectedChainId: onArc ? arcTestnet.id : undefined, simulation: "passed", expectedTarget: contractAddress! })); }
      setStep("review");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setFormError(/time|future|minute/i.test(message) ? t("validation.future") : message || t("tx.failed"));
    }
  }

  async function submit() {
    if (connection.status !== "connected" || !onArc || !contractAddress) return;
    if (!reviewedAccount || !connection.address || reviewedAccount.toLowerCase() !== connection.address.toLowerCase()) { setStep("form"); setFormError(t("review.changed")); return; }
    const safe = parseCreateJar(values);
    setStep("wallet");
    setTransactionError(undefined);
    try {
      const withdrawalDelay = BigInt(withdrawalDelayHours) * 60n * 60n;
      const protection = guardianProtection
        ? validateProtectionWallets(guardianWallet, recoveryWallet, connection.address, t("create.walletsError"), t("create.distinctWalletsError"))
        : undefined;
      if (reviewSnapshot) { const reviewedIntent = goalIntent(safe, pendingEncrypted.current?.metadataCommitment); if (!reviewedIntent) throw new Error("Review again."); const checked = revalidateTransactionReview(reviewSnapshot, { intent: { ...reviewedIntent, preparedAt: reviewSnapshot.preparedAt }, context: { connectedAccount: connection.address, connectedChainId: arcTestnet.id, simulation: "passed", expectedTarget: contractAddress }, now: reviewNow() }); if (!checked.valid) throw new Error("Review again."); }
      const guardedWrite = (request: Parameters<typeof write.mutateAsync>[0]) => { if (!reviewSnapshot) throw new Error("Review again."); return submissionGuard.current.run(reviewSnapshot.fingerprint, () => write.mutateAsync(request)); };
      let hash: `0x${string}`;
      if (privacy === "private") {
        const encrypted = pendingEncrypted.current ?? await (async () => { const signature = await signMessage.mutateAsync({ message: privateMetadataSigningMessage(connection.address, arcTestnet.id, contractAddress), account: connection.address }); return encryptPrivateMetadata({ metadata: { version: 1, name: safe.name, targetAmount: formatUnits(safe.targetAmount, 6), note: note.trim() }, signature, owner: connection.address, chainId: arcTestnet.id, contractAddress }); })();
        pendingEncrypted.current = encrypted;
        if (!reviewSnapshot) { const intent = goalIntent(safe, encrypted.metadataCommitment); if (!intent) throw new Error("Could not prepare goal review."); setReviewSnapshot(prepareFlowReview(intent, { connectedAccount: connection.address, connectedChainId: arcTestnet.id, simulation: "passed", expectedTarget: contractAddress })); setStep("review"); return; }
        hash = jarMode === "shielded"
          ? protection
            ? await guardedWrite({ address: contractAddress, abi: penguJarV3Abi, functionName: "createPrivateGuardianShieldedJar", args: [encrypted.metadataCommitment, safe.unlockTime, 0n, withdrawalDelay, protection.guardian, protection.recovery], chainId: arcTestnet.id, account: connection.address })
            : await guardedWrite({ address: contractAddress, abi: penguJarV3Abi, functionName: "createPrivateShieldedJar", args: [encrypted.metadataCommitment, safe.unlockTime, 0n, withdrawalDelay], chainId: arcTestnet.id, account: connection.address })
          : await guardedWrite({ address: contractAddress, abi: penguJarV3Abi, functionName: "createPrivateJar", args: [encrypted.metadataCommitment, safe.unlockTime, 0n], chainId: arcTestnet.id, account: connection.address });
      } else {
        pendingEncrypted.current = undefined;
        hash = jarMode === "shielded"
          ? protection
            ? await guardedWrite({ address: contractAddress, abi: penguJarV3Abi, functionName: "createGuardianShieldedJar", args: [safe.name, safe.targetAmount, safe.unlockTime, 0n, withdrawalDelay, protection.guardian, protection.recovery], chainId: arcTestnet.id, account: connection.address })
            : await guardedWrite({ address: contractAddress, abi: penguJarV3Abi, functionName: "createShieldedJar", args: [safe.name, safe.targetAmount, safe.unlockTime, 0n, withdrawalDelay], chainId: arcTestnet.id, account: connection.address })
          : await guardedWrite({ address: contractAddress, abi: penguJarV3Abi, functionName: "createJar", args: [safe.name, safe.targetAmount, safe.unlockTime, 0n], chainId: arcTestnet.id, account: connection.address });
      }
      if (pendingEncrypted.current) {
        savePendingEncryptedMetadata({ ...pendingEncrypted.current, transactionHash: hash });
        pendingEncrypted.current = undefined;
      }
      setConfirmedHash(hash);
      setStep("submitted");
    } catch (error) {
      pendingEncrypted.current = undefined;
      setTransactionError(transactionErrorMessage(error, t));
      setStep("error");
    }
  }

  useEffect(() => {
    if (step !== "submitted") return;
    const timer = window.setTimeout(() => {
      if (receipt.isSuccess && write.data && finalizedHash.current !== write.data) {
        const jarId = createdJarId(receipt.data?.logs ?? [], contractAddress);
        if (jarId === undefined) {
          setTransactionError(t("create.eventError"));
          setStep("error");
          return;
        }
        if (confirmedHash && connection.address && contractAddress) {
          finalizePendingEncryptedMetadata(
            { chainId: arcTestnet.id, contractAddress, owner: connection.address, transactionHash: confirmedHash },
            jarId.toString(),
          );
        }
        finalizedHash.current = write.data;
        void confirmThenRefresh({
          receipt: Promise.resolve({ status: "success" as const }),
          onConfirmed: () => setStep("success"),
          refresh: onConfirmed,
        });
      }
      if (receipt.isError) {
        setTransactionError(transactionErrorMessage(receipt.error, t));
        setStep("error");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [confirmedHash, connection.address, onConfirmed, receipt.data?.logs, receipt.error, receipt.isError, receipt.isSuccess, step, t, write.data]);

  if (!open) return null;

  let jarId: bigint | undefined;
  if (receipt.data) {
    for (const log of receipt.data.logs) {
      try {
        const decoded = decodeEventLog({ abi: penguJarV3Abi, data: log.data, topics: log.topics });
        if (decoded.eventName === "JarCreated") jarId = decoded.args.jarId;
      } catch { /* unrelated log */ }
    }
  }

  if (step === "review" && parsed && reviewSnapshot) return <div className="modal-backdrop" role="presentation"><section className="create-modal" role="dialog" aria-modal="true" aria-label={t("create.review")}><TransactionSafetyReview title={t("create.title")} summary={t("create.noDeposit")} details={[{ label: t("create.name"), value: parsed.name }, { label: t("jar.target"), value: `${formatUsdc(parsed.targetAmount)} USDC` }, { label: t("jar.unlocks"), value: formatLocalDateTime(parsed.unlockDate) }, { label: t("create.withdrawalProtection"), value: jarMode === "shielded" ? `SHIELDED · ${withdrawalDelayHours} ${t("create.hours")}` : "SAFE" }, { label: t("create.metadataVisibility"), value: privacy === "private" ? "PRIVATE" : "PUBLIC" }, { label: t("wallet.wallet"), value: <span className="full-address">{connection.address}</span> }, { label: t("wallet.network"), value: "Arc Testnet · 5042002" }, { label: t("create.starting"), value: "0 USDC" }]} checks={[{ code: "wallet", status: connection.isConnected && connection.address === reviewedAccount ? "verified" : "blocking", label: connection.isConnected && connection.address === reviewedAccount ? "Connected account matches review" : t("review.changed") }, { code: "network", status: onArc ? "verified" : "blocking", label: onArc ? "Arc Testnet · 5042002" : t("wallet.switch") }, { code: "config", status: "info", label: t("create.noDeposit") }]} review={reviewSnapshot} walletNotice={privacy === "private" ? (vi ? "Chữ ký mã hóa metadata đã hoàn tất. Ví sẽ yêu cầu xác nhận riêng cho giao dịch tạo mục tiêu." : "Metadata encryption signing is complete. Your wallet will separately confirm the goal-creation transaction.") : (vi ? "Ví sẽ yêu cầu xác nhận giao dịch tạo mục tiêu Makoto Vault." : "Your wallet will request confirmation for the Makoto Vault goal-creation transaction.")} onBack={() => { setReviewSnapshot(undefined); pendingEncrypted.current = undefined; setStep("form"); }} onContinue={() => void submit()} continueDisabled={!onArc || !contractAddress} /></section></div>;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && step !== "wallet" && step !== "submitted") onClose(); }}>
      <section className="create-modal" role="dialog" aria-modal="true" aria-labelledby="create-title">
        <div className="modal-header"><div><p className="eyebrow">{t("create.kicker")}</p><h2 id="create-title">{t("create.title")}</h2></div><button onClick={onClose} disabled={step === "wallet" || step === "submitted"} aria-label={t("common.close")}>×</button></div>
        <div className="step-indicator"><span className={step === "form" ? "active" : "done"}>1 {t("create.goal")}</span><i /><span className={step === "review" ? "active" : (["wallet","submitted","success"].includes(step) ? "done" : "")}>2 {t("create.review")}</span><i /><span className={["wallet","submitted"].includes(step) ? "active" : step === "success" ? "done" : ""}>3 {t("create.confirm")}</span></div>

        {step === "form" && <form className="create-form" onSubmit={review}>
          <fieldset className="create-choice"><legend>{t("create.metadataVisibility")}</legend><label><input type="radio" name="privacy" checked={privacy === "public"} onChange={() => setPrivacy("public")} /> {t("create.public")}</label><label><input type="radio" name="privacy" checked={privacy === "private"} onChange={() => setPrivacy("private")} /> {t("create.privateMetadata")}</label></fieldset>
          <fieldset className="create-choice"><legend>{t("create.withdrawalProtection")}</legend><label><input type="radio" name="mode" checked={jarMode === "safe"} onChange={() => setJarMode("safe")} /> {t("create.safe")}</label><label><input type="radio" name="mode" checked={jarMode === "shielded"} onChange={() => setJarMode("shielded")} /> {t("create.shielded")}</label></fieldset>
          <label>{t("create.name")}<input value={values.name} maxLength={64} onChange={(event) => setValues({ ...values, name: event.target.value })} placeholder={t("create.namePlaceholder")} autoFocus /><small>{t("create.nameHelp")}</small></label>
          <label>{t("create.target")}<div className="unit-input"><input inputMode="decimal" value={values.target} onChange={(event) => setValues({ ...values, target: event.target.value })} placeholder="250.50" /><span>USDC</span></div><small>{t("create.amountHelp")}</small></label>
          {privacy === "private" && <label>{t("create.privateNote")}<textarea value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} placeholder={t("create.privateNotePlaceholder")} /><small>{t("create.privateMetadataHelp")}</small></label>}
          {jarMode === "shielded" && <label>{t("create.withdrawalDelay")}<div className="unit-input"><input inputMode="numeric" value={withdrawalDelayHours} onChange={(event) => setWithdrawalDelayHours(event.target.value)} /><span>{t("create.hours")}</span></div><small>{t("create.withdrawalDelayHelp")}</small></label>}
          {jarMode === "shielded" && <fieldset className="create-choice"><legend>{t("create.guardianProtection")}</legend><label><input type="radio" name="guardian" checked={!guardianProtection} onChange={() => setGuardianProtection(false)} /> {t("create.off")}</label><label><input type="radio" name="guardian" checked={guardianProtection} onChange={() => setGuardianProtection(true)} /> {t("create.on")}</label></fieldset>}
          {jarMode === "shielded" && guardianProtection && <div className="security-fields">
            <label>{t("create.guardianWallet")}<input value={guardianWallet} onChange={(event) => setGuardianWallet(event.target.value)} placeholder="0x…" /><small>{t("create.guardianHelp")}</small></label>
            <label>{t("create.recoveryWallet")}<input value={recoveryWallet} onChange={(event) => setRecoveryWallet(event.target.value)} placeholder="0x…" /><small>{t("create.recoveryHelp")}</small></label>
          </div>}
          <label>{t("create.unlock")}<div className="date-time-24"><input aria-label={t("jar.unlockDate")} type="date" value={unlockParts.date} min={minimumUnlock.slice(0, 10)} onChange={(event) => setValues({ ...values, unlockLocal: joinLocalDateTime(event.target.value, unlockParts.hour, unlockParts.minute) })} /><select aria-label={t("create.unlock")} value={unlockParts.hour} onChange={(event) => setValues({ ...values, unlockLocal: joinLocalDateTime(unlockParts.date, event.target.value, unlockParts.minute) })}>{timeOptions(24).map((hour) => <option key={hour} value={hour}>{hour}</option>)}</select><span>:</span><select aria-label={t("create.unlock")} value={unlockParts.minute} onChange={(event) => setValues({ ...values, unlockLocal: joinLocalDateTime(unlockParts.date, unlockParts.hour, event.target.value) })}>{timeOptions(60).map((minute) => <option key={minute} value={minute}>{minute}</option>)}</select></div><small>{parsed ? t("create.selected", { date: formatLocalDateTime(parsed.unlockDate) }) : t("create.timeHelp")}</small></label>
          {formError && <p className="form-alert" role="alert">{formError}</p>}
          <div className="modal-actions"><button type="button" className="cancel-action" onClick={onClose}>{t("common.cancel")}</button><button type="submit" className="primary-action">{t("create.reviewJar")}</button></div>
        </form>}

        {step === "review" && parsed && <div className="review-panel">
          <div className="review-hero"><span>✦</span><div><small>{t("create.name")}</small><strong>{parsed.name}</strong></div></div>
          <dl><div><dt>{t("jar.target")}</dt><dd>{formatUsdc(parsed.targetAmount)} USDC</dd></div><div><dt>{t("jar.unlocks")}</dt><dd>{formatLocalDateTime(parsed.unlockDate)}</dd></div><div><dt>{t("create.withdrawalProtection")}</dt><dd>{jarMode === "shielded" ? `SHIELDED · ${withdrawalDelayHours} ${t("create.hours")}` : "SAFE"}</dd></div><div><dt>{t("create.metadataVisibility")}</dt><dd>{privacy === "private" ? "PRIVATE" : "PUBLIC"}</dd></div><div><dt>{t("wallet.wallet")}</dt><dd>{connection.address ? <span className="full-address">{connection.address}</span> : t("actions.connect")}</dd></div><div><dt>{t("wallet.network")}</dt><dd>{onArc ? "Arc Testnet · 5042002" : t("wallet.switch")}</dd></div><div><dt>{t("create.starting")}</dt><dd>0 USDC</dd></div></dl>
          <TransactionSafetyChecks checks={[{ code: connection.isConnected && connection.address !== reviewedAccount ? "account" : "wallet", status: connection.isConnected && connection.address === reviewedAccount ? "verified" : "blocking", label: connection.isConnected ? (connection.address === reviewedAccount ? (vi ? "Tài khoản kết nối khớp với bản kiểm tra" : "Connected account matches review") : t("review.changed")) : t("validation.disconnected") }, { code: "network", status: onArc ? "verified" : "blocking", label: onArc ? "Arc Testnet · 5042002" : t("wallet.switch") }, { code: "config", status: "info", label: t("create.noDeposit") }]} />
          <p className="review-note">{t("create.noDeposit")}</p>
          {privacy === "private" && <p className="review-note">{t("create.privateReview")}</p>}
          {jarMode === "shielded" && guardianProtection && <p className="review-note">{t("create.protectedReview", { guardian: shortAddress(getAddress(guardianWallet)), recovery: shortAddress(getAddress(recoveryWallet)) })}</p>}
          {!connection.isConnected && <p className="form-alert">{t("create.connectBefore")}</p>}
          {connection.isConnected && !onArc && <button className="switch-review" onClick={() => void verifiedChain.switchToArc()} disabled={["waiting", "switching", "missing"].includes(verifiedChain.switchStatus)}>{verifiedChain.switchStatus === "waiting" || verifiedChain.switchStatus === "missing" ? t("create.waitingSwitch") : verifiedChain.switchStatus === "switching" ? t("create.switching") : t("create.switchArc")}</button>}
          {connection.isConnected && !onArc && verifiedChain.switchMessage && <p className="form-alert">{verifiedChain.switchMessage}</p>}
          <div className="modal-actions"><button className="cancel-action" onClick={() => setStep("form")}>{t("common.back")}</button><button className="primary-action" onClick={() => void submit()} disabled={!onArc || !contractAddress}>{t("create.confirmWallet")}</button></div>
        </div>}

        {step === "wallet" && <TransactionState icon="◌" title={t("create.waitingTitle")} copy={t("create.waitingCopy")} />}
        {step === "submitted" && <TransactionState icon="↻" title={receipt.isLoading ? t("create.confirming") : t("create.submitted")} copy={t("create.submittedCopy")} hash={confirmedHash} />}
        {step === "error" && <TransactionState icon="!" title={t("create.failed")} copy={transactionError ?? t("tx.failed")} hash={confirmedHash} action={<div className="modal-actions"><button className="cancel-action" onClick={onClose}>{t("common.close")}</button><button className="primary-action" onClick={() => setStep("review")}>{t("common.tryAgain")}</button></div>} />}
        {step === "success" && <TransactionState icon="✓" title={t("create.success")} copy={`${t("create.success")}${jarId ? ` #${jarId}` : ""}.`} hash={confirmedHash} action={<div className="modal-actions"><button className="primary-action" onClick={onClose}>{t("create.viewDashboard")}</button></div>} />}
      </section>
    </div>
  );
}

function createdJarId(logs: readonly { address: `0x${string}`; data: `0x${string}`; topics: readonly `0x${string}`[] }[], expectedContract?: `0x${string}`) {
  if (!expectedContract) return undefined;
  for (const log of logs) {
    if (log.address.toLowerCase() !== expectedContract.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: penguJarV3Abi, data: log.data, topics: [...log.topics] as [`0x${string}`, ...`0x${string}`[]] });
      if (decoded.eventName === "JarCreated") return decoded.args.jarId;
    } catch { /* unrelated log */ }
  }
  return undefined;
}

function splitLocalDateTime(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value);
  return { date: match?.[1] ?? "", hour: match?.[2] ?? "00", minute: match?.[3] ?? "00" };
}

function joinLocalDateTime(date: string, hour: string, minute: string) {
  return date ? `${date}T${hour}:${minute}` : "";
}

function timeOptions(count: number) {
  return Array.from({ length: count }, (_, value) => value.toString().padStart(2, "0"));
}

function reviewNow() { return Date.now(); }

function TransactionState({ icon, title, copy, hash, action }: { icon: string; title: string; copy: string; hash?: `0x${string}`; action?: React.ReactNode }) {
  const { t } = usePreferences();
  return <div className="transaction-state"><span>{icon}</span><h3>{title}</h3><p>{copy}</p>{hash && <a href={`${ARC_EXPLORER_URL}/tx/${hash}`} target="_blank" rel="noreferrer">{t("tx.arcscan")} ↗</a>}{action}</div>;
}

function transactionErrorMessage(error: unknown, t: ReturnType<typeof usePreferences>["t"]) {
  const message = error instanceof Error ? error.message : "";
  if (/rejected|denied|4001/i.test(message)) return t("tx.rejected");
  if (/revert|execution/i.test(message)) return t("validation.reverted");
  if (/chain|network/i.test(message)) return t("wallet.switch");
  return t("tx.rpc");
}

function validateProtectionWallets(guardianValue: string, recoveryValue: string, owner: `0x${string}` | undefined, invalidMessage: string, distinctMessage: string) {
  if (!owner || !isAddress(guardianValue) || !isAddress(recoveryValue)) throw new Error(invalidMessage);
  const guardian = getAddress(guardianValue);
  const recovery = getAddress(recoveryValue);
  const normalizedOwner = getAddress(owner);
  if (guardian === zeroAddress || recovery === zeroAddress || guardian === normalizedOwner || recovery === normalizedOwner || guardian === recovery) {
    throw new Error(distinctMessage);
  }
  return { guardian, recovery };
}
