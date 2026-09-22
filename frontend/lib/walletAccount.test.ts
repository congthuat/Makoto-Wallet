import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createExternalWalletAccount, createLocalMakotoWalletAccount, createLocalWalletExecutionAdapter, isWalletConnected, LocalWalletRuntime, type LocalWalletSubmitter } from "./walletAccount.ts";
import { normalizeTransactionRequest } from "./transactionOrchestrator.ts";

const address = "0x1111111111111111111111111111111111111111" as `0x${string}`;

test("external account preserves address, provider identity, chain and Arc verification", () => {
  const account = createExternalWalletAccount({
    address,
    chainId: 5042002,
    connectorChainId: 5042002,
    providerChainId: 5042002,
    connectionStatus: "connected",
    isArc: true,
    providerName: "OKX",
    connectorId: "injected",
  });
  assert.equal(account.kind, "external");
  assert.equal(account.status, "connected");
  assert.equal(account.address, address);
  assert.equal(account.chainId, 5042002);
  assert.equal(account.providerName, "OKX");
  assert.equal(account.isArc, true);
  assert.equal(isWalletConnected(account), true);
});

test("external account keeps the verified provider chain ahead of connector metadata", () => {
  const account = createExternalWalletAccount({
    address,
    chainId: 84532,
    connectorChainId: 84532,
    providerChainId: 5042002,
    connectionStatus: "connected",
    isArc: false,
  });
  assert.equal(account.providerChainId, 5042002);
  assert.equal(account.connectorChainId, 84532);
});

test("disconnected external account stays unavailable and exposes no address", () => {
  const account = createExternalWalletAccount({
    connectionStatus: "disconnected",
    isArc: false,
  });
  assert.equal(account.kind, "external");
  assert.equal(account.status, "unavailable");
  assert.equal(account.address, undefined);
  assert.equal(account.chainId, undefined);
  assert.equal(isWalletConnected(account), false);
});

test("reconnecting state is not reported as connected", () => {
  const account = createExternalWalletAccount({
    address,
    chainId: 5042002,
    connectionStatus: "reconnecting",
    isArc: true,
  });
  assert.equal(account.status, "unavailable");
  assert.equal(account.connectionStatus, "reconnecting");
  assert.equal(isWalletConnected(account), false);
});

test("Agent consumers use read context and never receive signing capabilities", () => {
  const agentPage = readFileSync(new URL("../components/MakotoAgentPage.tsx", import.meta.url), "utf8");
  const dashboard = readFileSync(new URL("../components/WalletDashboard.tsx", import.meta.url), "utf8");
  for (const source of [agentPage, dashboard]) {
    assert.match(source, /useWalletReadContext/);
    assert.doesNotMatch(source, /useWriteContract|useSendTransaction|useSignMessage|useWalletClient|privateKey|mnemonic|seed phrase/);
  }
});

