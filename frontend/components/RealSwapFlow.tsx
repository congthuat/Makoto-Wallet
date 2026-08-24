"use client";

import { useEffect, useState } from "react";
import type { Hex } from "viem";
import { arcTestnet } from "viem/chains";
import { useConnection, usePublicClient, useWriteContract } from "wagmi";
import { useVerifiedWalletChain } from "@/hooks/useVerifiedWalletChain";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { erc20BalanceAbi } from "@/lib/abi/erc20";
import { calculateArcFee, formatArcFeeEstimate, maxUsdcSwapAfterArcFee, swapCostWithArcFee } from "@/lib/arcFees";
import { formatAssetAmount, getAssetById, parseAssetAmount, SUPPORTED_ASSETS, type SupportedAssetId } from "@/lib/assets";
import { ARC_EXPLORER_URL } from "@/lib/config";
import { confirmThenRefresh } from "@/lib/confirmedTransaction";
import { buildXyloSwapRequest, createXyloQuote, exactApprovalRequired, isSwapQuoteFresh, minimumSwapOutput, oppositeAssetId, swapAmountForPercent, SWAP_QUOTE_MAX_AGE_MS, SWAP_SLIPPAGE_OPTIONS, XYLO_ROUTER, xyloRouterAbi, type SwapQuickPercent, type SwapQuote } from "@/lib/swap";
import { CIRCLE_BROWSER_SWAP_STATUS, selectRouteForMode, swapRouteLabel, type SwapMode } from "@/lib/swapRouter";
import { globalReviewChecks } from "@/lib/transactionReview";
import { classifyWalletFailure } from "@/lib/walletSafety";
import { createAssetActivity, recordWalletActivity } from "@/lib/walletActivity";
import { TransactionSafetyReview } from "./TransactionSafetyReview";

type Props = { locale: "en" | "vi"; onBusyChange(busy: boolean): void; onConfirmed?(): void };

