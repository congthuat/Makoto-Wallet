import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { validateStrategy, type StrategyValidationCode } from "./strategyModel.ts";

const fingerprint = `0x${"a".repeat(64)}`;
const action = (id: string, capability: "APPROVE" | "SEND" | "SWAP" | "BRIDGE", dependsOn: string[] = []) => ({ id, kind: "ACTION", action: capability, dependsOn, confirmation: "EXPLICIT_USER_CONFIRMATION" });
const receipt = (id: string, actionStepId: string) => ({ id, kind: "WAIT_RECEIPT", dependsOn: [actionStepId], receipt: { kind: "RECEIPT", actionStepId } });
const revalidate = (id: string, dependsOn: string[]) => ({ id, kind: "REVALIDATE", dependsOn });
const strategy = (steps: unknown[]) => ({ version: 1, id: "strategy-1", createdAt: 1_000_000, steps });
function rejects(input: unknown, code: StrategyValidationCode) {
  const result = validateStrategy(input);
  assert.equal(result.valid, false);
  if (!result.valid) assert.ok(result.errors.some((error) => error.code === code), JSON.stringify(result.errors));
}

test("single Send is descriptive data with explicit wallet confirmation", () => {
  const input = strategy([{ ...action("send", "SEND"), preparedAction: { kind: "PREPARED_ACTION", tool: "send.prepare", quoteFingerprint: fingerprint, stepIndex: 0 } }]);
  assert.equal(validateStrategy(input).valid, true);
});

test("approval, receipt, revalidation and Swap dependencies are representable", () => {
  const input = strategy([
    { ...action("approve", "APPROVE"), preparedAction: { kind: "PREPARED_ACTION", tool: "swap.prepare", quoteFingerprint: fingerprint, stepIndex: 0 } },
    receipt("approval-receipt", "approve"),
    { ...revalidate("refresh", ["approval-receipt"]), quote: { kind: "QUOTE", tool: "swap.quote", fingerprint }, policy: { kind: "POLICY_RESULT", id: "policy-evidence-1" } },
    action("swap", "SWAP", ["refresh"]),
  ]);
  assert.equal(validateStrategy(input).valid, true);
});

test("Direct CCTP-shaped approval, receipt, revalidation and Bridge is data only", () => {
  const input = strategy([
    { ...action("approve", "APPROVE"), preparedAction: { kind: "PREPARED_ACTION", tool: "bridge.prepare", quoteFingerprint: fingerprint, stepIndex: 0 } },
    receipt("approval-receipt", "approve"),
    revalidate("refresh", ["approval-receipt"]),
    action("bridge", "BRIDGE", ["refresh"]),
  ]);
  assert.equal(validateStrategy(input).valid, true);
});

test("multiple explicit dependencies and JSON round trip preserve the model", () => {
  const input = { ...strategy([
    action("approve-a", "APPROVE"), action("approve-b", "APPROVE"),
    receipt("receipt-a", "approve-a"), receipt("receipt-b", "approve-b"),
    revalidate("refresh", ["receipt-a", "receipt-b"]), action("swap", "SWAP", ["refresh"]),
  ]), metadata: { label: "Two prerequisites", description: "Data only" } };
  const result = validateStrategy(input);
  assert.equal(result.valid, true);
  const serialized = JSON.stringify(input);
  assert.deepEqual(JSON.parse(serialized), input);
  assert.equal(validateStrategy(JSON.parse(serialized)).valid, true);
});

test("malformed identity, metadata and non-JSON values fail structurally", () => {
  rejects({ ...strategy([action("send", "SEND")]), id: " " }, "INVALID_SCHEMA");
  rejects({ ...strategy([]), version: 2 }, "INVALID_SCHEMA");
  rejects({ ...strategy([action("send", "SEND")]), metadata: { label: 42 } }, "INVALID_SCHEMA");
  rejects({ ...strategy([action("send", "SEND")]), callback: () => undefined }, "INVALID_SCHEMA");
  rejects({ ...strategy([action("send", "SEND")]), createdAt: Number.NaN }, "INVALID_SCHEMA");
});

test("duplicate, self, unknown and cyclic dependencies fail deterministically", () => {
  rejects(strategy([action("same", "SEND"), action("same", "SWAP")]), "DUPLICATE_STEP_ID");
  rejects(strategy([action("self", "SEND", ["self"])]), "SELF_DEPENDENCY");
  rejects(strategy([action("send", "SEND", ["missing"])]), "UNKNOWN_DEPENDENCY");
  const cycle = strategy([action("a", "SEND", ["b"]), action("b", "SWAP", ["a"])]);
  rejects(cycle, "DEPENDENCY_CYCLE");
  assert.deepEqual(validateStrategy(cycle), validateStrategy(cycle));
});

test("unsupported step kind, action and autonomous action are rejected", () => {
  rejects(strategy([{ id: "other", kind: "EXECUTE", dependsOn: [] }]), "UNSUPPORTED_STEP_KIND");
  rejects(strategy([{ ...action("write", "SEND"), action: "CUSTOM_CALL" }]), "UNSUPPORTED_ACTION");
  rejects(strategy([{ ...action("send", "SEND"), confirmation: "AUTOMATIC" }]), "CONFIRMATION_REQUIRED");
  rejects(strategy([{ id: "send", kind: "ACTION", action: "SEND", dependsOn: [] }]), "CONFIRMATION_REQUIRED");
});

test("malformed or mismatched canonical references are rejected", () => {
  rejects(strategy([{ ...action("send", "SEND"), preparedAction: { kind: "PREPARED_ACTION", tool: "swap.prepare", quoteFingerprint: fingerprint, stepIndex: 0 } }]), "INVALID_ARTIFACT_REFERENCE");
  rejects(strategy([{ ...action("send", "SEND"), preparedAction: { kind: "PREPARED_ACTION", tool: "send.prepare", quoteFingerprint: "0xbad", stepIndex: 0 } }]), "INVALID_ARTIFACT_REFERENCE");
  rejects(strategy([action("send", "SEND"), { ...receipt("wait", "send"), receipt: { kind: "RECEIPT", actionStepId: "missing" } }]), "INVALID_ARTIFACT_REFERENCE");
  rejects(strategy([action("send", "SEND"), receipt("wait", "send"), { ...revalidate("refresh", ["wait"]), quote: { kind: "QUOTE", tool: "unknown.quote", fingerprint } }]), "INVALID_ARTIFACT_REFERENCE");
  rejects(strategy([{ ...revalidate("refresh", []), policy: { kind: "POLICY_RESULT", id: " " } }]), "INVALID_ARTIFACT_REFERENCE");
});

test("strategy and step shapes exclude signing, provider and arbitrary transaction authority", () => {
  const forbidden = ["privateKey", "mnemonic", "seed", "password", "provider", "signer", "submitter", "walletClient", "sendTransaction", "writeContract", "to", "data", "value"];
  for (const field of forbidden) {
    rejects({ ...strategy([action("send", "SEND")]), [field]: "injected" }, "INVALID_SCHEMA");
    rejects(strategy([{ ...action("send", "SEND"), [field]: "injected" }]), "INVALID_SCHEMA");
  }
  const source = readFileSync(new URL("./strategyModel.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /sendTransaction|writeContract|walletClient|privateKey|mnemonic|seed|password|unlock/);
});
