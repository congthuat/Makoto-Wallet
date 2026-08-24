"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { encodeFunctionData, formatUnits, zeroHash, type Hex } from "viem";
import { arcTestnet } from "viem/chains";
import { useConnection, usePublicClient, useWriteContract } from "wagmi";
import { useVerifiedWalletChain } from "@/hooks/useVerifiedWalletChain";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { erc20BalanceAbi } from "@/lib/abi/erc20";
import { formatAssetAmount, getAssetById, parseAssetAmount } from "@/lib/assets";
import { ARC_EXPLORER_URL } from "@/lib/config";
import { classifyWalletFailure } from "@/lib/walletSafety";
import { confirmThenRefresh } from "@/lib/confirmedTransaction";
import { addressToBytes32, BASE_SEPOLIA_CCTP_DOMAIN, BASE_SEPOLIA_EXPLORER_URL, calculateCctpForwardingAmounts, CCTP_FORWARDING_HOOK_DATA, CCTP_STANDARD_FINALITY, CCTP_TOKEN_MINTER_V2, CCTP_TOKEN_MESSENGER_ABI, CCTP_TOKEN_MESSENGER_V2, type CctpForwardingFee } from "@/lib/cctp";
import { globalReviewChecks } from "@/lib/transactionReview";
import { createAssetActivity, recordWalletActivity } from "@/lib/walletActivity";
import { TransactionSafetyReview } from "./TransactionSafetyReview";
import { approvalIntent, bridgeIntent, prepareFlowReview } from "@/lib/transactionFlowReview";
import { revalidateTransactionReview, ReviewSubmissionGuard, type TransactionReviewSnapshot } from "@/lib/transactionOrchestrator";

const FEE_MAX_AGE_MS = 45_000;
type Props = { locale: "en" | "vi"; onBusyChange(busy: boolean): void };

