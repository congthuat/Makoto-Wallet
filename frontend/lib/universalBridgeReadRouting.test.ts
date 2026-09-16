import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as viem from "viem";
import * as chains from "viem/chains";
import { createConfig, getPublicClient, injected, type Config } from "@wagmi/core";
import * as assets from "./assets.ts";
import * as erc20 from "./abi/erc20.ts";
import * as bridge from "./circle/bridge.ts";
import * as bridgeChains from "./circle/chains.ts";
import * as browserAdapter from "./circle/browserAdapter.ts";
import * as flowReview from "./transactionFlowReview.ts";
import * as orchestrator from "./transactionOrchestrator.ts";

// Offline fixtures only: no connected wallet, live RPC, or Circle execution.
const account = "0x1111111111111111111111111111111111111111";
const configuredRpc = "https://configured-arc.invalid/";
const fixtureBalance = 2_000_000n;
const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
function load(path: string, imports: Record<string, unknown>) {
  const exports: Record<string, unknown> = {};
  const script = ts.transpileModule(source(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
  }).outputText;
  runInNewContext(script, {
    exports, Error,
    process: { env: { NEXT_PUBLIC_ARC_RPC_URL: configuredRpc } },
    require: (name: string) => {
      assert.ok(name in imports, `Unexpected import: ${name}`);
      return imports[name];
    },
    React: { createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => ({ type, props: { ...props, children } }) },
    window: { setTimeout: (callback: () => void) => { callback(); return 1; }, clearTimeout: () => undefined },
  });
  return exports;
}

const rpcConfig = load("./config.ts", { viem, "./assets.ts": assets }) as { arcRpcUrl: string; ARC_PUBLIC_RPC_URLS: string[] };
type RpcCall = { url: string; method: string; params: [{ to: string; data: viem.Hex }, string] };
function sharedConfig(mode: "success" | "fallback" | "failure") {
  const calls: RpcCall[] = [];
  const fetchFn: typeof fetch = async (url, init) => {
    const request = JSON.parse(String(init?.body));
    let params = request.params;
    let result = viem.toHex(fixtureBalance, { size: 32 });
    if (request.method === "eth_call" && request.params[0].data.startsWith("0x82ad56cb")) {
      const decoded = viem.decodeFunctionData({ abi: viem.multicall3Abi, data: request.params[0].data });
      assert.equal(decoded.functionName, "aggregate3");
      const [reads] = decoded.args as [readonly { target: string; callData: viem.Hex }[]];
      assert.equal(reads.length, 1);
      params = [{ to: reads[0].target, data: reads[0].callData }, request.params[1]];
      result = viem.encodeFunctionResult({ abi: viem.multicall3Abi, functionName: "aggregate3", result: [{ success: true, returnData: result }] });
    }
    calls.push({ url: String(url), method: request.method, params });
    if (mode === "failure" || (mode === "fallback" && String(url) === configuredRpc)) {
      return new Response("RPC unavailable", { status: 503 });
    }
    return Response.json({ jsonrpc: "2.0", id: request.id, result });
  };
  // Execute the existing config and fallback transport; replace only network I/O.
  const configured = load("./wagmi.ts", {
    "@reown/appkit/react": {}, "@reown/appkit-adapter-wagmi": {},
    wagmi: { createConfig, injected },
    viem: { ...viem, http: (url?: string, options?: viem.HttpTransportConfig) => viem.http(url, { ...options, fetchFn }) },
    "viem/chains": chains, "./config": rpcConfig,
    "./reown": { resolveReownProjectId: () => "", REOWN_METADATA: {} },
  });
  return { config: (configured.createWagmiConfig as () => Config)(), calls };
}

