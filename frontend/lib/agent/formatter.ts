import { formatUnits } from "viem";
import { arcTestnet } from "viem/chains";
import { translate, type TranslationKey } from "../../i18n/index.ts";
import type { WalletActivity } from "../wallet.ts";
import type { AgentContextSnapshot, AgentIntent, AgentResponse, AgentToolResult } from "./types.ts";
import { blockingExplanation, formatPlanningAmount, type AgentPlanningResult } from "./planning.ts";
import { createAgentActionDraft, type AgentOrchestrationDecision } from "./orchestration.ts";
import type { AgentCapabilityOutput, AgentOutcomeCategory } from "./tools.ts";

export function formatAgentResponse(snapshot: AgentContextSnapshot, intent: AgentIntent, decision: AgentOrchestrationDecision, output: AgentCapabilityOutput): AgentResponse {
  const vi = intent.locale === "vi";
  const { result, planning, category } = output;
  if (output.intelligence) return { intent, result, intelligence: output.intelligence, text: intelligenceText(output.intelligence, intent.locale) };
  if (decision.mode === "preparation") {
    const actionDraft = !category ? createAgentActionDraft(intent, planning) : undefined;
    if (actionDraft) return { intent, result, planning, actionDraft, text: translate(intent.locale, "agent.response.draftReady") };
    return { intent, result, planning, text: outcomeText(category ?? "PLANNING_FAILED", vi) };
  }
  if (decision.mode === "clarification") return { intent, text: clarificationText(intent, decision) };
  if (intent.kind === "clarification") return { intent, text: clarificationText(intent, decision) };
  if (intent.kind === "unknown") return { intent, text: vi ? "Mình có thể xem số dư, mạng, hoạt động gần đây, Makoto Vault, giải thích giao dịch và các biện pháp an toàn. Mình cũng có thể chuẩn bị hành động an toàn; bạn luôn kiểm tra và xác nhận trong ví." : "I can show balances, network status, recent activity, Makoto Vault, transaction explanations, and safety capabilities. I can also prepare safe actions; you always review and confirm them in your wallet." };
  if (isPlanningIntent(intent.kind)) return formatPlanningResponse(intent, result, vi);
  if (!result?.ok) return { intent, result, text: localUnavailable(result?.unavailable, vi) };
  if (intent.kind === "wallet-overview") { const b = snapshot.balances; return { intent, result, text: vi ? `Số dư Arc Testnet — USDC: ${amount(b.usdc, intent.locale)}; EURC: ${amount(b.eurc, intent.locale)}.` : `Arc Testnet balances — USDC: ${amount(b.usdc, intent.locale)}; EURC: ${amount(b.eurc, intent.locale)}.` }; }
  if (intent.kind === "network-status") return { intent, result, text: networkText(snapshot, vi) };
  if (intent.kind === "vault-summary") return { intent, result, text: vi ? `Makoto Vault: ${amount(snapshot.vault.total, intent.locale)} USDC trong ${snapshot.vault.goalCount ?? "không khả dụng"} mục tiêu; ${snapshot.vault.activeCount ?? "không khả dụng"} đang hoạt động.` : `Makoto Vault: ${amount(snapshot.vault.total, intent.locale)} USDC across ${snapshot.vault.goalCount ?? "unavailable"} goals; ${snapshot.vault.activeCount ?? "unavailable"} active.` };
  if (intent.kind === "safety-capabilities") { const labels = snapshot.safetyCapabilities.map((capability) => safetyCapabilityLabel(capability, intent.locale)); return { intent, result, text: vi ? `Makoto hỗ trợ: ${labels.join(", ")}. Các biện pháp này không phải kiểm toán và không đảm bảo không có rủi ro.` : `Makoto supports: ${labels.join(", ")}. These protections are not an audit and do not guarantee zero risk.` }; }
  if (intent.kind === "activity-explanation") return { intent, result, text: explain(result.data as WalletActivity, vi) };
  const items = result.data as WalletActivity[]; const prefix = result.partial ? (vi ? "Lịch sử đang hiển thị một phần. " : "Activity history is partial. ") : "";
  return { intent, result, text: prefix + (items.length ? items.map((item) => explain(item, vi)).join("\n") : (vi ? "Không có hoạt động phù hợp trong lịch sử đã tải." : "No matching activity exists in the loaded history.")) };
}

