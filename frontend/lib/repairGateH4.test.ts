/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, keccak256, parseAbiParameters, stringToHex } from "viem";
import { ARC_MEMO_ADDRESS, arcMemoAbi } from "./arcMemo.ts";
import { erc20BalanceAbi } from "./abi/erc20.ts";
import { SUPPORTED_ASSETS } from "./assets.ts";
import { encodeTransferLog } from "./transactionReceipt.ts";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../components/TransactionReceiptPanel.tsx", import.meta.url), "utf8");
const wallet = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const [usdc, eurc] = SUPPORTED_ASSETS;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function activity(byte: string, swap = false): any {
  return { hash: `0x${byte.repeat(32)}`, logIndex: 4, direction: "send", kind: swap ? "swap" : "transfer", amount: 5_000_000n, counterparty: other, confirmedAt: 1_766_000_000_000, blockNumber: 123n, assetId: usdc.id, assetSymbol: usdc.symbol, tokenAddress: usdc.address, decimals: 6, ...(swap ? { swapReceive: { amount: 4_990_000n, assetId: eurc.id, assetSymbol: eurc.symbol, tokenAddress: eurc.address, decimals: 6, logIndex: 8 } } : {}) };
}
function receipt(a: any, failed = false): any {
  const hash = a.hash;
  const callDataHash = keccak256(encodeFunctionData({ abi: erc20BalanceAbi, functionName: "transfer", args: [other, a.amount] }));
  const logs: any[] = [encodeTransferLog({ token: usdc.address, from: wallet, to: other, value: a.amount, logIndex: 4, transactionHash: hash }), {
    address: ARC_MEMO_ADDRESS, transactionHash: hash, logIndex: 5,
    topics: encodeEventTopics({ abi: arcMemoAbi, eventName: "Memo", args: { sender: wallet, target: usdc.address, memoId: `0x${"11".repeat(32)}` } }),
    data: encodeAbiParameters(parseAbiParameters("bytes32 callDataHash, bytes memo, uint256 memoIndex"), [callDataHash, stringToHex(`NOTE ${hash}`), 5n]),
  }];
  if (a.swapReceive) logs.push(encodeTransferLog({ token: eurc.address, from: other, to: wallet, value: a.swapReceive.amount, logIndex: 8, transactionHash: hash }));
  return { status: failed ? "reverted" : "success", transactionHash: hash, blockNumber: 123n, logs };
}
function nodes(value: any): any[] { return Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === "object" ? [value, ...nodes(value.props?.children)] : []; }
function text(value: any): string { return Array.isArray(value) ? value.map(text).join(" ") : value && typeof value === "object" ? text(value.props?.children) : typeof value === "string" ? value : ""; }
// Execute the production React component with retained hook slots. Effects are
// explicitly deferred so assertions observe the first render, not a reset render.
function harness() {
  const slots: any[] = [], pending: (() => void)[] = [], requests: any[] = [];
  let cursor = 0;
  const client = { getTransactionReceipt: ({ hash }: any) => new Promise((resolve, reject) => requests.push({ hash, resolve, reject })) };
  const env = { client: client as any, account: wallet, shared: [] as any[], copied: [] as string[] };
  const same = (a: any[], b?: any[]) => b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const mocks: Record<string, any> = {
    react: {
      useState: (initial: any) => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], (v: any) => { slots[i] = typeof v === "function" ? v(slots[i]) : v; }]; },
      useMemo: (fn: () => any, deps: any[]) => { const i = cursor++; if (!same(deps, slots[i]?.deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
      useEffect: (fn: () => any, deps: any[]) => { const i = cursor++; if (!same(deps, slots[i]?.deps)) { const prev = slots[i]; slots[i] = { deps }; pending.push(() => { prev?.cleanup?.(); slots[i].cleanup = fn(); }); } },
    },
    wagmi: { usePublicClient: () => env.client },
    "@/hooks/usePreferences": { usePreferences: () => ({ locale: "en" }) },
    "@/lib/contacts": { loadContacts: () => [] },
    "./WalletPanel": { WalletPanel: "wallet-panel" },
  };
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const mod = { exports: {} as any };
  const load = (id: string) => id in mocks ? mocks[id] : id.startsWith("@/") ? require(fileURLToPath(new URL(`../${id.slice(2)}.ts`, import.meta.url))) : require(id);
  new Function("require", "module", "exports", "navigator", "window", code)(load, mod, mod.exports, { share: async (v: any) => { env.shared.push(v); }, clipboard: { writeText: async (v: string) => { env.copied.push(v); } } }, { setTimeout: () => 0 });
  return { env, requests, render(a: any) { cursor = 0; return mod.exports.TransactionReceiptPanel({ activity: a, walletAddress: env.account, onClose() {} }); }, async effects() { pending.splice(0).forEach(fn => fn()); await tick(); }, async resolve(i: number, r: any) { requests[i].resolve(r); await tick(); } };
}
function status(tree: any) { return nodes(tree).find(n => n.props?.["data-receipt-status"])?.props["data-receipt-status"]; }
function safe(tree: any) { assert.equal(status(tree), undefined); assert.match(text(tree), /Verifying receipt/); assert.doesNotMatch(text(tree), /NOTE |4\.99|Verified on Arc|Confirmed failure/); assert.equal(nodes(tree).filter(n => n.type === "button" || n.type === "a").length, 0); }
async function ready(failed = false, swap = false) { const h = harness(), a = activity("ab", swap); h.render(a); await h.effects(); await h.resolve(0, receipt(a, failed)); return { h, a }; }

