"use client";
import { useEffect, useRef, useState } from "react";
import { createPublicClient, formatUnits, getAddress, http, parseUnits } from "viem";
import { arcTestnet, baseSepolia } from "viem/chains";
import { useConnection, useSwitchChain } from "wagmi";
import { erc20BalanceAbi } from "@/lib/abi/erc20";
import { getCircleAppKit } from "@/lib/circle/appKit";
import { createCircleBrowserAdapter, verifyProviderAccount, verifyProviderChain } from "@/lib/circle/browserAdapter";
import { BRIDGE_ESTIMATE_MAX_AGE_MS, bridgeDestination, bridgeEventStage, makeBridgeParams, normalizeBridgeEstimate, normalizeBridgeResult, normalizeRecipient, parseBridgeAmount, QA_BRIDGE_CHAINS, routeSupportedByAppKit, sanitizeBridgeError, supportsFastSource, type BridgeStage, type MakotoBridgeEstimate, type MakotoBridgeResult, type MakotoTransferSpeed } from "@/lib/circle/bridge";
import { unifiedChainById } from "@/lib/circle/chains";
import { bridgeIntent, managedRequest, prepareFlowReview } from "@/lib/transactionFlowReview";
import { revalidateTransactionReview, ReviewSubmissionGuard, type TransactionReviewSnapshot } from "@/lib/transactionOrchestrator";
import { isWalletCancellation, storeAgentResult } from "@/lib/agent/actions";
import { CctpBridgeFlow } from "./CctpBridgeFlow";
import { TransactionSafetyReview } from "./TransactionSafetyReview";
import "./UniversalBridgeFlow.module.css";

const clients = {
  [arcTestnet.id]: createPublicClient({ chain: arcTestnet, transport: http() }),
  [baseSepolia.id]: createPublicClient({
    chain: baseSepolia,
    transport: http(),
  }),
};
type Props = {
  locale: "en" | "vi";
  initialValues?: {
    amount?: string;
    sourceChain?: string;
    destinationChain?: string;
    recipient?: string;
    origin?: "agent";
  };
  onBusyChange(busy: boolean): void;
};