function intelligenceText(value: NonNullable<AgentResponse["intelligence"]>, locale: AgentIntent["locale"]) {
  const vi = locale === "vi";
  if (value.limitations.includes("ARC_DATED_UPDATES_SOURCE_NOT_CONFIGURED")) return translate(locale, "agent.intelligence.arcRecentUnsupported");
  if (value.limitations.includes("ARC_TOPIC_NOT_FOUND")) return translate(locale, "agent.intelligence.arcTopicNotFound");
  if (value.status === "SOURCE_ERROR") return translate(locale, "agent.intelligence.sourceError", { publisher: value.sources[0]?.publisher ?? translate(locale, "agent.intelligence.officialSource") });
  if (value.facts.some((fact) => fact.label.startsWith("cctp"))) {
    const details = [
      value.facts.some((fact) => fact.label === "cctpSupportedChains") ? translate(locale, "agent.intelligence.cctpSupportedChains") : undefined,
      value.facts.some((fact) => fact.label === "cctpFees") ? translate(locale, "agent.intelligence.cctpFees") : undefined,
      value.facts.some((fact) => fact.label === "cctpTransferModes") ? translate(locale, "agent.intelligence.cctpTransferModes") : undefined,
      value.facts.some((fact) => fact.label === "cctpForwarding") ? translate(locale, "agent.intelligence.cctpForwarding") : undefined,
    ].filter(Boolean).join(", ");
    const purpose = value.facts.some((fact) => fact.label === "cctpPurpose") ? translate(locale, "agent.intelligence.cctpPurpose") : "";
    return `${purpose}${details ? `${purpose ? " " : ""}${translate(locale, "agent.intelligence.cctpAlso", { details })}` : ""}`;
  }
  if (value.facts.some((fact) => fact.label === "arcBridging")) return translate(locale, "agent.intelligence.arcBridging");
  const addressClassificationUnavailable = value.facts.some((fact) => fact.label === "addressType" && fact.value === "UNKNOWN") && value.limitations.includes("CODE_UNAVAILABLE");
  const facts = value.facts.map((fact) => {
    if (fact.label === "addressType" && addressClassificationUnavailable) return translate(locale, "agent.intelligence.addressTypeUnavailable");
    if (fact.label === "addressType") return vi ? `Loại địa chỉ: ${fact.value === "CONTRACT" ? "hợp đồng" : fact.value === "EOA" ? "ví bên ngoài" : "chưa xác định"}.` : `Address type: ${fact.value === "CONTRACT" ? "contract" : fact.value === "EOA" ? "externally owned account" : "unknown"}.`;
    if (fact.label === "activity") { const [incoming, outgoing, total] = fact.value.split(":"); return vi ? `Hoạt động đã tải: ${total}; nhận ${incoming}, gửi ${outgoing}.` : `Loaded activity: ${total}; ${incoming} incoming and ${outgoing} outgoing.`; }
    if (fact.label === "providerStatus") return vi ? `Trạng thái chính thức: ${fact.value}.` : `Official status: ${fact.value}.`;
    if (fact.label === "officialSummary") return fact.value;
    const labels: Record<string, [string, string]> = { chain: ["Mạng", "Chain"], address: ["Địa chỉ", "Address"], balance: ["Số dư", "Balance"], counterparties: ["Đối tác gần đây", "Recent counterparties"], tokenName: ["Tên token", "Token name"], tokenSymbol: ["Ký hiệu", "Symbol"], tokenDecimals: ["Số thập phân", "Decimals"], tokenSupply: ["Tổng cung thô", "Raw total supply"], allowance: ["Allowance thô", "Raw allowance"], protocol: ["Danh tính đã xác minh", "Verified identity"] };
    return `${labels[fact.label]?.[vi ? 0 : 1] ?? fact.label}: ${fact.value}.`;
  });
  const prefix = addressClassificationUnavailable ? translate(locale, "agent.intelligence.addressPartial") : value.status === "PARTIAL" ? (vi ? "Kết quả một phần." : "Partial result.") : value.status === "AVAILABLE" ? (vi ? "Đã xác minh dữ liệu hiện có." : "Available evidence verified.") : (vi ? "Không thể xác minh đầy đủ." : "Could not fully verify this result.");
  const addressLimitation = addressClassificationUnavailable ? translate(locale, "agent.intelligence.addressBytecodeUnavailable") : undefined;
  const statusBoundary = value.limitations.includes("STATUS_NOT_ROUTE_TRUTH") ? translate(locale, "agent.intelligence.statusNotRouteTruth") : undefined;
  return [prefix, ...facts, addressLimitation, statusBoundary].filter(Boolean).join("\n");
}

