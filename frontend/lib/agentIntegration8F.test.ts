import assert from "node:assert/strict";
import test from "node:test";
import { getAddress } from "viem";
import { arcTestnet, baseSepolia } from "viem/chains";
import { createAgentContextSnapshot } from "./agent/context.ts";
import { parseAgentRequest } from "./agent/parser.ts";
import { routeAgentRequest } from "./agent/orchestration.ts";
import { runAgentCapability } from "./agent/tools.ts";
import { answerAgentRequest } from "./agent/planner.ts";
import { consumeAgentHandoff, storeAgentHandoff } from "./agent/actions/handoff.ts";
import type { QuoteContext } from "./agent/quoteTools.ts";

const account = getAddress("0x1111111111111111111111111111111111111111");
const recipient = getAddress("0x2222222222222222222222222222222222222222");
const at = 1_000_000;
const balance = { usdc: 100_000_000n, eurc: 50_000_000n, cirbtc: 200_000_000n };
const snapshot = (overrides: Partial<Parameters<typeof createAgentContextSnapshot>[0]> = {}) => createAgentContextSnapshot({ connected: true, account, accountKind: "external", walletStatus: "connected", verifiedChainId: arcTestnet.id, isArc: true, balances: balance, activity: [], activityLoadState: "loaded", vault: { available: false }, timestamp: at, ...overrides });
const quoteContext = (overrides: Partial<QuoteContext> = {}): QuoteContext => ({ snapshot: snapshot(), now: () => at, reads: { readBalance: async (_owner, asset) => balance[asset], readAllowance: async () => 0n }, services: { estimateSendMaximumFee: async () => 1_000_000_000_000_000n, readXyloOutput: async () => ({ amountOut: 9_000_000n, quotedAt: at }), readDirectCctpFee: async () => ({ finalityThreshold: 2000, minimumFee: 1, forwardFeeMed: "200000", quotedAt: at }) }, ...overrides });
const intent = (text: string) => parseAgentRequest({ text, locale: "en" });
async function ask(text: string, ctx = quoteContext()) {
  const input = intent(text), decision = routeAgentRequest(input);
  const output = await runAgentCapability({ snapshot: ctx.snapshot, quoteContext: ctx, now: at, binding: { generation: 1, account: ctx.snapshot.account, chainId: ctx.snapshot.verifiedChainId } }, input, decision);
  return { output, response: answerAgentRequest(ctx.snapshot, input, decision, output) };
}

test("Agent READ uses validated wallet state and keeps a locked local wallet present", async () => {
  const local = snapshot({ connected: false, accountKind: "local", walletStatus: "locked" });
  const input = intent("balance"), decision = routeAgentRequest(input);
  const output = await runAgentCapability({ snapshot: local, now: at, binding: { generation: 1, account, chainId: arcTestnet.id } }, input, decision);
  assert.equal(output.result?.read?.tool, "assets.balances");
  assert.equal(output.result?.ok, true);
  assert.match(answerAgentRequest(local, input, decision, output).text, /locked/i);
  assert.doesNotMatch(answerAgentRequest(local, input, decision, output).text, /0 USDC/);
});

test("Agent SEND quote and preparation use canonical status, quote binding, and no execution authority", async () => {
  const quoted = await ask(`Can I afford sending 10 USDC to ${recipient}?`);
  assert.equal(quoted.output.quote?.tool, "send.quote");
  assert.equal(quoted.output.quote?.status, "AVAILABLE");
  assert.equal(quoted.output.quote?.provider, "Arc RPC");
  const prepared = await ask(`Prepare a send of 10 USDC to ${recipient}`);
  assert.equal(prepared.output.prepared?.status, "PREPARED");
  if (prepared.output.prepared?.status !== "PREPARED") return;
  assert.equal(prepared.output.prepared.data.executionEnabled, false);
  assert.equal(prepared.output.prepared.data.steps[0].kind, "send");
  assert.equal(prepared.output.prepared.data.handoff?.action, "send");
  assert.equal(prepared.response.actionDraft?.kind, "send");
  assert.match(prepared.response.text, /review and confirmation/i);
});

