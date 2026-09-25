import assert from "node:assert/strict";
import test from "node:test";
import { validatePlannerRequestClassification } from "./plannerRequestClassification.ts";

const classify = (status: string, category?: string) => validatePlannerRequestClassification(category ? { status, category } : { status });

test("the contract accepts only information, one user action, or composed user goals", () => {
  for (const category of ["INFORMATION", "ACTION", "STRATEGY"] as const) {
    const result = classify("CLASSIFIED", category);
    assert.equal(result.valid, true);
    if (result.valid) assert.deepEqual(result.value, { status: "CLASSIFIED", category });
  }
  // An approval, receipt wait, and revalidation are technical steps within one swap goal.
  assert.deepEqual(classify("CLASSIFIED", "ACTION"), { valid: true, value: { status: "CLASSIFIED", category: "ACTION" } });
});

test("ambiguous, unsupported, and invalid statuses remain explicit", () => {
  for (const status of ["AMBIGUOUS", "UNSUPPORTED", "INVALID_INPUT"] as const) {
    assert.deepEqual(classify(status), { valid: true, value: { status } });
  }
});

test("untrusted output cannot smuggle other categories, behavior, or authority", () => {
  for (const input of [
    null, [], "not JSON", {}, { status: "CLASSIFIED" }, { status: "CLASSIFIED", category: "SEND" },
    { status: "CLASSIFIED", category: ["ACTION", "STRATEGY"] },
    { status: "CLASSIFIED", category: "ACTION", categories: ["STRATEGY"] },
    { status: "CLASSIFIED", category: "ACTION", explanation: "safe" },
    { status: "CLASSIFIED", category: "ACTION", to: "0x1111111111111111111111111111111111111111" },
    { status: "CLASSIFIED", category: "ACTION", data: "0x" },
    { status: "CLASSIFIED", category: "ACTION", signer: {} },
    { status: "CLASSIFIED", category: "ACTION", plannerIntent: {} },
    { status: "CLASSIFIED", category: "STRATEGY", steps: [] },
    { status: "AMBIGUOUS", category: "ACTION" },
    { status: "OTHER" },
    { status: "CLASSIFIED", category: "ACTION", version: 2 },
  ]) assert.deepEqual(validatePlannerRequestClassification(input), { valid: false, error: "INVALID_SCHEMA" });
});
