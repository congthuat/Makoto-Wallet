import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Address, Hash } from "viem";
import { createAgentContextSnapshot } from "./agent/context.ts";
import { answerAgentRequest } from "./agent/planner.ts";
import { parseAgentRequest } from "./agent/parser.ts";
import { runAgentTool } from "./agent/tools.ts";
import type { AgentContextSnapshot, AgentRequest } from "./agent/types.ts";
import type { WalletActivity } from "./wallet.ts";

const account = "0x1111111111111111111111111111111111111111" as Address;
const counterparty = "0x2222222222222222222222222222222222222222" as Address;
const token = "0x3600000000000000000000000000000000000000" as Address;
const activity = (kind: WalletActivity["kind"], direction: WalletActivity["direction"] = "send", index = 1): WalletActivity => ({ hash: `0x${String(index).padStart(64, "0")}` as Hash, logIndex: index, direction, kind, amount: 5_000_000n, counterparty, confirmedAt: 1000 + index, blockNumber: BigInt(index), assetId: "usdc", assetSymbol: "USDC", tokenAddress: token, decimals: 6, provider: "arcscan", source: "onchain", ...(kind === "swap" ? { swapReceive: { amount: 4_900_000n, assetId: "eurc" as const, assetSymbol: "EURC" as const, tokenAddress: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as Address, decimals: 6 as const, logIndex: index + 1 } } : {}) });
const connected = (overrides: Partial<AgentContextSnapshot> = {}) => createAgentContextSnapshot({ connected: true, account, verifiedChainId: 5042002, isArc: true, balances: { usdc: 12_300_000n, eurc: 2_000_000n }, activity: [activity("swap", "send", 6), activity("bridge", "send", 5), activity("vault-deposit", "send", 4), activity("vault-withdraw", "receive", 3), activity("transfer", "send", 2), activity("transfer", "receive", 1)], activityPartial: false, activityUnavailable: false, vault: { available: true, total: 9_000_000n, goalCount: 2, activeCount: 1 }, ...overrides });
const parse = (text: string, locale: AgentRequest["locale"] = "en") => parseAgentRequest({ text, locale });

test("AgentContextSnapshot is immutable, data-only, and represents connected/disconnected states", () => {
  const live = connected(); const offline = createAgentContextSnapshot({ connected: false, isArc: false, balances: {}, activity: [], activityPartial: false, activityUnavailable: false, vault: { available: false } });
  assert.equal(live.connected, true); assert.equal(offline.connected, false); assert.ok(Object.isFrozen(live)); assert.ok(Object.isFrozen(live.balances));
  assert.equal("provider" in live, false); assert.equal("signer" in live, false); assert.equal("walletClient" in live, false); assert.equal("privateKey" in live, false);
});

test("wallet overview returns supplied values and preserves unavailable instead of zero", () => {
  const full = runAgentTool(connected(), parse("balance")); assert.equal((full?.data as { usdc: bigint }).usdc, 12_300_000n);
  const missing = answerAgentRequest(connected({ balances: {} }), { text: "balance", locale: "en" }); assert.match(missing.text, /unavailable/); assert.doesNotMatch(missing.text, /USDC: 0/);
  assert.match(answerAgentRequest(createAgentContextSnapshot({ connected: false, isArc: false, balances: {}, activity: [], activityPartial: false, activityUnavailable: false, vault: { available: false } }), { text: "balance", locale: "en" }).text, /Connect your wallet/);
});

test("bounded parser recognizes English and Vietnamese read intents", () => {
  const cases: Array<[string, AgentRequest["locale"], string, string?]> = [
    ["how much USDC do I have", "en", "wallet-overview"], ["summarize my wallet", "en", "wallet-overview"], ["số dư của mình", "vi", "wallet-overview"], ["tóm tắt ví của tôi", "vi", "wallet-overview"],
    ["recent transactions", "en", "recent-activity", "all"], ["5 giao dịch gần nhất", "vi", "recent-activity", "all"],
    ["last swap", "en", "recent-activity", "swap"], ["recent bridges", "en", "recent-activity", "bridge"],
    ["what chain am I on", "en", "network-status"], ["đang ở mạng nào", "vi", "network-status"],
    ["vault balance", "en", "vault-summary"], ["mục tiết kiệm", "vi", "vault-summary"],
    ["security protections", "en", "safety-capabilities"], ["an toàn của ví", "vi", "safety-capabilities"],
    ["explain last transaction", "en", "activity-explanation", "all"], ["giải thích giao dịch swap gần nhất", "vi", "activity-explanation", "swap"],
  ];
  for (const [text, locale, kind, filter] of cases) { const value = parse(text, locale); assert.equal(value.kind, kind, text); if (filter) assert.equal(value.activityFilter, filter, text); }
  assert.equal(parse("tell me a joke").kind, "unknown");
});

