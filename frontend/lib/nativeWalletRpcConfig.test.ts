import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { arcTestnet } from "viem/chains";

import { ARC_PUBLIC_RPC_URLS, DEFAULT_ARC_RPC_URL, arcRpcUrl } from "./config.ts";
import { JAR_ACTIVITY_RPC_ENDPOINTS } from "./jarActivityApi.ts";

test("Native Wallet uses the canonical Arc Testnet RPC source and expected chain", () => {
  assert.equal(arcTestnet.id, 5_042_002);
  assert.equal(DEFAULT_ARC_RPC_URL, "https://rpc.testnet.arc.io");
  assert.equal(arcRpcUrl, DEFAULT_ARC_RPC_URL);
  assert.equal(ARC_PUBLIC_RPC_URLS[0], DEFAULT_ARC_RPC_URL);
  assert.equal(new Set(ARC_PUBLIC_RPC_URLS).size, ARC_PUBLIC_RPC_URLS.length);
  for (const url of ARC_PUBLIC_RPC_URLS) assert.match(url, /^https:\/\/[^/]+\.arc\.io$/);
});

test("specialized Jar Activity fallbacks are explicit approved Arc endpoints", () => {
  assert.ok(JAR_ACTIVITY_RPC_ENDPOINTS.length > 1);
  for (const endpoint of JAR_ACTIVITY_RPC_ENDPOINTS) {
    assert.match(endpoint.url, /^https:\/\/[^/]+\.arc\.io$/);
    assert.ok(endpoint.maxBlocks > 0n);
  }
});

test("examples and runtime fallback consumers do not retain the legacy .network endpoint", () => {
  const rootExample = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
  const frontendExample = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  const rpcFallback = readFileSync(new URL("indexer/rpcFallback.ts", import.meta.url), "utf8");
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  for (const source of [rootExample, frontendExample, rpcFallback, readme]) assert.doesNotMatch(source, /rpc\.testnet\.arc\.network/);
  assert.match(rpcFallback, /ARC_PUBLIC_RPC_URLS/);
  assert.match(readme, /one logical transaction|ordered, de-duplicated fallback list/i);
});
