import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { translate } from "../i18n/index.ts";
import { createAgentContextSnapshot } from "./agent/context.ts";
import { formatAgentResponse } from "./agent/formatter.ts";
import { routeAgentRequest } from "./agent/orchestration.ts";
import { parseAgentRequest } from "./agent/parser.ts";
import { formatPlanningAmount } from "./agent/planning.ts";
import { formatAgentActionResult } from "./agent/resultFormatter.ts";
import { updateAgentSessionContext, type AgentSessionContext } from "./agent/sessionContext.ts";
import type { AgentOutcomeCategory } from "./agent/tools.ts";

const snapshot = createAgentContextSnapshot({
  connected: false,
  isArc: false,
  balances: {},
  activity: [],
  activityPartial: false,
  activityUnavailable: false,
  vault: { available: false },
});
const account = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";
const binding = { account, chainId: 5_042_002 } as const;
const readyPlanning = { kind: "send-affordability", status: "ready", dataTimestamp: 1_000, expiresAt: 2_000, refreshRequired: false, completeness: "complete", blockingReasons: [] } as const;

function clarify(text: string, locale: "en" | "vi") {
  const intent = parseAgentRequest({ text, locale });
  const decision = routeAgentRequest(intent);
  assert.equal(decision.mode, "clarification", text);
  return { intent, decision, response: formatAgentResponse(snapshot, intent, decision, {}).text };
}

test("structured preparation fields produce specific EN and VI clarification copy", () => {
  assert.equal(clarify("Chuẩn bị gửi 10 USDC", "vi").response, "Bạn muốn gửi 10 USDC đến địa chỉ nào?");
  assert.equal(clarify("Prepare a 10 USDC send", "en").response, "Which address do you want to send 10 USDC to?");
  assert.equal(clarify("Đổi 10 USDC", "vi").response, "Bạn muốn đổi 10 USDC sang tài sản nào?");
  assert.equal(clarify("Swap 10 USDC", "en").response, "Which asset do you want to receive for 10 USDC?");
  assert.equal(clarify("Bridge 10 USDC", "en").response, "Which source and destination networks should be used to Bridge 10 USDC?");
  assert.match(clarify("Bridge 10 USDC to Base Sepolia", "en").response, /bridged from/);
  assert.match(clarify("Bridge 10 USDC from Arc", "en").response, /Which network should receive/);
});

test("the parser does not guess financial assets or bridge chains", () => {
  const send = clarify("Send 10", "en");
  assert.deepEqual(send.decision.missingFields, ["asset", "recipient"]);
  const bridge = clarify("Bridge 10 USDC to Base Sepolia", "en");
  assert.deepEqual(bridge.decision.missingFields, ["sourceChain"]);
});

test("all structured outcomes use locale dictionaries without provider-error leakage", () => {
  const categories: AgentOutcomeCategory[] = ["NEEDS_CLARIFICATION", "WALLET_NOT_CONNECTED", "WRONG_NETWORK", "INSUFFICIENT_BALANCE", "QUOTE_UNAVAILABLE", "ROUTE_UNAVAILABLE", "PROVIDER_UNAVAILABLE", "STALE_DATA", "PLANNING_FAILED"];
  for (const locale of ["en", "vi"] as const) {
    const intent = parseAgentRequest({ text: locale === "vi" ? "Chuẩn bị gửi 10 USDC" : "Prepare a 10 USDC send", locale });
    const decision = { topic: "send", mode: "preparation", capabilityId: "send_preparation", freshDataRequired: true, draftAllowed: true } as const;
    for (const category of categories) {
      const text = formatAgentResponse(snapshot, intent, decision, { category }).text;
      assert.equal(text, translate(locale, `agent.outcome.${category}`));
      assert.doesNotMatch(text, /RPC|ECONN|fetch failed/i);
    }
  }
});

test("localized values and transaction results preserve EN and VI parity", () => {
  assert.equal(formatPlanningAmount(undefined, "usdc", "en"), translate("en", "agent.value.unavailable"));
  assert.equal(formatPlanningAmount(undefined, "usdc", "vi"), translate("vi", "agent.value.unavailable"));
  const base = { id: "result-1", account: "0x1111111111111111111111111111111111111111", action: "send", status: "confirmed", createdAt: 1, amount: "10", asset: "USDC", transactionHash: "0xabc" } as const;
  assert.match(formatAgentActionResult(base, "en"), /Transaction:/);
  assert.match(formatAgentActionResult(base, "vi"), /Giao dịch:/);
});

function pending(text: string, locale: "en" | "vi") {
  const intent = parseAgentRequest({ text, locale });
  return updateAgentSessionContext(undefined, intent, binding, 1_000)!;
}