function outcomeText(category: AgentOutcomeCategory, vi: boolean) {
  const keys: Record<AgentOutcomeCategory, TranslationKey> = {
    NEEDS_CLARIFICATION: "agent.outcome.NEEDS_CLARIFICATION", WALLET_NOT_CONNECTED: "agent.outcome.WALLET_NOT_CONNECTED",
    WRONG_NETWORK: "agent.outcome.WRONG_NETWORK", INSUFFICIENT_BALANCE: "agent.outcome.INSUFFICIENT_BALANCE",
    QUOTE_UNAVAILABLE: "agent.outcome.QUOTE_UNAVAILABLE", ROUTE_UNAVAILABLE: "agent.outcome.ROUTE_UNAVAILABLE",
    PROVIDER_UNAVAILABLE: "agent.outcome.PROVIDER_UNAVAILABLE", STALE_DATA: "agent.outcome.STALE_DATA",
    PLANNING_FAILED: "agent.outcome.PLANNING_FAILED",
  };
  return translate(vi ? "vi" : "en", keys[category]);
}

function formatPlanningResponse(intent: AgentIntent, result: AgentToolResult | undefined, vi: boolean): AgentResponse {
  const planning = result?.data as AgentPlanningResult | undefined;
  if (!planning) return { intent, result, text: vi ? "Dữ liệu lập kế hoạch hiện không khả dụng. Chưa có giao dịch nào được chuẩn bị." : "Planning data is unavailable. No transaction has been prepared." };
  const partial = planning.completeness !== "complete" ? (vi ? "Dựa trên hoạt động hiện đang được tải. " : "Based on currently loaded activity. ") : "";
  const timestamp = new Date(planning.dataTimestamp).toLocaleString(vi ? "vi-VN" : "en-US");
  if (planning.kind === "latest-transaction") {
    if (planning.status === "unavailable") return { intent, result, planning, text: vi ? "Hoạt động hiện không khả dụng nên Makoto không thể xác định giao dịch gần nhất." : "Activity is unavailable, so Makoto cannot determine your latest transaction." };
    if (!planning.activity) return { intent, result, planning, text: partial + (vi ? "Không có giao dịch đã xác nhận trong hoạt động hiện đang tải." : "No confirmed transaction is available in the currently loaded activity.") };
    const item = planning.activity;
    return { intent, result, planning, text: `${partial}${explain(item, vi)} ${vi ? "Đã xác nhận lúc" : "Confirmed at"} ${new Date(item.confirmedAt).toLocaleString(vi ? "vi-VN" : "en-US")}.` };
  }
  if (planning.kind === "today-spending") {
    if (planning.status === "unavailable") return { intent, result, planning, text: vi ? "Hoạt động hiện không khả dụng nên Makoto không thể tính chi tiêu hôm nay." : "Activity is unavailable, so Makoto cannot calculate today's spending." };
    if (!hasSpending(planning)) return { intent, result, planning, text: `${partial}${vi ? "Không có khoản chi đã xác nhận nào trong hoạt động hiện đang tải hôm nay." : "No confirmed outgoing spending is available in the currently loaded activity today."} ${vi ? "Dữ liệu lấy lúc" : "Data as of"} ${timestamp}.` };
    const totals = (["usdc", "eurc"] as const).flatMap((id) => planning.spending?.[id] ? [`${formatPlanningAmount(planning.spending[id], id, vi ? "vi" : "en")} ${id.toUpperCase()}`] : []);
    return { intent, result, planning, text: `${partial}${vi ? "Chi tiêu đã xác nhận hôm nay" : "Confirmed spending today"}: ${totals.length ? totals.join("; ") : vi ? "không có" : "none"}. ${vi ? "Dữ liệu lấy lúc" : "Data as of"} ${timestamp}.` };
  }
  if (planning.kind === "blocking-explanation") {
    const code = planning.blockingReasons[0];
    return { intent, result, planning, text: code ? blockingExplanation(code, vi) : (vi ? "Không có lý do chặn có cấu trúc." : "No structured blocking reason is available.") };
  }
  if (planning.kind === "bridge-completion") return { intent, result, planning, text: vi ? "Hoàn tất bridge cần bằng chứng từ giao dịch ở mạng đích. Burn ở mạng nguồn không chứng minh bridge đã hoàn tất, và thời gian hoàn tất không được đảm bảo." : "Bridge completion requires destination-chain transaction evidence. A source-chain burn does not prove completion, and completion timing cannot be guaranteed." };
  if (planning.swap) return formatSwapPlanning(intent, result, planning, vi);
  if (planning.bridge) return formatBridgePlanning(intent, result, planning, vi);
  const assetId = planning.assetId ?? "usdc";
  const locale = vi ? "vi" : "en";
  const requested = formatPlanningAmount(planning.amount, assetId, locale);
  const balance = formatPlanningAmount(planning.balance, assetId, locale);
  const fee = formatPlanningAmount(planning.maximumFeeUsdc6, "usdc", locale);
  const remaining = formatPlanningAmount(planning.remaining, assetId, locale);
  const remainingBeforeFees = formatPlanningAmount(planning.remainingBeforeFees, assetId, locale);
  const intro = vi ? "Chỉ là ước tính; chưa có giao dịch nào được chuẩn bị." : "Estimated only. No transaction has been prepared.";
  if (planning.kind === "send-remaining" && planning.amount !== undefined && planning.balance !== undefined && planning.tokenBalanceCovers && planning.maximumFeeUsdc6 === undefined) return { intent, result, planning, text: vi ? `${intro} Số dư hiện tại của bạn là ${balance} ${assetId.toUpperCase()}. Sau khi trừ ${requested} ${assetId.toUpperCase()}, bạn sẽ còn ${remainingBeforeFees} ${assetId.toUpperCase()} trước phí mạng. Ước tính phí mạng hiện không khả dụng, nên chưa thể xác nhận số dư cuối cùng sau phí. Dữ liệu lấy lúc ${timestamp}.` : `${intro} Your current balance is ${balance} ${assetId.toUpperCase()}. After subtracting ${requested} ${assetId.toUpperCase()}, you would have ${remainingBeforeFees} ${assetId.toUpperCase()} before network fees. A current network fee estimate is unavailable, so I can't confirm the final fee-aware remainder yet. Data as of ${timestamp}.` };
  if (planning.amount === undefined || planning.balance === undefined) return { intent, result, planning, text: `${intro} ${vi ? "Số tiền hoặc số dư không khả dụng." : "The amount or token balance is unavailable."}` };
  if (!planning.tokenBalanceCovers) return { intent, result, planning, text: `${intro} ${vi ? "Số dư" : "Balance"}: ${balance} ${assetId.toUpperCase()}; ${vi ? "yêu cầu" : "requested"}: ${requested} ${assetId.toUpperCase()}. ${blockingExplanation("insufficient-token-balance", vi)}` };
  if (planning.maximumFeeUsdc6 === undefined) return { intent, result, planning, text: `${intro} ${vi ? "Số dư token đủ cho số tiền yêu cầu, nhưng" : "The token balance covers the requested amount, but"} ${blockingExplanation("gas-estimate-unavailable", vi).toLocaleLowerCase(vi ? "vi-VN" : "en-US")} ${vi ? "Dữ liệu lấy lúc" : "Data as of"} ${timestamp}.` };
  if (!planning.feeAwareAffordable) return { intent, result, planning, text: `${intro} ${vi ? "Yêu cầu" : "Requested"}: ${requested} ${assetId.toUpperCase()}; ${vi ? "phí mạng tối đa" : "maximum network fee"}: ${fee} USDC. ${blockingExplanation("insufficient-gas-balance", vi)}` };
  return { intent, result, planning, text: `${intro} ${vi ? "Yêu cầu" : "Requested"}: ${requested} ${assetId.toUpperCase()}; ${vi ? "phí mạng tối đa" : "maximum network fee"}: ${fee} USDC; ${vi ? "số dư thận trọng còn lại" : "conservative remaining balance"}: ${remaining} ${assetId.toUpperCase()}. ${vi ? "Dữ liệu lấy lúc" : "Data as of"} ${timestamp}; ${vi ? "làm mới sau" : "refresh after"} ${planning.expiresAt ? new Date(planning.expiresAt).toLocaleTimeString(vi ? "vi-VN" : "en-US") : vi ? "ngay bây giờ" : "now"}.` };
}

