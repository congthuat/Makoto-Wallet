import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync(new URL("../components/SwapPanel.tsx", import.meta.url), "utf8");
const swap = readFileSync(new URL("../components/RealSwapFlow.tsx", import.meta.url), "utf8");

test("outer action fixes the direct Swap or Bridge workflow", () => {
  assert.match(panel, /initialMode === "swap" \? <RealSwapFlow[\s\S]*: <UniversalBridgeFlow/);
  assert.match(panel, /title=\{initialMode === "bridge" \? "Bridge"[\s\S]*?"Swap"\}/);
});

test("modal contains no duplicate Swap or Bridge chooser", () => {
  assert.doesNotMatch(panel, /Swap & Bridge|Hoán đổi & Bridge|setMode\(|mode === "swap"/);
  assert.doesNotMatch(panel, />\s*Bridge\s*<\/button>|>\s*Swap\s*<\/button>/);
});

test("quote preparation does not lock mode navigation", () => {
  assert.match(swap, /onBusyChange\(Boolean\(pending && \(maxApproval \|\| reviewStage\)\)\)/);
  assert.doesNotMatch(swap, /onBusyChange\(Boolean\(pending\)\)/);
});

test("direct-flow wrapper contains no signing or transaction submission", () => {
  for (const forbidden of ["writeContract", "sendTransaction", "sign", "approve", "execute"]) {
    assert.equal(panel.includes(forbidden), false, forbidden);
  }
});
