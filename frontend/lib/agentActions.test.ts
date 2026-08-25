import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseActionDraft } from "./agent/parser.ts";
import { handoffUrl, prepareAgentActionHandoff, validateAgentActionDraft } from "./agent/actions/index.ts";

const recipient = "0x1111111111111111111111111111111111111111";

for (const [label, phrase, kind] of [
  ["EN Send", `send 5 USDC to ${recipient}`, "send"], ["VI Send", `gửi 5 USDC cho ${recipient}`, "send"],
  ["EN Swap", "swap 5 USDC to EURC", "swap"], ["VI Swap", "đổi 5 USDC sang EURC", "swap"],
  ["EN Bridge", "bridge 5 USDC to Base Sepolia", "bridge"], ["VI Bridge", "chuyển chuỗi 5 USDC sang Base Sepolia", "bridge"],
  ["EN Vault deposit", "deposit 5 USDC into my Vault", "vault-deposit"], ["VI Vault deposit", "gửi 5 USDC vào Vault", "vault-deposit"],
  ["EN Vault withdraw", "withdraw 5 USDC from Vault", "vault-withdraw"], ["VI Vault withdraw", "rút 5 USDC khỏi Vault", "vault-withdraw"],
] as const) test(`${label} creates a data-only ${kind} draft`, () => { const draft = parseActionDraft(phrase)!; assert.equal(draft.kind, kind); assert.equal(draft.executionEnabled, false); });

test("missing and unsafe Send recipients are blocked", () => {
  assert.deepEqual(validateAgentActionDraft(parseActionDraft("send 5 USDC")!).missingFields, ["recipient"]);
  for (const value of ["0x1234", "0x0000000000000000000000000000000000000000"]) assert.equal(validateAgentActionDraft(parseActionDraft(`send 5 USDC to ${value}`)!).valid, false);
});

test("missing, zero, negative, excessive precision, and MAX amounts are blocked", () => {
  for (const phrase of [`send USDC to ${recipient}`, `send 0 USDC to ${recipient}`, `send -1 USDC to ${recipient}`, `send 1.0000001 USDC to ${recipient}`, "swap max USDC to EURC"]) assert.equal(validateAgentActionDraft(parseActionDraft(phrase)!).valid, false, phrase);
  assert.match(validateAgentActionDraft(parseActionDraft("swap max USDC to EURC")!).errors[0], /MAX/);
});

test("swap requires a distinct supported output asset", () => {
  assert.deepEqual(validateAgentActionDraft(parseActionDraft("swap 5 USDC")!).missingFields, ["outputAsset"]);
  assert.equal(validateAgentActionDraft(parseActionDraft("swap 5 USDC to USDC")!).valid, false);
});

test("bridge requires a distinct supported destination and defaults to Universal handoff", () => {
  assert.deepEqual(validateAgentActionDraft(parseActionDraft("bridge 5 USDC")!).missingFields, ["destinationChain"]);
  const prepared = prepareAgentActionHandoff(parseActionDraft("bridge 5 USDC to Base Sepolia")!);
  assert.equal(prepared.handoff?.path, "/unified-balance");
  assert.equal(handoffUrl(prepared.handoff!).includes("cctp-direct"), false);
});

test("Prepare safely yields only a structured handoff and no signing client", () => {
  const prepared = prepareAgentActionHandoff(parseActionDraft(`send 5 USDC to ${recipient}`)!);
  assert.equal(prepared.status, "preparing"); assert.equal(prepared.transactionIntent, undefined); assert.equal(prepared.reviewSnapshot, undefined);
  assert.match(handoffUrl(prepared.handoff!), /source=makoto-agent/);
  assert.equal(JSON.stringify(prepared).includes("privateKey"), false);
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