export function RealSwapFlow({ locale, onBusyChange, onConfirmed }: Props) {
  const vi = locale === "vi", connection = useConnection(), chain = useVerifiedWalletChain();
  const client = usePublicClient({ chainId: arcTestnet.id }), writer = useWriteContract(), balances = useWalletBalances(connection.address, chain.isArc);
  const [fromId, setFromId] = useState<SupportedAssetId>("usdc"), [mode, setMode] = useState<SwapMode>("smart"), [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState<(typeof SWAP_SLIPPAGE_OPTIONS)[number]>(0.005), [quote, setQuote] = useState<SwapQuote>(), [gasFee, setGasFee] = useState<bigint>();
  const [gasUnavailable, setGasUnavailable] = useState(false), [reviewing, setReviewing] = useState(false), [pending, setPending] = useState<string>(), [error, setError] = useState<string>(), [quickFeedback, setQuickFeedback] = useState<string>();
  const [reviewedAccount, setReviewedAccount] = useState<`0x${string}`>(), [approvalRequired, setApprovalRequired] = useState(false), [success, setSuccess] = useState<{ hash: Hex; quote: SwapQuote; received: bigint }>();
  useEffect(() => onBusyChange(Boolean(pending)), [onBusyChange, pending]);
  const from = getAssetById(fromId)!, to = getAssetById(oppositeAssetId(fromId))!, balance = balances.assets[fromId].data ?? 0n, usdcBalance = balances.assets.usdc.data ?? 0n, parsed = parseAssetAmount(amount, from);
  const route = quote ? selectRouteForMode(mode, [{ provider: "xylonet", output: quote.amountOut, fee: gasFee ?? 0n, quotedAt: quote.quotedAt, expiresAt: quote.quotedAt + SWAP_QUOTE_MAX_AGE_MS, available: true }], quote.quotedAt) : undefined;
  const gasCost = quote && gasFee !== undefined ? swapCostWithArcFee(quote.amountIn, from.id, usdcBalance, gasFee) : undefined;

  function invalidate() { setQuote(undefined); setReviewing(false); setError(undefined); setQuickFeedback(undefined); setGasFee(undefined); setGasUnavailable(false); }
  function changeAmount(value: string) { setAmount(value); invalidate(); }
  function reset() { setAmount(""); invalidate(); setSuccess(undefined); }
  async function estimateSwapFee(candidate: SwapQuote, needsApproval: boolean) {
    if (!client || !connection.address) return undefined;
    const swapGas = await client.estimateContractGas(buildXyloSwapRequest(candidate, candidate.amountOut, slippage, connection.address));
    const approvalGas = needsApproval ? await client.estimateContractGas({ address: from.address, abi: erc20BalanceAbi, functionName: "approve", args: [XYLO_ROUTER, candidate.amountIn], account: connection.address }) : 0n;
    const fees = await client.estimateFeesPerGas();
    return calculateArcFee(swapGas + approvalGas, fees.maxFeePerGas ?? await client.getGasPrice()).rawFee;
  }
  async function chooseQuickAmount(percent: SwapQuickPercent) {
    let selected = swapAmountForPercent(balance, percent);
    if (percent === 100 && from.id === "usdc" && selected > 0n && client && connection.address && await chain.verifyNow()) {
      setPending(vi ? "Đang tính mức MAX an toàn…" : "Calculating safe MAX…");
      try {
        const [output, allowance] = await Promise.all([client.readContract({ address: XYLO_ROUTER, abi: xyloRouterAbi, functionName: "getAmountOut", args: [from.address, to.address, selected] }), client.readContract({ address: from.address, abi: erc20BalanceAbi, functionName: "allowance", args: [connection.address, XYLO_ROUTER] })]);
        const fee = await estimateSwapFee(createXyloQuote(from.id, to.id, selected, output), allowance < selected), maximum = fee === undefined ? undefined : maxUsdcSwapAfterArcFee(balance, fee);
        if (maximum === undefined) return setError(vi ? "Không thể tính MAX an toàn vì chưa ước tính được phí Arc." : "A safe MAX cannot be calculated because the Arc fee is unavailable.");
        selected = maximum;
      } catch { return setError(vi ? "Không thể tính MAX an toàn vì chưa ước tính được phí Arc." : "A safe MAX cannot be calculated because the Arc fee is unavailable."); }
      finally { setPending(undefined); }
    }
    changeAmount(selected > 0n ? formatAssetAmount(selected, from) : "");
    if (selected === 0n) setQuickFeedback(vi ? "Số dư quá nhỏ cho tỷ lệ này." : "Balance too small for this percentage.");
  }
  async function review() {
    if (!connection.address || !client || !parsed) return setError(vi ? "Nhập số tiền hợp lệ." : "Enter a valid amount.");
    if (parsed > balance) return setError(vi ? "Số dư không đủ." : "Insufficient balance.");
    setPending(vi ? "Đang lấy báo giá trực tiếp từ XyloNet…" : "Loading a live XyloNet quote…"); setError(undefined); setQuote(undefined); setGasFee(undefined); setGasUnavailable(false);
    try {
      if (!(await chain.verifyNow())) throw new Error("arc");
      const [output, allowance] = await Promise.all([client.readContract({ address: XYLO_ROUTER, abi: xyloRouterAbi, functionName: "getAmountOut", args: [from.address, to.address, parsed] }), client.readContract({ address: from.address, abi: erc20BalanceAbi, functionName: "allowance", args: [connection.address, XYLO_ROUTER] })]);
      const nextQuote = createXyloQuote(from.id, to.id, parsed, output), needsApproval = allowance < parsed;
      setQuote(nextQuote); setApprovalRequired(needsApproval); try { setGasFee(await estimateSwapFee(nextQuote, needsApproval)); } catch { setGasUnavailable(true); }
      setReviewedAccount(connection.address); setReviewing(true);
    } catch (caught) { setError(caught instanceof Error && caught.message === "arc" ? (vi ? "Cần kết nối Arc Testnet." : "Arc Testnet is required.") : (vi ? "Không lấy được báo giá XyloNet." : "Could not load a XyloNet quote.")); }
    finally { setPending(undefined); }
  }
  async function execute() {
    if (!connection.address || !client || !quote || !route || pending) return;
    if (!reviewedAccount || connection.address.toLowerCase() !== reviewedAccount.toLowerCase()) { setReviewing(false); return setError(vi ? "Chi tiết giao dịch đã thay đổi. Vui lòng kiểm tra lại." : "Transaction details changed. Please review again."); }
    if (!isSwapQuoteFresh(quote.quotedAt)) { setQuote(undefined); setReviewing(false); return setError(vi ? "Báo giá đã hết hạn." : "Quote expired. Get a fresh quote."); }
    if (gasUnavailable || !gasCost?.sufficientGasBalance) return setError(vi ? "Không đủ số dư USDC đã tính cả phí Arc, hoặc chưa thể ước tính phí an toàn." : "USDC balance including Arc gas is insufficient, or a safe fee estimate is unavailable.");
    let submitted = false; setError(undefined);
    try {
      if (!(await chain.verifyNow())) throw new Error("arc");
      let freshBalance = await client.readContract({ address: from.address, abi: erc20BalanceAbi, functionName: "balanceOf", args: [connection.address] }); if (quote.amountIn > freshBalance) throw new Error("balance");
      const allowance = await client.readContract({ address: from.address, abi: erc20BalanceAbi, functionName: "allowance", args: [connection.address, XYLO_ROUTER] }), approval = exactApprovalRequired(allowance, quote.amountIn);
      if (approval) { setPending(vi ? "Đang chờ approve đúng số lượng trong ví…" : "Waiting for exact token approval…"); await client.simulateContract({ address: from.address, abi: erc20BalanceAbi, functionName: "approve", args: [XYLO_ROUTER, approval], account: connection.address }); const approvalHash = await writer.writeContractAsync({ address: from.address, abi: erc20BalanceAbi, functionName: "approve", args: [XYLO_ROUTER, approval], account: connection.address, chainId: arcTestnet.id }); if ((await client.waitForTransactionReceipt({ hash: approvalHash })).status !== "success") throw new Error("approve"); }
      if (!isSwapQuoteFresh(quote.quotedAt)) { setQuote(undefined); setReviewing(false); return setError(vi ? "Approve xong nhưng báo giá đã hết hạn. Không gửi swap." : "Approval succeeded, but the quote expired. No swap was sent."); }
      if (!(await chain.verifyNow())) throw new Error("arc"); freshBalance = await client.readContract({ address: from.address, abi: erc20BalanceAbi, functionName: "balanceOf", args: [connection.address] }); if (quote.amountIn > freshBalance) throw new Error("balance");
      const freshOutput = await client.readContract({ address: XYLO_ROUTER, abi: xyloRouterAbi, functionName: "getAmountOut", args: [from.address, to.address, quote.amountIn] }), request = buildXyloSwapRequest(quote, freshOutput, slippage, connection.address);
      setPending(vi ? "Đang chờ bạn xác nhận swap trong ví…" : "Waiting for swap confirmation in your wallet…"); const simulation = await client.simulateContract(request), hash = await writer.writeContractAsync(simulation.request); submitted = true;
      setPending(vi ? "Đã gửi. Đang chờ Arc xác nhận…" : "Submitted. Waiting for Arc confirmation…"); const receipt = await client.waitForTransactionReceipt({ hash }); if (receipt.status !== "success") throw new Error("revert"); const block = await client.getBlock({ blockNumber: receipt.blockNumber });
      await confirmThenRefresh({ receipt: Promise.resolve(receipt), onConfirmed: () => { const soldLog = receipt.logs.find((log) => log.address.toLowerCase() === from.address.toLowerCase()), receivedLog = receipt.logs.find((log) => log.address.toLowerCase() === to.address.toLowerCase()); recordWalletActivity(connection.address!, arcTestnet.id, createAssetActivity(from, { hash: receipt.transactionHash, logIndex: soldLog?.logIndex ?? -1, direction: "send", kind: "swap", amount: quote.amountIn, counterparty: XYLO_ROUTER, confirmedAt: Number(block.timestamp) * 1000, blockNumber: receipt.blockNumber, swapReceive: { amount: freshOutput, assetId: to.id, assetSymbol: to.symbol, tokenAddress: to.address, decimals: to.decimals, logIndex: receivedLog?.logIndex ?? 0 } })); setSuccess({ hash: receipt.transactionHash, quote, received: freshOutput }); setReviewing(false); }, refresh: async () => { await Promise.all([balances.usdc.refetch(), balances.eurc.refetch()]); onConfirmed?.(); } });
    } catch (caught) {
      if (caught instanceof Error && caught.message === "arc") return setError(vi ? "Cần kết nối Arc Testnet." : "Arc Testnet is required."); if (caught instanceof Error && caught.message === "balance") return setError(vi ? "Số dư vừa thay đổi và không còn đủ." : "Your balance changed and is no longer sufficient.");
      const kind = classifyWalletFailure(caught, submitted); setError(({ rejected: vi ? "Bạn đã từ chối yêu cầu trong ví." : "You rejected the wallet request.", "wrong-network": vi ? "Ví không còn ở Arc Testnet." : "Your wallet is no longer on Arc Testnet.", "insufficient-gas": vi ? "Không đủ USDC để trả gas trên Arc." : "Not enough USDC to pay Arc gas.", reverted: vi ? "Giao dịch bị revert." : "The transaction reverted.", "confirmation-unknown": vi ? "Trạng thái chưa rõ. Kiểm tra ArcScan." : "Confirmation is unclear. Check ArcScan.", rpc: vi ? "Ví hoặc RPC gặp lỗi." : "The wallet or RPC failed." } as const)[kind]);
    } finally { setPending(undefined); }
  }
  if (success) { const sold = getAssetById(success.quote.fromAssetId)!, bought = getAssetById(success.quote.toAssetId)!; return <div className="transaction-state"><span>✓</span><h3>{vi ? "Hoán đổi thành công" : "Swap confirmed"}</h3><p>{formatAssetAmount(success.quote.amountIn, sold)} {sold.symbol} → ≈ {formatAssetAmount(success.received, bought)} {bought.symbol}</p><a href={`${ARC_EXPLORER_URL}/tx/${success.hash}`} target="_blank" rel="noreferrer">ArcScan ↗</a><button type="button" className="standalone-action" onClick={reset}>{vi ? "Hoán đổi tiếp" : "Swap again"}</button></div>; }
  if (reviewing && quote && route) return <TransactionSafetyReview title={vi ? "Kiểm tra hoán đổi" : "Review Swap"} summary={vi ? "Kiểm tra tuyến đã chọn, phí và mức tối thiểu trước khi ký." : "Review the selected route, fee, and guaranteed minimum before signing."} details={[{ label: vi ? "Bán" : "From", value: `${formatAssetAmount(quote.amountIn, from)} ${from.symbol}` }, { label: vi ? "Ước tính nhận" : "Current quote", value: `≈ ${formatAssetAmount(quote.amountOut, to)} ${to.symbol}` }, { label: vi ? "Tối thiểu nhận" : "Minimum received", value: `${formatAssetAmount(minimumSwapOutput(quote.amountOut, slippage), to)} ${to.symbol}` }, { label: vi ? "Tuyến đã chọn" : "Selected route", value: swapRouteLabel(route.provider) }, { label: vi ? "Phí Arc ước tính" : "Estimated Arc gas", value: gasFee === undefined ? (vi ? "Không khả dụng" : "Unavailable") : formatArcFeeEstimate(gasFee) }, { label: "Slippage", value: `${(slippage * 100).toFixed(1)}%` }, { label: vi ? "Mạng" : "Network", value: "Arc Testnet · 5042002" }]} checks={[...globalReviewChecks({ connected: connection.isConnected, account: connection.address, reviewedAccount, isArc: chain.isArc, amount: quote.amountIn, balance }), { code: "quote", status: isSwapQuoteFresh(quote.quotedAt) ? "verified" : "blocking", label: isSwapQuoteFresh(quote.quotedAt) ? (vi ? "Báo giá còn hiệu lực" : "Quote is current") : (vi ? "Báo giá đã hết hạn" : "Quote expired") }, { code: "gas", status: gasUnavailable || !gasCost?.sufficientGasBalance ? "blocking" : "verified", label: gasUnavailable ? (vi ? "Không thể ước tính phí Arc an toàn" : "Safe Arc gas estimate unavailable") : gasCost?.sufficientGasBalance ? (vi ? "Số dư USDC đủ cho phí Arc ước tính" : "USDC balance covers estimated Arc gas") : (vi ? "Không đủ USDC cho số tiền và phí Arc" : "Insufficient USDC for amount and Arc gas") }, { code: "approval", status: "info", label: approvalRequired ? (vi ? "Có thể cần approve đúng số lượng, sau đó swap" : "Exact approval may be required before swap") : (vi ? "Allowance hiện tại đủ" : "Current allowance is sufficient") }]} walletNotice={vi ? "Ví của bạn thực hiện phê duyệt cuối cùng. Báo giá được tải lại trước khi swap." : "Your wallet performs final approval. The quote is refreshed before swap."} onBack={() => { setReviewing(false); setQuote(undefined); }} onContinue={() => void execute()} continueDisabled={Boolean(pending) || gasUnavailable || !gasCost?.sufficientGasBalance}>{pending && <p className="transaction-progress" role="status">{pending}</p>}{error && <p className="field-error" role="alert">{error}</p>}<details><summary>{vi ? "So sánh tuyến nâng cao" : "Advanced route comparison"}</summary><p>XyloNet StableSwap · {vi ? "khả dụng trong ví" : "wallet-executable"}</p><p>Circle App Kit Swap · {vi ? "không khả dụng trên trình duyệt: cần Kit Key bí mật phía máy chủ" : CIRCLE_BROWSER_SWAP_STATUS.reason}</p></details></TransactionSafetyReview>;
  return <form className="create-form wallet-flow" onSubmit={(event) => { event.preventDefault(); void review(); }}><fieldset><legend>{vi ? "Chế độ định tuyến" : "Routing mode"}</legend><label><input type="radio" checked={mode === "smart"} onChange={() => { setMode("smart"); invalidate(); }} /> Smart</label><label><input type="radio" checked={mode === "xylonet"} onChange={() => { setMode("xylonet"); invalidate(); }} /> XyloNet</label></fieldset><label>{vi ? "Tài sản bán" : "Sell asset"}<select className="asset-selector" value={fromId} onChange={(event) => { setFromId(event.target.value as SupportedAssetId); reset(); }}>{SUPPORTED_ASSETS.map((asset) => <option key={asset.id} value={asset.id}>{asset.symbol} · {asset.name}</option>)}</select></label><label>{vi ? "Tài sản nhận" : "Buy asset"}<select className="asset-selector" value={to.id} disabled><option>{to.symbol} · {to.name}</option></select></label><label>{vi ? "Số lượng" : "Amount"}<div className="wallet-field-with-action amount"><input inputMode="decimal" value={amount} onChange={(event) => changeAmount(event.target.value)} placeholder="0.00"/><span>{from.symbol}</span></div><small>{vi ? "Khả dụng" : "Available"}: {formatAssetAmount(balance, from)} {from.symbol}</small></label><div className="swap-quick-amounts" aria-label={vi ? "Chọn nhanh số lượng" : "Quick amount selection"}>{([25, 50, 75, 100] as const).map((percent) => <button key={percent} type="button" onClick={() => void chooseQuickAmount(percent)} disabled={balance <= 0n || Boolean(pending)}>{percent === 100 ? "MAX" : `${percent}%`}</button>)}</div>{quickFeedback && <p className="swap-quick-feedback" role="status">{quickFeedback}</p>}<label>Slippage<select className="asset-selector" value={slippage} onChange={(event) => { setSlippage(Number(event.target.value) as (typeof SWAP_SLIPPAGE_OPTIONS)[number]); invalidate(); }}>{SWAP_SLIPPAGE_OPTIONS.map((value) => <option key={value} value={value}>{(value * 100).toFixed(1)}%</option>)}</select></label><p className="wallet-notice">{mode === "smart" ? (vi ? "Smart chọn trong các tuyến thực thi an toàn; hiện tại tuyến được chọn là XyloNet." : "Smart selects among safely executable routes; XyloNet is currently the selected route.") : (vi ? "Chỉ dùng tuyến XyloNet trực tiếp trên Arc." : "Use only the direct XyloNet route on Arc.")}</p><details><summary>{vi ? "Nhà cung cấp nâng cao" : "Advanced providers"}</summary><p>Circle App Kit Swap · {vi ? "không khả dụng trong trình duyệt vì Kit Key phải giữ bí mật phía máy chủ" : CIRCLE_BROWSER_SWAP_STATUS.reason}</p></details>{pending && <p className="transaction-progress" role="status">{pending}</p>}{error && <p className="field-error" role="alert">{error}</p>}{!chain.isArc && <p className="field-error">{vi ? "Cần kết nối Arc Testnet." : "Arc Testnet is required."}</p>}<div className="modal-actions"><button type="submit" className="primary-action" disabled={Boolean(pending) || !chain.isArc}>{vi ? "Lấy báo giá" : "Get quote"}</button></div></form>;
}
