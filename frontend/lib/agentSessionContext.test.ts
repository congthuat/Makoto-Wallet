import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseAgentRequest } from "./agent/parser.ts";
import { answerAgentRequest } from "./agent/planner.ts";
import { resolveAgentPlanning, type AgentPlanningServices } from "./agent/planning.ts";
import {
  AGENT_SESSION_CONTEXT_KEY,
  AGENT_SESSION_CONTEXT_TTL_MS,
  clearAgentSessionContext,
  createAgentRequestGeneration,
  readAgentSessionContext,
  storeAgentSessionContext,
  updateAgentSessionContext,
  type AgentSessionContext,
} from "./agent/sessionContext.ts";
import type { AgentContextSnapshot } from "./agent/types.ts";
import { requestSwapPlanningData } from "./swapPlanning.ts";
import { requestBridgePlanningData } from "./circle/bridgePlanning.ts";

const account = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const now = 2_000_000;
const binding = { account, chainId: 5_042_002 } as const;

class MemoryStore {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

type GuardedState = { messages: string[]; previousIntent?: string; context?: AgentSessionContext; draft?: string };

async function guardedCompletion(
  generation: ReturnType<typeof createAgentRequestGeneration>,
  pending: Promise<GuardedState>,
  commit: (result: GuardedState) => void,
) {
  const captured = generation.capture();
  const result = await pending;
  if (!generation.isCurrent(captured)) return;
  commit(result);
}

function swapContext(updatedAt = now): AgentSessionContext {
  return Object.freeze({ version: 1, activeTopic: "swap", updatedAt, account, chainId: 5_042_002, swap: Object.freeze({ inputAsset: "usdc", outputAsset: "eurc", amount: "20", slippage: 0.005 }), lastPlanningIntent: "swap-quote", lastPlanningAt: updatedAt });
}

function bridgeContext(updatedAt = now): AgentSessionContext {
  return Object.freeze({ version: 1, activeTopic: "bridge", updatedAt, account, chainId: 5_042_002, bridge: Object.freeze({ asset: "usdc", sourceChainId: 5_042_002, destinationChainId: 84_532, amount: "10" }), lastPlanningIntent: "bridge-estimate", lastPlanningAt: updatedAt });
}

function parse(text: string, context?: AgentSessionContext, locale: "en" | "vi" = "en") {
  return parseAgentRequest({ text, locale, sessionContext: context });
}

test("session context hydrates only a valid versioned, account-bound and chain-bound schema", () => {
  const store = new MemoryStore();
  storeAgentSessionContext(store, swapContext());
  assert.deepEqual(readAgentSessionContext(store, binding, now), swapContext());
  assert.equal(readAgentSessionContext(store, { account: other, chainId: 5_042_002 }, now), undefined);
  assert.equal(store.getItem(AGENT_SESSION_CONTEXT_KEY), null);

  for (const invalid of [
    { ...swapContext(), version: 2 },
    { ...swapContext(), quote: "18.4" },
    { ...swapContext(), swap: { ...swapContext().swap, slippage: 0.01 } },
    { ...swapContext(), account: "invalid" },
  ]) {
    store.setItem(AGENT_SESSION_CONTEXT_KEY, JSON.stringify(invalid));
    assert.equal(readAgentSessionContext(store, binding, now), undefined);
  }
});

test("session context rejects malformed JSON, future timestamps and deterministic 20-minute expiry", () => {
  const store = new MemoryStore();
  store.setItem(AGENT_SESSION_CONTEXT_KEY, "{");
  assert.equal(readAgentSessionContext(store, binding, now), undefined);
  storeAgentSessionContext(store, swapContext(now + 1));
  assert.equal(readAgentSessionContext(store, binding, now), undefined);
  storeAgentSessionContext(store, swapContext(now - AGENT_SESSION_CONTEXT_TTL_MS + 1));
  assert.ok(readAgentSessionContext(store, binding, now));
  storeAgentSessionContext(store, swapContext(now - AGENT_SESSION_CONTEXT_TTL_MS));
  assert.equal(readAgentSessionContext(store, binding, now), undefined);
});

test("chain binding and explicit clear remove the single tab-scoped context entry", () => {
  const store = new MemoryStore();
  storeAgentSessionContext(store, swapContext());
  assert.equal(readAgentSessionContext(store, { account, chainId: 84_532 }, now), undefined);
  storeAgentSessionContext(store, swapContext());
  clearAgentSessionContext(store);
  assert.equal(store.getItem(AGENT_SESSION_CONTEXT_KEY), null);
});

test("request generation prevents clear from resurrecting messages, context, intent, or drafts", async () => {
  const generation = createAgentRequestGeneration();
  const pending = deferred<GuardedState>();
  const store = new MemoryStore();
  storeAgentSessionContext(store, swapContext());
  const state: GuardedState = { messages: [] };
  const request = guardedCompletion(generation, pending.promise, (result) => {
    Object.assign(state, result);
    if (result.context) storeAgentSessionContext(store, result.context);
  });
  generation.invalidate();
  state.messages = [];
  state.previousIntent = undefined;
  state.context = undefined;
  state.draft = undefined;
  clearAgentSessionContext(store);
  pending.resolve({ messages: ["stale answer"], previousIntent: "swap-quote", context: swapContext(), draft: "stale preparation" });
  await request;
  assert.deepEqual(state, { messages: [], previousIntent: undefined, context: undefined, draft: undefined });
  assert.equal(store.getItem(AGENT_SESSION_CONTEXT_KEY), null);
});

test("a new request after clear wins even when the old request resolves last", async () => {
  const generation = createAgentRequestGeneration();
  const oldPending = deferred<GuardedState>();
  const newPending = deferred<GuardedState>();
  const state: GuardedState = { messages: [] };
  const oldRequest = guardedCompletion(generation, oldPending.promise, (result) => Object.assign(state, result));
  generation.invalidate();
  const newRequest = guardedCompletion(generation, newPending.promise, (result) => Object.assign(state, result));
  newPending.resolve({ messages: ["new answer"], context: bridgeContext(now + 1) });
  await newRequest;
  oldPending.resolve({ messages: ["old answer"], context: swapContext() });
  await oldRequest;
  assert.deepEqual(state.messages, ["new answer"]);
  assert.equal(state.context?.activeTopic, "bridge");
});

test("disconnect, account change, and chain change invalidate pending completions", async () => {
  for (const event of ["disconnect", "account-change", "chain-change"]) {
    const generation = createAgentRequestGeneration();
    const pending = deferred<GuardedState>();
    const state: GuardedState = { messages: [] };
    const request = guardedCompletion(generation, pending.promise, (result) => Object.assign(state, result));
    generation.invalidate();
    pending.resolve({ messages: [`stale ${event}`], context: swapContext(), draft: "stale preparation" });
    await request;
    assert.deepEqual(state, { messages: [] }, event);
  }
});

test("current request generation completes normally", async () => {
  const generation = createAgentRequestGeneration();
  const pending = deferred<GuardedState>();
  const state: GuardedState = { messages: [] };
  const request = guardedCompletion(generation, pending.promise, (result) => Object.assign(state, result));
  pending.resolve({ messages: ["current answer"], previousIntent: "swap-quote", context: swapContext() });
  await request;
  assert.deepEqual(state.messages, ["current answer"]);
  assert.equal(state.previousIntent, "swap-quote");
  assert.equal(state.context?.activeTopic, "swap");
});

test("Swap amount, minimum, allowance and affordability follow-ups reuse parameters only", () => {
  const context = swapContext();
  const amount = parse("What about 30?", context);
  assert.deepEqual([amount.kind, amount.amount, amount.assetId, amount.outputAssetId], ["swap-quote", "30", "usdc", "eurc"]);
  assert.equal(parse("Còn 30 thì sao?", context, "vi").kind, "swap-quote");
  assert.equal(parse("What's the minimum received?", context).kind, "swap-quote");
  assert.equal(parse("Is my allowance enough?", context).kind, "swap-allowance");
  assert.equal(parse("Có cần approve không?", context, "vi").kind, "swap-allowance");
  assert.equal(parse("Can I afford it?", context).kind, "swap-affordability");
  assert.equal(parse("Tôi có đủ không?", context, "vi").kind, "swap-affordability");
});

test("Bridge amount, fee and route follow-ups work across English and Vietnamese", () => {
  const context = bridgeContext();
  const amount = parse("What about 20?", context);
  assert.deepEqual([amount.kind, amount.amount, amount.sourceChainId, amount.destinationChainId], ["bridge-estimate", "20", 5_042_002, 84_532]);
  assert.equal(parse("Còn 20 thì sao?", context, "vi").kind, "bridge-estimate");
  assert.equal(parse("What is the fee?", context).kind, "bridge-estimate");
  assert.equal(parse("Is that route available?", context).kind, "bridge-route");
});

test("conditional Bridge questions remain planning while explicit setup remains a draft", () => {
  assert.equal(parse("What if I bridge 10 USDC from Arc to Base?").kind, "bridge-estimate");
  assert.equal(parse("Nếu tôi bridge 10 USDC từ Arc sang Base?", undefined, "vi").kind, "bridge-estimate");
  assert.equal(parse("Set up a bridge of 10 USDC from Arc to Base.").kind, "action-draft");
});

test("missing, expired and Send-incompatible context produce structured clarification", () => {
  assert.deepEqual([parse("What about 30?").kind, parse("What about 30?").clarification], ["clarification", "missing-topic"]);
  assert.equal(parse("How much will I get?").clarification, "swap-or-bridge");
  const send = updateAgentSessionContext(undefined, { kind: "send-affordability", locale: "en", amount: "5", assetId: "usdc" }, binding, now)!;
  assert.deepEqual([parse("Do I need approval?", send).kind, parse("Do I need approval?", send).clarification], ["clarification", "approval-topic"]);
  const store = new MemoryStore();
  storeAgentSessionContext(store, swapContext(now - AGENT_SESSION_CONTEXT_TTL_MS));
  assert.equal(parse("What about 30?", readAgentSessionContext(store, binding, now)).kind, "clarification");
  const response = answerAgentRequest({ connected: false, isArc: false, balances: {}, activity: [], activityPartial: false, activityUnavailable: false, vault: { available: false }, safetyCapabilities: [], timestamp: now }, { text: "What about 0.03?", locale: "en" });
  assert.match(response.text, /^0\.03 of which asset/);
});

test("explicit incompatible topics replace context and conflicting Swap parameters do not merge", () => {
  const bridgeIntent = parse("How much would it cost to bridge 10 USDC from Arc to Base?", swapContext());
  const next = updateAgentSessionContext(swapContext(), bridgeIntent, binding, now + 1)!;
  assert.equal(next.activeTopic, "bridge");
  assert.equal(next.swap, undefined);
  const reverse = Object.freeze({ ...swapContext(), swap: Object.freeze({ inputAsset: "eurc" as const, outputAsset: "usdc" as const, amount: "20", slippage: 0.005 }) });
  const draft = parse("Prepare a swap of 5 USDC.", reverse);
  assert.equal(draft.actionDraft?.outputAsset, undefined);
  assert.ok(draft.actionDraft?.missingFields.includes("outputAsset"));
});

test("complete context may hydrate an explicit preparation draft without execution authority", () => {
  const draft = parse("Prepare that swap.", swapContext());
  assert.equal(draft.kind, "action-draft");
  assert.deepEqual([draft.actionDraft?.amount, draft.actionDraft?.asset, draft.actionDraft?.outputAsset], ["20", "USDC", "EURC"]);
  assert.equal(draft.actionDraft?.executionEnabled, false);
});

test("each dynamic Swap and Bridge follow-up invokes fresh planning services", async () => {
  let swapQuotes = 0, bridgeRoutes = 0, bridgeFees = 0;
  const services: AgentPlanningServices = {
    estimateSendMaximumFee: async () => undefined,
    planSwap: (request) => requestSwapPlanningData(request, {
      readBalance: async () => 100_000_000n,
      readQuote: async () => ({ amountOut: BigInt(++swapQuotes) * 1_000_000n, quotedAt: now }),
      readAllowance: async () => 100_000_000n,
      estimateApprovalGas: async () => 1n,
      simulateApproval: async () => "PASSED",
      estimateSwapGasEnvelope: async () => ({ gasLimit: 1n, maxFeePerGas: 1n, rawMaxFee18: 1n, feeUsdc6: 1n, preparedAt: now, walletEstimateUsed: true }),
      simulateSwap: async () => "PASSED",
    }),
    planBridge: (request) => requestBridgePlanningData(request, {
      routeAvailable: async () => { bridgeRoutes++; return true; },
      estimateBridge: async () => { bridgeFees++; return { quotedAt: now, sourceDebit: request.amount, expectedReceive: request.amount, approvalAmount: request.amount, fees: [] }; },
      readSourceBalance: async () => 100_000_000n,
      readAllowance: async () => 100_000_000n,
      estimateApprovalGas: async () => 1n,
      simulateBurn: async () => "PASSED",
    }),
  };
  const snapshot: AgentContextSnapshot = Object.freeze({ connected: true, account, verifiedChainId: 5_042_002, isArc: true, balances: Object.freeze({ usdc: 100_000_000n, eurc: 100_000_000n }), activity: Object.freeze([]), activityPartial: false, activityUnavailable: false, vault: Object.freeze({ available: true }), safetyCapabilities: Object.freeze([]), timestamp: now });
  await resolveAgentPlanning(snapshot, parse("What about 30?", swapContext()), services);
  const second = await resolveAgentPlanning(snapshot, parse("What is the minimum?", swapContext()), services);
  assert.equal(swapQuotes, 2);
  assert.equal(second?.swap?.expectedOutput, 2_000_000n);
  await resolveAgentPlanning(snapshot, parse("What is the fee?", bridgeContext()), services);
  await resolveAgentPlanning(snapshot, parse("Is that route available?", bridgeContext()), services);
  assert.equal(bridgeRoutes, 2);
  assert.equal(bridgeFees, 2);
});

test("session memory source is parameter-only, sessionStorage-only and has no execution authority", () => {
  const source = readFileSync(new URL("./agent/sessionContext.ts", import.meta.url), "utf8");
  for (const forbidden of ["localStorage", "indexedDB", "fetch(", "provider", "signer", "walletClient", "connector", "callback", "calldata", "sendTransaction", "private key", "seed phrase", "signature"]) assert.equal(source.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
  const serialized = JSON.stringify(swapContext());
  for (const forbidden of ["\"quote\":", "minimumReceived", "allowance", "balance", "gas", "fees", "recipient", "calldata", "transactionHash"]) assert.equal(serialized.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
});

test("Dashboard and Agent page share the same session-context hook while messages remain local", () => {
  const hook = readFileSync(new URL("../hooks/useMakotoAgent.ts", import.meta.url), "utf8");
  const dashboard = readFileSync(new URL("../components/WalletDashboard.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../components/MakotoAgentPage.tsx", import.meta.url), "utf8");
  assert.match(hook, /readAgentSessionContext\(window\.sessionStorage/);
  assert.match(hook, /storeAgentSessionContext\(window\.sessionStorage/);
  assert.match(hook, /setMessages\(\[\]\)[\s\S]*previousIntent\.current = undefined[\s\S]*clearAgentSessionContext\(window\.sessionStorage\)/);
  assert.match(hook, /if \(!binding \|\| previousBinding\.current && previousBinding\.current !== binding\)/);
  assert.match(hook, /\[snapshot\.account, snapshot\.connected, snapshot\.verifiedChainId\]/);
  assert.doesNotMatch(hook, /const request = \{[^\n]*previousIntent/);
  assert.match(hook, /previousBinding\.current === `\$\{binding\.account\.toLowerCase\(\)\}:\$\{binding\.chainId\}`/);
  assert.match(dashboard, /useMakotoAgent\(/);
  assert.match(page, /useMakotoAgent\(/);
  assert.match(page, /onClick=\{clearConversation\}/);
  assert.match(page, /disabled=\{!messages\.length && !hasSessionContext\}/);
  assert.doesNotMatch(hook, /storeAgentSessionContext[^\n]*messages/);
});