type Element = { type: unknown; props: Record<string, unknown> & { children: unknown[] } };
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value && typeof value === "object" && "props" in value) return text((value as Element).props.children);
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}
function harness(mode: "success" | "fallback" | "failure", options: { arc?: boolean; missingClient?: boolean; locale?: "en" | "vi" } = {}) {
  const { config, calls } = sharedConfig(mode);
  let slot = 0, estimates = 0, executions = 0;
  const states: unknown[] = [], requestedChains: number[] = [], effects: (() => void)[] = [];
  const estimatedParams: Parameters<typeof bridge.makeBridgeParams>[] = [];
  const Review = () => undefined;
  const componentModule = load("../components/UniversalBridgeFlow.tsx", {
    react: {
      useState: (initial?: unknown) => {
        const index = slot++;
        if (!(index in states)) states[index] = initial;
        return [states[index], (value: unknown) => { states[index] = value; }];
      },
      useRef: (initial: unknown) => {
        const index = slot++;
        if (!(index in states)) states[index] = { current: initial };
        return states[index];
      },
      useEffect: (effect: () => void) => effects.push(effect),
    },
    viem: { ...viem, createPublicClient: () => assert.fail("Bridge must use the shared read client") },
    "viem/chains": chains,
    wagmi: {
      useConnection: () => ({ address: account, isConnected: true }),
      useSwitchChain: () => ({ switchChainAsync: () => assert.fail("Fixture provider is already on the source chain") }),
      usePublicClient: ({ chainId }: { chainId: number }) => {
        requestedChains.push(chainId);
        return options.missingClient ? undefined : getPublicClient(config, { chainId });
      },
    },
    "@/lib/abi/erc20": erc20,
    "@/lib/circle/appKit": { getCircleAppKit: async () => ({
      getSupportedChains: () => bridgeChains.UNIFIED_EVM_CHAINS.map((chain) => ({ name: chain.sdk })),
      estimateBridge: async () => {
        estimates++;
        return { source: { address: account }, fees: [], gasFees: [] };
      },
      bridge: () => { executions++; assert.fail("Review must never execute a bridge"); },
    }) },
    "@/lib/circle/browserAdapter": {
      ...browserAdapter,
      createCircleBrowserAdapter: async () => ({ adapter: {}, provider: { request: async ({ method }: { method: string }) => {
        if (method === "eth_accounts") return [account];
        assert.equal(method, "eth_chainId");
        return viem.toHex(requestedChains.at(-1)!);
      } } }),
    },
    "@/lib/circle/bridge": { ...bridge, makeBridgeParams: (...args: Parameters<typeof bridge.makeBridgeParams>) => {
      estimatedParams.push(args);
      return bridge.makeBridgeParams(...args);
    } },
    "@/lib/circle/chains": bridgeChains,
    "@/lib/transactionFlowReview": flowReview,
    "@/lib/transactionOrchestrator": orchestrator,
    "@/lib/bridgeTerminalState": {
      bridgeReviewIsActionable: (result: unknown, estimate: unknown, review: unknown) => result === undefined && estimate !== undefined && review !== undefined,
      bridgeContinueAllowed: (result: unknown, locked: boolean, estimate: unknown, review: unknown) => result === undefined && !locked && estimate !== undefined && review !== undefined,
    },
    "@/lib/agent/actions": { storeAgentResult: () => assert.fail("Review must never persist a transaction result") },
    "./CctpBridgeFlow": {}, "./TransactionSafetyReview": { TransactionSafetyReview: Review },
    "./UniversalBridgeFlow.module.css": {},
  });
  const Component = componentModule.UniversalBridgeFlow as (props: unknown) => Element;
  function render() {
    slot = 0;
    const tree = Component({ locale: options.locale ?? "en", initialValues: options.arc ? { sourceChain: "Arc Testnet" } : undefined, onBusyChange: () => undefined });
    effects.splice(0).forEach((effect) => effect());
    return tree;
  }
  return {
    calls, config, requestedChains, estimatedParams, render, Review,
    get estimates() { return estimates; }, get executions() { return executions; },
    async review() {
      const form = elements(render()).find((element) => element.type === "form")!;
      (form.props.onSubmit as (event: unknown) => void)({ preventDefault() {} });
      // The form intentionally discards the review promise. Wait for the UI state.
      const deadline = Date.now() + 15_000;
      while (true) {
        const tree = render();
        if (tree.type === Review || elements(tree).some((element) => element.props.role === "alert")) return tree;
        assert.ok(Date.now() < deadline, "Bridge review did not settle");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
  };
}

test("Arc review reads through configured shared transport before Circle estimate", async () => {
  const app = harness("success", { arc: true });
  const tree = await app.review();
  assert.equal(rpcConfig.arcRpcUrl, configuredRpc);
  assert.equal(app.config.getClient({ chainId: chains.arcTestnet.id }).transport.type, "fallback");
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].url, configuredRpc);
  assert.equal(app.calls[0].method, "eth_call");
  assert.equal(app.calls[0].params[0].to.toLowerCase(), bridgeChains.unifiedChainById(chains.arcTestnet.id)!.usdc.toLowerCase());
  assert.equal(app.calls[0].params[0].data, viem.encodeFunctionData({ abi: erc20.erc20BalanceAbi, functionName: "balanceOf", args: [account] }));
  assert.equal(tree.type, app.Review, text(tree));
  assert.equal(app.estimates, 1);
  assert.equal(app.executions, 0);
});