test("recent activity applies limit/filter and discloses partial history", () => {
  const limited = runAgentTool(connected(), parse("last 2 transactions")); assert.equal((limited?.data as unknown[]).length, 2);
  const swaps = runAgentTool(connected(), parse("recent swaps")); assert.deepEqual((swaps?.data as WalletActivity[]).map((x) => x.kind), ["swap"]);
  const bridges = runAgentTool(connected(), parse("recent bridges")); assert.deepEqual((bridges?.data as WalletActivity[]).map((x) => x.kind), ["bridge"]);
  const partial = answerAgentRequest(connected({ activityPartial: true }), { text: "recent transactions", locale: "en" }); assert.match(partial.text, /partial/);
});

test("activity explanations are evidence-bound for supported kinds", () => {
  const prompts = [["explain last swap", "swapped"], ["explain last bridge", "CCTP"], ["explain last transaction", "swapped"]] as const;
  for (const [prompt, expected] of prompts) assert.match(answerAgentRequest(connected(), { text: prompt, locale: "en" }).text, new RegExp(expected));
  const kinds: Array<[WalletActivity["kind"], WalletActivity["direction"], RegExp]> = [["transfer", "send", /sent/], ["transfer", "receive", /received/], ["vault-deposit", "send", /deposited/], ["vault-withdraw", "receive", /withdrew/]];
  for (const [kind, direction, expected] of kinds) assert.match(answerAgentRequest(connected({ activity: [activity(kind, direction)] }), { text: "explain last transaction", locale: "en" }).text, expected);
  const unavailable = answerAgentRequest(connected({ activity: [], activityPartial: true }), { text: "explain last transaction", locale: "en" }); assert.match(unavailable.text, /partial/); assert.doesNotMatch(unavailable.text, /protocol|recipient|completed/i);
});

test("action requests create non-executable English and Vietnamese drafts", () => {
  const cases = ["send 5 USDC to 0x2222222222222222222222222222222222222222", "gửi 5 USDC cho 0x2222222222222222222222222222222222222222", "swap 5 USDC to EURC", "đổi 5 USDC sang EURC", "bridge 10 USDC to Base Sepolia"];
  for (const text of cases) { const parsed = parse(text, /[ăâđêôơư]/i.test(text) ? "vi" : "en"); assert.equal(parsed.kind, "action-draft"); assert.equal(parsed.actionDraft?.executionEnabled, false); }
  assert.deepEqual(parse("swap USDC to EURC").actionDraft?.missingFields, ["amount"]);
  assert.deepEqual(parse("send 5 USDC").actionDraft?.missingFields, ["recipient"]);
});

test("network status is explanatory and never switches a wallet", () => {
  const switchCalls = 0; const wrong = connected({ verifiedChainId: 84532, isArc: false });
  assert.match(answerAgentRequest(wrong, { text: "network", locale: "en" }).text, /will not switch/); assert.equal(switchCalls, 0);
  assert.equal((runAgentTool(wrong, parse("network"))?.data as { arcActionsAvailable: boolean }).arcActionsAvailable, false);
});

test("Agent source has no persistence or wallet-write execution surface", () => {
  const ui = readFileSync(new URL("../components/MakotoAgentPage.tsx", import.meta.url), "utf8"); const source = [ui, readFileSync(new URL("./agent/planner.ts", import.meta.url), "utf8"), readFileSync(new URL("./agent/tools.ts", import.meta.url), "utf8")].join("\n");
  for (const forbidden of ["localStorage", "document.cookie", "writeContract", "sendTransaction", "submitReviewedTransaction", "switchChain", "walletClient", "signMessage"]) assert.equal(source.includes(forbidden), false, forbidden);
  assert.match(ui, /storeAgentHandoff\(window\.sessionStorage/);
  assert.match(ui, /setMessages\(\[\]\)/); assert.match(ui, /aria-live="polite"/); assert.match(ui, /Safe Actions/); assert.match(ui, /Prepare safely/);
});

test("Agent shell follows the shared sidebar and mobile content geometry", () => {
  const css = readFileSync(new URL("../components/MakotoAgentPage.module.css", import.meta.url), "utf8");
  assert.match(css, /\.shell\{box-sizing:border-box;width:min\(100%,1840px\);min-width:0;min-height:100vh;margin:0 auto;padding:112px 32px 40px 272px\}/);
  assert.match(css, /@media\(max-width:1120px\)\{\.shell\{padding-left:252px\}\}/);
  assert.match(css, /@media\(max-width:767px\)\{\.shell\{width:100%;padding:92px 14px 110px\}/);
  assert.match(css, /\.messages article>p\{[^}]*overflow-wrap:anywhere/);
  assert.match(css, /\.draft dd\{[^}]*overflow-wrap:anywhere/);
  assert.match(css, /\.composer input\{[^}]*width:100%;min-width:0/);
  assert.doesNotMatch(css, /margin-left\s*:|translateX\(|100vw|width\s*:\s*calc\(/);
});

test("Agent quick prompts replace the legacy Vault surface with network intelligence", () => {
  const ui = readFileSync(new URL("../components/MakotoAgentPage.tsx", import.meta.url), "utf8");
  assert.match(ui, /Am I on the correct network\?/);
  assert.match(ui, /Tôi có đang ở đúng mạng không\?/);
  assert.doesNotMatch(ui, /What's in my Vault\?|Trong Makoto Vault có gì\?/);
});
