import assert from "node:assert/strict";
import test from "node:test";
import type { Address, Hash } from "viem";

import { createAgentContextSnapshot } from "./agent/context.ts";
import { deriveActivityLoadState } from "./activityLoadState.ts";
import { answerAgentRequest as formatAgentRequest } from "./agent/planner.ts";
import { parseAgentRequest } from "./agent/parser.ts";
import { createAgentActionDraft, routeAgentRequest } from "./agent/orchestration.ts";
import { blockingExplanation, confirmedSpendingToday, explainBlocking, latestConfirmedTransaction, planSend, resolveAgentPlanning } from "./agent/planning.ts";
import type { AgentContextSnapshot, AgentIntent, AgentRequest } from "./agent/types.ts";
import { prepareAgentActionHandoff } from "./agent/actions/prepare.ts";
import type { WalletActivity } from "./wallet.ts";

const account = "0x1111111111111111111111111111111111111111" as Address;
const recipient = "0x2222222222222222222222222222222222222222" as Address;
const usdc = "0x3600000000000000000000000000000000000000" as Address;
const eurc = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as Address;
const now = Date.UTC(2026, 7, 30, 12);

function activity(index: number, input: Partial<WalletActivity> = {}): WalletActivity {
  return { hash: `0x${index.toString(16).padStart(64, "0")}` as Hash, logIndex: index, direction: "send", kind: "transfer", amount: 1_000_000n, counterparty: recipient, confirmedAt: now - index * 1_000, blockNumber: BigInt(index), assetId: "usdc", assetSymbol: "USDC", tokenAddress: usdc, decimals: 6, source: "onchain", provider: "arcscan", ...input };
}
function snapshot(overrides: Partial<AgentContextSnapshot> = {}) {
  return createAgentContextSnapshot({ connected: true, account, verifiedChainId: 5042002, isArc: true, balances: { usdc: 10_000_000n, eurc: 5_000_000n }, activity: [activity(2), activity(1)], activityPartial: false, activityUnavailable: false, vault: { available: false }, timestamp: now, ...overrides });
}
function intent(kind: "send-affordability" | "send-remaining", amount = "9"): AgentIntent { return { kind, locale: "en", amount, assetId: "usdc", recipient }; }
function answerAgentRequest(value: AgentContextSnapshot, request: AgentRequest, supplied?: ReturnType<typeof planSend>) { const parsed = parseAgentRequest(request), decision = routeAgentRequest(parsed); const planning = supplied ?? (parsed.kind === "latest-transaction" ? latestConfirmedTransaction(value) : parsed.kind === "today-spending" ? confirmedSpendingToday(value, parsed.timezoneOffsetMinutes) : parsed.kind === "send-affordability" || parsed.kind === "send-remaining" ? planSend(value, parsed) : undefined); const result = planning ? { tool: parsed.kind.replaceAll("-", "_"), ok: planning.status !== "unavailable", data: planning, partial: planning.completeness !== "complete" } : undefined; return formatAgentRequest(value, parsed, decision, { planning, result }); }

test("latest transaction uses the newest confirmed loaded activity and preserves confirmation evidence", () => {
  const latest = latestConfirmedTransaction(snapshot({ activity: [activity(3), activity(1), activity(2)] }));
  assert.equal(latest.activity?.hash, activity(1).hash);
  assert.equal(latest.activity?.source, "onchain");
  assert.equal(latest.status, "ready");
  assert.match(answerAgentRequest(snapshot(), { text: "What did I do last?", locale: "en" }).text, /Confirmed at/);
});

test("latest transaction never invents missing or unavailable activity and discloses partial history", () => {
  const empty = answerAgentRequest(snapshot({ activity: [] }), { text: "What was my latest transaction?", locale: "en" });
  assert.equal(latestConfirmedTransaction(snapshot({ activity: [] })).status, "ready");
  assert.match(empty.text, /No confirmed transaction is available in the currently loaded activity/);
  const partial = answerAgentRequest(snapshot({ activityPartial: true }), { text: "What was my latest transaction?", locale: "en" });
  assert.match(partial.text, /currently loaded activity/);
  const unavailable = answerAgentRequest(snapshot({ activity: [], activityUnavailable: true }), { text: "What was my latest transaction?", locale: "en" });
  assert.match(unavailable.text, /Activity is unavailable/);
  assert.doesNotMatch(unavailable.text, /sent|received|swapped/i);
});

