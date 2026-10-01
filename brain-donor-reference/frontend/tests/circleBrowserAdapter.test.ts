import assert from "node:assert/strict";
import test from "node:test";
import { getActiveProvider, verifyProviderAccount, verifyProviderChain } from "./circle/browserAdapter.ts";

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
