import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync(new URL("../components/SwapPanel.tsx", import.meta.url), "utf8");
const swap = readFileSync(new URL("../components/RealSwapFlow.tsx", import.meta.url), "utf8");

test("Bridge selection renders Bridge and removes Swap from the active workflow", () => {
  assert.match(panel, /onClick=\{\(\) => setMode\("bridge"\)\}/);
  assert.match(panel, /mode === "swap" \? <RealSwapFlow[\s\S]*: <UniversalBridgeFlow/);
});

test("Swap and Bridge remain selectable for repeated mode switching", () => {
  assert.match(panel, /onClick=\{\(\) => setMode\("swap"\)\}/);
  assert.match(panel, /onClick=\{\(\) => setMode\("bridge"\)\}/);
  assert.match(panel, /className=\{mode === "swap"/);
  assert.match(panel, /className=\{mode === "bridge"/);
});

test("quote preparation does not lock mode navigation", () => {
  assert.match(swap, /onBusyChange\(Boolean\(pending && \(maxApproval \|\| reviewStage\)\)\)/);
  assert.doesNotMatch(swap, /onBusyChange\(Boolean\(pending\)\)/);
});

test("mode switching contains no signing or transaction submission", () => {
  const modeControls = panel.slice(panel.indexOf('<div className="modal-actions"'), panel.indexOf('{mode === "swap"'));
  for (const forbidden of ["writeContract", "sendTransaction", "sign", "approve", "execute"]) {
    assert.equal(modeControls.includes(forbidden), false, forbidden);
  }
});