test("activity completeness stays consistent for unavailable, loaded empty, partial, and confirmed snapshots", () => {
  const unavailable = snapshot({ activity: [], activityUnavailable: true, activityPartial: true });
  assert.match(answerAgentRequest(unavailable, { text: "What was my latest transaction?", locale: "en" }).text, /Activity is unavailable/);
  assert.match(answerAgentRequest(unavailable, { text: "How much did I spend today?", locale: "en" }).text, /Activity is unavailable/);

  const empty = snapshot({ activity: [], activityUnavailable: false, activityPartial: false });
  assert.match(answerAgentRequest(empty, { text: "What was my latest transaction?", locale: "en" }).text, /No confirmed transaction/);
  assert.match(answerAgentRequest(empty, { text: "How much did I spend today?", locale: "en" }).text, /No confirmed outgoing spending/);

  const partial = snapshot({ activity: [], activityUnavailable: false, activityPartial: true });
  assert.match(answerAgentRequest(partial, { text: "What was my latest transaction?", locale: "en" }).text, /Based on currently loaded activity/);
  assert.match(answerAgentRequest(partial, { text: "How much did I spend today?", locale: "en" }).text, /Based on currently loaded activity/);

  const loaded = snapshot({ activity: [activity(1)], activityUnavailable: false, activityPartial: false });
  assert.match(answerAgentRequest(loaded, { text: "What was my latest transaction?", locale: "en" }).text, /Confirmed at/);
  assert.match(answerAgentRequest(loaded, { text: "How much did I spend today?", locale: "en" }).text, /1 USDC/);
});

test("runtime activity load metadata gives both Agent features one authoritative state", () => {
  const cases = [
    { name: "unavailable", load: { hasSuccessfulLoad: false, requestFailed: true, pagePartial: false }, activity: [], latest: /Activity is unavailable/, spending: /Activity is unavailable/ },
    { name: "loaded empty", load: { hasSuccessfulLoad: true, requestFailed: false, pagePartial: false }, activity: [], latest: /No confirmed transaction/, spending: /No confirmed outgoing spending/ },
    { name: "partial cached empty after refetch failure", load: { hasSuccessfulLoad: true, requestFailed: true, pagePartial: false }, activity: [], latest: /Based on currently loaded activity/, spending: /Based on currently loaded activity/ },
    { name: "loaded confirmed", load: { hasSuccessfulLoad: true, requestFailed: false, pagePartial: false }, activity: [activity(1)], latest: /Confirmed at/, spending: /1 USDC/ },
  ] as const;

  for (const item of cases) {
    const state = deriveActivityLoadState(item.load);
    const runtimeSnapshot = snapshot({ activity: [...item.activity], activityPartial: state.partial, activityUnavailable: state.unavailable });
    assert.match(answerAgentRequest(runtimeSnapshot, { text: "What was my latest transaction?", locale: "en" }).text, item.latest, `${item.name}: latest`);
    assert.match(answerAgentRequest(runtimeSnapshot, { text: "How much did I spend today?", locale: "en" }).text, item.spending, `${item.name}: spending`);
  }
});

test("today spending aggregates outgoing confirmed activity and keeps USDC and EURC separate", () => {
  const data = confirmedSpendingToday(snapshot({ activity: [activity(1), activity(2, { assetId: "eurc", assetSymbol: "EURC", tokenAddress: eurc, amount: 2_500_000n }), activity(3, { direction: "receive", amount: 8_000_000n })] }), 0);
  assert.deepEqual(data.spending, { usdc: 1_000_000n, eurc: 2_500_000n });
  const response = answerAgentRequest(snapshot({ activity: [activity(1), activity(2, { assetId: "eurc", assetSymbol: "EURC", tokenAddress: eurc, amount: 2_500_000n })] }), { text: "How much did I spend today?", locale: "en" });
  assert.match(response.text, /1 USDC; 2.5 EURC/);
  assert.doesNotMatch(response.text, /3\.5/);
});

test("today spending uses an explicit timezone offset across local midnight", () => {
  const beforeLocalMidnight = Date.UTC(2026, 7, 29, 16, 59);
  const afterLocalMidnight = Date.UTC(2026, 7, 29, 17, 1);
  const localNow = Date.UTC(2026, 7, 29, 18);
  const data = confirmedSpendingToday(snapshot({ timestamp: localNow, activity: [activity(1, { confirmedAt: beforeLocalMidnight }), activity(2, { confirmedAt: afterLocalMidnight, amount: 2_000_000n })] }), -420);
  assert.deepEqual(data.spending, { usdc: 2_000_000n });
});

test("send planning distinguishes token coverage from fee-aware affordability", () => {
  const sufficient = planSend(snapshot(), intent("send-affordability"), 1_000_000_000_000_000n);
  assert.equal(sufficient.tokenBalanceCovers, true);
  assert.equal(sufficient.feeAwareAffordable, true);
  assert.equal(sufficient.maximumFeeUsdc6, 1_000n);
  assert.equal(sufficient.remaining, 999_000n);
  const feeBlocked = planSend(snapshot(), intent("send-affordability", "9.9995"), 1_000_000_000_000_000n);
  assert.equal(feeBlocked.tokenBalanceCovers, true);
  assert.equal(feeBlocked.feeAwareAffordable, false);
  assert.ok(feeBlocked.blockingReasons.includes("insufficient-gas-balance"));
});

test("send planning blocks insufficient token balance and preserves unknown gas estimates", () => {
  const insufficient = planSend(snapshot(), intent("send-affordability", "11"), 1_000_000_000_000_000n);
  assert.equal(insufficient.tokenBalanceCovers, false);
  assert.ok(insufficient.blockingReasons.includes("insufficient-token-balance"));
  const unknownFee = planSend(snapshot(), intent("send-affordability", "9"));
  assert.equal(unknownFee.tokenBalanceCovers, true);
  assert.equal(unknownFee.feeAwareAffordable, undefined);
  assert.equal(unknownFee.refreshRequired, true);
  assert.ok(unknownFee.blockingReasons.includes("gas-estimate-unavailable"));
});

