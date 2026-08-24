"use client";

import { useEffect, useRef, useState } from "react";
import { encodeFunctionData, type Hex } from "viem";
import { arcTestnet } from "viem/chains";
import { useConnection, usePublicClient, useWriteContract } from "wagmi";
import { useVerifiedWalletChain } from "@/hooks/useVerifiedWalletChain";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { erc20BalanceAbi } from "@/lib/abi/erc20";
import { arcFeeToUsdcAtomic, calculateArcFee, formatArcFeeEstimate, swapCostWithArcFee } from "@/lib/arcFees";
import { formatAssetAmount, getAssetById, parseAssetAmount, SUPPORTED_ASSETS, type SupportedAssetId } from "@/lib/assets";
import { ARC_EXPLORER_URL } from "@/lib/config";
import { confirmThenRefresh } from "@/lib/confirmedTransaction";
import { buildXyloSwapRequest, createXyloQuote, exactApprovalRequired, isSwapQuoteFresh, minimumSwapOutput, oppositeAssetId, swapAmountForPercent, SWAP_QUOTE_MAX_AGE_MS, SWAP_SLIPPAGE_OPTIONS, XYLO_ROUTER, xyloRouterAbi, type SwapQuickPercent, type SwapQuote } from "@/lib/swap";
import { CIRCLE_BROWSER_SWAP_STATUS, selectRouteForMode, swapRouteLabel, type SwapMode } from "@/lib/swapRouter";
import { planSwapReview, safeMaxCanUseSwapEstimate } from "@/lib/swapApprovalFlow";
import { calculateSafeUsdcSwapMax, SafeSwapMaxError, type SafeSwapMaxResult } from "@/lib/safeSwapMax";
import { createSwapFeeEnvelope, type SwapFeeEnvelope } from "@/lib/swapFeeEnvelope";
import { globalReviewChecks } from "@/lib/transactionReview";
import { classifyWalletFailure } from "@/lib/walletSafety";
import { createAssetActivity, recordWalletActivity } from "@/lib/walletActivity";
import { TransactionSafetyReview } from "./TransactionSafetyReview";
import { approvalIntent, prepareFlowReview, swapIntent } from "@/lib/transactionFlowReview";
import { revalidateTransactionReview, ReviewSubmissionGuard, type TransactionReviewSnapshot } from "@/lib/transactionOrchestrator";

type Props = { locale: "en" | "vi"; onBusyChange(busy: boolean): void; onConfirmed?(): void };
type MaxApprovalReview = { account: `0x${string}`; balance: bigint; allowance: bigint; approvalFee: bigint };

function safeMaxFailure(locale: "en" | "vi", caught: unknown) {
  const vi = locale === "vi";
  if (caught instanceof SafeSwapMaxError && (caught.code === "zero-balance" || caught.code === "too-small")) return vi ? "Số dư không đủ để swap sau khi chừa phí Arc." : "Balance is insufficient to swap after reserving Arc gas.";
  if (caught instanceof SafeSwapMaxError && caught.code === "no-estimate") return vi ? "Không thể lấy ước tính gas cho SAFE MAX." : "SAFE MAX gas estimate is unavailable.";
  if (caught instanceof SafeSwapMaxError && caught.code === "no-convergence") return vi ? "SAFE MAX chưa hội tụ an toàn. Hãy thử lại." : "SAFE MAX could not converge safely. Try again.";
  return vi ? "RPC Arc tạm thời không phản hồi khi tính SAFE MAX." : "Arc RPC failed while calculating SAFE MAX.";
}

