import type { AgentActivityFilter, AgentIntent, AgentPreparationInput, AgentRequest } from "./types.ts";
import type { AgentSessionContext } from "./sessionContext.ts";

const ADDRESS = /0x[a-fA-F0-9]{40}/;
const ADDRESS_LIKE = /0x[^\s,;]+/i;
const AMOUNT = /(?:^|\s)(-?\d+(?:[.,]\d+)?|max|all|everything|entire balance)(?=\s|[?!.,]|$)/i;

export function parseAgentRequest(request: AgentRequest): AgentIntent {
  const raw = request.text.trim(), text = normalize(raw);
  const pendingFollowUp = parsePendingPreparationFollowUp(raw, text, request.locale, request.sessionContext);
  if (pendingFollowUp) return { kind: "prepare-action", locale: request.locale, preparation: pendingFollowUp };
  const addresses = [...raw.matchAll(/0x[a-fA-F0-9]{40}/g)].map((match) => match[0] as AgentIntent["intelligenceAddress"]);
  if (has(text, ["what does circle say about cctp", "circle cctp", "circle documentation", "circle docs"])) return { kind: "official-research", locale: request.locale, researchTopic: "circle-cctp" };
  if (has(text, ["official issue", "provider status", "circle status", "bridge provider healthy", "bridge provider operational"])) return { kind: "official-research", locale: request.locale, researchTopic: "circle-status" };
  if (has(text, ["what changed on arc", "arc updates", "arc recently", "latest arc news", "new arc announcements"])) return { kind: "official-research", locale: request.locale, researchTopic: "arc-updates" };
  if (has(text, ["what does arc documentation say", "arc docs say", "arc documentation about"])) return { kind: "official-research", locale: request.locale, researchTopic: "arc-docs" };
  const boundAccount = request.account ?? request.sessionContext?.account as AgentIntent["intelligenceAddress"] | undefined;
  const tokenQuestion = has(text, ["what is this token", "token contract", "token metadata", "token này", "hợp đồng token"]);
  if (tokenQuestion && addresses[0]) return { kind: "onchain-intelligence", locale: request.locale, intelligenceOperation: "token", intelligenceAddress: boundAccount ?? addresses[0], tokenAddress: addresses[0], spender: addresses[1] };
  if (tokenQuestion) return { kind: "clarification", locale: request.locale, clarification: "missing-token-address" };
  const ownWalletActivity = has(text, ["activity for my wallet", "activity for my address", "activity for my account", "activity for the connected wallet", "hoạt động của ví của tôi", "hoạt động của ví của mình", "hoạt động của tài khoản của tôi"]);
  const addressedActivity = has(text, ["recent activity for", "activity for this address", "hoạt động gần đây của"]);
  if (ownWalletActivity || addressedActivity && addresses[0]) return boundAccount || addresses[0] ? { kind: "onchain-intelligence", locale: request.locale, intelligenceOperation: "activity", intelligenceAddress: addresses[0] ?? boundAccount } : { kind: "clarification", locale: request.locale, clarification: "missing-intelligence-target" };
  const ownWalletReference = has(text, ["my wallet", "my address", "my account", "connected wallet", "current wallet", "ví của tôi", "ví của mình", "địa chỉ của tôi", "địa chỉ ví đang kết nối", "tài khoản của tôi"]);
  const addressQuestion = has(text, ["this address", "tell me about this address", "address a contract", "contract or eoa"]) || ownWalletReference && has(text, ["tell me", "what can you tell", "inspect", "kiểm tra", "cho tôi biết"]);
  if (addressQuestion) return addresses[0] || boundAccount ? { kind: "onchain-intelligence", locale: request.locale, intelligenceOperation: "address", intelligenceAddress: addresses[0] ?? boundAccount } : { kind: "clarification", locale: request.locale, clarification: "missing-intelligence-target" };
  const limit = Math.min(20, Math.max(1, Number(text.match(/\b(\d{1,2})\b/)?.[1] ?? 5)));
  const planning = parsePlanningIntent(raw, text, request.locale, request.previousIntent, request.sessionContext);
  if (planning) return planning;
  if (has(text, ["explain", "giải thích"]) && has(text, ["transaction", "activity", "swap", "bridge", "giao dịch", "hoán đổi", "chuyển chuỗi"])) return { kind: "activity-explanation", locale: request.locale, activityFilter: filterOf(text), limit: 1 };
  if (has(text, ["recent", "last", "history", "activity", "transaction", "gần đây", "gần nhất", "lịch sử", "giao dịch"])) return { kind: "recent-activity", locale: request.locale, activityFilter: filterOf(text), limit };
  const preparation = resolvePreparationFromContext(parseActionDraft(raw, text), request.sessionContext);
  if (preparation) return { kind: "prepare-action", locale: request.locale, preparation };
  if (has(text, ["vault", "savings", "saving goal", "tiết kiệm", "mục tiêu"])) return { kind: "vault-summary", locale: request.locale };
  if (has(text, ["balance", "portfolio", "how much", "summarize my wallet", "wallet summary", "số dư", "còn bao nhiêu", "tài sản", "tóm tắt ví"])) return { kind: "wallet-overview", locale: request.locale };
  if (has(text, ["network", "chain", "mạng nào", "mạng", "chuỗi nào"])) return { kind: "network-status", locale: request.locale };
  if (has(text, ["security", "safety", "protect", "bảo mật", "an toàn", "bảo vệ"])) return { kind: "safety-capabilities", locale: request.locale };
  return { kind: "unknown", locale: request.locale };
}