test("H4 own success and valid memo remain usable", async () => { const { h, a } = await ready(); const tree = h.render(a); assert.equal(status(tree), "confirmed-success"); assert.match(text(tree), /NOTE /); });
test("H4 first B render rejects A success before effects", async () => { const { h } = await ready(); safe(h.render(activity("cd"))); });
test("H4 first B render rejects A failure before effects", async () => { const { h } = await ready(true); safe(h.render(activity("cd"))); });
test("H4 first B render rejects A actual received", async () => { const { h } = await ready(false, true); safe(h.render(activity("cd", true))); });
test("H4 transition exposes no copy/share handler with mixed ownership", async () => { const { h } = await ready(); safe(h.render(activity("cd"))); assert.deepEqual(h.env.shared, []); assert.deepEqual(h.env.copied, []); });
test("H4 current copy and share use the actual canonical formatter", async () => { const { h, a } = await ready(); for (const label of ["Copy receipt", "Share receipt"]) { const b = nodes(h.render(a)).find(n => n.type === "button" && text(n) === label); assert.ok(b); b.props.onClick(); await tick(); } assert.match(h.env.copied[0], /Status: Confirmed/); assert.ok(h.env.shared[0].text.includes(a.hash)); assert.equal(h.env.shared[0].text, h.env.copied[0]); });
test("H4 A pending resolves after B selected but before effects", async () => { const h = harness(), a = activity("ab"), b = activity("cd"); h.render(a); await h.effects(); safe(h.render(b)); await h.resolve(0, receipt(a)); safe(h.render(b)); });
test("H4 A late resolution after B request cannot replace B", async () => { const h = harness(), a = activity("ab"), b = activity("cd"); h.render(a); await h.effects(); h.render(b); await h.effects(); await h.resolve(1, receipt(b)); await h.resolve(0, receipt(a)); const tree = h.render(b); assert.equal(status(tree), "confirmed-success"); assert.ok(text(tree).includes(`NOTE ${b.hash}`)); assert.ok(!text(tree).includes(`NOTE ${a.hash}`)); });
test("H4 rapid A to B to C ignores late B and A", async () => { const h = harness(), a = activity("ab"), b = activity("cd"), c = activity("ef"); for (const item of [a, b, c]) { h.render(item); await h.effects(); } await h.resolve(1, receipt(b)); await h.resolve(0, receipt(a)); safe(h.render(c)); await h.resolve(2, receipt(c)); assert.equal(status(h.render(c)), "confirmed-success"); });
test("H4 B own failure remains failure", async () => { const { h } = await ready(); const b = activity("cd"); h.render(b); await h.effects(); await h.resolve(1, receipt(b, true)); assert.equal(status(h.render(b)), "confirmed-failure"); });
test("H4 same hash account change invalidates evidence immediately", async () => { const { h, a } = await ready(); h.env.account = other; safe(h.render(a)); });
test("H4 same hash activity evidence change invalidates immediately", async () => { const { h, a } = await ready(); safe(h.render({ ...a, amount: 6_000_000n })); });
test("H4 Arc client context change invalidates immediately", async () => { const { h, a } = await ready(); h.env.client = undefined; safe(h.render(a)); await h.effects(); assert.equal(status(h.render(a)), "submitted-unknown"); });
test("H4 late rejected A request cannot remove B verification", async () => { const h = harness(), a = activity("ab"), b = activity("cd"); h.render(a); await h.effects(); h.render(b); await h.effects(); await h.resolve(1, receipt(b)); h.requests[0].reject(new Error("offline")); await tick(); assert.equal(status(h.render(b)), "confirmed-success"); });