function compactBridgeFeeSummary(fees: MakotoBridgeEstimate["fees"], vi: boolean) {
  const primary = fees.find((fee) => fee.type !== "gas" && fee.amount) ?? fees.find((fee) => fee.amount);
  if (!primary?.amount) return vi ? "Không khả dụng" : "Unavailable";
  const [whole, fraction] = primary.amount.split(".");
  const compactAmount = fraction ? `${whole}.${fraction.slice(0, 6).replace(/0+$/, "") || "0"}` : whole;
  const hasGas = primary.type !== "gas" && fees.some((fee) => fee.type === "gas" && fee.amount);
  const hasOtherFees = fees.some((fee) => fee !== primary && fee.type !== "gas" && fee.amount);
  const suffix = hasGas ? (vi ? " + gas" : " + gas") : hasOtherFees ? (vi ? " + phí khác" : " + other fees") : "";
  return `≈ ${compactAmount} ${primary.token}${suffix}`;
}
export function UniversalBridgeFlow({ locale, initialValues, onBusyChange }: Props) {
  const vi = locale === "vi",
    connection = useConnection(),
    { switchChainAsync } = useSwitchChain();
  const [sourceId, setSourceId] = useState<number>(initialValues?.sourceChain === "Arc Testnet" || initialValues?.destinationChain === "Base Sepolia" ? arcTestnet.id : baseSepolia.id);
  const source = unifiedChainById(sourceId)!,
    destination = bridgeDestination(sourceId)!;
  const [amount, setAmount] = useState(initialValues?.amount ?? "0.10"),
    [custom, setCustom] = useState(Boolean(initialValues?.recipient)),
    [recipient, setRecipient] = useState(initialValues?.recipient ?? ""),
    [speed, setSpeed] = useState<MakotoTransferSpeed>("STANDARD"),
    [balance, setBalance] = useState<bigint>(),
    [estimate, setEstimate] = useState<MakotoBridgeEstimate>(),
    [reviewSnapshot, setReviewSnapshot] = useState<TransactionReviewSnapshot>(),
    [result, setResult] = useState<MakotoBridgeResult>(),
    [error, setError] = useState<string>(),
    [busy, setBusy] = useState<"idle" | "estimating" | "review" | "executing">("idle"),
    [stages, setStages] = useState<BridgeStage[]>([]),
    [advanced, setAdvanced] = useState(false);
  const lock = useRef(false),
    submissionGuard = useRef(new ReviewSubmissionGuard()),
    statusRef = useRef<HTMLDivElement>(null),
    handoffStarted = useRef(false);
  const invalidate = () => {
    setEstimate(undefined);
    setReviewSnapshot(undefined);
    setResult(undefined);
    setError(undefined);
    setBusy("idle");
  };
  useEffect(() => onBusyChange(busy === "executing"), [busy, onBusyChange]);
  function intentFor(current: MakotoBridgeEstimate) {
    return bridgeIntent({
      id: "universal-bridge",
      account: getAddress(current.raw.source.address),
      chainId: current.source.id,
      target: current.source.usdc,
      calldata: "0x",
      preparedAt: current.quotedAt,
      expiresAt: current.quotedAt + BRIDGE_ESTIMATE_MAX_AGE_MS,
      assetId: "usdc",
      amount: parseUnits(current.amount, 6),
      recipient: current.recipient,
      destinationChainId: current.destination.id,
      route: "circle-app-kit-cctp",
      expectedReceive: current.expectedReceive ? parseUnits(current.expectedReceive, 6) : undefined,
      circleManaged: true,
      metadata: {
        speed: current.speed,
        fees: current.fees.map((f) => `${f.type}:${f.amount ?? "unavailable"}:${f.token}`),
      },
    });
  }
  function reviewContext(current: MakotoBridgeEstimate) {
    return {
      connectedAccount: connection.address,
      connectedChainId: current.source.id,
      balances: { usdc: balance },
      simulation: "passed" as const,
      managedTarget: { label: "Circle App Kit", category: "circle" as const },
    };
  }
  // The Circle estimate object is the immutable source for this one-shot snapshot.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!estimate || reviewSnapshot) return;
    const timeout = window.setTimeout(() => {
      const intent = intentFor(estimate);
      setReviewSnapshot(prepareFlowReview(intent, reviewContext(estimate), managedRequest(intent)));
      statusRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [estimate, reviewSnapshot]);
  async function active() {
    if (!connection.address) throw new Error(vi ? "Kết nối ví để tiếp tục." : "Connect your wallet to continue.");
    return createCircleBrowserAdapter(connection.connector, connection.address);
  }
  async function switchSource() {
    const current = await active();
    if (estimate && estimate.raw.source.address.toLowerCase() !== connection.address!.toLowerCase()) throw new Error(vi ? "Tài khoản đã thay đổi. Vui lòng kiểm tra lại." : "Connected account changed. Review again.");
    if (!(await verifyProviderChain(current.provider, source.id))) await switchChainAsync({ chainId: source.id as 5042002 });
    if (!(await verifyProviderChain(current.provider, source.id))) throw new Error(vi ? `Ví vẫn chưa ở ${source.name}.` : `Wallet is still not on ${source.name}.`);
    await verifyProviderAccount(current.provider, connection.address!);
    if (lock.current && estimate) {
      if (!reviewSnapshot) throw new Error("Review again.");
      const intent = intentFor(estimate);
      const checked = revalidateTransactionReview(reviewSnapshot, {
        intent,
        context: reviewContext(estimate),
        request: managedRequest(intent),
        now: Date.now(),
      });
      if (!checked.valid) throw new Error("Review again.");
    }
    return current;
  }
  async function review() {
    const parsed = parseBridgeAmount(amount),
      to = custom ? normalizeRecipient(recipient) : connection.address;
    if (!parsed || !to) return setError(vi ? "Nhập số tiền và người nhận hợp lệ." : "Enter a valid amount and recipient.");
    setBusy("estimating");
    setError(undefined);
    try {
      const { adapter } = await switchSource();
      const kit = await getCircleAppKit();
      if (!routeSupportedByAppKit(kit.getSupportedChains("bridge"), source, destination)) throw new Error("Circle App Kit does not report this bridge route as supported.");
      const fresh = await clients[source.id as keyof typeof clients].readContract({
        address: source.usdc,
        abi: erc20BalanceAbi,
        functionName: "balanceOf",
        args: [connection.address!],
      });
      setBalance(fresh);
      if (parsed > fresh) throw new Error(vi ? "Số dư USDC nguồn không đủ." : "Source USDC balance is insufficient.");
      const raw = await kit.estimateBridge(makeBridgeParams(adapter, source, destination, amount, getAddress(to), speed));
      setEstimate(
        normalizeBridgeEstimate(raw, {
          quotedAt: Date.now(),
          amount,
          source,
          destination,
          recipient: getAddress(to),
          speed,
        })
      );
      setBusy("review");
    } catch (e) {
      setError(sanitizeBridgeError(e));
      setBusy("idle");
    }
  }
  // The one-shot handoff intentionally captures the validated initial route only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (initialValues?.origin !== "agent" || !connection.address || handoffStarted.current) return;
    handoffStarted.current = true;
    const timeout = window.setTimeout(() => void review(), 0);
    return () => window.clearTimeout(timeout);
  }, [connection.address, initialValues?.origin]);
  async function execute() {
    if (lock.current || !estimate || !reviewSnapshot) return;
    const intent = intentFor(estimate),
      checked = revalidateTransactionReview(reviewSnapshot, {
        intent,
        context: reviewContext(estimate),
        request: managedRequest(intent),
        now: Date.now(),
      });
    if (!checked.valid) {
      invalidate();
      setError(vi ? "Chi tiết hoặc ước tính đã thay đổi. Vui lòng kiểm tra lại." : "Estimate or transaction details changed. Review again.");
      return;
    }
    lock.current = true;
    setBusy("executing");
    setStages(["preparing"]);
    setError(undefined);
    try {
      const { adapter, provider } = await switchSource();
      await verifyProviderAccount(provider, connection.address!);
      const kit = await getCircleAppKit();
      const handler = (payload: unknown) => {
        const action = typeof payload === "object" && payload !== null && "method" in payload ? String((payload as { method: unknown }).method) : "";
        const stage = bridgeEventStage(action);
        if (stage) setStages((old) => (old.includes(stage) ? old : [...old, stage]));
      };
      kit.on("*", handler);
      try {
        const raw = await submissionGuard.current.run(reviewSnapshot.fingerprint, () => kit.bridge(makeBridgeParams(adapter, estimate.source, estimate.destination, estimate.amount, estimate.recipient, estimate.speed)));
        if (raw.state !== "success") throw new Error("Circle returned a non-success bridge result.");
        const confirmed = normalizeBridgeResult(raw, estimate);
        setResult(confirmed);
        if (initialValues?.origin === "agent" && connection.address)
          storeAgentResult(window.sessionStorage, {
            id: `bridge-${Date.now()}`,
            account: connection.address,
            action: "bridge",
            status: "confirmed",
            createdAt: Date.now(),
            amount: confirmed.amount,
            asset: "USDC",
            transactionHash: confirmed.destinationTxHash ?? confirmed.sourceTxHash,
          });
        setStages((old) => [...old.filter((x) => x !== "completed"), "completed"]);
      } finally {
        kit.off("*", handler);
      }
    } catch (e) {
      setStages((old) => [...old, "failed"]);
      if (initialValues?.origin === "agent" && connection.address)
        storeAgentResult(window.sessionStorage, {
          id: `bridge-${Date.now()}`,
          account: connection.address,
          action: "bridge",
          status: isWalletCancellation(e) ? "cancelled" : "failed",
          createdAt: Date.now(),
        });
      setError(sanitizeBridgeError(e));
    } finally {
      lock.current = false;
      setBusy("idle");
    }
  }
  const reverse = () => {
    setSourceId(destination.id);
    invalidate();
  };
  const timeline: [BridgeStage, string][] = [
    ["preparing", vi ? "Chuẩn bị" : "Preparing"],
    ["approval", vi ? "Phê duyệt" : "Approval"],
    ["burn", "Burn"],
    ["attestation", "Attestation"],
    ["mint", vi ? "Mint / chuyển tiếp" : "Mint / forwarding"],
    ["completed", vi ? "Hoàn tất" : "Completed"],
  ];
  if (estimate && reviewSnapshot)
    return (
      <TransactionSafetyReview
        compact
        technicalDetailIndexes={[0, 1, 2, 3, 4, 5, 6, 7]}
        compactDetails={[
          { label: "From", value: estimate.source.name },
          { label: "To", value: estimate.destination.name },
          { label: "Amount", value: `${estimate.amount} USDC` },
          { label: "Expected receive", value: estimate.expectedReceive ? `${estimate.expectedReceive} USDC` : "Unavailable" },
          { label: "Recipient", value: `${estimate.recipient.slice(0, 6)}...${estimate.recipient.slice(-4)}` },
          { label: vi ? "Phí" : "Fees", value: compactBridgeFeeSummary(estimate.fees, vi) },
        ]}
        title={vi ? "Kiểm tra Bridge" : "Review Bridge"}
        summary={vi ? "Kiểm tra ước tính Circle và toàn bộ chi tiết trước khi mở ví." : "Review the Circle estimate and all material details before opening your wallet."}
        details={[
          {
            label: vi ? "Mạng nguồn" : "From network",
            value: estimate.source.name,
          },
          {
            label: vi ? "Mạng đích" : "To network",
            value: estimate.destination.name,
          },
          {
            label: vi ? "Người nhận" : "Recipient",
            value: <span className="full-address">{estimate.recipient}</span>,
          },
          {
            label: vi ? "Số tiền" : "Amount",
            value: `${estimate.amount} USDC`,
          },
          { label: vi ? "Tốc độ" : "Transfer speed", value: estimate.speed },
          { label: vi ? "Tuyến" : "Route", value: "Circle App Kit · CCTP" },
          {
            label: vi ? "Ước tính nhận" : "Expected receive",
            value: estimate.expectedReceive ? `${estimate.expectedReceive} USDC` : vi ? "Không khả dụng" : "Unavailable",
          },
          {
            label: vi ? "Phí" : "Fees",
            value: estimate.fees.map((f) => `${f.label}: ${f.amount ?? "Unavailable"} ${f.amount ? f.token : ""}`).join(" · "),
          },
        ]}
        checks={[
          {
            code: "wallet",
            status: connection.isConnected ? "verified" : "blocking",
            label: connection.isConnected ? "Wallet connected" : "Wallet disconnected",
          },
          {
            code: "account",
            status: connection.address?.toLowerCase() === estimate.raw.source.address.toLowerCase() ? "verified" : "blocking",
            label: connection.address?.toLowerCase() === estimate.raw.source.address.toLowerCase() ? "Account matches review" : "Account changed",
          },
          {
            code: "source-network",
            status: "verified",
            label: `${estimate.source.name} · ${estimate.source.id}`,
          },
        ]}
        review={reviewSnapshot}
        walletNotice=""
        onBack={invalidate}
        onContinue={() => void execute()}
        continueDisabled={busy === "executing"}
      >
        {stages.length > 0 && (
          <ol className="bridge-timeline">
            {timeline.map(([id, label]) => (
              <li key={id} data-active={stages.includes(id)}>
                {label}
              </li>
            ))}
          </ol>
        )}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </TransactionSafetyReview>
    );
  if (advanced)
    return (
      <div>
        <button className="secondary-action" onClick={() => setAdvanced(false)}>
          ← Universal Bridge
        </button>
        <CctpBridgeFlow locale={locale} onBusyChange={onBusyChange} />
      </div>
    );
  return (
    <div className="universal-bridge">
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {result ? (
        <section className="bridge-complete">
          <h3>✓ {vi ? "Đã hoàn tất" : "Completed"}</h3>
          <p>
            {result.amount} USDC · {result.sourceChain.name} → {result.destinationChain.name}
          </p>
          <p className="full-address">{result.recipient}</p>
          {result.sourceExplorerUrl && (
            <a href={result.sourceExplorerUrl} target="_blank" rel="noreferrer">
              {vi ? "Giao dịch nguồn" : "Source transaction"} ↗
            </a>
          )}
          {result.destinationExplorerUrl ? (
            <a href={result.destinationExplorerUrl} target="_blank" rel="noreferrer">
              {vi ? "Giao dịch đích" : "Destination transaction"} ↗
            </a>
          ) : (
            <p>{vi ? "Đích đã được xác nhận." : "Destination confirmed."}</p>
          )}
          <button className="primary-action" onClick={invalidate}>
            {vi ? "Bridge tiếp" : "Bridge again"}
          </button>
        </section>
      ) : estimate ? (
        <section className="bridge-review">
          <h3>{vi ? "Kiểm tra Bridge" : "Review Bridge"}</h3>
          <dl>
            {[
              [vi ? "Mạng nguồn" : "From network", estimate.source.name],
              [vi ? "Mạng đích" : "To network", estimate.destination.name],
              [vi ? "Tài sản" : "Asset", "USDC · USD Coin"],
              [vi ? "Ví nguồn" : "Source wallet", connection.address],
              [vi ? "Người nhận" : "Recipient", estimate.recipient],
              [vi ? "Số tiền Bridge" : "Bridge amount", `${estimate.amount} USDC`],
              [vi ? "Tốc độ" : "Transfer speed", estimate.speed === "STANDARD" ? (vi ? "Tiêu chuẩn" : "Standard") : vi ? "Nhanh" : "Fast"],
              [vi ? "Nhà cung cấp" : "Provider", "Circle App Kit · CCTP"],
              [vi ? "Ước tính nhận" : "Estimated receive", estimate.expectedReceive ? `${estimate.expectedReceive} USDC` : vi ? "Xem phí chi tiết" : "See itemized fees"],
              [vi ? "Gas nguồn" : "Source gas", estimate.source.nativeGas],
              ["Forwarding Service", vi ? "Bật · trừ từ mint đích" : "Enabled · deducted from destination mint"],
            ].map(([a, b]) => (
              <div key={a}>
                <dt>{a}</dt>
                <dd className="full-address">{b}</dd>
              </div>
            ))}
          </dl>
          <div className="bridge-fees">
            {estimate.fees.map((fee, i) => (
              <p key={`${fee.type}-${i}`}>
                <span>{fee.label}</span>
                <strong>
                  {fee.amount ?? (vi ? "Không có" : "Unavailable")} {fee.amount ? fee.token : ""}
                </strong>
              </p>
            ))}
          </div>
          <div className="bridge-actions">
            <button className="secondary-action" disabled={busy === "executing"} onClick={invalidate}>
              {vi ? "Quay lại" : "Back"}
            </button>
            <button className="primary-action" disabled={busy === "executing"} onClick={() => void execute()}>
              {busy === "executing" ? (vi ? "Đang xử lý…" : "Processing…") : vi ? "Tiếp tục đến ví" : "Continue to wallet"}
            </button>
          </div>
          {stages.length > 0 && (
            <ol className="bridge-timeline">
              {timeline.map(([id, label]) => (
                <li key={id} data-active={stages.includes(id)}>
                  {label}
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void review();
          }}
        >
          <div className="bridge-networks">
            <label>
              {vi ? "Mạng nguồn" : "From network"}
              <select
                value={sourceId}
                onChange={(e) => {
                  setSourceId(Number(e.target.value));
                  invalidate();
                }}
              >
                {QA_BRIDGE_CHAINS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="bridge-reverse" onClick={reverse} aria-label={vi ? "Đảo chiều" : "Reverse direction"}>
              ⇅
            </button>
            <label>
              {vi ? "Mạng đích" : "To network"}
              <input value={destination.name} readOnly />
            </label>
          </div>
          <label>
            {vi ? "Tài sản" : "Asset"}
            <input value="USDC · USD Coin" readOnly />
          </label>
          <label>
            {vi ? "Số tiền" : "Amount"}
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                invalidate();
              }}
            />
            {balance !== undefined && (
              <small>
                {vi ? "Số dư nguồn" : "Source balance"}: {formatUnits(balance, 6)} USDC
              </small>
            )}
          </label>
          {!custom ? (
            <div className="bridge-recipient-summary">
              <span>
                <small>{vi ? "Người nhận" : "Recipient"}</small>
                <strong>{vi ? "Ví đang kết nối" : "Connected wallet"}</strong>
              </span>
              <button
                type="button"
                className="secondary-action"
                onClick={() => {
                  setCustom(true);
                  invalidate();
                }}
              >
                {vi ? "Thay đổi" : "Change"}
              </button>
            </div>
          ) : (
            <fieldset className="bridge-recipient-editor">
              <legend>{vi ? "Người nhận" : "Recipient"}</legend>
              <input
                aria-label={vi ? "Địa chỉ người nhận tùy chỉnh" : "Custom recipient address"}
                placeholder="0x…"
                value={recipient}
                onChange={(e) => {
                  setRecipient(e.target.value);
                  invalidate();
                }}
              />
              <button
                type="button"
                className="secondary-action"
                onClick={() => {
                  setCustom(false);
                  setRecipient("");
                  invalidate();
                }}
              >
                {vi ? "Dùng ví đang kết nối" : "Use connected wallet"}
              </button>
            </fieldset>
          )}
          <details className="bridge-options">
            <summary>{vi ? "Tùy chọn" : "Options"}</summary>
            <fieldset>
              <legend>{vi ? "Tốc độ chuyển" : "Transfer speed"}</legend>
              <label>
                <input
                  type="radio"
                  checked={speed === "STANDARD"}
                  onChange={() => {
                    setSpeed("STANDARD");
                    invalidate();
                  }}
                />{" "}
                {vi ? "Tiêu chuẩn" : "Standard"}
              </label>
              <label>
                <input
                  type="radio"
                  disabled={!supportsFastSource(source)}
                  checked={speed === "FAST"}
                  onChange={() => {
                    setSpeed("FAST");
                    invalidate();
                  }}
                />{" "}
                {vi ? "Nhanh" : "Fast"}
              </label>
              {!supportsFastSource(source) && <small>{vi ? "Fast không khả dụng cho mạng nguồn này." : "Fast is unavailable for this source network."}</small>}
            </fieldset>
            <button type="button" className="secondary-action" onClick={() => setAdvanced(true)}>
              {vi ? "CCTP Direct nâng cao" : "Advanced CCTP Direct"}
            </button>
          </details>
          <button className="primary-action" disabled={busy === "estimating"}>
            {busy === "estimating" ? (vi ? "Đang tải…" : "Loading…") : vi ? "Kiểm tra Bridge" : "Review Bridge"}
          </button>
        </form>
      )}
    </div>
  );
}