function parsePendingPreparationFollowUp(raw: string, text: string, locale: AgentIntent["locale"], context?: AgentSessionContext): AgentPreparationInput | undefined {
  const pending = context?.pendingPreparation;
  if (!pending || has(text, ["send", "gửi", "swap", "đổi", "hoán đổi", "bridge", "chuyển chuỗi", "vault", "deposit", "withdraw", "nạp", "rút"])) return undefined;
  const amount = text.match(AMOUNT)?.[1]?.replace(",", ".");
  const recipient = raw.match(ADDRESS)?.[0] as AgentIntent["recipient"] | undefined;
  const addressLike = raw.match(ADDRESS_LIKE)?.[0];
  const asset = /^\s*(usdc|eurc)\s*[.!?]?\s*$/i.exec(raw)?.[1]?.toLowerCase() as "usdc" | "eurc" | undefined;
  const chain = /^\s*(arc(?: testnet)?|base(?: sepolia)?)\s*[.!?]?\s*$/i.exec(text)?.[1];
  if (!amount && !recipient && !addressLike && !asset && !chain) return undefined;
  let sourceChainId = pending.sourceChainId, destinationChainId = pending.destinationChainId;
  if (pending.kind === "bridge" && chain) {
    const value = chainId(chain);
    if (!sourceChainId) sourceChainId = value;
    else if (!destinationChainId) destinationChainId = value;
  }
  return Object.freeze({ kind: pending.kind, assetId: pending.assetId, amount: amount ?? pending.amount, recipient: recipient ?? pending.recipient as AgentIntent["recipient"] | undefined, sourceChainId, destinationChainId, outputAssetId: pending.kind === "swap" && asset ? asset : pending.outputAssetId, rawUserText: raw, invalidRecipient: Boolean(addressLike && !recipient) });
}

