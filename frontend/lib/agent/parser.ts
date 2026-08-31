import type { AgentActionDraft, AgentActivityFilter, AgentIntent, AgentRequest } from "./types.ts";

const ADDRESS = /0x[a-fA-F0-9]{40}/;
const ADDRESS_LIKE = /0x[^\s,;]+/i;
const AMOUNT = /(?:^|\s)(-?\d+(?:[.,]\d+)?|max|all|everything|entire balance)(?=\s|$)/i;

export function parseAgentRequest(request: AgentRequest): AgentIntent {
  const raw = request.text.trim(), text = normalize(raw);
  const limit = Math.min(20, Math.max(1, Number(text.match(/\b(\d{1,2})\b/)?.[1] ?? 5)));
  const planning = parsePlanningIntent(raw, text, request.locale, request.previousIntent);
  if (planning) return planning;
  if (has(text, ["explain", "giải thích"]) && has(text, ["transaction", "activity", "swap", "bridge", "giao dịch", "hoán đổi", "chuyển chuỗi"])) return { kind: "activity-explanation", locale: request.locale, activityFilter: filterOf(text), limit: 1 };
  if (has(text, ["recent", "last", "history", "activity", "transaction", "gần đây", "gần nhất", "lịch sử", "giao dịch"])) return { kind: "recent-activity", locale: request.locale, activityFilter: filterOf(text), limit };
  const action = parseActionDraft(raw, text);
  if (action) return { kind: "action-draft", locale: request.locale, actionDraft: action };
  if (has(text, ["vault", "savings", "saving goal", "tiết kiệm", "mục tiêu"])) return { kind: "vault-summary", locale: request.locale };
  if (has(text, ["balance", "portfolio", "how much", "summarize my wallet", "wallet summary", "số dư", "còn bao nhiêu", "tài sản", "tóm tắt ví"])) return { kind: "wallet-overview", locale: request.locale };
  if (has(text, ["network", "chain", "mạng nào", "mạng", "chuỗi nào"])) return { kind: "network-status", locale: request.locale };
  if (has(text, ["security", "safety", "protect", "bảo mật", "an toàn", "bảo vệ"])) return { kind: "safety-capabilities", locale: request.locale };
  return { kind: "unknown", locale: request.locale };
}