export function CctpBridgeFlow({ locale, onBusyChange }: Props) {
  const vi = locale === "vi";
  const connection = useConnection();
  const chain = useVerifiedWalletChain();
  const client = usePublicClient({ chainId: arcTestnet.id });
  const writer = useWriteContract();
  const balances = useWalletBalances(connection.address, chain.isArc);
  const usdc = getAssetById("usdc")!;
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState<CctpForwardingFee>();
  const [reviewing, setReviewing] = useState(false);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  const [burnHash, setBurnHash] = useState<Hex>();
  const [forwardHash, setForwardHash] = useState<Hex>();
  const [checking, setChecking] = useState(false);
  const [reviewedAccount, setReviewedAccount] = useState<`0x${string}`>();
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [reviewSnapshot, setReviewSnapshot] = useState<TransactionReviewSnapshot>();
  const submissionGuard = useRef(new ReviewSubmissionGuard());
  useEffect(() => onBusyChange(Boolean(pending)), [onBusyChange, pending]);

  const parsed = parseAssetAmount(amount, usdc);
  const amounts = useMemo(() => parsed && fee ? calculateCctpForwardingAmounts(parsed, fee) : undefined, [parsed, fee]);

  function reset() { setAmount(""); setFee(undefined); setReviewSnapshot(undefined); setReviewing(false); setError(undefined); setBurnHash(undefined); setForwardHash(undefined); }

  function currentIntent(currentFee: CctpForwardingFee, current: NonNullable<typeof amounts>) {
    if (!connection.address) return undefined;
    const args = [current.totalAmount, BASE_SEPOLIA_CCTP_DOMAIN, addressToBytes32(connection.address), usdc.address, zeroHash, current.maxFee, CCTP_STANDARD_FINALITY, CCTP_FORWARDING_HOOK_DATA] as const;
    return bridgeIntent({ id: "cctp-direct", account: connection.address, target: CCTP_TOKEN_MESSENGER_V2, calldata: encodeFunctionData({ abi: CCTP_TOKEN_MESSENGER_ABI, functionName: "depositForBurnWithHook", args }), preparedAt: currentFee.quotedAt, expiresAt: currentFee.quotedAt + FEE_MAX_AGE_MS, assetId: "usdc", amount: current.totalAmount, recipient: connection.address, destinationChainId: 84532, route: "cctp-direct-forwarding", forwardingFee: current.forwardingFee.toString(), protocolFee: current.protocolFee.toString(), metadata: { totalBurn: current.totalAmount.toString() } });
  }

  async function review() {
    if (!connection.address || !parsed) return setError(vi ? "Nhập số USDC hợp lệ." : "Enter a valid USDC amount.");
    setPending(vi ? "Đang lấy phí CCTP hiện tại…" : "Loading current CCTP fees…"); setError(undefined); setFee(undefined);
    try {
      const response = await fetch("/api/cctp-fees", { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as CctpForwardingFee | { error?: string };
      if (!response.ok || !("forwardFeeMed" in payload)) throw new Error("error" in payload && payload.error ? payload.error : "CCTP fee unavailable.");
      const next = calculateCctpForwardingAmounts(parsed, payload);
      if (next.totalAmount > (balances.usdc.data ?? 0n)) throw new Error(vi ? "Số dư USDC không đủ cho số tiền bridge cộng phí forwarding." : "USDC balance is too low for the bridge amount plus forwarding fee.");
      if (!client) throw new Error("CCTP route unavailable.");
      const allowance = await client.readContract({ address: usdc.address, abi: erc20BalanceAbi, functionName: "allowance", args: [connection.address, CCTP_TOKEN_MESSENGER_V2] });
      const intent = currentIntent(payload, next); if (intent) setReviewSnapshot(prepareFlowReview(intent, { connectedAccount: connection.address, connectedChainId: arcTestnet.id, balances: { usdc: balances.usdc.data }, allowance, simulation: "passed", expectedTarget: CCTP_TOKEN_MESSENGER_V2 }));
      setApprovalRequired(allowance < next.totalAmount); setReviewedAccount(connection.address); setFee(payload); setReviewing(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : (vi ? "Không lấy được phí CCTP." : "Could not load CCTP fees.")); }
    finally { setPending(undefined); }
  }

  async function execute() {
    if (!connection.address || !client || !fee || !amounts || !reviewSnapshot || pending) return;
    if (!reviewedAccount || reviewedAccount.toLowerCase() !== connection.address.toLowerCase()) { setReviewing(false); return setError(vi ? "Chi tiết giao dịch đã thay đổi. Vui lòng kiểm tra lại." : "Transaction details changed. Please review again."); }
    if (Date.now() - fee.quotedAt > FEE_MAX_AGE_MS) { setFee(undefined); setReviewing(false); return setError(vi ? "Phí bridge đã cũ. Hãy kiểm tra lại." : "Bridge fee quote expired. Review again."); }
    let submitted = false; setError(undefined);
    try {
      if (!(await chain.verifyNow())) throw new Error("arc");
      const freshBalance = await client.readContract({ address: usdc.address, abi: erc20BalanceAbi, functionName: "balanceOf", args: [connection.address] });
      if (amounts.totalAmount > freshBalance) throw new Error("balance");
      const allowance = await client.readContract({ address: usdc.address, abi: erc20BalanceAbi, functionName: "allowance", args: [connection.address, CCTP_TOKEN_MESSENGER_V2] });
      if (allowance < amounts.totalAmount) {
        const approval = approvalIntent({ id: "cctp-approval", account: connection.address, target: usdc.address, token: usdc.address, spender: CCTP_TOKEN_MESSENGER_V2, amount: amounts.totalAmount, assetId: "usdc", calldata: "0x", preparedAt: fee.quotedAt, expiresAt: fee.quotedAt + FEE_MAX_AGE_MS });
        const approvalSnapshot = prepareFlowReview(approval, { connectedAccount: connection.address, connectedChainId: arcTestnet.id, balances: { usdc: freshBalance }, allowance, simulation: "passed", expectedTarget: usdc.address });
        const approvalChecked = revalidateTransactionReview(approvalSnapshot, { intent: approval, context: { connectedAccount: connection.address, connectedChainId: arcTestnet.id, balances: { usdc: freshBalance }, allowance, simulation: "passed", expectedTarget: usdc.address }, now: Date.now() });
        if (!approvalChecked.valid) throw new Error("Review again.");
        setPending(vi ? "Đang chờ approve USDC cho CCTP…" : "Waiting for USDC approval for CCTP…");
        await client.simulateContract({ address: usdc.address, abi: erc20BalanceAbi, functionName: "approve", args: [CCTP_TOKEN_MESSENGER_V2, amounts.totalAmount], account: connection.address });
        const approvalHash = await submissionGuard.current.run(approvalSnapshot.fingerprint, () => writer.writeContractAsync({ address: usdc.address, abi: erc20BalanceAbi, functionName: "approve", args: [CCTP_TOKEN_MESSENGER_V2, amounts.totalAmount], account: connection.address, chainId: arcTestnet.id }));
        const receipt = await client.waitForTransactionReceipt({ hash: approvalHash });
        if (receipt.status !== "success") throw new Error("approve");
        setReviewSnapshot(undefined); setFee(undefined); setReviewing(false); setError(vi ? "Approve đã xác nhận. Hãy kiểm tra phí mới trước khi bridge." : "Approval confirmed. Review fresh fees before bridging."); return;
      }
      if (Date.now() - fee.quotedAt > FEE_MAX_AGE_MS) { setFee(undefined); setReviewing(false); return setError(vi ? "Approve xong nhưng phí forwarding đã thay đổi. Chưa burn USDC; hãy kiểm tra phí lại." : "Approval succeeded, but the forwarding fee quote expired. No USDC was burned; review fees again."); }
      if (!(await chain.verifyNow())) throw new Error("arc");
      const submissionBalance = await client.readContract({ address: usdc.address, abi: erc20BalanceAbi, functionName: "balanceOf", args: [connection.address] });
      if (amounts.totalAmount > submissionBalance) throw new Error("balance");
      const args = [amounts.totalAmount, BASE_SEPOLIA_CCTP_DOMAIN, addressToBytes32(connection.address), usdc.address, zeroHash, amounts.maxFee, CCTP_STANDARD_FINALITY, CCTP_FORWARDING_HOOK_DATA] as const;
      const intent = currentIntent(fee, amounts)!;
      const checked = revalidateTransactionReview(reviewSnapshot, { intent, context: { connectedAccount: connection.address, connectedChainId: arcTestnet.id, balances: { usdc: submissionBalance }, allowance, simulation: "passed", expectedTarget: CCTP_TOKEN_MESSENGER_V2 }, now: Date.now() });
      if (!checked.valid) { setReviewing(false); setFee(undefined); setReviewSnapshot(undefined); return setError(vi ? "Phí hoặc chi tiết đã thay đổi. Hãy kiểm tra lại." : "Fees or transaction details changed. Review again."); }
      setPending(vi ? "Đang chờ bạn xác nhận CCTP bridge trong ví…" : "Waiting for CCTP bridge confirmation in your wallet…");
      await client.simulateContract({ address: CCTP_TOKEN_MESSENGER_V2, abi: CCTP_TOKEN_MESSENGER_ABI, functionName: "depositForBurnWithHook", args, account: connection.address });
      const hash = await submissionGuard.current.run(reviewSnapshot.fingerprint, () => writer.writeContractAsync({ address: CCTP_TOKEN_MESSENGER_V2, abi: CCTP_TOKEN_MESSENGER_ABI, functionName: "depositForBurnWithHook", args, account: connection.address, chainId: arcTestnet.id }));
      submitted = true; setPending(vi ? "Đã burn trên Arc. Đang chờ xác nhận…" : "Burn submitted on Arc. Waiting for confirmation…");
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("revert");
      const block = await client.getBlock({ blockNumber: receipt.blockNumber });
      await confirmThenRefresh({ receipt: Promise.resolve(receipt), onConfirmed: () => { const transferLog = receipt.logs.find((log) => log.address.toLowerCase() === usdc.address.toLowerCase()); recordWalletActivity(connection.address!, arcTestnet.id, createAssetActivity(usdc, { hash: receipt.transactionHash, logIndex: transferLog?.logIndex ?? -1, direction: "send", kind: "bridge", amount: amounts.totalAmount, counterparty: CCTP_TOKEN_MINTER_V2, confirmedAt: Number(block.timestamp) * 1000, blockNumber: receipt.blockNumber })); setBurnHash(receipt.transactionHash); setReviewing(false); }, refresh: async () => { await balances.usdc.refetch(); } });
    } catch (caught) {
      if (caught instanceof Error && caught.message === "arc") return setError(vi ? "Cần kết nối Arc Testnet." : "Arc Testnet is required.");
      if (caught instanceof Error && caught.message === "balance") return setError(vi ? "Số dư vừa thay đổi và không còn đủ." : "Your USDC balance changed and is no longer sufficient.");
      const kind = classifyWalletFailure(caught, submitted);
      const messages = { rejected: vi ? "Bạn đã từ chối yêu cầu trong ví." : "You rejected the wallet request.", "wrong-network": vi ? "Ví không còn ở Arc Testnet." : "Your wallet is no longer on Arc Testnet.", "insufficient-gas": vi ? "Không đủ USDC để trả gas trên Arc." : "Not enough USDC to pay Arc gas.", reverted: vi ? "Giao dịch CCTP bị revert." : "The CCTP transaction reverted.", "confirmation-unknown": vi ? "Burn đã gửi nhưng trạng thái chưa rõ. Kiểm tra ArcScan trước khi thử lại." : "The burn was submitted but confirmation is unclear. Check ArcScan before retrying.", rpc: vi ? "Ví hoặc RPC đang gặp lỗi." : "The wallet or RPC failed." } as const;
      setError(messages[kind]);
    } finally { setPending(undefined); }
  }

  async function checkDestination() {
    if (!burnHash) return; setChecking(true); setError(undefined);
    try {
      const response = await fetch(`/api/cctp-status?txHash=${burnHash}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as { forwardTxHash?: string };
      if (payload.forwardTxHash && /^0x[0-9a-fA-F]{64}$/.test(payload.forwardTxHash)) setForwardHash(payload.forwardTxHash as Hex);
      else setError(vi ? "Circle vẫn đang xử lý mint. Bạn có thể kiểm tra lại sau." : "Circle is still forwarding the mint. Check again shortly.");
    } catch { setError(vi ? "Chưa lấy được trạng thái Base Sepolia." : "Could not load Base Sepolia status yet."); }
    finally { setChecking(false); }
  }

  if (burnHash) return <div className="transaction-state"><span>✓</span><h3>{vi ? "Bridge đã được gửi" : "Bridge submitted"}</h3><p>{vi ? "Burn trên Arc đã xác nhận. Circle Forwarding Service sẽ hoàn tất mint USDC sang cùng địa chỉ ví trên Base Sepolia." : "The Arc burn is confirmed. Circle Forwarding Service will mint USDC to the same wallet address on Base Sepolia."}</p><div className="transaction-links"><a href={`${ARC_EXPLORER_URL}/tx/${burnHash}`} target="_blank" rel="noreferrer">ArcScan ↗</a>{forwardHash && <a href={`${BASE_SEPOLIA_EXPLORER_URL}/tx/${forwardHash}`} target="_blank" rel="noreferrer">BaseScan ↗</a>}</div>{error && <p className="field-error" role="status">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-action" onClick={() => void checkDestination()} disabled={checking || Boolean(forwardHash)}>{forwardHash ? (vi ? "Đã thấy giao dịch đích" : "Destination confirmed") : checking ? (vi ? "Đang kiểm tra…" : "Checking…") : (vi ? "Kiểm tra Base Sepolia" : "Check Base Sepolia")}</button><button type="button" className="primary-action" onClick={reset}>{vi ? "Bridge tiếp" : "Bridge again"}</button></div></div>;

  if (reviewing && fee && amounts && parsed) return <TransactionSafetyReview title={vi ? "Kiểm tra Bridge" : "Review Bridge"} summary={vi ? "Bridge USDC từ Arc Testnet đến cùng địa chỉ ví trên Base Sepolia." : "Bridge USDC from Arc Testnet to the same wallet address on Base Sepolia."} details={[{ label: vi ? "Mạng nguồn" : "Source network", value: "Arc Testnet · 5042002" }, { label: vi ? "Mạng đích" : "Destination network", value: "Base Sepolia" }, { label: vi ? "Tuyến / nhà cung cấp" : "Route / provider", value: "Circle CCTP V2 Forwarding Service" }, { label: vi ? "Ví nguồn" : "Source wallet", value: <span className="full-address">{connection.address}</span> }, { label: vi ? "Đích: cùng địa chỉ ví" : "Destination: same wallet address", value: <span className="full-address">{connection.address}</span> }, { label: vi ? "Nhận" : "Amount", value: `${formatUnits(parsed, 6)} USDC` }, { label: vi ? "Phí forwarding" : "Forwarding fee", value: `${formatUnits(amounts.forwardingFee, 6)} USDC` }, { label: vi ? "Phí CCTP" : "CCTP fee", value: `${formatUnits(amounts.protocolFee, 6)} USDC` }, { label: vi ? "Tổng burn" : "Total burn", value: `${formatUnits(amounts.totalAmount, 6)} USDC` }]} checks={[...globalReviewChecks({ connected: connection.isConnected, account: connection.address, reviewedAccount, isArc: chain.isArc, amount: amounts.totalAmount, balance: balances.usdc.data }), { code: "route", status: "verified", label: "Arc Testnet → Base Sepolia · Circle CCTP V2" }, { code: "approval", status: "info", label: approvalRequired ? (vi ? "Có thể cần hai xác nhận ví: approve đúng số lượng, sau đó bridge" : "Two wallet confirmations may be required: exact approval, then bridge") : (vi ? "Allowance hiện tại đủ" : "Current allowance is sufficient") }]} walletNotice={vi ? "Makoto xác nhận giao dịch bridge ở phía Arc. Mint/hoàn tất ở mạng đích là bước riêng và chỉ hoàn tất khi có dữ liệu đích xác nhận." : "Makoto confirms the Arc-side bridge transaction. Destination mint/finalization is separate and is not complete until destination data confirms it."} onBack={() => { setReviewing(false); setFee(undefined); setError(undefined); }} onContinue={() => void execute()} continueDisabled={Boolean(pending)}>{pending && <p className="transaction-progress" role="status">{pending}</p>}{error && <p className="field-error" role="alert">{error}</p>}</TransactionSafetyReview>;

  const balance = balances.usdc.data ?? 0n;
  return <form className="create-form wallet-flow" onSubmit={(event) => { event.preventDefault(); void review(); }}><label>{vi ? "Số USDC muốn nhận trên Base Sepolia" : "USDC to receive on Base Sepolia"}<div className="wallet-field-with-action amount"><input inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setFee(undefined); setError(undefined); }} placeholder="0.00" /><span>USDC</span><button type="button" onClick={() => setAmount(formatAssetAmount(balance, usdc))}>MAX</button></div><small>{vi ? "Khả dụng trên Arc" : "Available on Arc"}: {formatAssetAmount(balance, usdc)} USDC</small></label><p className="wallet-notice">{vi ? "Bridge testnet thật: Arc Testnet → Base Sepolia bằng Circle CCTP V2. Phí forwarding được tải lại trước khi bạn ký." : "Real testnet bridge: Arc Testnet → Base Sepolia with Circle CCTP V2. Forwarding fees are refreshed before you sign."}</p>{pending && <p className="transaction-progress" role="status">{pending}</p>}{error && <p className="field-error" role="alert">{error}</p>}{!chain.isArc && <p className="field-error">{vi ? "Cần kết nối Arc Testnet." : "Arc Testnet is required."}</p>}<div className="modal-actions"><button type="submit" className="primary-action" disabled={Boolean(pending) || !chain.isArc}>{vi ? "Kiểm tra phí" : "Review fees"}</button></div></form>;
}