function parsePlanningIntent(raw: string, text: string, locale: AgentIntent["locale"], previous?: AgentIntent, session?: AgentSessionContext): AgentIntent | undefined {
  if (has(text, ["what was my latest transaction", "what did i do last", "latest transaction", "giao dịch gần nhất"]) && !/\b(?:[2-9]|1\d|20)\b/.test(text)) return { kind: "latest-transaction", locale };
  if (has(text, ["spend today", "spent today", "chi bao nhiêu", "đã chi bao nhiêu"])) return { kind: "today-spending", locale };
  const blockingCode = blockingCodeOf(text);
  if (blockingCode && has(text, ["why", "can't", "cannot", "blocked", "không thể", "tại sao"])) return { kind: "blocking-explanation", locale, blockingCode };
  const sendQuestion = has(text, ["send", "gửi"]);
  const amount = text.match(AMOUNT)?.[1]?.replace(",", ".");
  const assetId = /\beurc\b/.test(text) ? "eurc" : "usdc";
  const recipient = raw.match(ADDRESS)?.[0] as AgentIntent["recipient"] | undefined;
  const swapQuestion = has(text, ["swap", "đổi", "hoán đổi"]);
  const assets = [...text.matchAll(/\b(usdc|eurc)\b/g)].map((match) => match[1] as "usdc" | "eurc");
  const swapInput = assets[0] ?? assetId;
  const swapOutput = assets[1] ?? (swapInput === "usdc" ? "eurc" : "usdc");
  if (swapQuestion && has(text, ["do i need approval", "allowance enough", "need approve", "cần approve", "cần phê duyệt", "allowance đủ"])) return { kind: "swap-allowance", locale, amount, assetId: swapInput, outputAssetId: swapOutput };
  if (swapQuestion && has(text, ["can i afford", "can i swap", "do i have enough", "có đủ", "đủ để swap"])) return { kind: "swap-affordability", locale, amount, assetId: swapInput, outputAssetId: swapOutput };
  if (swapQuestion && (has(text, ["how much", "what would i get", "what will i receive", "minimum", "bao nhiêu", "được bao nhiêu", "nhận được"]) || isConditional(text))) return { kind: "swap-quote", locale, amount, assetId: swapInput, outputAssetId: swapOutput };
  const bridgeQuestion = has(text, ["bridge", "chuyển chuỗi"]);
  const sourceChainId = chainId(text.match(/(?:from|từ)\s+(base sepolia|arc testnet|base|arc)/)?.[1]);
  const destinationChainId = chainId(text.match(/(?:to|sang|đến)\s+(base sepolia|arc testnet|base|arc)/)?.[1]);
  const inferredSource = sourceChainId ?? (destinationChainId === 5_042_002 ? 84_532 : 5_042_002);
  const inferredDestination = destinationChainId ?? (inferredSource === 5_042_002 ? 84_532 : 5_042_002);
  if (bridgeQuestion && has(text, ["has my bridge completed", "bridge completed", "bridge complete", "đã bridge xong", "bridge hoàn tất"])) return { kind: "bridge-completion", locale, amount, assetId: "usdc", sourceChainId: inferredSource, destinationChainId: inferredDestination, recipient };
  if (bridgeQuestion && has(text, ["route available", "route", "can i bridge", "tuyến", "có hoạt động"])) return { kind: "bridge-route", locale, amount, assetId: "usdc", sourceChainId: inferredSource, destinationChainId: inferredDestination, recipient };
  if (bridgeQuestion && has(text, ["how much", "cost", "fee", "arrive", "receive", "tốn bao nhiêu", "phí", "nhận"])) return { kind: "bridge-estimate", locale, amount, assetId: "usdc", sourceChainId: inferredSource, destinationChainId: inferredDestination, recipient };
  if (bridgeQuestion && isConditional(text)) return { kind: "bridge-estimate", locale, amount, assetId: "usdc", sourceChainId: inferredSource, destinationChainId: inferredDestination, recipient };
  if (sendQuestion && has(text, ["how much will i have left", "how much would i have left", "what will remain", "còn bao nhiêu"])) return { kind: "send-remaining", locale, amount, assetId, recipient };
  if (sendQuestion && has(text, ["can i afford", "do i have enough", "đủ để", "có đủ"])) return { kind: "send-affordability", locale, amount, assetId, recipient };

  const previousSwap = session?.activeTopic === "swap" && session.swap
    ? { assetId: session.swap.inputAsset, outputAssetId: session.swap.outputAsset, amount: session.swap.amount }
    : previous && ["swap-quote", "swap-allowance", "swap-affordability"].includes(previous.kind)
      ? previous
      : undefined;
  const previousBridge = session?.activeTopic === "bridge" ? session.bridge : undefined;
  const amountFollowUp = amount && has(text, ["what about", "còn", "thế còn"]);
  const minimumFollowUp = has(text, ["minimum", "minimum received", "tối thiểu"]);
  const approvalFollowUp = has(text, ["do i need approval", "is my allowance enough", "allowance enough", "cần approve", "có cần approve", "cần phê duyệt"]);
  const affordabilityFollowUp = has(text, ["can i afford", "can i afford it", "có đủ", "tôi có đủ", "mình có đủ"]);
  const feeFollowUp = has(text, ["what is the fee", "what's the fee", "phí là bao nhiêu", "phí bao nhiêu"]);
  const routeFollowUp = has(text, ["is that route available", "is the route available", "route available", "tuyến đó", "tuyến này"]);

  if (previousSwap && minimumFollowUp) return { kind: "swap-quote", locale, amount: amount ?? previousSwap.amount, assetId: previousSwap.assetId, outputAssetId: previousSwap.outputAssetId };
  if (previousSwap && approvalFollowUp) return { kind: "swap-allowance", locale, amount: amount ?? previousSwap.amount, assetId: previousSwap.assetId, outputAssetId: previousSwap.outputAssetId };
  if (previousSwap && affordabilityFollowUp) return { kind: "swap-affordability", locale, amount: amount ?? previousSwap.amount, assetId: previousSwap.assetId, outputAssetId: previousSwap.outputAssetId };
  if (previousSwap && amountFollowUp) return { kind: "swap-quote", locale, amount, assetId: previousSwap.assetId, outputAssetId: previousSwap.outputAssetId };

  if (previousBridge && amountFollowUp) return { kind: "bridge-estimate", locale, amount, assetId: "usdc", sourceChainId: previousBridge.sourceChainId, destinationChainId: previousBridge.destinationChainId };
  if (previousBridge && feeFollowUp) return { kind: "bridge-estimate", locale, amount: previousBridge.amount, assetId: "usdc", sourceChainId: previousBridge.sourceChainId, destinationChainId: previousBridge.destinationChainId };
  if (previousBridge && routeFollowUp) return { kind: "bridge-route", locale, amount: previousBridge.amount, assetId: "usdc", sourceChainId: previousBridge.sourceChainId, destinationChainId: previousBridge.destinationChainId };

  if (approvalFollowUp) return { kind: "clarification", locale, clarification: "approval-topic" };
  if (amountFollowUp) return { kind: "clarification", locale, clarification: "missing-topic", amount };
  if (has(text, ["how much will i get", "how much would i get", "tôi sẽ nhận được bao nhiêu", "mình nhận được bao nhiêu"])) return { kind: "clarification", locale, clarification: "swap-or-bridge" };
  return undefined;
}

