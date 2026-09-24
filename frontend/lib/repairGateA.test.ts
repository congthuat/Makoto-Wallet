/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { encodeFunctionData } from "viem";
import { arcTestnet, baseSepolia } from "viem/chains";
import { getAssetById } from "./assets.ts";
import * as flowReview from "./transactionFlowReview.ts";
import * as orchestrator from "./transactionOrchestrator.ts";
import type { TransactionSafetyAssessment, SafetyContext } from "./transactionSafety.ts";

// Execute the production TSX with controlled hooks/providers. No wallet, RPC,
// browser storage, effect scheduling, or real signing is involved in this harness.
const require = createRequire(import.meta.url);
const compiled = new Map<string, string>();
function component(name: string, mocks: Record<string, any>) {
  let code = compiled.get(name);
  if (!code) {
    code = ts.transpileModule(readFileSync(new URL(`../components/${name}.tsx`, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    compiled.set(name, code);
  }
  const loaded = { exports: {} as any };
  const load = (id: string) => {
    if (id in mocks) return mocks[id];
    if (id.startsWith("@/")) return require(fileURLToPath(new URL(`../${id.slice(2)}.ts`, import.meta.url)));
    return require(id);
  };
  new Function("require", "module", "exports", code)(load, loaded, loaded.exports);
  return loaded.exports[name];
}
const account = "0x1111111111111111111111111111111111111111" as const;
const usdc = getAssetById("usdc")!;
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const preferences = { usePreferences: () => ({ locale: "en", t: (key: string) => key }) };

function swapHarness(initialAllowance = 0n) {
  const slots: any[] = [];
  let cursor = 0;
  const observations = {
    allowance: initialAllowance,
    output: 1_000_000n,
    simulations: [] as any[], estimates: [] as any[], snapshots: [] as any[], revalidations: [] as any[], writes: [] as any[],
    simulateSwap: async () => {},
  };
  const client = {
    readContract: async (request: any) => request.functionName === "allowance" ? observations.allowance : request.functionName === "getAmountOut" ? observations.output : 10_000_000n,
    estimateContractGas: async (request: any) => { observations.estimates.push(request); return 50_000n; },
    estimateFeesPerGas: async () => ({ maxFeePerGas: 1_000_000n, maxPriorityFeePerGas: 1n }),
    simulateContract: async (request: any) => {
      observations.simulations.push(request);
      if (request.functionName === "swap") await observations.simulateSwap();
      return { request };
    },
    waitForTransactionReceipt: async () => ({ status: "success" }),
  };
  const RealSwapFlow = component("RealSwapFlow", {
    react: {
      useState: (initial: any) => {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [slots[index], (value: any) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
      },
      useRef: (initial: any) => { const index = cursor++; return slots[index] ??= { current: initial }; },
      useEffect: () => {},
    },
    wagmi: {
      useConnection: () => ({ address: account, isConnected: true }),
      usePublicClient: () => client,
      useWriteContract: () => ({ writeContractAsync: async (request: any) => {
        observations.writes.push(request);
        if (request.functionName === "approve") { observations.allowance = request.args[1]; return `0x${"1".repeat(64)}`; }
        // Stop the successful execution scenario at the mocked wallet boundary.
        throw new Error("Controlled wallet stop");
      } }),
    },
    "@/hooks/useVerifiedWalletChain": { useVerifiedWalletChain: () => ({ isArc: true, verifyNow: async () => true }) },
    "@/hooks/useWalletBalances": { useWalletBalances: () => ({ assets: { usdc: { data: 10_000_000n }, eurc: { data: 10_000_000n } } }) },
    "@/hooks/useWalletAccount": { useWalletAccount: () => ({
      read: { kind: "external", address: account, chainId: arcTestnet.id, status: "connected", connectionStatus: "connected", isArc: true },
      execution: { kind: "external", submitReviewed: (_request: unknown, legacy?: () => Promise<string>) => legacy!() },
    }) },
    "@/lib/walletActivity": {},
    "@/lib/agent/actions": { storeAgentResult: () => {} },
    "./TransactionSafetyReview": { TransactionSafetyReview: "controlled-review" },
    "./PolicyDecisionNotice": { PolicyDecisionNotice: "policy-notice" },
    "@/lib/transactionFlowReview": { ...flowReview, prepareFlowReview: (...args: Parameters<typeof flowReview.prepareFlowReview>) => {
      const snapshot = flowReview.prepareFlowReview(...args);
      observations.snapshots.push(snapshot);
      return snapshot;
    } },
    "@/lib/transactionOrchestrator": { ...orchestrator, revalidateTransactionReview: (...args: Parameters<typeof orchestrator.revalidateTransactionReview>) => {
      const result = orchestrator.revalidateTransactionReview(...args);
      observations.revalidations.push({ snapshot: args[0], options: args[1], result });
      return result;
    } },
  });
  const render = () => { cursor = 0; return RealSwapFlow({ locale: "en", initialValues: { amount: "1" }, onBusyChange: () => {} }); };
  return {
    observations, render, client,
    review: async () => { render().props.onSubmit({ preventDefault() {} }); await tick(); },
    proceed: async () => { render().props.onContinue(); await tick(); },
  };
}

test("post-approval gas success earns no swap evidence while exact simulation is pending", async () => {
  const h = swapHarness();
  await h.review();
  assert.equal(h.render().props.title, "Approve token");
  assert.equal(h.observations.snapshots[0].intent.kind, "approval");
  assert.deepEqual(h.observations.simulations.map((request) => request.functionName), ["approve"]);
  h.observations.output = 1_100_000n;
  let release!: () => void;
  h.observations.simulateSwap = () => new Promise<void>((resolve) => { release = resolve; });
  await h.proceed();
  assert.ok(h.observations.estimates.some((request) => request.functionName === "swap"));
  assert.equal(h.observations.snapshots.filter((snapshot) => snapshot.intent.kind === "swap").length, 0);
  assert.equal(h.render().props.title, "Approve token");
  assert.deepEqual(h.observations.writes.map((request) => request.functionName), ["approve"]);
  assert.equal(typeof release, "function", "post-approval flow must actually await swap simulation");
  release();
  await tick();
  assert.equal(h.render().props.title, "Review Swap");
  const snapshot = h.observations.snapshots.find((value) => value.intent.kind === "swap");
  assert.equal(snapshot.assessment.checks.find((check: any) => check.code === "request-simulated")?.status, "pass");
  assert.equal(snapshot.intent.assetIn.expectedAmount, 1_100_000n);
  const earnedRequest = h.observations.simulations.find((request) => request.functionName === "swap");
  assert.equal(earnedRequest.args[0].minAmountOut, 1_094_500n);
  assert.equal(snapshot.request.data, encodeFunctionData(earnedRequest));
  assert.equal(snapshot.request.to, earnedRequest.address);
  assert.equal(snapshot.intent.account, earnedRequest.account);
  assert.equal(snapshot.request.chainId, earnedRequest.chainId);
  for (const field of ["gas", "maxFeePerGas", "maxPriorityFeePerGas"]) assert.equal(snapshot.request[field], earnedRequest[field].toString());
  h.observations.simulateSwap = async () => {};
  await h.proceed();
  const finalRequest = h.observations.simulations.filter((request) => request.functionName === "swap").at(-1);
  assert.deepEqual(finalRequest, earnedRequest, "execute must simulate the frozen reviewed request and fee envelope");
  assert.deepEqual(h.observations.writes.at(-1), earnedRequest);
  assert.equal(h.observations.revalidations.at(-1).snapshot, snapshot);
  assert.equal(h.observations.revalidations.at(-1).result.valid, true);
});

for (const failure of ["reverted", "unavailable", "not-performed"]) {
  test(`post-approval simulation ${failure} leaves no passing swap review or swap write`, async () => {
    const h = swapHarness();
    await h.review();
    if (failure === "not-performed") h.client.simulateContract = undefined as any;
    else h.observations.simulateSwap = async () => { throw new Error(failure); };
    // Already-approved allowance also exercises the path that skips a new approval write.
    if (failure === "not-performed") h.observations.allowance = 1_000_000n;
    await h.proceed();
    assert.ok(h.observations.estimates.some((request) => request.functionName === "swap"));
    assert.equal(h.observations.snapshots.filter((snapshot) => snapshot.intent.kind === "swap").length, 0);
    assert.equal(h.render().props.title, "Approve token");
    assert.equal(h.observations.writes.filter((request) => request.functionName === "swap").length, 0);
  });
}

test("execute simulation failure still blocks the swap wallet write after earned post-approval evidence", async () => {
  const h = swapHarness();
  await h.review();
  await h.proceed();
  assert.equal(h.render().props.title, "Review Swap");
  h.observations.simulateSwap = async () => { throw new Error("execution simulation reverted"); };
  await h.proceed();
  assert.equal(h.observations.simulations.filter((request) => request.functionName === "swap").length, 2);
  assert.equal(h.observations.writes.filter((request) => request.functionName === "swap").length, 0);
});

test("direct swap review still earns exact simulation evidence and executes without approval", async () => {
  const h = swapHarness(1_000_000n);
  await h.review();
  assert.equal(h.render().props.title, "Review Swap");
  assert.equal(h.observations.snapshots[0].assessment.checks.find((check: any) => check.code === "request-simulated")?.status, "pass");
  assert.deepEqual(h.observations.simulations.map((request) => request.functionName), ["swap"]);
  const request = h.observations.simulations[0];
  await h.proceed();
  assert.deepEqual(h.observations.writes, [request]);
  assert.deepEqual(h.observations.simulations[1], request);
});

// Resolve the actual child components, retaining native button props for
// DOM-equivalent disabled dispatch and callback-ownership assertions.
function nodes(element: any): any[] {
  if (element == null || typeof element === "boolean") return [];
  if (Array.isArray(element)) return element.flatMap(nodes);
  if (typeof element !== "object") return [element];
  if (typeof element.type === "function") return nodes(element.type(element.props));
  return [element, ...nodes(element.props?.children)];
}
const Review = component("TransactionSafetyReview", { "@/hooks/usePreferences": preferences, "./PolicyDecisionNotice": { PolicyDecisionNotice: "policy-notice" } });
const circleIntent = flowReview.bridgeIntent({ id: "circle-review", account, chainId: baseSepolia.id, target: usdc.address, calldata: "0x", preparedAt: 1_000, expiresAt: 46_000, assetId: "usdc", amount: 1_000_000n, recipient: account, destinationChainId: arcTestnet.id, route: "circle-app-kit-cctp", circleManaged: true });
const circleContext: SafetyContext = { connectedAccount: account, connectedChainId: baseSepolia.id, balances: { usdc: 2_000_000n }, simulation: "not-performed", simulationPolicy: { requirement: "externally-managed", provider: "circle-app-kit" }, now: 1_000, managedTarget: { label: "Circle App Kit", category: "circle" } };
const circleSnapshot = flowReview.prepareFlowReview(circleIntent, circleContext);
const assessment = (status: TransactionSafetyAssessment["status"]) => ({ ...circleSnapshot.assessment, status, checks: [] });

for (const compact of [false, true]) {
  for (const [direct, snapshot, expected] of [
    ["ready", "blocked", "blocked"], ["ready", "unknown", "unknown"],
    [undefined, "blocked", "blocked"], [undefined, "unknown", "unknown"],
    ["ready", "ready", "ready"], ["review", "ready", "review"],
    ["ready", "review", "review"], ["blocked", "ready", "blocked"], ["unknown", "ready", "unknown"],
  ] as const) {
    test(`${compact ? "compact" : "full"} review: direct ${direct} + snapshot ${snapshot} displays ${expected} with matching CTA`, () => {
      let calls = 0;
      const onContinue = () => { calls++; };
      const rendered = nodes(Review({ title: "Review", summary: "Summary", details: [], checks: [], walletNotice: "", compact, assessment: direct && assessment(direct), review: { ...circleSnapshot, assessment: assessment(snapshot) }, onBack() {}, onContinue }));
      const button = rendered.find((node) => node?.type === "button" && node.props.className === "primary-action");
      const blocked = expected === "blocked" || expected === "unknown";
      assert.equal(button.props.disabled, blocked);
      assert.equal(button.props.onClick, onContinue, "shared review must preserve parent callback ownership");
      if (!button.props.disabled) button.props.onClick();
      assert.equal(calls, blocked ? 0 : 1);
      const visible = rendered.filter((node) => typeof node === "string").join(" ");
      assert.ok(visible.includes(compact ? blocked ? "Action required" : expected === "review" ? "Review" : "Checks passed" : { ready: "Ready to sign", blocked: "Blocked", unknown: "Unknown contract", review: "Review required" }[expected]), visible);
      const status = rendered.find((node) => typeof node === "object" && (compact ? node.props?.className?.startsWith("compact-safety-summary") : node.props?.className?.startsWith("safety-engine-status")));
      assert.ok(status.props.className.includes(compact ? blocked ? "safety-blocking" : expected === "review" ? "safety-attention" : "safety-verified" : `safety-engine-${expected}`));
    });
  }
  test(`${compact ? "compact" : "full"} Circle review preserves externally-managed disclosure and eligible callback`, () => {
    let calls = 0;
    const rendered = nodes(Review({ title: "Circle", summary: "", details: [], checks: [], walletNotice: "", compact, review: circleSnapshot, onBack() {}, onContinue() { calls++; } }));
    const visible = rendered.filter((node) => typeof node === "string").join(" ");
    assert.ok(visible.includes("review.simulationNotPerformed"));
    assert.ok(!visible.includes("Simulation passed"));
    const button = rendered.find((node) => node?.type === "button" && node.props.className === "primary-action");
    assert.equal(button.props.disabled, false);
    button.props.onClick();
    assert.equal(calls, 1);
    assert.equal(orchestrator.revalidateTransactionReview(circleSnapshot, { intent: circleIntent, context: circleContext, now: 2_000 }).valid, true);
    assert.equal(circleSnapshot.assessment.checks.some((check) => check.code === "request-simulated" && check.status === "pass"), false);
  });
}

test("review presentation repair preserves Send and Bridge final revalidation backstops", () => {
  for (const name of ["SendFlow", "UniversalBridgeFlow"]) {
    const source = readFileSync(new URL(`../components/${name}.tsx`, import.meta.url), "utf8");
    assert.match(source, /revalidateTransactionReview\(/);
    assert.match(source, /if \(![a-zA-Z]+\.valid\)/);
  }
  const rejected = orchestrator.revalidateTransactionReview(circleSnapshot, { intent: circleIntent, context: { ...circleContext, connectedAccount: undefined }, now: 2_000 });
  assert.equal(rejected.valid, false);
});
