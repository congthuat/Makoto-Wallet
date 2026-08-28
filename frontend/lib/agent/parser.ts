import type { AgentActionDraft, AgentActivityFilter, AgentIntent, AgentRequest } from "./types.ts";

const ADDRESS = /0x[a-fA-F0-9]{40}/;
const ADDRESS_LIKE = /0x[^\s,;]+/i;
const AMOUNT = /(?:^|\s)(-?\d+(?:[.,]\d+)?|max|all|everything|entire balance)(?=\s|$)/i;

export function parseAgentRequest(request: AgentRequest): AgentIntent {
  const raw = request.text.trim(), text = normalize(raw);
  const limit = Math.min(20, Math.max(1, Number(text.match(/\b(\d{1,2})\b/)?.[1] ?? 5)));
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