function blockingCodeOf(text: string): AgentIntent["blockingCode"] {
  if (has(text, ["wrong network", "wrong chain", "sai mạng"])) return "wrong-network";
  if (has(text, ["invalid recipient", "invalid address", "địa chỉ không hợp lệ"])) return "invalid-recipient";
  if (has(text, ["insufficient gas", "network fee", "phí mạng"])) return "insufficient-gas-balance";
  if (has(text, ["insufficient balance", "not enough balance", "không đủ số dư"])) return "insufficient-token-balance";
  if (has(text, ["wallet rejected", "wallet rejection", "ví từ chối"])) return "wallet-rejection";
  if (has(text, ["simulation reverted", "simulation failed", "mô phỏng thất bại"])) return "reverted-simulation";
  if (has(text, ["confirmation unknown", "unknown confirmation", "chưa xác định xác nhận"])) return "unknown-confirmation";
  if (has(text, ["allowance", "approval required", "cần phê duyệt"])) return "allowance-required";
  if (has(text, ["quote expired", "stale quote", "báo giá hết hạn"])) return "stale-quote";
  if (has(text, ["quote unavailable", "no quote", "không có báo giá"])) return "quote-unavailable";
  if (has(text, ["gas estimate", "fee estimate", "ước tính phí"])) return "gas-estimate-unavailable";
  if (has(text, ["bridge route", "route unavailable", "tuyến bridge"])) return "bridge-route-unavailable";
  return undefined;
}