export function RealSwapFlow({ locale, onBusyChange, onConfirmed }: Props) {
  const vi = locale === "vi", connection = useConnection(), chain = useVerifiedWalletChain();
  const client = usePublicClient({ chainId: arcTestnet.id }), writer = useWriteContract(), balances = useWalletBalances(connection.address, chain.isArc);
  const [fromId, setFromId] = useState<SupportedAssetId>("usdc"), [mode, setMode] = useState<SwapMode>("smart"), [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState<(typeof SWAP_SLIPPAGE_OPTIONS)[number]>(0.005), [quote, setQuote] = useState<SwapQuote>(), [approvalGasFee, setApprovalGasFee] = useState<bigint>(), [swapGasFee, setSwapGasFee] = useState<bigint>();
  const [swapEnvelope, setSwapEnvelope] = useState<SwapFeeEnvelope>();
  const [reviewStage, setReviewStage] = useState<"approval" | "swap">(), [gasUnavailable, setGasUnavailable] = useState(false), [pending, setPending] = useState<string>(), [error, setError] = useState<string>(), [quickFeedback, setQuickFeedback] = useState<string>();
  const [reviewedAccount, setReviewedAccount] = useState<`0x${string}`>(), [success, setSuccess] = useState<{ hash: Hex; quote: SwapQuote; received: bigint }>();
  const [safeMax, setSafeMax] = useState<(SafeSwapMaxResult & { balance: bigint; account: `0x${string}`; chainId: number })>();
  const [maxApproval, setMaxApproval] = useState<MaxApprovalReview>();
  const [approvalReview, setApprovalReview] = useState<TransactionReviewSnapshot>(), [swapReview, setSwapReview] = useState<TransactionReviewSnapshot>();
  const submissionGuard = useRef(new ReviewSubmissionGuard());
  useEffect(() => onBusyChange(Boolean(pending)), [onBusyChange, pending]);
  const from = getAssetById(fromId)!, to = getAssetById(oppositeAssetId(fromId))!, balance = balances.assets[fromId].data ?? 0n, usdcBalance = balances.assets.usdc.data ?? 0n, parsed = parseAssetAmount(amount, from);
  const route = quote ? selectRouteForMode(mode, [{ provider: "xylonet", output: quote.amountOut, fee: swapGasFee ?? approvalGasFee ?? 0n, quotedAt: quote.quotedAt, expiresAt: quote.quotedAt + SWAP_QUOTE_MAX_AGE_MS, available: true }], quote.quotedAt) : undefined;
  const gasCost = quote && swapGasFee !== undefined ? swapCostWithArcFee(quote.amountIn, from.id, usdcBalance, swapEnvelope?.rawMaxFee18 ?? swapGasFee) : undefined;
  const approvalGasCovered = approvalGasFee !== undefined && swapCostWithArcFee(0n, "eurc", usdcBalance, approvalGasFee).sufficientGasBalance;
  const maxApprovalGasCovered = maxApproval !== undefined && swapCostWithArcFee(0n, "eurc", usdcBalance, maxApproval.approvalFee).sufficientGasBalance;

  useEffect(() => {
    if (!safeMax || safeMax.balance === balance && safeMax.account.toLowerCase() === connection.address?.toLowerCase() && safeMax.chainId === arcTestnet.id && chain.isArc) return;
    const timeout = window.setTimeout(() => { setSafeMax(undefined); setAmount((current) => current === formatAssetAmount(safeMax.amount, from) ? "" : current); }, 0);
    return () => window.clearTimeout(timeout);
  }, [balance, chain.isArc, connection.address, from, safeMax]);
  useEffect(() => {
    if (!maxApproval || from.id === "usdc" && chain.isArc && maxApproval.balance === balance && maxApproval.account.toLowerCase() === connection.address?.toLowerCase()) return;
    const timeout = window.setTimeout(() => setMaxApproval(undefined), 0);
    return () => window.clearTimeout(timeout);
  }, [balance, chain.isArc, connection.address, from.id, maxApproval]);
  function invalidate() { setQuote(undefined); setReviewStage(undefined); setApprovalReview(undefined); setSwapReview(undefined); setError(undefined); setQuickFeedback(undefined); setApprovalGasFee(undefined); setSwapGasFee(undefined); setSwapEnvelope(undefined); setGasUnavailable(false); setSafeMax(undefined); setMaxApproval(undefined); }

  function approvalIntentFor(inputAmount: bigint, preparedAt: number, fee?: bigint) { if (!connection.address) return undefined; return approvalIntent({ id: "swap-approval", account: connection.address, target: from.address, token: from.address, spender: XYLO_ROUTER, amount: inputAmount, assetId: from.id, calldata: "0x", preparedAt, expiresAt: preparedAt + SWAP_QUOTE_MAX_AGE_MS, gas: fee === undefined ? undefined : { gasLimit: 0n, maxFeeRaw18: fee, maxFeeUsdc6: arcFeeToUsdcAtomic(fee) } }); }
  function swapIntentFor(current: SwapQuote, envelope: SwapFeeEnvelope) { if (!connection.address) return undefined; const request = buildXyloSwapRequest(current, current.amountOut, slippage, connection.address); return swapIntent({ id: "smart-swap", account: connection.address, target: XYLO_ROUTER, calldata: encodeFunctionData({ abi: request.abi, functionName: request.functionName, args: request.args }), preparedAt: current.quotedAt, expiresAt: current.quotedAt + SWAP_QUOTE_MAX_AGE_MS, inputAsset: from.id, outputAsset: to.id, amount: current.amountIn, quoteOutput: current.amountOut, minimumReceive: minimumSwapOutput(current.amountOut, slippage), slippageBps: Math.round(slippage * 10_000), route: "xylonet", gas: { gasLimit: envelope.gasLimit, maxFeePerGas: envelope.maxFeePerGas, maxPriorityFeePerGas: envelope.maxPriorityFeePerGas, maxFeeRaw18: envelope.rawMaxFee18, maxFeeUsdc6: envelope.feeUsdc6 } }); }

  function changeAmount(value: string) { setAmount(value); invalidate(); }
  function reset() { setAmount(""); invalidate(); setSuccess(undefined); }
  async function gasPrice() {
    if (!client) return undefined;
    const fees = await client.estimateFeesPerGas();
    return fees.maxFeePerGas ?? await client.getGasPrice();
  }
  async function estimateApprovalFee(inputAmount: bigint) {
    if (!client || !connection.address) return undefined;
    const gas = await client.estimateContractGas({ address: from.address, abi: erc20BalanceAbi, functionName: "approve", args: [XYLO_ROUTER, inputAmount], account: connection.address });
    const price = await gasPrice();
    return price === undefined ? undefined : calculateArcFee(gas, price).rawFee;
  }
  async function prepareSwapEnvelope(candidate: SwapQuote, overrideNativeBalance = false, fixedFees?: { maxFeePerGas: bigint; maxPriorityFeePerGas?: bigint }) {
    if (!client || !connection.address) throw new Error("gas");
    const request = buildXyloSwapRequest(candidate, candidate.amountOut, slippage, connection.address);
    const publicRpcGas = await client.estimateContractGas({ ...request, ...(overrideNativeBalance ? { stateOverride: [{ address: connection.address, balance: 2n ** 128n }] } : {}) });
    let walletProviderGas: bigint | undefined;
    if (!overrideNativeBalance && connection.connector) {
      try {
        const provider = await connection.connector.getProvider() as { request(args: { method: string; params: unknown[] }): Promise<string> };
        const data = encodeFunctionData({ abi: request.abi, functionName: request.functionName, args: request.args });
        walletProviderGas = BigInt(await provider.request({ method: "eth_estimateGas", params: [{ from: connection.address, to: request.address, data }] }));
      } catch { walletProviderGas = undefined; }
    }
    const fees = fixedFees ?? await client.estimateFeesPerGas();
    const maxFeePerGas = fees.maxFeePerGas ?? await client.getGasPrice();
    return createSwapFeeEnvelope(publicRpcGas, walletProviderGas, maxFeePerGas, fees.maxPriorityFeePerGas ?? undefined);
  }
  async function solveSafeMax(currentBalance: bigint, allowance: bigint) {
    if (!client || !connection.address || !safeMaxCanUseSwapEstimate(allowance, currentBalance)) throw new SafeSwapMaxError("no-estimate");
    let useNativeBalanceOverride = true;
    const fixedFees = await client.estimateFeesPerGas();
    const fixedFeePerGas = fixedFees.maxFeePerGas ?? await client.getGasPrice();
    const estimateCandidate = async (candidate: bigint, fixed?: { maxFeePerGas: bigint; maxPriorityFeePerGas?: bigint }) => {
      const output = await client.readContract({ address: XYLO_ROUTER, abi: xyloRouterAbi, functionName: "getAmountOut", args: [from.address, to.address, candidate] });
      const candidateQuote = createXyloQuote(from.id, to.id, candidate, output);
      try {
        const envelope = await prepareSwapEnvelope(candidateQuote, useNativeBalanceOverride, fixed);
        return { feeUsdc6: envelope.feeUsdc6 };
      } catch (caught) {
        if (!useNativeBalanceOverride) throw caught;
        useNativeBalanceOverride = false;
        const envelope = await prepareSwapEnvelope(candidateQuote, false, fixed);
        return { feeUsdc6: envelope.feeUsdc6 };
      }
    };
    return calculateSafeUsdcSwapMax(currentBalance, (candidate) => estimateCandidate(candidate, { maxFeePerGas: fixedFeePerGas, maxPriorityFeePerGas: fixedFees.maxPriorityFeePerGas ?? undefined }), (candidate) => estimateCandidate(candidate));
  }
  async function chooseQuickAmount(percent: SwapQuickPercent) {
    let selected = swapAmountForPercent(balance, percent);
    let calculatedSafeMax: SafeSwapMaxResult | undefined;
    if (percent === 100 && from.id === "usdc" && selected > 0n && client && connection.address && await chain.verifyNow()) {
      setPending(vi ? "Đang tính mức MAX an toàn…" : "Calculating safe MAX…");
      try {
        const allowance = await client.readContract({ address: from.address, abi: erc20BalanceAbi, functionName: "allowance", args: [connection.address, XYLO_ROUTER] });
        if (!safeMaxCanUseSwapEstimate(allowance, selected)) {
          const approvalFee = await estimateApprovalFee(selected);
          if (approvalFee === undefined) throw new Error("approval-fee");
          setMaxApproval({ account: connection.address, balance: selected, allowance, approvalFee }); setError(undefined); return;
        }
        calculatedSafeMax = await solveSafeMax(balance, allowance);
        selected = calculatedSafeMax.amount;
      } catch (caught) { return setError(safeMaxFailure(locale, caught)); }
      finally { setPending(undefined); }
    }
    changeAmount(selected > 0n ? formatAssetAmount(selected, from) : "");
    if (calculatedSafeMax && connection.address) setSafeMax({ ...calculatedSafeMax, balance, account: connection.address, chainId: arcTestnet.id });
    if (selected === 0n) setQuickFeedback(vi ? "Số dư quá nhỏ cho tỷ lệ này." : "Balance too small for this percentage.");
  }
  async function approveForMax() {
    if (!connection.address || !client || !maxApproval || pending) return;
    if (connection.address.toLowerCase() !== maxApproval.account.toLowerCase()) { setMaxApproval(undefined); return setError(vi ? "Tài khoản đã thay đổi. Hãy nhấn MAX lại." : "Account changed. Press MAX again."); }
    setError(undefined);
    try {
      if (!(await chain.verifyNow())) throw new Error("arc");
      const [currentBalance, currentAllowance] = await Promise.all([
        client.readContract({ address: from.address, abi: erc20BalanceAbi, functionName: "balanceOf", args: [connection.address] }),
        client.readContract({ address: from.address, abi: erc20BalanceAbi, functionName: "allowance", args: [connection.address, XYLO_ROUTER] }),
      ]);
      if (currentBalance !== maxApproval.balance) { setMaxApproval(undefined); return setError(vi ? "Số dư đã thay đổi. Hãy nhấn MAX lại." : "Balance changed. Press MAX again."); }
      if (currentAllowance < currentBalance) {
        const finiteApproval = currentBalance;
        const intent = approvalIntentFor(finiteApproval, reviewNow(), maxApproval.approvalFee)!;
        const snapshot = prepareFlowReview(intent, { connectedAccount: connection.address, connectedChainId: arcTestnet.id, balances: { [from.id]: currentBalance, usdc: usdcBalance }, allowance: currentAllowance, simulation: "passed", expectedTarget: from.address });
        setPending(vi ? "Đang chờ Approve cho MAX trong ví…" : "Waiting for Approve for MAX in your wallet…");
        await client.simulateContract({ address: from.address, abi: erc20BalanceAbi, functionName: "approve", args: [XYLO_ROUTER, finiteApproval], account: connection.address });
        const approvalHash = await submissionGuard.current.run(snapshot.fingerprint, () => writer.writeContractAsync({ address: from.address, abi: erc20BalanceAbi, functionName: "approve", args: [XYLO_ROUTER, finiteApproval], account: connection.address, chainId: arcTestnet.id }));
        if ((await client.waitForTransactionReceipt({ hash: approvalHash })).status !== "success") throw new Error("approve");
      }
      if (!(await chain.verifyNow())) throw new Error("arc");
      const [postApprovalBalance, postApprovalAllowance] = await Promise.all([
        client.readContract({ address: from.address, abi: erc20BalanceAbi, functionName: "balanceOf", args: [connection.address] }),
        client.readContract({ address: from.address, abi: erc20BalanceAbi, functionName: "allowance", args: [connection.address, XYLO_ROUTER] }),
      ]);
      if (!safeMaxCanUseSwapEstimate(postApprovalAllowance, postApprovalBalance)) throw new Error("allowance");
      setPending(vi ? "Đang tính mức MAX an toàn…" : "Calculating safe MAX…");
      const result = await solveSafeMax(postApprovalBalance, postApprovalAllowance);
      setAmount(formatAssetAmount(result.amount, from)); setSafeMax({ ...result, balance: postApprovalBalance, account: connection.address, chainId: arcTestnet.id }); setMaxApproval(undefined);
    } catch (caught) {
      if (caught instanceof Error && caught.message === "arc") setError(vi ? "Cần kết nối Arc Testnet." : "Arc Testnet is required.");
      else if (caught instanceof SafeSwapMaxError) setError(safeMaxFailure(locale, caught));
      else { const kind = classifyWalletFailure(caught, false); setError(kind === "rejected" ? (vi ? "Bạn đã từ chối Approve cho MAX." : "You rejected Approve for MAX.") : (vi ? "Không thể hoàn tất Approve cho MAX." : "Approve for MAX could not be completed.")); }
    } finally { setPending(undefined); }
  }
  async function review() {
    if (!connection.address || !client || !parsed) return setError(vi ? "Nhập số tiền hợp lệ." : "Enter a valid amount.");
    if (parsed > balance) return setError(vi ? "Số dư không đủ." : "Insufficient balance.");
    setPending(vi ? "Đang lấy báo giá trực tiếp từ XyloNet…" : "Loading a live XyloNet quote…"); setError(undefined); setQuote(undefined); setApprovalGasFee(undefined); setSwapGasFee(undefined); setGasUnavailable(false);
    try {
      if (!(await chain.verifyNow())) throw new Error("arc");
      const [output, allowance] = await Promise.all([client.readContract({ address: XYLO_ROUTER, abi: xyloRouterAbi, functionName: "getAmountOut", args: [from.address, to.address, parsed] }), client.readContract({ address: from.address, abi: erc20BalanceAbi, functionName: "allowance", args: [connection.address, XYLO_ROUTER] })]);
      const nextQuote = createXyloQuote(from.id, to.id, parsed, output), plan = planSwapReview(allowance, parsed), needsApproval = plan.stage === "approval";
      setQuote(nextQuote);
      try {
        if (needsApproval) { const fee = await estimateApprovalFee(parsed); setApprovalGasFee(fee); if (fee !== undefined) { const intent = approvalIntentFor(parsed, nextQuote.quotedAt, fee); if (intent) setApprovalReview(prepareFlowReview(intent, { connectedAccount: connection.address, connectedChainId: arcTestnet.id, balances: { [from.id]: balance, usdc: usdcBalance }, allowance, simulation: "passed", expectedTarget: from.address })); } }
        else {
          const envelope = await prepareSwapEnvelope(nextQuote);
          if (safeMax && parsed === safeMax.amount && parsed + envelope.feeUsdc6 > balance) {
            const recalculated = await solveSafeMax(balance, allowance); setAmount(formatAssetAmount(recalculated.amount, from)); setSafeMax({ ...recalculated, balance, account: connection.address, chainId: arcTestnet.id });
            setQuote(undefined); setError(vi ? "Phí Arc đã thay đổi. MAX đã được tính lại; hãy kiểm tra lại." : "Arc gas changed. MAX was recalculated; review again."); return;
          }
          setSwapEnvelope(envelope); setSwapGasFee(envelope.rawMaxFee18);
          const intent = swapIntentFor(nextQuote, envelope); if (intent) setSwapReview(prepareFlowReview(intent, { connectedAccount: connection.address, connectedChainId: arcTestnet.id, balances: { [from.id]: balance, usdc: usdcBalance }, allowance, simulation: "passed", expectedTarget: XYLO_ROUTER }));
        }
      } catch { setGasUnavailable(true); }
      setReviewedAccount(connection.address); setReviewStage(needsApproval ? "approval" : "swap");
    } catch (caught) { setError(caught instanceof Error && caught.message === "arc" ? (vi ? "Cần kết nối Arc Testnet." : "Arc Testnet is required.") : (vi ? "Không lấy được báo giá XyloNet." : "Could not load a XyloNet quote.")); }
    finally { setPending(undefined); }
  }
  async function approveThenReview() {
    if (!connection.address || !client || !quote || reviewStage !== "approval" || pending) return;
    if (!reviewedAccount || connection.address.toLowerCase() !== reviewedAccount.toLowerCase()) { setReviewStage(undefined); return setError(vi ? "Chi tiết giao dịch đã thay đổi. Vui lòng kiểm tra lại." : "Transaction details changed. Please review again."); }
    if (!isSwapQuoteFresh(quote.quotedAt)) { setQuote(undefined); setReviewStage(undefined); return setError(vi ? "Báo giá đã hết hạn. Hãy lấy báo giá mới trước khi approve." : "Quote expired. Get a fresh quote before approving."); }
    setError(undefined);
    try {
      if (!(await chain.verifyNow())) throw new Error("arc");
      const freshBalance = await client.readContract({ address: from.address, abi: erc20BalanceAbi, functionName: "balanceOf", args: [connection.address] });
      if (quote.amountIn > freshBalance) throw new Error("balance");
      const currentAllowance = await client.readContract({ address: from.address, abi: erc20BalanceAbi, functionName: "allowance", args: [connection.address, XYLO_ROUTER] });
      const approval = exactApprovalRequired(currentAllowance, quote.amountIn);
      if (approval) {
        if (!approvalReview) throw new Error("Review again.");
        const intent = approvalIntentFor(approval, quote.quotedAt, approvalGasFee)!;
        const checked = revalidateTransactionReview(approvalReview, { intent, context: { connectedAccount: connection.address, connectedChainId: arcTestnet.id, balances: { [from.id]: freshBalance, usdc: usdcBalance }, allowance: currentAllowance, simulation: "passed", expectedTarget: from.address }, now: reviewNow() });
        if (!checked.valid) throw new Error("Review again.");
        setPending(vi ? "Đang chờ approve đúng số lượng trong ví…" : "Waiting for exact token approval…");
        await client.simulateContract({ address: from.address, abi: erc20BalanceAbi, functionName: "approve", args: [XYLO_ROUTER, approval], account: connection.address });
        const approvalHash = await submissionGuard.current.run(approvalReview.fingerprint, () => writer.writeContractAsync({ address: from.address, abi: erc20BalanceAbi, functionName: "approve", args: [XYLO_ROUTER, approval], account: connection.address, chainId: arcTestnet.id }));
        if ((await client.waitForTransactionReceipt({ hash: approvalHash })).status !== "success") throw new Error("approve");
      }
      if (!(await chain.verifyNow())) throw new Error("arc");
      const [allowance, nextBalance, nextUsdcBalance, freshOutput] = await Promise.all([
        client.readContract({ address: from.address, abi: erc20BalanceAbi, functionName: "allowance", args: [connection.address, XYLO_ROUTER] }),
        client.readContract({ address: from.address, abi: erc20BalanceAbi, functionName: "balanceOf", args: [connection.address] }),
        client.readContract({ address: getAssetById("usdc")!.address, abi: erc20BalanceAbi, functionName: "balanceOf", args: [connection.address] }),
        client.readContract({ address: XYLO_ROUTER, abi: xyloRouterAbi, functionName: "getAmountOut", args: [from.address, to.address, quote.amountIn] }),
      ]);
      if (allowance < quote.amountIn) throw new Error("allowance");
      if (nextBalance < quote.amountIn) throw new Error("balance");
      const freshQuote = createXyloQuote(from.id, to.id, quote.amountIn, freshOutput);
      const envelope = await prepareSwapEnvelope(freshQuote);
      const cost = swapCostWithArcFee(freshQuote.amountIn, from.id, nextUsdcBalance, envelope.rawMaxFee18);
      const nextIntent = swapIntentFor(freshQuote, envelope); if (nextIntent) setSwapReview(prepareFlowReview(nextIntent, { connectedAccount: connection.address, connectedChainId: arcTestnet.id, balances: { [from.id]: nextBalance, usdc: nextUsdcBalance }, allowance, simulation: "passed", expectedTarget: XYLO_ROUTER }));
      setApprovalReview(undefined); setSwapReview(undefined); setQuote(freshQuote); setApprovalGasFee(undefined); setSwapEnvelope(envelope); setSwapGasFee(envelope.rawMaxFee18); setGasUnavailable(false); setReviewStage("swap");
      if (!cost.sufficientGasBalance) setError(vi ? "Không đủ USDC cho phí gas của giao dịch swap." : "Insufficient USDC for the swap network fee.");
    } catch (caught) {
      if (caught instanceof Error && caught.message === "arc") setError(vi ? "Cần kết nối Arc Testnet." : "Arc Testnet is required.");
      else if (caught instanceof Error && caught.message === "balance") setError(vi ? "Số dư vừa thay đổi và không còn đủ." : "Your balance changed and is no longer sufficient.");
      else { const kind = classifyWalletFailure(caught, false); setError(kind === "rejected" ? (vi ? "Bạn đã từ chối yêu cầu approve trong ví." : "You rejected the approval request.") : (vi ? "Không thể hoàn tất approve hoặc ước tính gas swap." : "Approval or post-approval swap gas estimation failed.")); }
    } finally { setPending(undefined); }
  }
  async function execute() {
    if (!connection.address || !client || !quote || !route || !swapReview || reviewStage !== "swap" || pending) return;
    if (!reviewedAccount || connection.address.toLowerCase() !== reviewedAccount.toLowerCase()) { setReviewStage(undefined); return setError(vi ? "Chi tiết giao dịch đã thay đổi. Vui lòng kiểm tra lại." : "Transaction details changed. Please review again."); }
    if (!isSwapQuoteFresh(quote.quotedAt)) { setQuote(undefined); setReviewStage(undefined); return setError(vi ? "Báo giá đã hết hạn." : "Quote expired. Get a fresh quote."); }
    if (gasUnavailable || !gasCost?.sufficientGasBalance) return setError(vi ? "Không đủ số dư USDC đã tính cả phí Arc, hoặc chưa thể ước tính phí an toàn." : "USDC balance including Arc gas is insufficient, or a safe fee estimate is unavailable.");
    let submitted = false; setError(undefined);
    try {
      if (!(await chain.verifyNow())) throw new Error("arc");
      let freshBalance = await client.readContract({ address: from.address, abi: erc20BalanceAbi, functionName: "balanceOf", args: [connection.address] }); if (quote.amountIn > freshBalance) throw new Error("balance");
      const allowance = await client.readContract({ address: from.address, abi: erc20BalanceAbi, functionName: "allowance", args: [connection.address, XYLO_ROUTER] });
      if (allowance < quote.amountIn) { setReviewStage(undefined); return setError(vi ? "Allowance đã thay đổi. Vui lòng kiểm tra lại." : "Allowance changed. Please review again."); }
      if (!(await chain.verifyNow())) throw new Error("arc"); freshBalance = await client.readContract({ address: from.address, abi: erc20BalanceAbi, functionName: "balanceOf", args: [connection.address] }); if (quote.amountIn > freshBalance) throw new Error("balance");
      const [freshOutput, freshUsdcBalance] = await Promise.all([client.readContract({ address: XYLO_ROUTER, abi: xyloRouterAbi, functionName: "getAmountOut", args: [from.address, to.address, quote.amountIn] }), client.readContract({ address: getAssetById("usdc")!.address, abi: erc20BalanceAbi, functionName: "balanceOf", args: [connection.address] })]), freshQuote = createXyloQuote(from.id, to.id, quote.amountIn, freshOutput), request = buildXyloSwapRequest(freshQuote, freshOutput, slippage, connection.address), freshEnvelope = await prepareSwapEnvelope(freshQuote);
      if (safeMax && quote.amountIn === safeMax.amount && quote.amountIn + freshEnvelope.feeUsdc6 > freshBalance) { const recalculated = await solveSafeMax(freshBalance, allowance); setAmount(formatAssetAmount(recalculated.amount, from)); setSafeMax({ ...recalculated, balance: freshBalance, account: connection.address, chainId: arcTestnet.id }); setQuote(undefined); setReviewStage(undefined); return setError(vi ? "Phí Arc đã thay đổi. MAX đã được tính lại; hãy kiểm tra lại." : "Arc fees changed. MAX was recalculated. Review again."); }
      const finalCost = swapCostWithArcFee(quote.amountIn, from.id, freshUsdcBalance, freshEnvelope.rawMaxFee18); if (!finalCost.sufficientGasBalance) throw new Error("balance");
      const preparedRequest = { ...request, gas: freshEnvelope.gasLimit, maxFeePerGas: freshEnvelope.maxFeePerGas, maxPriorityFeePerGas: freshEnvelope.maxPriorityFeePerGas };
      const finalQuote = { ...freshQuote, quotedAt: quote.quotedAt }, finalIntent = swapIntentFor(finalQuote, freshEnvelope)!;
      const checked = revalidateTransactionReview(swapReview, { intent: finalIntent, context: { connectedAccount: connection.address, connectedChainId: arcTestnet.id, balances: { [from.id]: freshBalance, usdc: freshUsdcBalance }, allowance, simulation: "passed", expectedTarget: XYLO_ROUTER }, request: { to: XYLO_ROUTER, data: finalIntent.calldata, value: 0n, chainId: arcTestnet.id, gas: freshEnvelope.gasLimit, maxFeePerGas: freshEnvelope.maxFeePerGas, maxPriorityFeePerGas: freshEnvelope.maxPriorityFeePerGas }, now: reviewNow() });
      if (!checked.valid) { setSwapReview(undefined); setReviewStage(undefined); return setError(vi ? "Báo giá, tuyến hoặc phí đã thay đổi. Hãy kiểm tra lại." : "Quote, route, or fees changed. Review again."); }
      setPending(vi ? "Đang chờ bạn xác nhận swap trong ví…" : "Waiting for swap confirmation in your wallet…"); const simulation = await client.simulateContract(preparedRequest), hash = await submissionGuard.current.run(swapReview.fingerprint, () => writer.writeContractAsync(simulation.request)); submitted = true;
      setPending(vi ? "Đã gửi. Đang chờ Arc xác nhận…" : "Submitted. Waiting for Arc confirmation…"); const receipt = await client.waitForTransactionReceipt({ hash }); if (receipt.status !== "success") throw new Error("revert"); const block = await client.getBlock({ blockNumber: receipt.blockNumber });
      await confirmThenRefresh({ receipt: Promise.resolve(receipt), onConfirmed: () => { const soldLog = receipt.logs.find((log) => log.address.toLowerCase() === from.address.toLowerCase()), receivedLog = receipt.logs.find((log) => log.address.toLowerCase() === to.address.toLowerCase()); recordWalletActivity(connection.address!, arcTestnet.id, createAssetActivity(from, { hash: receipt.transactionHash, logIndex: soldLog?.logIndex ?? -1, direction: "send", kind: "swap", amount: quote.amountIn, counterparty: XYLO_ROUTER, confirmedAt: Number(block.timestamp) * 1000, blockNumber: receipt.blockNumber, swapReceive: { amount: freshOutput, assetId: to.id, assetSymbol: to.symbol, tokenAddress: to.address, decimals: to.decimals, logIndex: receivedLog?.logIndex ?? 0 } })); setSuccess({ hash: receipt.transactionHash, quote, received: freshOutput }); setReviewStage(undefined); }, refresh: async () => { await Promise.all([balances.usdc.refetch(), balances.eurc.refetch()]); onConfirmed?.(); } });
    } catch (caught) {
      if (caught instanceof Error && caught.message === "arc") return setError(vi ? "Cần kết nối Arc Testnet." : "Arc Testnet is required."); if (caught instanceof Error && caught.message === "balance") return setError(vi ? "Số dư vừa thay đổi và không còn đủ." : "Your balance changed and is no longer sufficient.");
      const kind = classifyWalletFailure(caught, submitted); setError(({ rejected: vi ? "Bạn đã từ chối yêu cầu trong ví." : "You rejected the wallet request.", "wrong-network": vi ? "Ví không còn ở Arc Testnet." : "Your wallet is no longer on Arc Testnet.", "insufficient-gas": vi ? "Không đủ USDC để trả gas trên Arc." : "Not enough USDC to pay Arc gas.", reverted: vi ? "Giao dịch bị revert." : "The transaction reverted.", "confirmation-unknown": vi ? "Trạng thái chưa rõ. Kiểm tra ArcScan." : "Confirmation is unclear. Check ArcScan.", rpc: vi ? "Ví hoặc RPC gặp lỗi." : "The wallet or RPC failed." } as const)[kind]);
    } finally { setPending(undefined); }
  }
  if (success) { const sold = getAssetById(success.quote.fromAssetId)!, bought = getAssetById(success.quote.toAssetId)!; return <div className="transaction-state"><span>✓</span><h3>{vi ? "Hoán đổi thành công" : "Swap confirmed"}</h3><p>{formatAssetAmount(success.quote.amountIn, sold)} {sold.symbol} → ≈ {formatAssetAmount(success.received, bought)} {bought.symbol}</p><a href={`${ARC_EXPLORER_URL}/tx/${success.hash}`} target="_blank" rel="noreferrer">ArcScan ↗</a><button type="button" className="standalone-action" onClick={reset}>{vi ? "Hoán đổi tiếp" : "Swap again"}</button></div>; }
  if (maxApproval) return <TransactionSafetyReview title={vi ? "Approve cho MAX" : "Approve for MAX"} summary={vi ? "Đây chỉ là allowance hữu hạn. Không có giao dịch swap nào được gửi." : "This only grants a finite allowance. No swap will be submitted."} details={[{ label: "Token", value: "USDC" }, { label: "Spender", value: XYLO_ROUTER }, { label: vi ? "Số lượng approval" : "Approval amount", value: `${formatAssetAmount(maxApproval.balance, getAssetById("usdc")!)} USDC` }, { label: vi ? "Phí approval ước tính" : "Estimated approval fee", value: formatArcFeeEstimate(maxApproval.approvalFee) }, { label: vi ? "Mạng" : "Network", value: "Arc Testnet · 5042002" }]} checks={[...globalReviewChecks({ connected: connection.isConnected, account: connection.address, reviewedAccount: maxApproval.account, isArc: chain.isArc, amount: maxApproval.balance, balance }), { code: "finite", status: "verified", label: vi ? "Allowance hữu hạn bằng số dư snapshot hiện tại" : "Finite allowance capped at the current balance snapshot" }, { code: "approval-gas", status: maxApprovalGasCovered ? "verified" : "blocking", label: maxApprovalGasCovered ? (vi ? "Số dư USDC đủ cho phí approval" : "USDC balance covers approval gas") : (vi ? "Không đủ USDC cho phí approval" : "Insufficient USDC for approval gas") }]} walletNotice={vi ? "Chỉ approval hữu hạn được gửi. Sau khi xác nhận, Makoto sẽ tự điền SAFE MAX nhưng không tự swap." : "Only a finite approval is submitted. After confirmation, Makoto auto-fills SAFE MAX but never swaps automatically."} onBack={() => setMaxApproval(undefined)} onContinue={() => void approveForMax()} continueLabel={vi ? "Approve cho MAX" : "Approve for MAX"} continueDisabled={Boolean(pending) || !maxApprovalGasCovered}>{pending && <p className="transaction-progress" role="status">{pending}</p>}{error && <p className="field-error" role="alert">{error}</p>}</TransactionSafetyReview>;
  if (reviewStage === "approval" && quote && route) return <TransactionSafetyReview title={vi ? "Approve token" : "Approve token"} summary={vi ? "Approve đúng số lượng trước; Makoto sẽ lấy báo giá mới và ước tính gas swap sau khi approval được xác nhận." : "Approve the exact amount first. Makoto will fetch a fresh quote and estimate swap gas after approval confirms."} details={[{ label: vi ? "Bán" : "From", value: `${formatAssetAmount(quote.amountIn, from)} ${from.symbol}` }, { label: vi ? "Tuyến đã chọn" : "Selected route", value: swapRouteLabel(route.provider) }, { label: vi ? "Phí mạng approval" : "Approval network fee", value: approvalGasFee === undefined ? (vi ? "Không khả dụng" : "Unavailable") : formatArcFeeEstimate(approvalGasFee) }, { label: vi ? "Phí mạng swap" : "Swap network fee", value: vi ? "Ước tính sau approval" : "Estimated after approval" }, { label: vi ? "Mạng" : "Network", value: "Arc Testnet · 5042002" }]} checks={[...globalReviewChecks({ connected: connection.isConnected, account: connection.address, reviewedAccount, isArc: chain.isArc, amount: quote.amountIn, balance }), { code: "quote", status: isSwapQuoteFresh(quote.quotedAt) ? "verified" : "blocking", label: isSwapQuoteFresh(quote.quotedAt) ? (vi ? "Báo giá còn hiệu lực" : "Quote is current") : (vi ? "Báo giá đã hết hạn" : "Quote expired") }, { code: "approval-gas", status: approvalGasCovered ? "verified" : "blocking", label: approvalGasFee === undefined ? (vi ? "Không thể ước tính phí approval" : "Approval gas estimate unavailable") : approvalGasCovered ? (vi ? "Số dư USDC đủ cho phí approval" : "USDC balance covers approval gas") : (vi ? "Không đủ USDC cho phí approval" : "Insufficient USDC for approval gas") }, { code: "swap-gas-later", status: "info", label: vi ? "Phí gas của giao dịch swap sẽ được ước tính sau khi token được approve." : "Swap gas will be estimated after token approval." }]} walletNotice={vi ? "Chỉ approval đúng số lượng được gửi ở bước này. Swap sẽ không tự động chạy." : "Only the exact approval is submitted at this step. The swap will not run automatically."} onBack={() => { setReviewStage(undefined); setQuote(undefined); }} onContinue={() => void approveThenReview()} continueLabel={vi ? "Approve token" : "Approve token"} continueDisabled={Boolean(pending) || !approvalGasCovered}>{pending && <p className="transaction-progress" role="status">{pending}</p>}{error && <p className="field-error" role="alert">{error}</p>}</TransactionSafetyReview>;
  if (reviewStage === "swap" && quote && route) return <TransactionSafetyReview title={vi ? "Kiểm tra hoán đổi" : "Review Swap"} summary={vi ? "Kiểm tra báo giá mới, tuyến đã chọn, phí swap và mức tối thiểu trước khi ký." : "Review the fresh quote, selected route, swap fee, and guaranteed minimum before signing."} details={[{ label: vi ? "Bán" : "From", value: `${formatAssetAmount(quote.amountIn, from)} ${from.symbol}` }, { label: vi ? "Ước tính nhận" : "Current quote", value: `≈ ${formatAssetAmount(quote.amountOut, to)} ${to.symbol}` }, { label: vi ? "Tối thiểu nhận" : "Minimum received", value: `${formatAssetAmount(minimumSwapOutput(quote.amountOut, slippage), to)} ${to.symbol}` }, { label: vi ? "Tuyến đã chọn" : "Selected route", value: swapRouteLabel(route.provider) }, { label: vi ? "Phí mạng swap" : "Swap network fee", value: swapGasFee === undefined ? (vi ? "Không khả dụng" : "Unavailable") : formatArcFeeEstimate(swapGasFee) }, { label: "Slippage", value: `${(slippage * 100).toFixed(1)}%` }, { label: vi ? "Mạng" : "Network", value: "Arc Testnet · 5042002" }]} checks={[...globalReviewChecks({ connected: connection.isConnected, account: connection.address, reviewedAccount, isArc: chain.isArc, amount: quote.amountIn, balance }), { code: "quote", status: isSwapQuoteFresh(quote.quotedAt) ? "verified" : "blocking", label: isSwapQuoteFresh(quote.quotedAt) ? (vi ? "Báo giá còn hiệu lực" : "Quote is current") : (vi ? "Báo giá đã hết hạn" : "Quote expired") }, { code: "gas", status: gasUnavailable || !gasCost?.sufficientGasBalance ? "blocking" : "verified", label: gasUnavailable ? (vi ? "Không thể ước tính phí swap an toàn" : "Safe swap gas estimate unavailable") : gasCost?.sufficientGasBalance ? (vi ? "Số dư USDC đủ cho phí swap" : "USDC balance covers swap gas") : (vi ? "Không đủ USDC cho số tiền và phí swap" : "Insufficient USDC for amount and swap gas") }, { code: "approval", status: "verified", label: vi ? "Allowance đã đủ" : "Allowance is sufficient" }]} walletNotice={vi ? "Approval đã hoàn tất. Swap chỉ được gửi sau xác nhận riêng này." : "Approval is complete. The swap is submitted only after this separate confirmation."} onBack={() => { setReviewStage(undefined); setQuote(undefined); }} onContinue={() => void execute()} continueDisabled={Boolean(pending) || gasUnavailable || !gasCost?.sufficientGasBalance}>{pending && <p className="transaction-progress" role="status">{pending}</p>}{error && <p className="field-error" role="alert">{error}</p>}<details><summary>{vi ? "So sánh tuyến nâng cao" : "Advanced route comparison"}</summary><p>XyloNet StableSwap · {vi ? "khả dụng trong ví" : "wallet-executable"}</p><p>Circle App Kit Swap · {vi ? "không khả dụng trên trình duyệt: cần Kit Key bí mật phía máy chủ" : CIRCLE_BROWSER_SWAP_STATUS.reason}</p></details></TransactionSafetyReview>;
  return <form className="create-form wallet-flow" onSubmit={(event) => { event.preventDefault(); void review(); }}><fieldset><legend>{vi ? "Chế độ định tuyến" : "Routing mode"}</legend><label><input type="radio" checked={mode === "smart"} onChange={() => { setMode("smart"); invalidate(); }} /> Smart</label><label><input type="radio" checked={mode === "xylonet"} onChange={() => { setMode("xylonet"); invalidate(); }} /> XyloNet</label></fieldset><label>{vi ? "Tài sản bán" : "Sell asset"}<select className="asset-selector" value={fromId} onChange={(event) => { setFromId(event.target.value as SupportedAssetId); reset(); }}>{SUPPORTED_ASSETS.map((asset) => <option key={asset.id} value={asset.id}>{asset.symbol} · {asset.name}</option>)}</select></label><label>{vi ? "Tài sản nhận" : "Buy asset"}<select className="asset-selector" value={to.id} disabled><option>{to.symbol} · {to.name}</option></select></label><label>{vi ? "Số lượng" : "Amount"}<div className="wallet-field-with-action amount"><input inputMode="decimal" value={amount} onChange={(event) => changeAmount(event.target.value)} placeholder="0.00"/><span>{from.symbol}</span></div><small>{vi ? "Khả dụng" : "Available"}: {formatAssetAmount(balance, from)} {from.symbol}</small></label><div className="swap-quick-amounts" aria-label={vi ? "Chọn nhanh số lượng" : "Quick amount selection"}>{([25, 50, 75, 100] as const).map((percent) => <button key={percent} type="button" onClick={() => void chooseQuickAmount(percent)} disabled={balance <= 0n || Boolean(pending)}>{percent === 100 ? "MAX" : `${percent}%`}</button>)}</div>{quickFeedback && <p className="swap-quick-feedback" role="status">{quickFeedback}</p>}{safeMax && <p className="swap-quick-feedback" role="status">{vi ? "Đã chừa cho phí gas Arc" : "Reserved for Arc gas"}: {formatAssetAmount(safeMax.feeUsdc6, getAssetById("usdc")!)} USDC</p>}<label>Slippage<select className="asset-selector" value={slippage} onChange={(event) => { setSlippage(Number(event.target.value) as (typeof SWAP_SLIPPAGE_OPTIONS)[number]); invalidate(); }}>{SWAP_SLIPPAGE_OPTIONS.map((value) => <option key={value} value={value}>{(value * 100).toFixed(1)}%</option>)}</select></label><p className="wallet-notice">{mode === "smart" ? (vi ? "Smart chọn trong các tuyến thực thi an toàn; hiện tại tuyến được chọn là XyloNet." : "Smart selects among safely executable routes; XyloNet is currently the selected route.") : (vi ? "Chỉ dùng tuyến XyloNet trực tiếp trên Arc." : "Use only the direct XyloNet route on Arc.")}</p><details><summary>{vi ? "Nhà cung cấp nâng cao" : "Advanced providers"}</summary><p>Circle App Kit Swap · {vi ? "không khả dụng trong trình duyệt vì Kit Key phải giữ bí mật phía máy chủ" : CIRCLE_BROWSER_SWAP_STATUS.reason}</p></details>{pending && <p className="transaction-progress" role="status">{pending}</p>}{error && <p className="field-error" role="alert">{error}</p>}{!chain.isArc && <p className="field-error">{vi ? "Cần kết nối Arc Testnet." : "Arc Testnet is required."}</p>}<div className="modal-actions"><button type="submit" className="primary-action" disabled={Boolean(pending) || !chain.isArc}>{vi ? "Lấy báo giá" : "Get quote"}</button></div></form>;
}

function reviewNow() { return Date.now(); }
