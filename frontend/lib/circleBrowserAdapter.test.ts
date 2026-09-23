import assert from "node:assert/strict";
import test from "node:test";
import { getActiveProvider, normalizeProviderChainId, runSingleFlight, verifyProviderAccount, verifyProviderChain, verifyProviderReadyForEstimate } from "./circle/browserAdapter.ts";

const account = "0x1111111111111111111111111111111111111111" as const;

test("active connector provider is used and its account and chain are verified", async () => {
  const provider = { request: async ({ method }: { method: string }) => method === "eth_accounts" ? [account] : "0x4cef52" };
  assert.equal(await getActiveProvider({ getProvider: async () => provider }), provider);
  assert.equal(await verifyProviderAccount(provider, account), account);
  assert.equal(await verifyProviderChain(provider, 5_042_002), true);
});

test("account mismatch and missing connector fail closed", async () => {
  const provider = { request: async () => ["0x2222222222222222222222222222222222222222"] };
  await assert.rejects(() => verifyProviderAccount(provider, account), /account changed/i);
  await assert.rejects(() => getActiveProvider(), /not connected/i);
});

test("provider chain IDs normalize decimal and hexadecimal values without ambiguity", () => {
  for (const value of [5_042_002, 5_042_002n, "5042002", "0x4cef52"]) assert.equal(normalizeProviderChainId(value), 5_042_002);
  for (const value of [84_532, 84_532n, "84532", "0x14a34"]) assert.equal(normalizeProviderChainId(value), 84_532);
});

test("provider chain ID normalization rejects malformed and unsafe values", () => {
  for (const value of ["", " ", "hello", "0xZZ", "84532abc", "0x14a34junk", null, undefined, 84_532.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, 0, -1, 0n, `${BigInt(Number.MAX_SAFE_INTEGER) + 1n}`, BigInt(Number.MAX_SAFE_INTEGER) + 1n]) {
    assert.throws(() => normalizeProviderChainId(value), /invalid provider chain ID/i);
  }
});

test("provider chain ID normalization documents whitespace and uppercase-prefix behavior", () => {
  assert.equal(normalizeProviderChainId(" 84532 "), 84_532);
  assert.equal(normalizeProviderChainId("0X14A34"), 84_532);
});

