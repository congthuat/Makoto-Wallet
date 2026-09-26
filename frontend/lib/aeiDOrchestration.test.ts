import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createAeiDOrchestrator, validateAeiDOperationalEnvelope } from "./aeiDOrchestration.ts";

const hostile = () => {
  const value = { materialization: {}, retainedLiveInput: {}, actionStepId: "action" };
  Object.defineProperty(value, "materialization", { enumerable: true, get() { throw Error("getter"); } });
  return value;
};
function unusedHost() {
  let calls = 0;
  const host = { current: async () => { calls++; throw Error("host must not be called"); }, reads: {}, quotes: {}, now: () => 1000 };
  return { orchestrator: createAeiDOrchestrator(host), count: () => calls };
}

test("invalid, loose, copied and hostile AEI-C inputs fail before wallet/provider acquisition", async () => {
  const { orchestrator, count } = unusedHost();
  const normal = { materialization: {}, retainedLiveInput: {}, actionStepId: "action" };
  const proxy = new Proxy(normal, { ownKeys() { throw Error("proxy"); } });
  const symbol = { ...normal }; Object.defineProperty(symbol, Symbol("hidden"), { value: true });
  for (const value of [null, undefined, 1, "draft", {}, normal, hostile(), proxy, symbol,
    { ...normal, walletClient: true }, { ...normal, materialization: { stage: "SEMANTIC_ONLY", executionEnabled: false } }]) {
    const result = await orchestrator.orchestrate(value as typeof normal);
    assert.equal(result.executionEnabled, false);
    assert.equal(result.status, "INVALID_MATERIALIZATION");
    assert.equal(result.envelope, undefined);
  }
  assert.equal(count(), 0);
});

test("copied or caller-made operational records have no registration authority", async () => {
  assert.equal(await validateAeiDOperationalEnvelope({}, {}), false);
  assert.equal(await validateAeiDOperationalEnvelope({ version: 1, stage: "OPERATIONAL_ONLY",
    executionEnabled: false, executionAuthority: "FORBIDDEN", digest: `0x${"0".repeat(64)}` }, {}), false);
  assert.equal(await validateAeiDOperationalEnvelope(new Proxy({}, { getPrototypeOf() { throw Error("proxy"); } }), {}), false);
});

test("AEI-D production source has no signer, wallet submission, receipt or lifecycle import", () => {
  const source = readFileSync(new URL("./aeiDOrchestration.ts", import.meta.url), "utf8");
  for (const pattern of [/personal_sign/, /eth_sendTransaction/, /\.sendTransaction\(/, /\.writeContract\(/,
    /\.signTypedData\(/, /\.signMessage\(/, /\.submitReviewed\(/, /runReadTool\([^\n]*transaction\.receipt/,
    /from "\.\/agentTransition/, /from "\.\/strategyRecovery/]) assert.doesNotMatch(source, pattern);
  assert.match(source, /runReadTool/);
  assert.match(source, /runQuoteTool/);
  assert.match(source, /runPrepareTool/);
  assert.match(source, /evaluatePolicy/);
});
