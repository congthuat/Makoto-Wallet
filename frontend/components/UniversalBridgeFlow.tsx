"use client";
import { useEffect, useRef, useState } from "react";
import { formatUnits, getAddress, parseUnits } from "viem";
import { arcTestnet, baseSepolia } from "viem/chains";
import { useConnection, usePublicClient, useSwitchChain } from "wagmi";
import { erc20BalanceAbi } from "@/lib/abi/erc20";
import { getCircleAppKit } from "@/lib/circle/appKit";
import { createCircleBrowserAdapter, runSingleFlight, verifyProviderAccount, verifyProviderReadyForEstimate } from "@/lib/circle/browserAdapter";
import { BRIDGE_ESTIMATE_MAX_AGE_MS, bridgeDestination, bridgeEventStage, makeBridgeParams, normalizeBridgeEstimate, normalizeBridgeResult, normalizeRecipient, parseBridgeAmount, QA_BRIDGE_CHAINS, routeSupportedByAppKit, sanitizeBridgeError, supportsFastSource, type BridgeStage, type MakotoBridgeEstimate, type MakotoBridgeResult, type MakotoTransferSpeed } from "@/lib/circle/bridge";
import { unifiedChainById } from "@/lib/circle/chains";
import { bridgeIntent, managedRequest, prepareFlowReview } from "@/lib/transactionFlowReview";
import { revalidateTransactionReview, ReviewSubmissionGuard, type TransactionReviewSnapshot } from "@/lib/transactionOrchestrator";
import { bridgeContinueAllowed, bridgeReviewIsActionable } from "@/lib/bridgeTerminalState";
import { isWalletCancellation, storeAgentResult } from "@/lib/agent/actions";
import { CctpBridgeFlow } from "./CctpBridgeFlow";
import { TransactionSafetyReview } from "./TransactionSafetyReview";
import "./UniversalBridgeFlow.module.css";

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