test("provider verification accepts decimal strings and numeric provider values", async () => {
  for (const value of ["5042002", 5_042_002, 5_042_002n]) {
    assert.equal(await verifyProviderChain({ request: async () => value }, 5_042_002), true);
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

test("correct source waits for chain and account verification before estimating", async () => {
  const chain = deferred<string>(), accounts = deferred<string[]>(), states: string[] = [];
  let estimateCalls = 0;
  const provider = { request: ({ method }: { method: string }) => method === "eth_chainId" ? chain.promise : accounts.promise } as Parameters<typeof verifyProviderReadyForEstimate>[0]["provider"];
  const review = (async () => {
    await verifyProviderReadyForEstimate({ provider, expectedChainId: 84_532, expectedAccount: account, switchChain: async () => assert.fail("switch not expected"), onSwitching: () => states.push("switching"), onReady: () => states.push("estimating") });
    estimateCalls++;
  })();
  assert.deepEqual(states, []);
  assert.equal(estimateCalls, 0);
  chain.resolve("84532");
  await Promise.resolve();
  assert.deepEqual(states, []);
  assert.equal(estimateCalls, 0);
  accounts.resolve([account]);
  await review;
  assert.deepEqual(states, ["estimating"]);
  assert.equal(estimateCalls, 1);
});

test("mismatched source stays switching through switch, post-switch chain, and account verification", async () => {
  const switchStarted = deferred<void>(), switched = deferred<void>(), postVerifyStarted = deferred<void>(), postSwitchChain = deferred<string>(), accountVerifyStarted = deferred<void>(), accounts = deferred<string[]>(), states: string[] = [];
  let chainReads = 0, estimateCalls = 0;
  const provider = { request: ({ method }: { method: string }) => {
    if (method === "eth_chainId") {
      if (++chainReads === 1) return Promise.resolve("5042002");
      postVerifyStarted.resolve();
      return postSwitchChain.promise;
    }
    accountVerifyStarted.resolve();
    return accounts.promise;
  } } as Parameters<typeof verifyProviderReadyForEstimate>[0]["provider"];
  const review = (async () => {
    await verifyProviderReadyForEstimate({ provider, expectedChainId: 84_532, expectedAccount: account, switchChain: () => { switchStarted.resolve(); return switched.promise; }, onSwitching: () => states.push("switching"), onReady: () => states.push("estimating") });
    estimateCalls++;
  })();
  await switchStarted.promise;
  assert.deepEqual(states, ["switching"]);
  assert.equal(estimateCalls, 0);
  switched.resolve();
  await postVerifyStarted.promise;
  assert.deepEqual(states, ["switching"]);
  postSwitchChain.resolve("84532");
  await accountVerifyStarted.promise;
  assert.deepEqual(states, ["switching"]);
  accounts.resolve([account]);
  await review;
  assert.deepEqual(states, ["switching", "estimating"]);
  assert.equal(estimateCalls, 1);
});

test("switch rejection exits without estimating and a single-flight guard resets", async () => {
  const flag = { current: false }, states: string[] = [];
  const provider = { request: async ({ method }: { method: string }) => method === "eth_chainId" ? "5042002" : [account] } as Parameters<typeof verifyProviderReadyForEstimate>[0]["provider"];
  await assert.rejects(runSingleFlight(flag, () => verifyProviderReadyForEstimate({ provider, expectedChainId: 84_532, expectedAccount: account, switchChain: async () => { throw new Error("Switch rejected"); }, onSwitching: () => states.push("switching"), onReady: () => states.push("estimating") })), /switch rejected/i);
  assert.deepEqual(states, ["switching"]);
  assert.equal(flag.current, false);
  assert.equal(await runSingleFlight(flag, async () => undefined), true);
});

test("resolved switch with a stale provider never estimates", async () => {
  const states: string[] = [];
  let estimateCalls = 0;
  const provider = { request: async ({ method }: { method: string }) => method === "eth_chainId" ? "5042002" : [account] } as Parameters<typeof verifyProviderReadyForEstimate>[0]["provider"];
  await assert.rejects(async () => { await verifyProviderReadyForEstimate({ provider, expectedChainId: 84_532, expectedAccount: account, switchChain: async () => undefined, onSwitching: () => states.push("switching"), onReady: () => states.push("estimating") }); estimateCalls++; }, /wrong network/i);
  assert.deepEqual(states, ["switching"]);
  assert.equal(estimateCalls, 0);
});

test("changed provider account after switching never estimates", async () => {
  const states: string[] = [];
  let chainReads = 0, estimateCalls = 0;
  const provider = { request: async ({ method }: { method: string }) => method === "eth_chainId" ? (++chainReads === 1 ? "5042002" : "84532") : ["0x2222222222222222222222222222222222222222"] } as Parameters<typeof verifyProviderReadyForEstimate>[0]["provider"];
  await assert.rejects(async () => { await verifyProviderReadyForEstimate({ provider, expectedChainId: 84_532, expectedAccount: account, switchChain: async () => undefined, onSwitching: () => states.push("switching"), onReady: () => states.push("estimating") }); estimateCalls++; }, /account changed/i);
  assert.deepEqual(states, ["switching"]);
  assert.equal(estimateCalls, 0);
});

test("single-flight review guard blocks synchronous duplicates and permits a later review", async () => {
  const flag = { current: false }, gate = deferred<void>();
  let switchCalls = 0, routeCalls = 0, estimateCalls = 0, reviewContexts = 0;
  const review = () => runSingleFlight(flag, async () => { switchCalls++; await gate.promise; routeCalls++; estimateCalls++; reviewContexts++; });
  const first = review(), duplicate = review();
  assert.equal(await duplicate, false);
  assert.deepEqual([switchCalls, routeCalls, estimateCalls, reviewContexts], [1, 0, 0, 0]);
  gate.resolve();
  assert.equal(await first, true);
  assert.deepEqual([switchCalls, routeCalls, estimateCalls, reviewContexts], [1, 1, 1, 1]);
  assert.equal(await review(), true);
  assert.deepEqual([switchCalls, routeCalls, estimateCalls, reviewContexts], [2, 2, 2, 2]);
});
