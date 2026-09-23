import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getAddress, type Hash } from "viem";

import { createLocalMakotoWalletAccount, createLocalWalletExecutionAdapter, LocalWalletRuntime } from "./walletAccount.ts";
import { normalizeTransactionRequest } from "./transactionOrchestrator.ts";

const address = getAddress("0x1111111111111111111111111111111111111111");
const router = getAddress("0x73742278c31a76dBb0D2587d03ef92E6E2141023");
const approvalHash = `0x${"a".repeat(64)}` as Hash;
const swapHash = `0x${"b".repeat(64)}` as Hash;
const approvalRequest = normalizeTransactionRequest({ to: getAddress("0x3600000000000000000000000000000000000000"), data: "0x1234", chainId: 5042002 });
const swapRequest = normalizeTransactionRequest({ to: router, data: "0x5678", chainId: 5042002 });

test("local Swap uses one guarded adapter for distinct explicit approval and swap submissions", async () => {
  const locked = createLocalMakotoWalletAccount({ address, status: "locked" });
  const unlocked = createLocalMakotoWalletAccount({ address, status: "connected" });
  const runtime = new LocalWalletRuntime(locked);
  const submitted: typeof approvalRequest[] = [];
  const submitter = { address, send: async (request: typeof approvalRequest) => { submitted.push(request); return submitted.length === 1 ? approvalHash : swapHash; } };
  const generation = runtime.beginUnlock(locked);
  assert.equal(runtime.completeUnlock(generation, unlocked, submitter), true);
  const adapter = createLocalWalletExecutionAdapter(() => runtime.getSubmitter(), () => runtime.wallet);

  assert.equal(submitted.length, 0, "quote/review preparation must not sign");
  assert.equal(await adapter.submitReviewed(approvalRequest), approvalHash);
  assert.equal(submitted.length, 1, "approval requires its own explicit submission");
  assert.equal(await adapter.submitReviewed(swapRequest), swapHash);
  assert.deepEqual(submitted.map((request) => request.to), [approvalRequest.to, router]);
});

test("locked or stale local Swap cannot submit and never falls back to an external writer", async () => {
  const locked = createLocalMakotoWalletAccount({ address, status: "locked" });
  const unlocked = createLocalMakotoWalletAccount({ address, status: "connected" });
  const runtime = new LocalWalletRuntime(locked);
  let sends = 0;
  let externalFallbacks = 0;
  const submitter = { address, send: async () => { sends += 1; return swapHash; } };
  const generation = runtime.beginUnlock(locked);
  runtime.completeUnlock(generation, unlocked, submitter);
  const adapter = createLocalWalletExecutionAdapter(() => runtime.getSubmitter(), () => runtime.wallet);
  runtime.lock(locked);

  await assert.rejects(adapter.submitReviewed(swapRequest, async () => { externalFallbacks += 1; return swapHash; }), /locked/);
  assert.equal(sends, 0);
  assert.equal(externalFallbacks, 0);
});

test("production Swap shares quote/review logic and selects execution only at confirmation", () => {
  const source = readFileSync(new URL("../components/RealSwapFlow.tsx", import.meta.url), "utf8");
  assert.match(source, /useWalletAccount\(\)/);
  assert.match(source, /execution\.submitReviewed\(snapshot\.request/);
  assert.match(source, /execution\.submitReviewed\(approvalReview\.request/);
  assert.match(source, /execution\.submitReviewed\(swapReview\.request/);
  assert.match(source, /verifyArcExecution\(\)/);
  assert.match(source, /Unlock local wallet to continue\./);
  assert.match(source, /continueDisabled=\{[^}]*!execution/);
  assert.match(source, /waitForTransactionReceipt\(\{ hash: approvalHash \}\)/);
  assert.match(source, /functionName: "allowance"/);
  assert.match(source, /balances\.usdc\.refetch\(\)/);
  assert.match(source, /balances\.eurc\.refetch\(\)/);
});

test("external Swap remains Wagmi-backed while local Bridge routes only to Direct CCTP", () => {
  const swap = readFileSync(new URL("../components/RealSwapFlow.tsx", import.meta.url), "utf8");
  const dashboard = readFileSync(new URL("../components/WalletDashboard.tsx", import.meta.url), "utf8");
  const overview = readFileSync(new URL("../components/ConnectedOverview.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../components/SwapPanel.tsx", import.meta.url), "utf8");
  assert.match(swap, /writer\.writeContractAsync/);
  assert.match(swap, /wallet\.kind === "external" && externalConnection\.connector/);
  assert.doesNotMatch(dashboard, /wallet\.kind === "local" && next === "bridge"/);
  assert.match(dashboard, /action === "swap" \|\| action === "bridge"/);
  assert.doesNotMatch(overview, /walletKind === "local" && action === "bridge"/);
  assert.match(panel, /wallet\.kind === "local" \? <CctpBridgeFlow/);
  assert.match(panel, /: <UniversalBridgeFlow/);
});

test("Agent remains context-only and receives no Swap execution adapter", () => {
  const context = readFileSync(new URL("./agent/context.ts", import.meta.url), "utf8");
  const tools = readFileSync(new URL("./agent/tools.ts", import.meta.url), "utf8");
  assert.doesNotMatch(context, /WalletExecutionAdapter|submitReviewed|signer|privateKey|mnemonic/);
  assert.doesNotMatch(tools, /WalletExecutionAdapter|submitReviewed|useWriteContract|sendTransaction/);
});