function isPlanningIntent(kind: AgentIntent["kind"]) { return kind === "latest-transaction" || kind === "today-spending" || kind === "send-affordability" || kind === "send-remaining" || kind === "swap-quote" || kind === "swap-allowance" || kind === "swap-affordability" || kind === "bridge-estimate" || kind === "bridge-route" || kind === "bridge-completion" || kind === "blocking-explanation"; }
function hasSpending(planning: AgentPlanningResult) { return Boolean(planning.spending?.usdc || planning.spending?.eurc); }

function formatSwapPlanning(intent: AgentIntent, result: AgentToolResult | undefined, planning: AgentPlanningResult, vi: boolean): AgentResponse {
  const swap = planning.swap!, input = `${formatUnits(swap.inputAmount, 6)} ${swap.inputAsset.toUpperCase()}`;
  const estimateOnly = vi ? "Chỉ là ước tính. Chưa có giao dịch nào được chuẩn bị." : "Estimated only. No transaction has been prepared.";
  if (swap.freshness === "STALE") return { intent, result, planning, text: `${blockingExplanation("stale-quote", vi)} ${estimateOnly}` };
  if (swap.freshness === "UNAVAILABLE" || swap.expectedOutput === undefined) return { intent, result, planning, text: `${blockingExplanation("quote-unavailable", vi)} ${estimateOnly}` };
  if (planning.kind === "swap-allowance") {
    if (swap.allowanceState === "ALLOWANCE_UNAVAILABLE") return { intent, result, planning, text: `${blockingExplanation("allowance-unavailable", vi)} ${estimateOnly}` };
    if (swap.allowanceState === "SUFFICIENT") return { intent, result, planning, text: vi ? `Allowance hiện tại đủ cho ${input}. Không cần approve thêm. ${estimateOnly}` : `Current allowance is sufficient for ${input}. No additional approval is needed. ${estimateOnly}` };
    const required = swap.requiredFiniteApproval === undefined ? translate(vi ? "vi" : "en", "agent.value.unavailable") : formatUnits(swap.requiredFiniteApproval, 6);
    return { intent, result, planning, text: vi ? `Cần finite approval ${required} ${swap.inputAsset.toUpperCase()}. Makoto không dùng unlimited approval và không kích hoạt approve. ${estimateOnly}` : `A finite approval of ${required} ${swap.inputAsset.toUpperCase()} is required. Makoto never uses unlimited approval and did not trigger approval. ${estimateOnly}` };
  }
  if (planning.kind === "swap-affordability") {
    if (swap.affordability.affordable === true) return { intent, result, planning, text: vi ? `Số dư token và USDC gas hiện đủ cho ${input}; mô phỏng chỉ đọc đã đạt. ${estimateOnly}` : `Current token and USDC gas balances cover ${input}, and the read-only simulation passed. ${estimateOnly}` };
    if (swap.affordability.affordable === false) return { intent, result, planning, text: `${swap.blockingReasons.map((code) => blockingExplanation(code as Parameters<typeof blockingExplanation>[0], vi)).join(" ")} ${estimateOnly}` };
    return { intent, result, planning, text: vi ? `Chưa đủ dữ liệu gas hoặc mô phỏng để xác nhận khả năng chi trả cho ${input}. ${estimateOnly}` : `Gas or simulation evidence is incomplete, so full affordability for ${input} cannot be confirmed. ${estimateOnly}` };
  }
  const output = `${formatUnits(swap.expectedOutput, 6)} ${swap.outputAsset.toUpperCase()}`, minimum = swap.minimumReceived === undefined ? translate(vi ? "vi" : "en", "agent.value.unavailable") : `${formatUnits(swap.minimumReceived, 6)} ${swap.outputAsset.toUpperCase()}`;
  const remaining = swap.expiresAt === undefined ? undefined : Math.max(0, Math.floor((swap.expiresAt - swap.dataTimestamp) / 1000));
  const freshness = swap.freshness === "EXPIRING" ? (vi ? "sắp hết hạn" : "expiring") : (vi ? "mới" : "fresh");
  return { intent, result, planning, text: `${input} → ${vi ? "ước tính" : "estimated"} ${output}\n${vi ? "Nhận tối thiểu" : "Minimum received"}: ${minimum}\n${vi ? "Trượt giá" : "Slippage"}: ${swap.slippageBps / 100}%\n${vi ? "Báo giá" : "Quote"}: ${freshness}${remaining === undefined ? "" : ` · ${remaining}s ${vi ? "còn lại" : "remaining"}`}\n${estimateOnly}` };
}