function resume(text: string, locale: "en" | "vi", context: AgentSessionContext) {
  const intent = parseAgentRequest({ text, locale, sessionContext: context });
  const decision = routeAgentRequest(intent);
  const response = formatAgentResponse(snapshot, intent, decision, { planning: readyPlanning });
  return { intent, decision, response };
}

test("current request locale controls pending Send, Swap, and Bridge completion in both directions", () => {
  const cases = [
    { initial: "Chuẩn bị gửi 10 USDC", from: "vi", reply: recipient, to: "en", expected: "Draft ready. Review it before continuing in your wallet." },
    { initial: "Prepare a 10 USDC send", from: "en", reply: recipient, to: "vi", expected: "Bản nháp đã sẵn sàng. Kiểm tra trước khi tiếp tục trong ví." },
    { initial: "Chuẩn bị hoán đổi 10 USDC", from: "vi", reply: "EURC", to: "en", expected: "Draft ready. Review it before continuing in your wallet." },
    { initial: "Prepare a swap of 10 USDC", from: "en", reply: "EURC", to: "vi", expected: "Bản nháp đã sẵn sàng. Kiểm tra trước khi tiếp tục trong ví." },
    { initial: "Bridge 10 USDC from Arc", from: "vi", reply: "Base Sepolia", to: "en", expected: "Draft ready. Review it before continuing in your wallet." },
    { initial: "Bridge 10 USDC from Arc", from: "en", reply: "Base Sepolia", to: "vi", expected: "Bản nháp đã sẵn sàng. Kiểm tra trước khi tiếp tục trong ví." },
  ] as const;
  for (const item of cases) {
    const context = pending(item.initial, item.from);
    const result = resume(item.reply, item.to, context);
    assert.equal(result.intent.locale, item.to);
    assert.equal(result.decision.mode, "preparation");
    assert.equal(result.response.text, item.expected);
    assert.equal(result.response.text, translate(item.to, "agent.response.draftReady"));
    assert.ok(result.response.actionDraft);
  }
});

test("locale switches preserve pending financial parameters and session hydration", () => {
  const context = pending("Chuẩn bị hoán đổi 10 USDC", "vi");
  const serialized = JSON.parse(JSON.stringify(context)) as AgentSessionContext;
  const result = resume("EURC", "en", serialized);
  assert.equal(serialized.pendingPreparation?.locale, "vi");
  assert.deepEqual(
    [result.intent.preparation?.amount, result.intent.preparation?.assetId, result.intent.preparation?.outputAssetId],
    ["10", "usdc", "eurc"],
  );
  assert.equal(result.response.text, translate("en", "agent.response.draftReady"));
});

test("current locale controls clarification, planning failure, preparation success, and draft display copy", () => {
  const context = pending("Chuẩn bị gửi 10 USDC", "vi");
  const clarificationIntent = parseAgentRequest({ text: "0x1234", locale: "en", sessionContext: context });
  const clarificationDecision = routeAgentRequest(clarificationIntent);
  assert.equal(formatAgentResponse(snapshot, clarificationIntent, clarificationDecision, {}).text, translate("en", "agent.clarification.sendRecipient", { amount: "10", asset: "USDC" }));

  const completed = resume(recipient, "en", context);
  assert.equal(formatAgentResponse(snapshot, completed.intent, completed.decision, { category: "PLANNING_FAILED" }).text, translate("en", "agent.outcome.PLANNING_FAILED"));
  assert.equal(completed.response.text, translate("en", "agent.response.draftReady"));

  const hook = readFileSync(new URL("../hooks/useMakotoAgent.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../components/MakotoAgentPage.tsx", import.meta.url), "utf8");
  const dashboard = readFileSync(new URL("../components/WalletDashboard.tsx", import.meta.url), "utf8");
  assert.match(hook, /useEffect\(\(\) => \{\s*latestLocale\.current = locale;\s*\}, \[locale\]\)/);
  assert.match(hook, /locale: requestLocale/);
  assert.match(page, /ActionDraftCard draft=\{message\.draft\} vi=\{vi\}/);
  assert.match(dashboard, /ActionDraftCard draft=\{message\.draft\} vi=\{locale === "vi"\}/);
});

test("shared Agent UI uses translation keys and contains no legacy draft copy", () => {
  const page = readFileSync(new URL("../components/MakotoAgentPage.tsx", import.meta.url), "utf8");
  const dashboard = readFileSync(new URL("../components/WalletDashboard.tsx", import.meta.url), "utf8");
  assert.match(page, /agent\.draft\.review/);
  assert.doesNotMatch(page, /Prepare safely|Action Draft|Nothing is sent automatically/);
  assert.match(dashboard, /ActionDraftCard/);
  assert.match(dashboard, /useMakotoAgent/);
});
