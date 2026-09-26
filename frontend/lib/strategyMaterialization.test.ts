import assert from "node:assert/strict";
import test from "node:test";
import { materializePlannerStrategy, validateStrategyMaterialization } from "./strategyMaterialization.ts";

const rejected = (input: unknown) => assert.equal(materializePlannerStrategy(input).status, "REJECTED");
const placeholder = () => ({ version: 1, compilation: { status: "COMPILED", executionEnabled: false,
  strategy: { version: 1, id: "strategy:fake", createdAt: 1, steps: [{ id: "action:fake", kind: "ACTION", action: "SEND", confirmation: "EXPLICIT_USER_CONFIRMATION", dependsOn: [] }] },
  binding: { version: 2, digestVersion: 2 } }, bindingSource: { requestId: "r", sessionId: "s", plan: {}, resolution: {}, strategy: {}, goalSteps: [], provenance: {}, provenanceSource: {} } });

test("loose, copied and caller-made inputs cannot materialize without live B2 authority", () => {
  for (const input of [null, undefined, false, 1, "draft", [], {}, placeholder(), JSON.parse(JSON.stringify(placeholder()))]) rejected(input);
  rejected({ ...placeholder(), compilation: { ...placeholder().compilation, binding: { version: 1, digestVersion: 1 } } });
  rejected({ ...placeholder(), compilation: { ...placeholder().compilation, executionEnabled: true } });
});

test("closed input rejects added authority and missing fields", () => {
  rejected({ ...placeholder(), wallet: true });
  rejected({ ...placeholder(), version: 2 });
  rejected({ ...placeholder(), compilation: { ...placeholder().compilation, submit: true } });
  rejected({ ...placeholder(), bindingSource: { requestId: "r" } });
});

test("hostile runtime data fails without uncaught exceptions", () => {
  const getter = placeholder(); Object.defineProperty(getter, "version", { enumerable: true, get() { throw Error("accessor"); } });
  rejected(getter);
  const symbol = placeholder(); Object.defineProperty(symbol, Symbol("hidden"), { value: "wallet" });
  rejected(symbol);
  const proxy = new Proxy(placeholder(), { ownKeys() { throw Error("trap"); } });
  rejected(proxy);
  const inherited = Object.assign(Object.create({ wallet: true }) as object, placeholder());
  rejected(inherited);
  const cyclic = placeholder() as ReturnType<typeof placeholder> & { cycle?: unknown }; cyclic.cycle = cyclic;
  rejected(cyclic);
  let nested: unknown = "deep"; for (let i = 0; i < 40; i++) nested = { nested };
  rejected({ ...placeholder(), nested });
});

test("artifact validation requires exact live upstream input", () => {
  const candidate = { version: 1, stage: "SEMANTIC_ONLY", executionEnabled: false, actions: [], digest: `0x${"0".repeat(64)}` };
  assert.equal(validateStrategyMaterialization(candidate, placeholder()).valid, false);
  assert.equal(validateStrategyMaterialization(candidate, null).valid, false);
  assert.equal(validateStrategyMaterialization({ ...candidate, executionEnabled: true }, placeholder()).valid, false);
});