function formatBridgePlanning(intent: AgentIntent, result: AgentToolResult | undefined, planning: AgentPlanningResult, vi: boolean): AgentResponse {
  const bridge = planning.bridge!, estimateOnly = vi ? "Chỉ là ước tính. Chưa có giao dịch nào được chuẩn bị." : "Estimated only. No transaction has been prepared.";
  if (planning.kind === "bridge-route") {
    const state = bridge.routeAvailable ? "AVAILABLE" : bridge.blockingReasons.includes("route-unavailable") ? "UNAVAILABLE" : "UNKNOWN";
    const stateLabel = translate(vi ? "vi" : "en", state === "AVAILABLE" ? "agent.value.available" : state === "UNAVAILABLE" ? "agent.value.unavailable" : "agent.value.unknown");
    return { intent, result, planning, text: `${stateLabel} — ${bridge.sourceChain ?? bridge.sourceChainId} → ${bridge.destinationChain ?? bridge.destinationChainId}. ${state === "AVAILABLE" ? (vi ? "Nhà cung cấp hiện báo cáo tuyến này được hỗ trợ." : "The provider currently reports this route as supported.") : blockingExplanation(bridge.blockingReasons.includes("unsupported-chain") ? "unsupported-chain" : "route-unavailable", vi)} ${estimateOnly}` };
  }
  if (bridge.sourceDebit === undefined) return { intent, result, planning, text: `${blockingExplanation(bridge.blockingReasons.includes("provider-unavailable") ? "provider-unavailable" : "fee-unavailable", vi)} ${vi ? "Thời gian chuyển không thể được đảm bảo." : "Transfer timing cannot be guaranteed."} ${estimateOnly}` };
  const amount = `${formatUnits(bridge.amount, 6)} USDC`, receive = bridge.expectedReceive === undefined ? translate(vi ? "vi" : "en", "agent.value.unavailable") : `${formatUnits(bridge.expectedReceive, 6)} USDC`;
  const locale = vi ? "vi" : "en";
  const fees = bridge.fees.length ? bridge.fees.map((fee) => `${feeKindLabel(fee.kind, locale)}: ${fee.amount === undefined ? translate(locale, "agent.value.unavailable") : formatUnits(fee.amount, fee.token.toUpperCase() === "ETH" ? 18 : 6)} ${fee.token} · ${translate(locale, "agent.value.chain")} ${fee.chainId}`).join("\n") : `${translate(locale, "agent.fee.provider")}: ${translate(locale, "agent.value.unavailable")}`;
  return { intent, result, planning, text: `${vi ? "Số tiền bridge" : "Bridge amount"}: ${amount}\n${fees}\n${vi ? "Dự kiến nhận" : "Expected receive"}: ${receive}\n${vi ? "Phí khác token/mạng luôn được giữ riêng. Thời gian chuyển không thể được đảm bảo." : "Different token/chain fee units remain separate. Transfer timing cannot be guaranteed."}\n${estimateOnly}` };
}

