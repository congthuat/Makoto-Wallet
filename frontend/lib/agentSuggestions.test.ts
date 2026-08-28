import assert from "node:assert/strict";
import test from "node:test";

import { rankAgentSuggestions, recordSuggestionUsage, suggestionStorageKey } from "./agent/suggestions.ts";
import type { WalletActivity } from "./wallet.ts";

function activity(kind: WalletActivity["kind"]): WalletActivity {
  return { kind, hash: `0x${kind}`, assetId: "usdc", assetSymbol: "USDC", amount: 1n, direction: "send", counterparty: "0x0000000000000000000000000000000000000001", confirmedAt: Date.now(), source: "onchain" };
}

test("suggestions fall back to useful wallet context", () => {
  assert.deepEqual(rankAgentSuggestions({ activities: [], isArc: true }).map(({ id }) => id), ["overview", "activity", "network"]);
});

test("suggestions adapt deterministically to network, activity, and local usage", () => {
  assert.equal(rankAgentSuggestions({ activities: [activity("bridge"), activity("bridge")], isArc: true })[0].id, "bridge");
  assert.equal(rankAgentSuggestions({ activities: [], isArc: false })[0].id, "network");
  assert.equal(rankAgentSuggestions({ activities: [], isArc: true, usage: { swap: 6 } })[0].id, "swap");
});

test("suggestion persistence is scoped to wallet and chain", () => {
  assert.notEqual(suggestionStorageKey("0xAbC", 5042002), suggestionStorageKey("0xDef", 5042002));
  assert.notEqual(suggestionStorageKey("0xAbC", 5042002), suggestionStorageKey("0xAbC", 1));
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
  const key = suggestionStorageKey("0xAbC", 5042002);
  recordSuggestionUsage(storage, key, "swap");
  recordSuggestionUsage(storage, key, "swap");
  assert.deepEqual(JSON.parse(values.get(key)!), { swap: 2 });
});