test("Arc review retains the shared ordered fallback after configured RPC failure", async () => {
  const app = harness("fallback", { arc: true });
  const tree = await app.review();
  assert.equal(tree.type, app.Review, text(tree));
  assert.deepEqual([...new Set(app.calls.map((call) => call.url))], Array.from(rpcConfig.ARC_PUBLIC_RPC_URLS.slice(0, 2), (url) => new URL(url).href));
  assert.equal(app.estimates, 1);
  assert.equal(app.executions, 0);
});

for (const missingClient of [false, true]) test(`Arc ${missingClient ? "missing client" : "read failure"} shows an alert without financial or review state`, async () => {
  const app = harness("failure", { arc: true, missingClient });
  const tree = await app.review();
  const alert = elements(tree).find((element) => element.props.role === "alert");
  assert.ok(alert);
  assert.ok(text(alert).length > 0);
  assert.notEqual(tree.type, app.Review);
  assert.equal(elements(tree).some((element) => element.type === "form"), true);
  assert.doesNotMatch(text(tree), /Source balance:|Expected receive|Estimated receive|Continue to wallet|Completed/);
  assert.equal(app.estimates, 0);
  assert.equal(app.estimatedParams.length, 0);
  assert.equal(app.executions, 0);
  if (missingClient) assert.equal(app.calls.length, 0);
  else assert.deepEqual([...new Set(app.calls.map((call) => call.url))], Array.from(rpcConfig.ARC_PUBLIC_RPC_URLS, (url) => new URL(url).href));
});

test("missing source client has a visible Vietnamese error", async () => {
  const app = harness("failure", { arc: true, missingClient: true, locale: "vi" });
  const tree = await app.review();
  assert.match(text(elements(tree).find((element) => element.props.role === "alert")), /Không thể đọc số dư mạng nguồn/);
  assert.equal(app.estimates, 0);
});

test("Base to Arc keeps source routing, Circle parameters and not-performed simulation", async () => {
  const app = harness("success");
  const tree = await app.review();
  assert.equal(tree.type, app.Review, text(tree));
  assert.ok(app.requestedChains.every((chainId) => chainId === chains.baseSepolia.id));
  assert.equal(app.calls[0].url, new URL(chains.baseSepolia.rpcUrls.default.http[0]).href);
  assert.equal(app.calls[0].params[0].to.toLowerCase(), bridgeChains.unifiedChainById(chains.baseSepolia.id)!.usdc.toLowerCase());
  const params = bridge.makeBridgeParams(...app.estimatedParams[0]);
  assert.equal(params.from.chain, "Base_Sepolia");
  assert.equal(params.to.chain, "Arc_Testnet");
  assert.equal(params.to.recipientAddress, account);
  assert.equal(params.to.useForwarder, true);
  assert.equal(params.amount, "0.10");
  assert.equal(params.config?.transferSpeed, "SLOW");
  const review = tree.props.review as orchestrator.TransactionReviewSnapshot;
  assert.equal(review.intent.chainId, chains.baseSepolia.id);
  assert.equal(review.intent.metadata?.destinationChainId, chains.arcTestnet.id);
  assert.equal(review.intent.metadata?.finalTransaction, "managed-by-circle-app-kit");
  assert.equal(review.assessment.status, "review");
  assert.ok(review.assessment.checks.some((check) => check.code === "request-simulation-not-performed"));
  assert.equal(app.executions, 0);
});