export function explain(item: WalletActivity, vi: boolean) {
  const sent = `${formatUnits(item.amount, item.decimals)} ${item.assetSymbol}`; const hash = ` (${item.hash.slice(0, 10)}…)`;
  if (item.kind === "swap" && item.swapReceive) { const received = `${formatUnits(item.swapReceive.amount, item.swapReceive.decimals)} ${item.swapReceive.assetSymbol}`; return vi ? `Bạn đã hoán đổi ${sent} lấy ${received} qua XyloNet StableSwap.${hash}` : `You swapped ${sent} for ${received} through XyloNet StableSwap.${hash}`; }
  if (item.kind === "bridge") return vi ? `Đây là giao dịch bridge CCTP từ Arc với số tiền ${sent}. Giao dịch phía Arc đã xác nhận; hoàn tất ở đích chỉ được xác nhận khi có bằng chứng đích.${hash}` : `This is an Arc-origin CCTP bridge for ${sent}. The Arc-side transaction is confirmed; destination completion requires destination evidence.${hash}`;
  if (item.kind === "vault-deposit") return vi ? `Bạn đã nạp ${sent} vào Makoto Vault.${hash}` : `You deposited ${sent} into Makoto Vault.${hash}`;
  if (item.kind === "vault-withdraw") return vi ? `Bạn đã rút ${sent} khỏi Makoto Vault.${hash}` : `You withdrew ${sent} from Makoto Vault.${hash}`;
  return item.direction === "receive" ? (vi ? `Bạn đã nhận ${sent} từ ${item.counterparty}.${hash}` : `You received ${sent} from ${item.counterparty}.${hash}`) : (vi ? `Bạn đã gửi ${sent} đến ${item.counterparty}.${hash}` : `You sent ${sent} to ${item.counterparty}.${hash}`);
}
function amount(value: bigint | undefined, locale: AgentIntent["locale"]) { return value === undefined ? translate(locale, "agent.value.unavailable") : formatUnits(value, 6); }
function localUnavailable(text: string | undefined, vi: boolean) { if (text?.startsWith("Connect")) return vi ? "Kết nối ví để xem số dư và hoạt động." : "Connect your wallet to view balances and activity."; if (text?.includes("partial")) return vi ? "Không có hoạt động phù hợp trong dữ liệu đã tải; lịch sử hiện chỉ có một phần." : "No matching activity is available in the loaded data; history is currently partial."; return vi ? "Thông tin này hiện không khả dụng." : "That information is currently unavailable."; }
function clarificationText(intent: AgentIntent, decision: AgentOrchestrationDecision) {
  const locale = intent.locale, preparation = intent.preparation, missing = decision.missingFields ?? [];
  if (preparation && missing.length) {
    const amount = preparation.amount ?? translate(locale, "agent.field.amount");
    const asset = preparation.assetId?.toUpperCase() ?? translate(locale, "agent.field.asset");
    if (preparation.kind === "send") {
      if (missing.includes("asset")) return translate(locale, "agent.clarification.sendAsset");
      if (missing.includes("amount")) return translate(locale, "agent.clarification.sendAmount", { asset });
      if (missing.includes("recipient")) return translate(locale, "agent.clarification.sendRecipient", { amount, asset });
    }
    if (preparation.kind === "swap") {
      if (missing.includes("asset")) return translate(locale, "agent.clarification.swapAsset");
      if (missing.includes("amount")) return translate(locale, "agent.clarification.swapAmount", { asset });
      if (missing.includes("outputAsset")) return translate(locale, "agent.clarification.swapOutput", { amount, asset });
    }
    if (preparation.kind === "bridge") {
      const sourceMissing = missing.includes("sourceChain"), destinationMissing = missing.includes("destinationChain");
      if (missing.includes("amount")) return translate(locale, "agent.clarification.bridgeAmount");
      if (sourceMissing && destinationMissing) return translate(locale, "agent.clarification.bridgeChains", { amount });
      if (sourceMissing) return translate(locale, "agent.clarification.bridgeSource", { amount, destination: chainDisplay(preparation.destinationChainId) });
      if (destinationMissing) return translate(locale, "agent.clarification.bridgeDestination", { amount, source: chainDisplay(preparation.sourceChainId) });
    }
    if (preparation.kind.startsWith("vault-") && missing.includes("amount")) return translate(locale, "agent.clarification.vaultAmount");
  }
  const reason = decision.clarification ?? intent.clarification;
  if (reason === "approval-topic") return translate(locale, "agent.clarification.approvalTopic");
  if (reason === "swap-or-bridge") return translate(locale, "agent.clarification.swapOrBridge");
  if (reason === "missing-details") return translate(locale, "agent.clarification.missingDetails");
  if (reason === "missing-intelligence-target") return translate(locale, "agent.clarification.intelligenceTarget");
  if (reason === "missing-token-address") return translate(locale, "agent.clarification.tokenAddress");
  return translate(locale, "agent.clarification.missingTopic", { amount: intent.amount ?? (locale === "vi" ? "Số tiền đó" : "That amount") });
}
function networkText(s: AgentContextSnapshot, vi: boolean) { if (!s.connected) return vi ? `Chưa kết nối ví. Makoto cần Arc Testnet (chain ID ${arcTestnet.id}) cho các thao tác Arc.` : `Wallet disconnected. Makoto requires Arc Testnet (chain ID ${arcTestnet.id}) for Arc actions.`; return s.isArc ? (vi ? `Ví đang ở Arc Testnet (chain ID ${arcTestnet.id}). Các thao tác phụ thuộc Arc hiện khả dụng.` : `Your wallet is on Arc Testnet (chain ID ${arcTestnet.id}). Arc-dependent actions are available.`) : (vi ? `Ví đang ở chain ID ${s.verifiedChainId ?? "không xác định"}; Makoto cần Arc Testnet (${arcTestnet.id}). Agent sẽ không tự chuyển mạng.` : `Your wallet is on chain ID ${s.verifiedChainId ?? "unknown"}; Makoto requires Arc Testnet (${arcTestnet.id}). The Agent will not switch networks.`); }
function chainDisplay(chainId: number | undefined) { return chainId === 5_042_002 ? "Arc Testnet" : chainId === 84_532 ? "Base Sepolia" : String(chainId ?? "—"); }
function feeKindLabel(kind: "protocol" | "forwarding" | "provider" | "gas", locale: AgentIntent["locale"]) { const keys: Record<typeof kind, TranslationKey> = { protocol: "agent.fee.protocol", forwarding: "agent.fee.forwarding", provider: "agent.fee.provider", gas: "agent.fee.gas" }; return translate(locale, keys[kind]); }
function safetyCapabilityLabel(capability: string, locale: AgentIntent["locale"]) { const keys: Record<string, TranslationKey> = { "read-only simulation": "agent.safety.readOnlySimulation", "known-contract verification": "agent.safety.knownContractVerification", "finite approval enforcement": "agent.safety.finiteApprovalEnforcement", "request fingerprint": "agent.safety.requestFingerprint", "fee-envelope checks": "agent.safety.feeEnvelopeChecks", "review expiry": "agent.safety.reviewExpiry", "wallet confirmation": "agent.safety.walletConfirmation", "receipt confirmation": "agent.safety.receiptConfirmation" }; return keys[capability] ? translate(locale, keys[capability]) : capability; }