test("remaining-balance result exposes amount, maximum fee, timestamp and expiry separately", () => {
  const result = planSend(snapshot(), intent("send-remaining"), 2_000_000_000_000_000n);
  assert.equal(result.amount, 9_000_000n);
  assert.equal(result.maximumFeeRaw18, 2_000_000_000_000_000n);
  assert.equal(result.maximumFeeUsdc6, 2_000n);
  assert.equal(result.remaining, 998_000n);
  assert.equal(result.dataTimestamp, now);
  assert.ok(result.expiresAt && result.expiresAt > now);
});

test("remaining-balance response preserves a distinct pre-fee remainder when the fee is unavailable", () => {
  const result = planSend(snapshot(), intent("send-remaining", "0.01"));
  assert.equal(result.remainingBeforeFees, 9_990_000n);
  assert.equal(result.remaining, undefined);
  const response = answerAgentRequest(snapshot(), { text: "If I send 0.01 USDC, how much will I have left?", locale: "en" });
  assert.match(response.text, /current balance is 10 USDC/i);
  assert.match(response.text, /9\.99 USDC before network fees/);
  assert.match(response.text, /can't confirm the final fee-aware remainder yet/);
  assert.doesNotMatch(response.text, /maximum network fee: 0|final fee-aware remainder is 9\.99/i);
});

test("read-only fee service is invoked only with an explicit recipient and returns data only", async () => {
  let calls = 0;
  const services = { estimateSendMaximumFee: async () => { calls++; return 1_000_000_000_000_000n; } };
  const withRecipient = await resolveAgentPlanning(snapshot(), intent("send-affordability"), services);
  assert.equal(calls, 1);
  assert.equal(withRecipient?.maximumFeeUsdc6, 1_000n);
  const withoutRecipient = await resolveAgentPlanning(snapshot(), { ...intent("send-affordability"), recipient: undefined }, services);
  assert.equal(calls, 1);
  assert.equal(withoutRecipient?.refreshRequired, true);
  const serialized = JSON.stringify(withRecipient, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  for (const forbidden of ["provider", "signer", "connector", "walletClient", "submit", "approve", "callback"]) assert.doesNotMatch(serialized, new RegExp(forbidden, "i"));
});

test("structured blocking explanations cover approved safety codes without raw errors", () => {
  const codes = ["wrong-network", "invalid-recipient", "insufficient-token-balance", "insufficient-gas-balance", "wallet-rejection", "reverted-simulation", "unknown-confirmation", "allowance-required", "quote-unavailable", "stale-quote", "gas-estimate-unavailable", "bridge-route-unavailable"] as const;
  for (const code of codes) {
    const result = explainBlocking(code, now);
    assert.equal(result.blockingReasons[0], code);
    assert.ok(blockingExplanation(code, false).length > 20);
  }
  assert.match(blockingExplanation("wallet-rejection", false), /Nothing was submitted/);
  assert.match(blockingExplanation("stale-quote", false), /expired/);
  assert.match(blockingExplanation("wrong-network", true), /Ví của bạn không ở Arc Testnet/);
  assert.doesNotMatch(blockingExplanation("gas-estimate-unavailable", true), /Ã|Æ|Ä/);
});

test("new planning intents are bounded and never become action drafts", () => {
  assert.equal(parseAgentRequest({ text: "Can I afford to send 10 USDC?", locale: "en" }).kind, "send-affordability");
  assert.equal(parseAgentRequest({ text: "If I send 10 USDC, how much will I have left?", locale: "en" }).kind, "send-remaining");
  assert.equal(parseAgentRequest({ text: "Hôm nay tôi đã chi bao nhiêu?", locale: "vi" }).kind, "today-spending");
  assert.equal(parseAgentRequest({ text: "Tại sao sai mạng nên không thể tiếp tục?", locale: "vi" }).kind, "blocking-explanation");
});

test("Agent handoff remains exact and contains no execution authority", () => {
  const intent = parseAgentRequest({ text: `send 1 USDC to ${recipient}`, locale: "en" });
  const draft = createAgentActionDraft(intent, { ...planSend(snapshot(), { kind: "send-affordability", locale: "en", amount: "1", assetId: "usdc", recipient }, 1_000_000_000_000_000n), refreshRequired: false, completeness: "complete", blockingReasons: [] })!;
  const prepared = prepareAgentActionHandoff(draft, account, now);
  assert.equal(prepared.handoff?.amount, "1");
  assert.equal(prepared.handoff?.recipient, recipient);
  const serialized = JSON.stringify(prepared, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  for (const forbidden of ["signer", "provider", "connector", "submit", "approve", "sendTransaction"]) assert.doesNotMatch(serialized, new RegExp(forbidden, "i"));
});