export function parseActionDraft(raw: string, text = normalize(raw)): AgentPreparationInput | undefined {
  let kind: AgentPreparationInput["kind"] | undefined;
  if (text.includes("vault") && has(text, ["deposit", "nạp", "gửi"])) kind = "vault-deposit";
  else if (text.includes("vault") && has(text, ["withdraw", "rút"])) kind = "vault-withdraw";
  else if (has(text, ["send", "gửi"])) kind = "send";
  else if (has(text, ["swap", "đổi", "hoán đổi"])) kind = "swap";
  else if (has(text, ["bridge", "chuyển chuỗi", "chuyển sang base"])) kind = "bridge";
  if (!kind) return undefined;
  const amount = text.match(AMOUNT)?.[1]?.replace(",", ".");
  const assets = [...text.matchAll(/\b(usdc|eurc)\b/g)].map((match) => match[1] as "usdc" | "eurc");
  const validRecipient = raw.match(ADDRESS)?.[0] as AgentIntent["recipient"] | undefined;
  const addressLike = raw.match(ADDRESS_LIKE)?.[0];
  const source = text.match(/(?:from|từ)\s+(base sepolia|arc testnet|base|arc)/)?.[1];
  const destination = text.match(/(?:to|sang|đến)\s+(base sepolia|arc testnet|base|arc)/)?.[1];
  const fixedAsset = kind === "bridge" || kind === "vault-deposit" || kind === "vault-withdraw" ? "usdc" : assets[0];
  const fixedSource = kind === "send" || kind === "swap" ? 5_042_002 : chainId(source);
  return Object.freeze({ kind, assetId: fixedAsset, amount, recipient: validRecipient, sourceChainId: fixedSource, destinationChainId: chainId(destination), outputAssetId: assets[1], rawUserText: raw, invalidRecipient: Boolean(addressLike && !validRecipient) });
}

function resolvePreparationFromContext(input: AgentPreparationInput | undefined, context?: AgentSessionContext): AgentPreparationInput | undefined {
  if (!input || !context || input.kind !== context.activeTopic) return input;
  const swap = input.kind === "swap" ? context.swap : undefined;
  const bridge = input.kind === "bridge" ? context.bridge : undefined;
  const send = input.kind === "send" ? context.send : undefined;
  const amount = input.amount ?? swap?.amount ?? bridge?.amount ?? send?.amount;
  const explicitAssets = [...input.rawUserText.toLowerCase().matchAll(/\b(usdc|eurc)\b/g)].map((match) => match[1]);
  const compatibleSwap = swap && (explicitAssets.length === 0 || explicitAssets[0] === swap.inputAsset) ? swap : undefined;
  const assetId = explicitAssets.length ? input.assetId : compatibleSwap?.inputAsset ?? bridge?.asset ?? send?.asset ?? input.assetId;
  const outputAssetId = input.outputAssetId ?? compatibleSwap?.outputAsset;
  const sourceChainId = input.sourceChainId ?? bridge?.sourceChainId;
  const destinationChainId = input.destinationChainId ?? bridge?.destinationChainId;
  return Object.freeze({ ...input, assetId, amount, outputAssetId, sourceChainId, destinationChainId });
}

function filterOf(text: string): AgentActivityFilter { if (has(text, ["swap", "hoán đổi"])) return "swap"; if (has(text, ["bridge", "chuyển chuỗi"])) return "bridge"; if (has(text, ["vault", "tiết kiệm"])) return "vault"; if (has(text, ["receive", "nhận"])) return "receive"; if (has(text, ["send", "gửi"])) return "send"; return "all"; }
function normalize(value: string) { return value.toLocaleLowerCase("vi-VN").normalize("NFC"); }
function has(value: string, terms: string[]) { return terms.some((term) => value.includes(term)); }
function chainId(value?: string) { if (!value) return undefined; return value.startsWith("arc") ? 5_042_002 : value.startsWith("base") ? 84_532 : undefined; }
function isConditional(text: string) { return has(text, ["if i ", "what if i ", "what happens if", "nếu tôi", "nếu mình", "nếu bridge"]); }
