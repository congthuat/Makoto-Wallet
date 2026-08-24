"use client";

import { useEffect, useState } from "react";
import type { Hex } from "viem";
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
import { globalReviewChecks } from "@/lib/transactionReview";
import { classifyWalletFailure } from "@/lib/walletSafety";
import { createAssetActivity, recordWalletActivity } from "@/lib/walletActivity";
import { TransactionSafetyReview } from "./TransactionSafetyReview";

type Props = { locale: "en" | "vi"; onBusyChange(busy: boolean): void; onConfirmed?(): void };

export function RealSwapFlow({ locale, onBusyChange, onConfirmed }: Props) {
  const vi = locale === "vi", connection = useConnection(), chain = useVerifiedWalletChain();
  const client = usePublicClient({ chainId: arcTestnet.id }), writer = useWriteContract(), balances = useWalletBalances(connection.address, chain.isArc);
  const [fromId, setFromId] = useState<SupportedAssetId>("usdc"), [mode, setMode] = useState<SwapMode>("smart"), [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState<(typeof SWAP_SLIPPAGE_OPTIONS)[number]>(0.005), [quote, setQuote] = useState<SwapQuote>(), [approvalGasFee, setApprovalGasFee] = useState<bigint>(), [swapGasFee, setSwapGasFee] = useState<bigint>();
  const [reviewStage, setReviewStage] = useState<"approval" | "swap">(), [gasUnavailable, setGasUnavailable] = useState(false), [pending, setPending] = useState<string>(), [error, setError] = useState<string>(), [quickFeedback, setQuickFeedback] = useState<string>();
  const [reviewedAccount, setReviewedAccount] = useState<`0x${string}`>(), [success, setSuccess] = useState<{ hash: Hex; quote: SwapQuote; received: bigint }>();
  const [safeMax, setSafeMax] = useState<(SafeSwapMaxResult & { balance: bigint; account: `0x${string}`; chainId: number })>();
  useEffect(() => onBusyChange(Boolean(pending)), [onBusyChange, pending]);
  const from = getAssetById(fromId)!, to = getAssetById(oppositeAssetId(fromId))!, balance = balances.assets[fromId].data ?? 0n, usdcBalance = balances.assets.usdc.data ?? 0n, parsed = parseAssetAmount(amount, from);
  const route = quote ? selectRouteForMode(mode, [{ provider: "xylonet", output: quote.amountOut, fee: swapGasFee ?? approvalGasFee ?? 0n, quotedAt: quote.quotedAt, expiresAt: quote.quotedAt + SWAP_QUOTE_MAX_AGE_MS, available: true }], quote.quotedAt) : undefined;
  const gasCost = quote && swapGasFee !== undefined ? swapCostWithArcFee(quote.amountIn, from.id, usdcBalance, swapGasFee) : undefined;
  const approvalGasCovered = approvalGasFee !== undefined && swapCostWithArcFee(0n, "eurc", usdcBalance, approvalGasFee).sufficientGasBalance;

  useEffect(() => {
    if (!safeMax || safeMax.balance === balance && safeMax.account.toLowerCase() === connection.address?.toLowerCase() && safeMax.chainId === arcTestnet.id && chain.isArc) return;
    const timeout = window.setTimeout(() => { setSafeMax(undefined); setAmount((current) => current === formatAssetAmount(safeMax.amount, from) ? "" : current); }, 0);
    return () => window.clearTimeout(timeout);
  }, [balance, chain.isArc, connection.address, from, safeMax]);
  function invalidate() { setQuote(undefined); setReviewStage(undefined); setError(undefined); setQuickFeedback(undefined); setApprovalGasFee(undefined); setSwapGasFee(undefined); setGasUnavailable(false); setSafeMax(undefined); }
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
  async function estimateSwapFee(candidate: SwapQuote, overrideNativeBalance = false) {
    if (!client || !connection.address) return undefined;
    const swapGas = await client.estimateContractGas({ ...buildXyloSwapRequest(candidate, candidate.amountOut, slippage, connection.address), ...(overrideNativeBalance ? { stateOverride: [{ address: connection.address, balance: 2n ** 128n }] } : {}) });
    const price = await gasPrice();
    return price === undefined ? undefined : calculateArcFee(swapGas, price).rawFee;
  }
  async function solveSafeMax(currentBalance: bigint, allowance: bigint) {
    if (!client || !connection.address || !safeMaxCanUseSwapEstimate(allowance, currentBalance)) throw new SafeSwapMaxError("no-estimate");
    let useNativeBalanceOverride = true;
    return calculateSafeUsdcSwapMax(currentBalance, async (candidate) => {
      const output = await client.readContract({ address: XYLO_ROUTER, abi: xyloRouterAbi, functionName: "getAmountOut", args: [from.address, to.address, candidate] });
      const candidateQuote = createXyloQuote(from.id, to.id, candidate, output);
      try {
        const fee = await estimateSwapFee(candidateQuote, useNativeBalanceOverride);
        if (fee === undefined) throw new Error("fee");
        return { fee };
      } catch (caught) {
        if (!useNativeBalanceOverride) throw caught;
        useNativeBalanceOverride = false;
        const fee = await estimateSwapFee(candidateQuote, false);
        if (fee === undefined) throw caught;
        return { fee };
      }
    });
  }
  async function chooseQuickAmount(percent: SwapQuickPercent) {
    let selected = swapAmountForPercent(balance, percent);
    let calculatedSafeMax: SafeSwapMaxResult | undefined;
    if (percent === 100 && from.id === "usdc" && selected > 0n && client && connection.address && await chain.verifyNow()) {
      setPending(vi ? "Đang tính mức MAX an toàn…" : "Calculating safe MAX…");
      try {
        const allowance = await client.readContract({ address: from.address, abi: erc20BalanceAbi, functionName: "allowance", args: [connection.address, XYLO_ROUTER] });
        if (!safeMaxCanUseSwapEstimate(allowance, selected)) return setError(vi ? "Cần approve token trước khi có thể tính MAX an toàn." : "Approve the token before calculating a safe MAX.");
        calculatedSafeMax = await solveSafeMax(balance, allowance);
        selected = calculatedSafeMax.amount;
      } catch (caught) { return setError(caught instanceof SafeSwapMaxError && caught.code === "too-small" ? (vi ? "Số dư quá nhỏ để swap sau khi chừa phí Arc." : "Balance is too small to swap after reserving Arc gas.") : (vi ? "Không thể tính MAX an toàn từ phí Arc thực tế." : "A safe MAX could not be calculated from real Arc fees.")); }
      finally { setPending(undefined); }
    }
    changeAmount(selected > 0n ? formatAssetAmount(selected, from) : "");
    if (calculatedSafeMax && connection.address) setSafeMax({ ...calculatedSafeMax, balance, account: connection.address, chainId: arcTestnet.id });
    if (selected === 0n) setQuickFeedback(vi ? "Số dư quá nhỏ cho tỷ lệ này." : "Balance too small for this percentage.");
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
        if (needsApproval) setApprovalGasFee(await estimateApprovalFee(parsed));
        else {
          const fee = await estimateSwapFee(nextQuote);
          if (fee !== undefined && safeMax && parsed === safeMax.amount && parsed + arcFeeToUsdcAtomic(fee) > balance) {
            const recalculated = await solveSafeMax(balance, allowance); setAmount(formatAssetAmount(recalculated.amount, from)); setSafeMax({ ...recalculated, balance, account: connection.address, chainId: arcTestnet.id });
            setQuote(undefined); setError(vi ? "Phí Arc đã thay đổi. MAX đã được tính lại; hãy kiểm tra lại." : "Arc gas changed. MAX was recalculated; review again."); return;
          }
          setSwapGasFee(fee);
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
        setPending(vi ? "Đang chờ approve đúng số lượng trong ví…" : "Waiting for exact token approval…");
        await client.simulateContract({ address: from.address, abi: erc20BalanceAbi, functionName: "approve", args: [XYLO_ROUTER, approval], account: connection.address });
        const approvalHash = await writer.writeContractAsync({ address: from.address, abi: erc20BalanceAbi, functionName: "approve", args: [XYLO_ROUTER, approval], account: connection.address, chainId: arcTestnet.id });
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
      const fee = await estimateSwapFee(freshQuote);
      if (fee === undefined) throw new Error("gas");
      const cost = swapCostWithArcFee(freshQuote.amountIn, from.id, nextUsdcBalance, fee);
      setQuote(freshQuote); setApprovalGasFee(undefined); setSwapGasFee(fee); setGasUnavailable(false); setReviewStage("swap");
      if (!cost.sufficientGasBalance) setError(vi ? "Không đủ USDC cho phí gas của giao dịch swap." : "Insufficient USDC for the swap network fee.");
    } catch (caught) {
      if (caught instanceof Error && caught.message === "arc") setError(vi ? "Cần kết nối Arc Testnet." : "Arc Testnet is required.");
      else if (caught instanceof Error && caught.message === "balance") setError(vi ? "Số dư vừa thay đổi và không còn đủ." : "Your balance changed and is no longer sufficient.");
      else { const kind = classifyWalletFailure(caught, false); setError(kind === "rejected" ? (vi ? "Bạn đã từ chối yêu cầu approve trong ví." : "You rejected the approval request.") : (vi ? "Không thể hoàn tất approve hoặc ước tính gas swap." : "Approval or post-approval swap gas estimation failed.")); }
    } finally { setPending(undefined); }
  }
  async function execute() {
    if (!connection.address || !client || !quote || !route || reviewStage !== "swap" || pending) return;
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
      const freshOutput = await client.readContract({ address: XYLO_ROUTER, abi: xyloRouterAbi, functionName: "getAmountOut", args: [from.address, to.address, quote.amountIn] }), request = buildXyloSwapRequest(quote, freshOutput, slippage, connection.address);
      setPending(vi ? "Đang chờ bạn xác nhận swap trong ví…" : "Waiting for swap confirmation in your wallet…"); const simulation = await client.simulateContract(request), hash = await writer.writeContractAsync(simulation.request); submitted = true;
      setPending(vi ? "Đã gửi. Đang chờ Arc xác nhận…" : "Submitted. Waiting for Arc confirmation…"); const receipt = await client.waitForTransactionReceipt({ hash }); if (receipt.status !== "success") throw new Error("revert"); const block = await client.getBlock({ blockNumber: receipt.blockNumber });
      await confirmThenRefresh({ receipt: Promise.resolve(receipt), onConfirmed: () => { const soldLog = receipt.logs.find((log) => log.address.toLowerCase() === from.address.toLowerCase()), receivedLog = receipt.logs.find((log) => log.address.toLowerCase() === to.address.toLowerCase()); recordWalletActivity(connection.address!, arcTestnet.id, createAssetActivity(from, { hash: receipt.transactionHash, logIndex: soldLog?.logIndex ?? -1, direction: "send", kind: "swap", amount: quote.amountIn, counterparty: XYLO_ROUTER, confirmedAt: Number(block.timestamp) * 1000, blockNumber: receipt.blockNumber, swapReceive: { amount: freshOutput, assetId: to.id, assetSymbol: to.symbol, tokenAddress: to.address, decimals: to.decimals, logIndex: receivedLog?.logIndex ?? 0 } })); setSuccess({ hash: receipt.transactionHash, quote, received: freshOutput }); setReviewStage(undefined); }, refresh: async () => { await Promise.all([balances.usdc.refetch(), balances.eurc.refetch()]); onConfirmed?.(); } });
    } catch (caught) {
      if (caught instanceof Error && caught.message === "arc") return setError(vi ? "Cần kết nối Arc Testnet." : "Arc Testnet is required."); if (caught instanceof Error && caught.message === "balance") return setError(vi ? "Số dư vừa thay đổi và không còn đủ." : "Your balance changed and is no longer sufficient.");
      const kind = classifyWalletFailure(caught, submitted); setError(({ rejected: vi ? "Bạn đã từ chối yêu cầu trong ví." : "You rejected the wallet request.", "wrong-network": vi ? "Ví không còn ở Arc Testnet." : "Your wallet is no longer on Arc Testnet.", "insufficient-gas": vi ? "Không đủ USDC để trả gas trên Arc." : "Not enough USDC to pay Arc gas.", reverted: vi ? "Giao dịch bị revert." : "The transaction reverted.", "confirmation-unknown": vi ? "Trạng thái chưa rõ. Kiểm tra ArcScan." : "Confirmation is unclear. Check ArcScan.", rpc: vi ? "Ví hoặc RPC gặp lỗi." : "The wallet or RPC failed." } as const)[kind]);
    } finally { setPending(undefined); }
  }
  if (success) { const sold = getAssetById(success.quote.fromAssetId)!, bought = getAssetById(success.quote.toAssetId)!; return <div className="transaction-state"><span>✓</span><h3>{vi ? "Hoán đổi thành công" : "Swap confirmed"}</h3><p>{formatAssetAmount(success.quote.amountIn, sold)} {sold.symbol} → ≈ {formatAssetAmount(success.received, bought)} {bought.symbol}</p><a href={`${ARC_EXPLORER_URL}/tx/${success.hash}`} target="_blank" rel="noreferrer">ArcScan ↗</a><button type="button" className="standalone-action" onClick={reset}>{vi ? "Hoán đổi tiếp" : "Swap again"}</button></div>; }
  if (reviewStage === "approval" && quote && route) return <TransactionSafetyReview title={vi ? "Approve token" : "Approve token"} summary={vi ? "Approve đúng số lượng trước; Makoto sẽ lấy báo giá mới và ước tính gas swap sau khi approval được xác nhận." : "Approve the exact amount first. Makoto will fetch a fresh quote and estimate swap gas after approval confirms."} details={[{ label: vi ? "Bán" : "From", value: `${formatAssetAmount(quote.amountIn, from)} ${from.symbol}` }, { label: vi ? "Tuyến đã chọn" : "Selected route", value: swapRouteLabel(route.provider) }, { label: vi ? "Phí mạng approval" : "Approval network fee", value: approvalGasFee === undefined ? (vi ? "Không khả dụng" : "Unavailable") : formatArcFeeEstimate(approvalGasFee) }, { label: vi ? "Phí mạng swap" : "Swap network fee", value: vi ? "Ước tính sau approval" : "Estimated after approval" }, { label: vi ? "Mạng" : "Network", value: "Arc Testnet · 5042002" }]} checks={[...globalReviewChecks({ connected: connection.isConnected, account: connection.address, reviewedAccount, isArc: chain.isArc, amount: quote.amountIn, balance }), { code: "quote", status: isSwapQuoteFresh(quote.quotedAt) ? "verified" : "blocking", label: isSwapQuoteFresh(quote.quotedAt) ? (vi ? "Báo giá còn hiệu lực" : "Quote is current") : (vi ? "Báo giá đã hết hạn" : "Quote expired") }, { code: "approval-gas", status: approvalGasCovered ? "verified" : "blocking", label: approvalGasFee === undefined ? (vi ? "Không thể ước tính phí approval" : "Approval gas estimate unavailable") : approvalGasCovered ? (vi ? "Số dư USDC đủ cho phí approval" : "USDC balance covers approval gas") : (vi ? "Không đủ USDC cho phí approval" : "Insufficient USDC for approval gas") }, { code: "swap-gas-later", status: "info", label: vi ? "Phí gas của giao dịch swap sẽ được ước tính sau khi token được approve." : "Swap gas will be estimated after token approval." }]} walletNotice={vi ? "Chỉ approval đúng số lượng được gửi ở bước này. Swap sẽ không tự động chạy." : "Only the exact approval is submitted at this step. The swap will not run automatically."} onBack={() => { setReviewStage(undefined); setQuote(undefined); }} onContinue={() => void approveThenReview()} continueLabel={vi ? "Approve token" : "Approve token"} continueDisabled={Boolean(pending) || !approvalGasCovered}>{pending && <p className="transaction-progress" role="status">{pending}</p>}{error && <p className="field-error" role="alert">{error}</p>}</TransactionSafetyReview>;
  if (reviewStage === "swap" && quote && route) return <TransactionSafetyReview title={vi ? "Kiểm tra hoán đổi" : "Review Swap"} summary={vi ? "Kiểm tra báo giá mới, tuyến đã chọn, phí swap và mức tối thiểu trước khi ký." : "Review the fresh quote, selected route, swap fee, and guaranteed minimum before signing."} details={[{ label: vi ? "Bán" : "From", value: `${formatAssetAmount(quote.amountIn, from)} ${from.symbol}` }, { label: vi ? "Ước tính nhận" : "Current quote", value: `≈ ${formatAssetAmount(quote.amountOut, to)} ${to.symbol}` }, { label: vi ? "Tối thiểu nhận" : "Minimum received", value: `${formatAssetAmount(minimumSwapOutput(quote.amountOut, slippage), to)} ${to.symbol}` }, { label: vi ? "Tuyến đã chọn" : "Selected route", value: swapRouteLabel(route.provider) }, { label: vi ? "Phí mạng swap" : "Swap network fee", value: swapGasFee === undefined ? (vi ? "Không khả dụng" : "Unavailable") : formatArcFeeEstimate(swapGasFee) }, { label: "Slippage", value: `${(slippage * 100).toFixed(1)}%` }, { label: vi ? "Mạng" : "Network", value: "Arc Testnet · 5042002" }]} checks={[...globalReviewChecks({ connected: connection.isConnected, account: connection.address, reviewedAccount, isArc: chain.isArc, amount: quote.amountIn, balance }), { code: "quote", status: isSwapQuoteFresh(quote.quotedAt) ? "verified" : "blocking", label: isSwapQuoteFresh(quote.quotedAt) ? (vi ? "Báo giá còn hiệu lực" : "Quote is current") : (vi ? "Báo giá đã hết hạn" : "Quote expired") }, { code: "gas", status: gasUnavailable || !gasCost?.sufficientGasBalance ? "blocking" : "verified", label: gasUnavailable ? (vi ? "Không thể ước tính phí swap an toàn" : "Safe swap gas estimate unavailable") : gasCost?.sufficientGasBalance ? (vi ? "Số dư USDC đủ cho phí swap" : "USDC balance covers swap gas") : (vi ? "Không đủ USDC cho số tiền và phí swap" : "Insufficient USDC for amount and swap gas") }, { code: "approval", status: "verified", label: vi ? "Allowance đã đủ" : "Allowance is sufficient" }]} walletNotice={vi ? "Approval đã hoàn tất. Swap chỉ được gửi sau xác nhận riêng này." : "Approval is complete. The swap is submitted only after this separate confirmation."} onBack={() => { setReviewStage(undefined); setQuote(undefined); }} onContinue={() => void execute()} continueDisabled={Boolean(pending) || gasUnavailable || !gasCost?.sufficientGasBalance}>{pending && <p className="transaction-progress" role="status">{pending}</p>}{error && <p className="field-error" role="alert">{error}</p>}<details><summary>{vi ? "So sánh tuyến nâng cao" : "Advanced route comparison"}</summary><p>XyloNet StableSwap · {vi ? "khả dụng trong ví" : "wallet-executable"}</p><p>Circle App Kit Swap · {vi ? "không khả dụng trên trình duyệt: cần Kit Key bí mật phía máy chủ" : CIRCLE_BROWSER_SWAP_STATUS.reason}</p></details></TransactionSafetyReview>;
  return <form className="create-form wallet-flow" onSubmit={(event) => { event.preventDefault(); void review(); }}><fieldset><legend>{vi ? "Chế độ định tuyến" : "Routing mode"}</legend><label><input type="radio" checked={mode === "smart"} onChange={() => { setMode("smart"); invalidate(); }} /> Smart</label><label><input type="radio" checked={mode === "xylonet"} onChange={() => { setMode("xylonet"); invalidate(); }} /> XyloNet</label></fieldset><label>{vi ? "Tài sản bán" : "Sell asset"}<select className="asset-selector" value={fromId} onChange={(event) => { setFromId(event.target.value as SupportedAssetId); reset(); }}>{SUPPORTED_ASSETS.map((asset) => <option key={asset.id} value={asset.id}>{asset.symbol} · {asset.name}</option>)}</select></label><label>{vi ? "Tài sản nhận" : "Buy asset"}<select className="asset-selector" value={to.id} disabled><option>{to.symbol} · {to.name}</option></select></label><label>{vi ? "Số lượng" : "Amount"}<div className="wallet-field-with-action amount"><input inputMode="decimal" value={amount} onChange={(event) => changeAmount(event.target.value)} placeholder="0.00"/><span>{from.symbol}</span></div><small>{vi ? "Khả dụng" : "Available"}: {formatAssetAmount(balance, from)} {from.symbol}</small></label><div className="swap-quick-amounts" aria-label={vi ? "Chọn nhanh số lượng" : "Quick amount selection"}>{([25, 50, 75, 100] as const).map((percent) => <button key={percent} type="button" onClick={() => void chooseQuickAmount(percent)} disabled={balance <= 0n || Boolean(pending)}>{percent === 100 ? "MAX" : `${percent}%`}</button>)}</div>{quickFeedback && <p className="swap-quick-feedback" role="status">{quickFeedback}</p>}{safeMax && <p className="swap-quick-feedback" role="status">{vi ? "Đã chừa cho phí gas Arc" : "Reserved for Arc gas"}: {formatAssetAmount(arcFeeToUsdcAtomic(safeMax.fee), getAssetById("usdc")!)} USDC</p>}<label>Slippage<select className="asset-selector" value={slippage} onChange={(event) => { setSlippage(Number(event.target.value) as (typeof SWAP_SLIPPAGE_OPTIONS)[number]); invalidate(); }}>{SWAP_SLIPPAGE_OPTIONS.map((value) => <option key={value} value={value}>{(value * 100).toFixed(1)}%</option>)}</select></label><p className="wallet-notice">{mode === "smart" ? (vi ? "Smart chọn trong các tuyến thực thi an toàn; hiện tại tuyến được chọn là XyloNet." : "Smart selects among safely executable routes; XyloNet is currently the selected route.") : (vi ? "Chỉ dùng tuyến XyloNet trực tiếp trên Arc." : "Use only the direct XyloNet route on Arc.")}</p><details><summary>{vi ? "Nhà cung cấp nâng cao" : "Advanced providers"}</summary><p>Circle App Kit Swap · {vi ? "không khả dụng trong trình duyệt vì Kit Key phải giữ bí mật phía máy chủ" : CIRCLE_BROWSER_SWAP_STATUS.reason}</p></details>{pending && <p className="transaction-progress" role="status">{pending}</p>}{error && <p className="field-error" role="alert">{error}</p>}{!chain.isArc && <p className="field-error">{vi ? "Cần kết nối Arc Testnet." : "Arc Testnet is required."}</p>}<div className="modal-actions"><button type="submit" className="primary-action" disabled={Boolean(pending) || !chain.isArc}>{vi ? "Lấy báo giá" : "Get quote"}</button></div></form>;
}