function parsePlanningIntent(raw: string, text: string, locale: AgentIntent["locale"], previous?: AgentIntent): AgentIntent | undefined {
  if (has(text, ["what was my latest transaction", "what did i do last", "latest transaction", "giao dịch gần nhất"]) && !/\b(?:[2-9]|1\d|20)\b/.test(text)) return { kind: "latest-transaction", locale };
  if (has(text, ["spend today", "spent today", "chi bao nhiêu", "đã chi bao nhiêu"])) return { kind: "today-spending", locale };
  const blockingCode = blockingCodeOf(text);
  if (blockingCode && has(text, ["why", "can't", "cannot", "blocked", "không thể", "tại sao"])) return { kind: "blocking-explanation", locale, blockingCode };
  const sendQuestion = has(text, ["send", "gửi"]);
  const amount = text.match(AMOUNT)?.[1]?.replace(",", ".");
  const assetId = /\beurc\b/.test(text) ? "eurc" : "usdc";
  const recipient = raw.match(ADDRESS)?.[0] as AgentIntent["recipient"] | undefined;
  const previousSwap = previous && ["swap-quote", "swap-allowance", "swap-affordability"].includes(previous.kind) ? previous : undefined;
  const followUpAmount = amount ?? (text.match(AMOUNT)?.[1]?.replace(",", "."));
  if (previousSwap && has(text, ["minimum", "tối thiểu"])) return { ...previousSwap, kind: "swap-quote", locale, amount: followUpAmount ?? previousSwap.amount };
  if (previousSwap && has(text, ["do i need approval", "allowance", "cần approve", "cần phê duyệt"])) return { ...previousSwap, kind: "swap-allowance", locale, amount: followUpAmount ?? previousSwap.amount };
  if (previousSwap && has(text, ["can i afford", "afford this swap", "có đủ", "đủ để swap"])) return { ...previousSwap, kind: "swap-affordability", locale, amount: followUpAmount ?? previousSwap.amount };
  if (previousSwap && amount && has(text, ["what about", "còn", "thế còn"])) return { ...previousSwap, kind: "swap-quote", locale, amount };
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
  if (sendQuestion && has(text, ["how much will i have left", "how much would i have left", "what will remain", "còn bao nhiêu"])) return { kind: "send-remaining", locale, amount, assetId, recipient };
  if (sendQuestion && has(text, ["can i afford", "do i have enough", "đủ để", "có đủ"])) return { kind: "send-affordability", locale, amount, assetId, recipient };
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

export function parseActionDraft(raw: string, text = normalize(raw)): AgentActionDraft | undefined {
  let kind: AgentActionDraft["kind"] | undefined;
  if (text.includes("vault") && has(text, ["deposit", "nạp", "gửi"])) kind = "vault-deposit";
  else if (text.includes("vault") && has(text, ["withdraw", "rút"])) kind = "vault-withdraw";
  else if (has(text, ["send", "gửi"])) kind = "send";
  else if (has(text, ["swap", "đổi", "hoán đổi"])) kind = "swap";
  else if (has(text, ["bridge", "chuyển chuỗi", "chuyển sang base"])) kind = "bridge";
  if (!kind) return undefined;
  const amount = text.match(AMOUNT)?.[1]?.replace(",", ".");
  const assets = [...text.matchAll(/\b(usdc|eurc)\b/g)].map((match) => match[1].toUpperCase());
  const recipient = raw.match(ADDRESS)?.[0] ?? raw.match(ADDRESS_LIKE)?.[0];
  const source = text.match(/(?:from|từ)\s+(base sepolia|arc testnet|base|arc)/)?.[1];
  const destination = text.match(/(?:to|sang|đến)\s+(base sepolia|arc testnet|base|arc)/)?.[1];
  const missingFields: string[] = [];
  if (!amount) missingFields.push("amount");
  if (kind === "send" && !recipient) missingFields.push("recipient");
  if (kind === "swap" && assets.length < 2) missingFields.push("outputAsset");
  if (kind === "bridge" && !destination) missingFields.push("destinationChain");
  return Object.freeze({ kind, asset: assets[0] ?? "USDC", amount, recipient, sourceChain: titleChain(source) ?? "Arc Testnet", destinationChain: titleChain(destination), outputAsset: assets[1], rawUserText: raw, missingFields: Object.freeze(missingFields), executionEnabled: false });
}

function filterOf(text: string): AgentActivityFilter { if (has(text, ["swap", "hoán đổi"])) return "swap"; if (has(text, ["bridge", "chuyển chuỗi"])) return "bridge"; if (has(text, ["vault", "tiết kiệm"])) return "vault"; if (has(text, ["receive", "nhận"])) return "receive"; if (has(text, ["send", "gửi"])) return "send"; return "all"; }
function normalize(value: string) { return value.toLocaleLowerCase("vi-VN").normalize("NFC"); }
function has(value: string, terms: string[]) { return terms.some((term) => value.includes(term)); }
function titleChain(value?: string) { if (!value) return undefined; if (value === "arc") return "Arc Testnet"; if (value === "base") return "Base Sepolia"; return value.split(" ").map((part) => part[0].toUpperCase() + part.slice(1)).join(" "); }
function chainId(value?: string) { if (!value) return undefined; return value.startsWith("arc") ? 5_042_002 : value.startsWith("base") ? 84_532 : undefined; }
function isConditional(text: string) { return has(text, ["if i ", "what happens if", "nếu tôi", "nếu mình"]); }
