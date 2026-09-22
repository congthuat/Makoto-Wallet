import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (name: string) => readFileSync(new URL(`../components/${name}`, import.meta.url), "utf8");

test("every real confirmed Makoto money flow uses the central Activity writer", () => {
  assert.match(source("WalletDashboard.tsx"), /recordWalletActivity\(wallet\.address, arcTestnet\.id, item\)/);
  assert.match(source("RealSwapFlow.tsx"), /kind: "swap"[\s\S]*swapReceive:/);
  assert.match(source("RealSwapFlow.tsx"), /recordWalletActivity\(/);
  assert.match(source("OwnerDepositFlow.tsx"), /kind: "vault-deposit"[\s\S]*recordWalletActivity|recordWalletActivity[\s\S]*kind: "vault-deposit"/);
  assert.match(source("SharedContributionFlow.tsx"), /kind: "vault-deposit"[\s\S]*recordWalletActivity|recordWalletActivity[\s\S]*kind: "vault-deposit"/);
  assert.match(source("OwnerWithdrawalFlow.tsx"), /kind: "vault-withdraw"[\s\S]*recordWalletActivity|recordWalletActivity[\s\S]*kind: "vault-withdraw"/);
  assert.match(source("CctpBridgeFlow.tsx"), /kind: "bridge"[\s\S]*recordWalletActivity|recordWalletActivity[\s\S]*kind: "bridge"/);
});

test("demo-only Makoto Pay still creates no fake Activity", () => {
  assert.doesNotMatch(source("MakotoPay.tsx"), /recordWalletActivity\(/);
});
