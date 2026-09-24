/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import * as orchestrator from "./transactionOrchestrator.ts";

// Render the production component with deterministic hook slots and offline clients.
// Real request preparation, simulation gating, and revalidation run unchanged.
const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../components/RealSwapFlow.tsx", import.meta.url), "utf8");
const account = "0x1111111111111111111111111111111111111111";
const hash = `0x${"ab".repeat(32)}`;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function nodes(element: any): any[] {
  if (Array.isArray(element)) return element.flatMap(nodes);
  if (!element || typeof element !== "object") return [];
  return [element, ...nodes(element.props?.children)];
}
function harness(componentSource = source) {
  const slots: any[] = [];
  const refs: any[] = [];
  const cleanups: (() => void)[] = [];
  let cursor = 0;
  let busy = false;
  const o = {
    simulations: [] as any[], writes: [] as any[], revalidations: [] as any[],
    simulate: async () => {}, verify: async () => true,
    read: async () => {}, envelope: async () => {},
    write: async () => hash,
    receipt: async (): Promise<any> => ({ status: "success", transactionHash: hash, blockNumber: 1n, logs: [] }),
    invalidateReview: false,
    afterRevalidation: () => {},
  };
  const client = {
    readContract: async (request: any) => { await o.read(); return request.functionName === "getAmountOut" ? 1_000_000n : 10_000_000n; },
    estimateContractGas: async () => { await o.envelope(); return 50_000n; },
    estimateFeesPerGas: async () => ({ maxFeePerGas: 1_000_000n, maxPriorityFeePerGas: 1n }),
    simulateContract: async (request: any) => { o.simulations.push(request); await o.simulate(); return { request }; },
    waitForTransactionReceipt: () => o.receipt(),
    getBlock: async () => ({ timestamp: 1n }),
  };
  const mocks: Record<string, any> = {
    react: {
      useState: (initial: any) => {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [slots[index], (value: any) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
      },
      useRef: (initial: any) => { const index = cursor++; if (!(index in slots)) { slots[index] = { current: initial }; refs.push(slots[index]); } return slots[index]; },
      useEffect: (effect: () => any, deps: any[]) => {
        const index = cursor++;
        if (deps.length === 0 && !(index in slots)) { slots[index] = true; cleanups.push(effect()); }
        if (deps.includes(onBusyChange)) effect();
      },
    },
    wagmi: {
      useConnection: () => ({ address: account, isConnected: true }),
      usePublicClient: () => client,
      useWriteContract: () => ({ writeContractAsync: (request: any) => { o.writes.push(request); return o.write(); } }),
    },
    "@/hooks/useVerifiedWalletChain": { useVerifiedWalletChain: () => ({ isArc: true, verifyNow: () => o.verify() }) },
    "@/hooks/useWalletBalances": { useWalletBalances: () => ({ assets: { usdc: { data: 10_000_000n }, eurc: { data: 10_000_000n } }, usdc: { refetch: async () => {} }, eurc: { refetch: async () => {} } }) },
    "@/hooks/useWalletAccount": { useWalletAccount: () => ({
      read: { kind: "external", address: account, chainId: 5042002, status: "connected", connectionStatus: "connected", isArc: true },
      execution: { kind: "external", submitReviewed: (_request: unknown, legacy?: () => Promise<string>) => legacy!() },
    }) },
    "@/lib/walletActivity": { createAssetActivity: () => ({}), recordWalletActivity: () => {} },
    "@/lib/agent/actions": { storeAgentResult: () => {} },
    "./TransactionSafetyReview": { TransactionSafetyReview: "controlled-review" },
    "./PolicyDecisionNotice": { PolicyDecisionNotice: "policy-notice" },
    "@/lib/transactionOrchestrator": { ...orchestrator, revalidateTransactionReview: (...args: Parameters<typeof orchestrator.revalidateTransactionReview>) => {
      const result = orchestrator.revalidateTransactionReview(...args);
      o.revalidations.push({ args, result });
      o.afterRevalidation();
      return o.invalidateReview ? { ...result, valid: false } : result;
    } },
  };
  const compiled = ts.transpileModule(componentSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const loaded = { exports: {} as any };
  const load = (id: string) => id in mocks ? mocks[id] : id.startsWith("@/") ? require(fileURLToPath(new URL(`../${id.slice(2)}.ts`, import.meta.url))) : require(id);
  new Function("require", "module", "exports", compiled)(load, loaded, loaded.exports);
  function onBusyChange(value: boolean) { busy = value; }
  const render = () => { cursor = 0; return loaded.exports.RealSwapFlow({ locale: "en", initialValues: { amount: "1" }, onBusyChange }); };
  return {
    o, render, busy: () => busy,
    review: async () => { render().props.onSubmit({ preventDefault() {} }); await tick(); assert.equal(render().props.title, "Review Swap"); },
    start: () => render().props.onContinue(),
    unmount: () => cleanups.forEach(cleanup => cleanup?.()),
    replaceAttempt: () => { refs.find(ref => typeof ref.current === "number").current += 1; },
  };
}

test("F7 before-fix timeline: production F6 callback releases protection and later reaches wallet", async () => {
  const baseline = execFileSync("git", ["show", "2b285fca51c877720e3ae2d9b33978e49bb433df:frontend/components/RealSwapFlow.tsx"], { encoding: "utf8" });
  const h = harness(baseline);
  await h.review();
  const simulation = deferred<void>();
  h.o.simulate = () => simulation.promise;
  h.o.write = () => new Promise(() => {});
  h.start(); await tick();
  assert.equal(h.busy(), false); // Effects are flushed by render below.
  const review = h.render();
  assert.equal(h.busy(), true);
  assert.equal(review.props.backDisabled, false);
  review.props.onBack();
  assert.equal(h.render().type, "form");
  assert.equal(h.busy(), false);
  simulation.resolve(); await tick();
  assert.equal(h.o.writes.length, 1);
  assert.equal(h.render().type, "form");
});

test("F7 idle Review Back still returns to editing", async () => {
  const h = harness(); await h.review();
  assert.equal(h.render().props.backDisabled, false);
  h.render().props.onBack();
  assert.equal(h.render().type, "form");
  assert.equal(h.busy(), false);
});

test("F7 execution locks synchronously before the first await and rejects duplicate callbacks", async () => {
  const h = harness(); await h.review();
  const gate = deferred<boolean>(); h.o.verify = () => gate.promise;
  const review = h.render(); review.props.onContinue(); review.props.onContinue();
  assert.equal(h.render().props.backDisabled, true);
  assert.equal(h.render().props.continueDisabled, true);
  assert.equal(h.busy(), true);
  review.props.onBack(); assert.equal(h.render().props.title, "Review Swap");
  gate.resolve(false); await tick();
  assert.equal(h.o.writes.length, 0);
  assert.equal(h.render().props.backDisabled, false);
  assert.equal(h.busy(), false);
});

test("F7 deferred simulation, revalidation, awaiting hash and receipt retain continuous ownership", async () => {
  const h = harness(); await h.review();
  const simulation = deferred<void>(), wallet = deferred<string>(), receipt = deferred<any>();
  h.o.simulate = () => simulation.promise; h.o.write = () => wallet.promise; h.o.receipt = () => receipt.promise;
  h.start(); await tick();
  const review = h.render();
  assert.equal(review.props.backDisabled, true); assert.equal(h.busy(), true);
  review.props.onBack(); assert.equal(h.render().props.title, "Review Swap");
  simulation.resolve(); await tick();
  assert.equal(h.o.revalidations.at(-1).result.valid, true);
  assert.equal(h.o.writes.length, 1);
  assert.deepEqual(h.o.writes[0], h.o.simulations.at(-1));
  assert.equal(h.render().props.backDisabled, true); assert.equal(h.busy(), true);
  wallet.resolve(hash); await tick();
  assert.equal(h.render().props.backDisabled, true); assert.equal(h.busy(), true);
  h.render().props.onBack(); assert.equal(h.render().props.title, "Review Swap");
  receipt.resolve({ status: "success", transactionHash: hash, blockNumber: 1n, logs: [] }); await tick();
  assert.equal(h.render().props.className, "transaction-state"); assert.equal(h.busy(), false);
  nodes(h.render()).find(node => node.type === "button").props.onClick();
  assert.equal(h.render().type, "form");
});

for (const boundary of ["verify", "read", "envelope", "simulate"] as const) {
  test(`F7 unmount invalidates a deferred ${boundary} continuation before wallet write`, async () => {
    const h = harness(); await h.review();
    const gate = deferred<any>(); h.o[boundary] = () => gate.promise;
    h.start(); await tick(); h.unmount(); gate.resolve(true); await tick();
    assert.equal(h.o.writes.length, 0);
  });
}

test("F7 stale attempt cleanup cannot release a newer attempt's protection", async () => {
  const h = harness(); await h.review();
  const oldGate = deferred<void>(); h.o.simulate = () => oldGate.promise;
  h.start(); await tick();
  // Controlled internal replacement retains the same component refs and UI lock.
  h.replaceAttempt(); oldGate.resolve(); await tick();
  assert.equal(h.o.writes.length, 0);
  assert.equal(h.render().props.backDisabled, true); assert.equal(h.busy(), true);
  h.unmount();
});

test("F7 ownership is checked again after final revalidation immediately before wallet write", async () => {
  const h = harness(); await h.review();
  h.o.afterRevalidation = () => { if (h.o.simulations.length === 2) h.unmount(); };
  h.start(); await tick();
  assert.equal(h.o.revalidations.at(-1).result.valid, true);
  assert.equal(h.o.writes.length, 0);
});

for (const failure of ["simulation reverted", "simulation unavailable", "revalidation", "wallet rejected"]) {
  test(`F7 ${failure} releases ownership without fabricated submission`, async () => {
    const h = harness(); await h.review();
    if (failure.startsWith("simulation")) h.o.simulate = async () => { throw new Error(failure); };
    if (failure === "revalidation") h.o.simulate = async () => { h.o.invalidateReview = true; };
    if (failure === "wallet rejected") h.o.write = async () => { throw new Error("User rejected the request"); };
    h.start(); await tick();
    const ui = h.render();
    assert.equal(h.busy(), false);
    assert.notEqual(ui.props.backDisabled, true);
    assert.equal(h.o.writes.length, failure === "wallet rejected" ? 1 : 0);
    assert.equal(nodes(ui).some(node => node.type === "a" && String(node.props.href).includes(hash)), false);
    assert.notEqual(ui.props["data-status"], "submitted-unknown");
  });
}

for (const outcome of ["unknown", "reverted"] as const) {
  test(`F7 post-hash ${outcome} preserves F2/F3 recovery evidence`, async () => {
    const h = harness(); await h.review();
    h.o.receipt = async () => { if (outcome === "unknown") throw new Error("timeout"); return { status: "reverted" }; };
    h.start(); await tick();
    const ui = h.render();
    assert.equal(ui.props["data-status"], outcome === "unknown" ? "submitted-unknown" : "confirmed-failure");
    assert.ok(nodes(ui).some(node => node.type === "a" && node.props.href.endsWith(hash)));
    assert.equal(h.o.writes.length, 1); assert.equal(h.busy(), false);
    if (outcome === "unknown") assert.equal(nodes(ui).some(node => node.type === "button"), false);
    else { nodes(ui).find(node => node.type === "button").props.onClick(); assert.equal(h.render().type, "form"); }
  });
}
