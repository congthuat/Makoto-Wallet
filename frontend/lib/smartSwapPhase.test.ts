import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const flow = readFileSync(new URL("../components/RealSwapFlow.tsx", import.meta.url), "utf8");
const env = readFileSync(new URL("../.env.example", import.meta.url), "utf8");

test("smart swap UI exposes Smart and XyloNet with truthful selected-route copy", () => {
  assert.match(flow, /type SwapMode/);
  assert.match(flow, /Selected route/);
  assert.doesNotMatch(flow, /Best route/);
  assert.match(flow, /CIRCLE_BROWSER_SWAP_STATUS/);
});

test("Circle Kit Key remains server-only and no browser credential is declared", () => {
  assert.match(env, /^KIT_KEY=$/m);
  assert.doesNotMatch(env, /NEXT_PUBLIC_CIRCLE_KIT_KEY/);
  assert.doesNotMatch(flow, /KIT_KEY|estimateSwap\(|\.swap\(/);
});

test("live Xylo execution keeps exact approval, re-quote, slippage and activity", () => {
  assert.match(flow, /exactApprovalRequired/);
  assert.match(flow, /getAmountOut/);
  assert.match(flow, /minimumSwapOutput/);
  assert.match(flow, /recordWalletActivity/);
  assert.match(flow, /classifyWalletFailure/);
});