test("Agent Xylo SWAP uses canonical quote and local-wallet prepared handoff", async () => {
  const ctx = quoteContext({ snapshot: snapshot({ accountKind: "local" }) });
  const quoted = await ask("How much would I get swapping 10 USDC to EURC?", ctx);
  assert.equal(quoted.output.quote?.provider, "XyloNet StableSwap");
  assert.equal(quoted.output.quote?.status, "AVAILABLE");
  const prepared = await ask("Prepare a swap of 10 USDC to EURC", ctx);
  assert.equal(prepared.output.prepared?.status, "PREPARED");
  if (prepared.output.prepared?.status === "PREPARED") {
    assert.equal(prepared.output.prepared.data.handoff?.action, "swap");
    assert.deepEqual(prepared.output.prepared.data.steps.map((step) => step.kind), ["finite-approval", "swap"]);
    assert.equal(prepared.output.prepared.data.steps[1].requiresConfirmedPriorStep, true);
  }
});

test("Agent Direct CCTP prepares ordered data but offers no incompatible Bridge handoff", async () => {
  const quoted = await ask("How much does it cost to bridge 10 USDC from Arc to Base Sepolia?");
  assert.equal(quoted.output.quote?.provider, "Circle CCTP V2 Forwarding");
  assert.equal(quoted.output.quote?.destinationChainId, baseSepolia.id);
  const prepared = await ask("Prepare a bridge of 10 USDC from Arc to Base Sepolia");
  assert.equal(prepared.output.prepared?.status, "PREPARED");
  if (prepared.output.prepared?.status === "PREPARED") {
    assert.equal(prepared.output.prepared.data.executionEnabled, false);
    assert.equal(prepared.output.prepared.data.handoff, undefined);
    assert.deepEqual(prepared.output.prepared.data.steps.map((step) => step.kind), ["finite-approval", "cctp-burn"]);
  }
  assert.equal(prepared.response.actionDraft, undefined);
  assert.match(prepared.response.text, /No compatible wallet handoff/);
});

test("Agent preserves unsupported, expired, unavailable, and invalid schema truth", async () => {
  const unsupported = await ask("How much would I get swapping 10 cirBTC to EURC?");
  assert.equal(unsupported.output.quote?.status, "UNSUPPORTED");
  assert.equal(unsupported.output.error, "ROUTE_UNAVAILABLE");
  const expired = await ask("How much would I get swapping 10 USDC to EURC?", quoteContext({ services: { readXyloOutput: async () => ({ amountOut: 9_000_000n, quotedAt: at - 100_000 }) } }));
  assert.equal(expired.output.quote?.status, "EXPIRED");
  assert.equal(expired.output.error, "QUOTE_EXPIRED");
  const unavailable = await ask("How much would I get swapping 10 USDC to EURC?", quoteContext({ services: { readXyloOutput: async () => { throw Error("private provider details"); } } }));
  assert.equal(unavailable.output.quote?.status, "UNAVAILABLE");
  assert.equal(unavailable.output.error, "QUOTE_FAILED");
  assert.doesNotMatch(unavailable.response.text, /private provider details/);
  const malformed = await ask(`Can I afford sending 10 USDC to ${recipient}?`, quoteContext({ services: { estimateSendMaximumFee: async () => "bad" as never } }));
  assert.equal(malformed.output.error, "DATA_UNAVAILABLE");
});

test("cirBTC Send handoff retains eight decimals, account binding, expiry, and one-time use", async () => {
  const prepared = await ask(`Prepare a send of 0.12345678 cirBTC to ${recipient}`);
  assert.equal(prepared.output.prepared?.status, "PREPARED");
  if (prepared.output.prepared?.status !== "PREPARED") return;
  const handoff = prepared.output.prepared.data.handoff!;
  assert.equal(handoff.asset, "cirBTC");
  assert.equal(handoff.amount, "0.12345678");
  const values = new Map<string, string>();
  const store = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  storeAgentHandoff(store, handoff);
  assert.equal(consumeAgentHandoff(store, handoff.id, recipient, at), undefined);
  storeAgentHandoff(store, handoff);
  assert.equal(consumeAgentHandoff(store, handoff.id, account, at)?.path, "/");
  assert.equal(consumeAgentHandoff(store, handoff.id, account, at), undefined);
  storeAgentHandoff(store, handoff);
  assert.equal(consumeAgentHandoff(store, handoff.id, account, handoff.expiresAt + 1), undefined);
  storeAgentHandoff(store, { ...handoff, signer: "injected" } as never);
  assert.equal(consumeAgentHandoff(store, handoff.id, account, at), undefined);
});
