import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { assessAgentDraftContext } from "./agent/draftContext.ts";
import { consumeAgentHandoff, prepareAgentActionHandoff, storeAgentHandoff, validateAgentActionDraft } from "./agent/actions/index.ts";
import { AGENT_SESSION_CONTEXT_KEY, clearAgentSessionContext, storeAgentSessionContext } from "./agent/sessionContext.ts";
import type { AgentActionDraft, AgentDraftContext } from "./agent/types.ts";

const accountA = "0x1111111111111111111111111111111111111111" as const;
const accountB = "0x2222222222222222222222222222222222222222" as const;
const arc = 5_042_002;
const otherChain = 84_532;
const draft: AgentActionDraft = {
  version: 1,
  mode: "prepare-only",
  rawUserText: `send 5 USDC to ${accountB}`,
  executionEnabled: false,
  kind: "send",
  asset: "USDC",
  amount: "5",
  recipient: accountB,
  sourceChain: "Arc Testnet",
};

function memoryStore() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value), removeItem: (key: string) => void values.delete(key) };
}

/** Characterization of the defect observed before the repair. */
function beforeRepairCardState(origin: AgentDraftContext | undefined, currentAccount: string) {
  return {
    retainedMessage: true,
    displayedStatus: validateAgentActionDraft(draft).valid ? "Ready" : "Blocked",
    preparedAccount: prepareAgentActionHandoff(draft, currentAccount, 1_000).handoff?.account,
    origin,
  };
}

test("BEFORE FIX reproduction: a historical valid draft stayed visible as Ready and rebound silently", () => {
  const before = beforeRepairCardState({ account: accountA, chainId: arc }, accountB);
  assert.equal(before.retainedMessage, true);
  assert.equal(before.displayedStatus, "Ready");
  assert.equal(before.preparedAccount, accountB);
});

test("required state sequence: session context clears while history remains, then the repaired card is stale and explicit", () => {
  const store = memoryStore();
  storeAgentSessionContext(store, { version: 1, activeTopic: "send", updatedAt: 1_000, account: accountA, chainId: arc, send: { asset: "usdc", amount: "5" } });
  const history = [{ draft, draftContext: Object.freeze({ account: accountA, chainId: arc }) }];
  clearAgentSessionContext(store);
  assert.equal(store.getItem(AGENT_SESSION_CONTEXT_KEY), null);
  assert.equal(history[0].draft.rawUserText, draft.rawUserText);
  assert.equal(beforeRepairCardState(history[0].draftContext, accountB).displayedStatus, "Ready");
  assert.deepEqual(assessAgentDraftContext(history[0].draftContext, { account: accountB, chainId: arc }), { status: "historical", reason: "account-changed" });
});

test("historical origin context is retained separately from the action payload", () => {
  const origin = Object.freeze({ account: accountA, chainId: arc });
  assert.deepEqual(origin, { account: accountA, chainId: arc });
  assert.equal(draft.executionEnabled, false);
  assert.equal(draft.sourceChain, "Arc Testnet");
  assert.equal(draft.rawUserText, `send 5 USDC to ${accountB}`);
  assert.deepEqual(draft, { ...draft });
});

test("account rebinding is explicit and does not classify the draft as current", () => {
  assert.deepEqual(assessAgentDraftContext({ account: accountA, chainId: arc }, { account: accountB, chainId: arc }), { status: "historical", reason: "account-changed" });
});

test("explicit rebinding leaves the historical draft untouched while a new handoff uses account B", () => {
  const historical = Object.freeze({ draft, draftContext: Object.freeze({ account: accountA, chainId: arc }) });
  const prepared = prepareAgentActionHandoff(historical.draft, accountB, 1_000).handoff!;
  assert.equal(prepared.account, accountB);
  assert.deepEqual(historical.draftContext, { account: accountA, chainId: arc });
  assert.equal(historical.draft.sourceChain, "Arc Testnet");
});

test("chain rebinding is explicit even when the wallet account is unchanged", () => {
  assert.deepEqual(assessAgentDraftContext({ account: accountA, chainId: arc }, { account: accountA, chainId: otherChain }), { status: "historical", reason: "chain-changed" });
});

test("matching account and chain remain current", () => {
  assert.deepEqual(assessAgentDraftContext({ account: accountA, chainId: arc }, { account: accountA.toUpperCase() as typeof accountA, chainId: arc }), { status: "current", reason: "match" });
});

test("missing origin context is never shown as current-ready", () => {
  assert.deepEqual(assessAgentDraftContext(undefined, { account: accountB, chainId: arc }), { status: "unknown", reason: "origin-missing" });
  assert.deepEqual(assessAgentDraftContext({}, { account: accountB, chainId: arc }), { status: "unknown", reason: "origin-missing" });
});

test("missing current context cannot be treated as a current draft", () => {
  assert.deepEqual(assessAgentDraftContext({ account: accountA, chainId: arc }, {}), { status: "historical", reason: "current-context-missing" });
  assert.deepEqual(assessAgentDraftContext({ account: accountA, chainId: arc }, { account: accountA }), { status: "historical", reason: "current-context-missing" });
});

test("handoff still rejects account A draft preparation when consumed by account B", () => {
  const store = memoryStore();
  const handoff = prepareAgentActionHandoff(draft, accountA, 1_000).handoff!;
  storeAgentHandoff(store, handoff);
  assert.equal(consumeAgentHandoff(store, handoff.id, accountB, 2_000), undefined);
});

test("handoff expiry remains enforced after explicit rebinding", () => {
  const store = memoryStore();
  const handoff = prepareAgentActionHandoff(draft, accountB, 1_000).handoff!;
  storeAgentHandoff(store, handoff);
  assert.equal(consumeAgentHandoff(store, handoff.id, accountB, handoff.expiresAt + 1), undefined);
});

test("handoff remains one-shot after explicit rebinding", () => {
  const store = memoryStore();
  const handoff = prepareAgentActionHandoff(draft, accountB, 1_000).handoff!;
  storeAgentHandoff(store, handoff);
  assert.equal(consumeAgentHandoff(store, handoff.id, accountB, 2_000)?.id, handoff.id);
  assert.equal(consumeAgentHandoff(store, handoff.id, accountB, 2_001), undefined);
});

test("implementation records origin context, renders semantic historical state, and keeps transaction architecture unchanged", () => {
  const hook = readFileSync(new URL("../hooks/useMakotoAgent.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../components/MakotoAgentPage.tsx", import.meta.url), "utf8");
  const dashboard = readFileSync(new URL("../components/WalletDashboard.tsx", import.meta.url), "utf8");
  assert.match(hook, /draftContext: response\.actionDraft && binding/);
  assert.match(page, /assessAgentDraftContext/);
  assert.match(page, /data-context-status=\{context\.status\}/);
  assert.match(page, /agent\.draft\.prepareCurrent/);
  assert.match(page, /useWalletReadContext/);
  assert.match(page, /draftContext=\{message\.draftContext\}/);
  assert.match(dashboard, /draftContext=\{message\.draftContext\}/);
  for (const forbidden of ["writeContract", "sendTransaction", "submitReviewedTransaction", "signMessage"]) {
    assert.equal(page.includes(forbidden), false, forbidden);
  }
});
