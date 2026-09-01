import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseActionDraft } from "./agent/parser.ts";
import { createAgentActionDraft, routeAgentRequest } from "./agent/orchestration.ts";
import type { AgentIntent } from "./agent/types.ts";
import { bindAgentHandoffJar, consumeAgentHandoff, consumeAgentResult, handoffUrl, prepareAgentActionHandoff, storeAgentHandoff, storeAgentResult } from "./agent/actions/index.ts";

const recipient = "0x1111111111111111111111111111111111111111";
const readyPlanning = { kind: "send-affordability", status: "ready", dataTimestamp: 1_000, expiresAt: 2_000, refreshRequired: false, completeness: "complete", blockingReasons: [] } as const;
function draft(phrase: string) { const preparation = parseActionDraft(phrase)!; return createAgentActionDraft({ kind: "prepare-action", locale: "en", preparation } as AgentIntent, readyPlanning)!; }

for (const [label, phrase, kind] of [
  ["EN Send", `send 5 USDC to ${recipient}`, "send"], ["VI Send", `gửi 5 USDC cho ${recipient}`, "send"],
  ["EN Swap", "swap 5 USDC to EURC", "swap"], ["VI Swap", "đổi 5 USDC sang EURC", "swap"],
  ["EN Bridge", "bridge 5 USDC to Base Sepolia", "bridge"], ["VI Bridge", "chuyển chuỗi 5 USDC sang Base Sepolia", "bridge"],
  ["EN Vault deposit", "deposit 5 USDC into my Vault", "vault-deposit"], ["VI Vault deposit", "gửi 5 USDC vào Vault", "vault-deposit"],
  ["EN Vault withdraw", "withdraw 5 USDC from Vault", "vault-withdraw"], ["VI Vault withdraw", "rút 5 USDC khỏi Vault", "vault-withdraw"],
] as const) test(`${label} creates a data-only ${kind} draft`, () => { const value = draft(phrase); assert.equal(value.kind, kind); assert.equal(value.executionEnabled, false); assert.equal(value.mode, "prepare-only"); });

test("missing and unsafe Send recipients are blocked", () => {
  assert.equal(routeAgentRequest({ kind: "prepare-action", locale: "en", preparation: parseActionDraft("send 5 USDC")! }).mode, "clarification");
  for (const value of ["0x1234", "0x0000000000000000000000000000000000000000"]) assert.equal(routeAgentRequest({ kind: "prepare-action", locale: "en", preparation: parseActionDraft(`send 5 USDC to ${value}`)! }).draftAllowed, false);
});

test("missing, zero, negative, excessive precision, and MAX amounts are blocked", () => {
  for (const phrase of [`send USDC to ${recipient}`, `send 0 USDC to ${recipient}`, `send -1 USDC to ${recipient}`, `send 1.0000001 USDC to ${recipient}`, "swap max USDC to EURC"]) assert.equal(createAgentActionDraft({ kind: "prepare-action", locale: "en", preparation: parseActionDraft(phrase)! }, readyPlanning), undefined, phrase);
});

test("swap requires a distinct supported output asset", () => {
  assert.equal(routeAgentRequest({ kind: "prepare-action", locale: "en", preparation: parseActionDraft("swap 5 USDC")! }).mode, "clarification");
  assert.equal(routeAgentRequest({ kind: "prepare-action", locale: "en", preparation: parseActionDraft("swap 5 USDC to USDC")! }).draftAllowed, false);
});

test("bridge requires a distinct supported destination and defaults to Universal handoff", () => {
  assert.equal(routeAgentRequest({ kind: "prepare-action", locale: "en", preparation: parseActionDraft("bridge 5 USDC")! }).mode, "clarification");
  const prepared = prepareAgentActionHandoff(draft("bridge 5 USDC to Base Sepolia"), recipient, 1_000);
  assert.equal(prepared.handoff?.path, "/");
  assert.equal(handoffUrl(prepared.handoff!).includes("cctp-direct"), false);
});

test("Prepare safely yields only a structured handoff and no signing client", () => {
  const prepared = prepareAgentActionHandoff(draft(`send 5 USDC to ${recipient}`), recipient, 1_000);
  assert.equal(prepared.status, "preparing"); assert.equal(prepared.transactionIntent, undefined); assert.equal(prepared.reviewSnapshot, undefined);
  assert.match(handoffUrl(prepared.handoff!), /agentHandoff=/);
  assert.equal(JSON.stringify(prepared).includes("privateKey"), false);
});

function memoryStore() { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value), removeItem: (key: string) => void values.delete(key) }; }

test("handoff is account-bound, expires, and is consumed only once", () => {
  const handoff = prepareAgentActionHandoff(draft(`send 5 USDC to ${recipient}`), recipient, 1_000).handoff!, store = memoryStore();
  storeAgentHandoff(store, handoff); assert.equal(consumeAgentHandoff(store, handoff.id, recipient, 2_000)?.id, handoff.id); assert.equal(consumeAgentHandoff(store, handoff.id, recipient, 2_000), undefined);
  storeAgentHandoff(store, handoff); assert.equal(consumeAgentHandoff(store, handoff.id, "0x2222222222222222222222222222222222222222", 2_000), undefined);
  storeAgentHandoff(store, handoff); assert.equal(consumeAgentHandoff(store, handoff.id, recipient, handoff.expiresAt + 1), undefined);
});

test("Vault selection binds the exact goal and regenerates a one-time id", () => {
  const handoff = prepareAgentActionHandoff(draft("withdraw 5 USDC from Vault"), recipient, 1_000).handoff!, selected = bindAgentHandoffJar(handoff, 42n, 2_000);
  assert.equal(selected.jarId, "42"); assert.notEqual(selected.id, handoff.id); assert.equal(selected.action, "vault-withdraw");
});

test("Agent results are account-bound, factual data-only, and consumed once", () => {
  const store = memoryStore(), result = { id: "result", account: recipient, action: "send" as const, status: "confirmed" as const, createdAt: 1_000, amount: "5", asset: "USDC", transactionHash: "0xabc" };
  storeAgentResult(store, result); assert.deepEqual(consumeAgentResult(store, recipient), result); assert.equal(consumeAgentResult(store, recipient), undefined);
});

test("Agent action source contains no wallet or network request", () => {
  const sources = ["../components/MakotoAgentPage.tsx", "./agent/actions/prepare.ts", "./agent/actions/validation.ts", "./agent/parser.ts"].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
  for (const forbidden of ["writeContract", "sendTransaction", "submitReviewedTransaction", "switchChain", "walletClient", "signMessage", "maxUint256"]) assert.equal(sources.includes(forbidden), false, forbidden);
  assert.match(sources, /Prepare safely/);
});

test("shared orchestrator retains expiry, final revalidation, and double-submit guard", () => {
  const source = readFileSync(new URL("./transactionOrchestrator.ts", import.meta.url), "utf8");
  assert.match(source, /TransactionReviewSnapshot/); assert.match(source, /revalidateTransactionReview/); assert.match(source, /ReviewSubmissionGuard/); assert.match(source, /expiresAt/);
});
