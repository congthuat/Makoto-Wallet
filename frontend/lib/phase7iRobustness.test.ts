import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { deriveActivityLoadState } from "./activityLoadState.ts";

const dashboard = readFileSync(new URL("../components/WalletDashboard.tsx", import.meta.url), "utf8");
const bridge = readFileSync(new URL("../components/UniversalBridgeFlow.tsx", import.meta.url), "utf8");
const cctp = readFileSync(new URL("../components/CctpBridgeFlow.tsx", import.meta.url), "utf8");
const send = readFileSync(new URL("../components/SendFlow.tsx", import.meta.url), "utf8");
const swap = readFileSync(new URL("../components/RealSwapFlow.tsx", import.meta.url), "utf8");
const rpcSources = [
  readFileSync(new URL("./config.ts", import.meta.url), "utf8"),
  readFileSync(new URL("../hooks/useVerifiedWalletChain.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("./jarActivityApi.ts", import.meta.url), "utf8"),
  readFileSync(new URL("../.env.example", import.meta.url), "utf8"),
  readFileSync(new URL("../README.md", import.meta.url), "utf8"),
  readFileSync(new URL("../../scripts/arc-testnet.js", import.meta.url), "utf8"),
];

test("cached activity remains partial, not unavailable, after a failed refresh", () => {
  assert.deepEqual(
    deriveActivityLoadState({ hasSuccessfulLoad: true, requestFailed: true, pagePartial: false }),
    { status: "partial", unavailable: false, partial: true },
  );
  assert.match(dashboard, /activityUnavailable=\{activity\.unavailable\}/);
  assert.doesNotMatch(dashboard, /activityUnavailable=\{activity\.unavailable\s*\|\|\s*activity\.isError\}/);
});

test("active Arc runtime sources use the canonical current testnet RPC", () => {
  for (const source of rpcSources) {
    assert.match(source, /rpc\.testnet\.arc\.io/);
    assert.doesNotMatch(source, /rpc\.testnet\.arc\.network/);
  }
});

test("Universal Bridge rejects stale asynchronous estimates before review state is promoted", () => {
  assert.match(bridge, /reviewAttempt = useRef\(0\)/);
  assert.match(bridge, /currentAccount = useRef\(connection\.address\)/);
  assert.match(bridge, /if \(abandonIfStale\(\)\) return;[\s\S]*?setEstimate\(/);
  assert.match(bridge, /if \(abandonIfStale\(\)\) return;[\s\S]*?setError\(sanitizeBridgeError\(e\)\)/);
});

test("direct Send, Swap, and CCTP reviews do not promote stale pre-sign state", () => {
  assert.match(cctp, /reviewAttempt = useRef\(0\)/);
  assert.match(cctp, /input\.attempt !== reviewAttempt\.current[\s\S]*currentWallet\.current\.kind !== input\.accountKind[\s\S]*currentWallet\.current\.address/);
  assert.match(cctp, /if \(pending\) return;/);
  assert.match(send, /reviewInFlight = useRef\(false\)/);
  assert.match(send, /if \(reviewInFlight\.current\) return;/);
  assert.match(send, /backDisabled=\{pending\}/);
  assert.match(swap, /reviewAttempt = useRef\(0\)/);
  assert.match(swap, /if \(!isCurrent\(\)\) return;/);
  assert.match(swap, /backDisabled=\{swapLocked\}/);
});