export function UniversalBridgeFlow({ locale, initialValues, onBusyChange }: Props) {
  const vi = locale === "vi",
    connection = useConnection(),
    { switchChainAsync } = useSwitchChain();
  const [sourceId, setSourceId] = useState<number>(initialValues?.sourceChain === "Arc Testnet" || initialValues?.destinationChain === "Base Sepolia" ? arcTestnet.id : baseSepolia.id);
  const client = usePublicClient({ chainId: sourceId });
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
    [busy, setBusy] = useState<"idle" | "switching" | "estimating" | "review" | "executing">("idle"),
    [stages, setStages] = useState<BridgeStage[]>([]),
    [advanced, setAdvanced] = useState(false);
  const lock = useRef(false),
    reviewInFlight = useRef(false),
    submissionGuard = useRef(new ReviewSubmissionGuard()),
    statusRef = useRef<HTMLDivElement>(null),
    handoffStarted = useRef(false);
  const invalidate = () => {
    if (busy === "executing") return;
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
      simulation: "not-performed" as const,
      simulationPolicy: { requirement: "externally-managed", provider: "circle-app-kit" } as const,
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
  async function switchSource(onSwitching: () => void = () => undefined, onReady: () => void = () => undefined) {
    const current = await active();
    if (estimate && estimate.raw.source.address.toLowerCase() !== connection.address!.toLowerCase()) throw new Error(vi ? "Tài khoản đã thay đổi. Vui lòng kiểm tra lại." : "Connected account changed. Review again.");
    await verifyProviderReadyForEstimate({
      provider: current.provider,
      expectedChainId: source.id,
      expectedAccount: connection.address!,
      switchChain: () => switchChainAsync({ chainId: source.id as 5042002 }),
      onSwitching,
      onReady,
      wrongNetworkError: vi ? `Ví vẫn chưa ở ${source.name}.` : `Wallet is still not on ${source.name}.`,
    });
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
    await runSingleFlight(reviewInFlight, async () => {
      const parsed = parseBridgeAmount(amount),
        to = custom ? normalizeRecipient(recipient) : connection.address;
      if (!parsed || !to) return setError(vi ? "Nhập số tiền và người nhận hợp lệ." : "Enter a valid amount and recipient.");
      setError(undefined);
      try {
        const { adapter } = await switchSource(() => setBusy("switching"), () => setBusy("estimating"));
        const kit = await getCircleAppKit();
        if (!routeSupportedByAppKit(kit.getSupportedChains("bridge"), source, destination)) throw new Error("Circle App Kit does not report this bridge route as supported.");
        if (!client) throw new Error(vi ? "Không thể đọc số dư mạng nguồn. Vui lòng thử lại." : "Source network balance read unavailable. Please try again.");
        const fresh = await client.readContract({
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
    });
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
    if (!bridgeContinueAllowed(result, lock.current, estimate, reviewSnapshot)) return;
    if (!estimate || !reviewSnapshot) return;
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
    ["burn", vi ? "Gửi USDC từ mạng nguồn" : "Send USDC from source"],
    ["attestation", vi ? "Chờ chứng thực Circle" : "Wait for Circle attestation"],
    ["mint", vi ? "Nhận / chuyển tiếp ở mạng đích" : "Receive / forward at destination"],
    ["completed", vi ? "Hoàn tất" : "Completed"],
  ];
  if (bridgeReviewIsActionable(result, estimate, reviewSnapshot) && estimate && reviewSnapshot)
    return (
      <TransactionSafetyReview
        compact
        technicalDetailIndexes={[]}
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
          { label: vi ? "Tốc độ" : "Transfer speed", value: estimate.speed === "STANDARD" ? (vi ? "Tiêu chuẩn" : "Standard") : vi ? "Nhanh" : "Fast" },
          { label: vi ? "Tuyến" : "Route", value: "Circle App Kit · CCTP" },
          { label: vi ? "Tài sản đích" : "Destination asset", value: "USDC" },
          {
            label: vi ? "Ước tính nhận" : "Expected receive",
            value: estimate.expectedReceive ? `${estimate.expectedReceive} USDC` : vi ? "Không khả dụng" : "Unavailable",
          },
        ]}
        costDetails={estimate.fees.map((fee) => ({
          label: vi ? (fee.type === "forwarding" ? "Phí chuyển tiếp" : fee.type === "protocol" ? "Phí giao thức CCTP" : `Phí mạng · ${fee.label}`) : fee.label,
          value: fee.amount === undefined ? (vi ? "Không khả dụng" : "Unavailable") : `${fee.amount} ${fee.token}`,
        }))}
        checks={[
          {
            code: "wallet",
            status: connection.isConnected ? "verified" : "blocking",
            label: connection.isConnected ? (vi ? "Ví đã kết nối" : "Wallet connected") : (vi ? "Ví chưa kết nối" : "Wallet disconnected"),
          },
          {
            code: "account",
            status: connection.address?.toLowerCase() === estimate.raw.source.address.toLowerCase() ? "verified" : "blocking",
            label: connection.address?.toLowerCase() === estimate.raw.source.address.toLowerCase() ? (vi ? "Tài khoản khớp với bản kiểm tra" : "Account matches review") : (vi ? "Tài khoản đã thay đổi" : "Account changed"),
          },
          {
            code: "source-network",
            status: "verified",
            label: `${estimate.source.name} · ${estimate.source.id}`,
          },
        ]}
        review={reviewSnapshot}
        walletNotice=""
        backDisabled={busy === "executing"}
        onBack={invalidate}
        onContinue={() => void execute()}
        continueDisabled={busy === "executing"}
      >
        <p className="exchange-context">{vi ? "Circle App Kit quản lý giao dịch cuối cùng. Ước tính nhận không phải số thực nhận." : "Circle App Kit manages the final transaction. Estimated receive is not actual received."}</p>
        {busy === "executing" && <p className="transaction-progress" role="status">{vi ? "Đang xử lý Bridge qua Circle. Theo dõi yêu cầu trong ví và các bước bên dưới." : "Bridge execution is in progress through Circle. Follow wallet requests and the stages below."}</p>}
        {stages.length > 0 && (
          <ol className="bridge-timeline" aria-label={vi ? "Các bước Bridge đã ghi nhận" : "Observed bridge stages"}>
            {timeline.map(([id, label]) => (
              <li key={id} data-active={stages.includes(id)}>
                {label}{stages.includes(id) && <span className="exchange-stage-note"> · {vi ? "Đã ghi nhận" : "Observed"}</span>}
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
        <section className="bridge-complete" data-status="completed">
          <h3><span aria-hidden="true">✓ </span>{vi ? "Đã hoàn tất" : "Completed"}</h3>
          <dl className="exchange-result-rows">
            <div><dt>{vi ? "Số tiền Bridge" : "Bridge amount"}</dt><dd>{result.amount} USDC</dd></div>
            <div><dt>{vi ? "Mạng nguồn" : "From network"}</dt><dd>{result.sourceChain.name}</dd></div>
            <div><dt>{vi ? "Mạng đích" : "To network"}</dt><dd>{result.destinationChain.name}</dd></div>
            <div><dt>{vi ? "Người nhận" : "Recipient"}</dt><dd className="full-address">{result.recipient}</dd></div>
          </dl>
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
            <ol className="bridge-timeline" aria-label={vi ? "Các bước Bridge đã ghi nhận" : "Observed bridge stages"}>
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
          </div>
          <label>
            {vi ? "Tài sản nguồn" : "Source asset"}
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
          <div className="bridge-destination">
            <button type="button" className="bridge-reverse" onClick={reverse} aria-label={vi ? "Đảo chiều" : "Reverse direction"}>
              ⇅
            </button>
            <label>
              {vi ? "Mạng đích" : "To network"}
              <input value={destination.name} readOnly />
            </label>
            <p className="exchange-context">{vi ? "Tài sản đích" : "Destination asset"}: USDC · {destination.name}</p>
          </div>
          <p className="exchange-context">{vi ? "Circle App Kit · CCTP. Báo giá và phí sẽ được hiển thị khi kiểm tra. Thời gian hoàn tất tùy thuộc vào mạng và chứng thực Circle." : "Circle App Kit · CCTP. A quote and costs appear in Review. Completion time depends on the networks and Circle attestation."}</p>
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
          <button className="primary-action" disabled={busy === "switching" || busy === "estimating"}>
            {busy === "switching" ? (vi ? "Đang chuyển mạng…" : "Switching network…") : busy === "estimating" ? (vi ? "Đang tải…" : "Loading…") : vi ? "Kiểm tra Bridge" : "Review Bridge"}
          </button>
        </form>
      )}
    </div>
  );
}