test("local execution is available only for the matching unlocked Arc account", async () => {
  let wallet = createLocalMakotoWalletAccount({ address, status: "connected" });
  let calls = 0;
  const adapter = createLocalWalletExecutionAdapter(
    () => ({ address, send: async () => { calls += 1; return "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; } }),
    () => wallet,
  );
  const request = normalizeTransactionRequest({ to: address, data: "0x", chainId: 5042002 });
  assert.equal(calls, 0);
  assert.equal(await adapter.submitReviewed(request), "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(calls, 1);
  wallet = createLocalMakotoWalletAccount({ address, status: "locked" });
  await assert.rejects(adapter.submitReviewed(request), /locked/);
  assert.equal(calls, 1);
});

test("local execution rejects a changed account and the wrong chain", async () => {
  const other = "0x2222222222222222222222222222222222222222" as `0x${string}`;
  const wallet = createLocalMakotoWalletAccount({ address, status: "connected" });
  const mismatch = createLocalWalletExecutionAdapter(() => ({ address: other, send: async () => "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }), () => wallet);
  await assert.rejects(mismatch.submitReviewed(normalizeTransactionRequest({ to: address, data: "0x", chainId: 5042002 })), /account changed/);
  const matching = createLocalWalletExecutionAdapter(() => ({ address, send: async () => "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }), () => wallet);
  await assert.rejects(matching.submitReviewed(normalizeTransactionRequest({ to: address, data: "0x", chainId: 84532 })), /Arc Testnet/);
});

test("authoritative runtime invalidates stale reviews immediately on Lock", async () => {
  const locked = createLocalMakotoWalletAccount({ address, status: "locked" });
  const unlocked = createLocalMakotoWalletAccount({ address, status: "connected" });
  const runtime = new LocalWalletRuntime(locked);
  let calls = 0;
  const submitter: LocalWalletSubmitter = { address, send: async () => { calls += 1; return `0x${"a".repeat(64)}`; } };
  const generation = runtime.beginUnlock(locked);
  assert.equal(runtime.status, "unlocking");
  assert.equal(runtime.completeUnlock(generation, unlocked, submitter), true);
  assert.equal(runtime.status, "unlocked");
  const adapter = createLocalWalletExecutionAdapter(() => runtime.getSubmitter(), () => runtime.wallet);
  const reviewed = normalizeTransactionRequest({ to: address, data: "0x", chainId: 5042002 });
  runtime.lock(locked);
  await assert.rejects(adapter.submitReviewed(reviewed), /locked/);
  assert.equal(calls, 0);
});

test("two tab runtimes never share a signer and remote invalidation wins an unlock race", () => {
  const locked = createLocalMakotoWalletAccount({ address, status: "locked" });
  const unlocked = createLocalMakotoWalletAccount({ address, status: "connected" });
  const tabA = new LocalWalletRuntime(locked);
  const tabB = new LocalWalletRuntime(locked);
  const submitter: LocalWalletSubmitter = { address, send: async () => `0x${"b".repeat(64)}` };
  const tabAGeneration = tabA.beginUnlock(locked);
  const tabBGeneration = tabB.beginUnlock(locked);
  assert.equal(tabA.completeUnlock(tabAGeneration, unlocked, submitter), true);
  assert.equal(tabA.getSubmitter(), submitter);
  assert.equal(tabB.getSubmitter(), undefined);
  tabB.lock(createLocalMakotoWalletAccount({ status: "unavailable" }));
  assert.equal(tabB.completeUnlock(tabBGeneration, unlocked, submitter), false);
  assert.equal(tabB.status, "unavailable");
  tabA.destroy();
  assert.equal(tabA.getSubmitter(), undefined);
  assert.equal(tabA.status, "locked");
});

test("provider reacts to safe cross-tab storage metadata and destroys runtime on unmount", () => {
  const provider = readFileSync(new URL("../hooks/useWalletAccount.tsx", import.meta.url), "utf8");
  assert.match(provider, /window\.addEventListener\("storage", sync\)/);
  assert.match(provider, /isLocalWalletLifecycleStorageKey\(event\.key\)/);
  assert.match(provider, /runtime\.destroy\(\)/);
  assert.match(provider, /JSON\.stringify\(\{ action: "lock", at: Date\.now\(\) \}\)/);
  assert.doesNotMatch(provider, /localStorage\.setItem\([^\n]*(?:password|mnemonic|privateKey|signer)/i);
});

test("Send keeps one selected adapter behind review and explicit confirmation", () => {
  const send = readFileSync(new URL("../components/SendFlow.tsx", import.meta.url), "utf8");
  assert.match(send, /const \{ read: wallet, execution \} = useWalletAccount\(\)/);
  assert.match(send, /submitReviewedTransaction/);
  assert.match(send, /ReviewSubmissionGuard/);
  assert.match(send, /writeContractAsync/);
  assert.match(send, /onContinue=\{\(\) => void submit\(\)\}/);
  assert.doesNotMatch(send, /useEffect\(\(\) => \{[^}]*submit\(/s);
});
