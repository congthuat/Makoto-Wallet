import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const receive = readFileSync(new URL("../components/ReceivePanel.tsx", import.meta.url), "utf8");
const swap = readFileSync(new URL("../components/RealSwapFlow.tsx", import.meta.url), "utf8");
const bridge = readFileSync(new URL("../components/UniversalBridgeFlow.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../components/SwapPanel.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("Receive defaults to a compact QR and address layout", () => {
  assert.match(receive, /title: "Receive"/);
  assert.match(receive, /receive-compact-grid/);
  assert.match(receive, /receive-address/);
  assert.match(receive, /noteOpen[^]*?\+ Add note/);
  assert.match(receive, /<details className="receive-details">/);
  assert.doesNotMatch(receive, /Receive on Arc|Short address|same for USDC and EURC|noteExplanation/);
  assert.match(css, /\.receive-compact-grid\{display:grid;grid-template-columns:minmax\(0,1fr\) 236px/);
});

test("Swap keeps routing, slippage and provider details under Advanced", () => {
  const defaultForm = swap.slice(swap.indexOf('className="create-form wallet-flow compact-swap-flow"'));
  assert.match(defaultForm, /swap-asset-grid[^]*?Sell asset[^]*?Buy asset[^]*?swap-amount-heading[^]*?swap-quick-amounts/);
  assert.match(defaultForm, /<details className="swap-advanced">\s*<summary>\{vi \? "Nâng cao" : "Advanced"\}<\/summary>[^]*?Routing mode[^]*?Slippage[^]*?swap-provider-detail/);
  assert.doesNotMatch(defaultForm, /Smart selects among safely executable routes|Advanced providers/);
});

test("Bridge defaults to compact recipient and hides speed under Options", () => {
  assert.doesNotMatch(bridge, /CIRCLE APP KIT · CCTP|MAKOTO UNIVERSAL BRIDGE|Source balance is read before review/);
  assert.match(bridge, /bridge-recipient-summary[^]*?Connected wallet[^]*?Change/);
  assert.match(bridge, /bridge-recipient-editor/);
  assert.match(bridge, /<details className="bridge-options">[^]*?Transfer speed[^]*?STANDARD[^]*?FAST/);
  assert.match(panel, /initialMode === "swap" \? <RealSwapFlow/);
  assert.doesNotMatch(panel, /Bridge USDC|Swap & Bridge|setMode\(/);
});

test("transaction and quote implementations remain present", () => {
  assert.match(swap, /selectRouteForMode/);
  assert.match(swap, /prepareXyloSwapRequest/);
  assert.match(swap, /writer\.writeContractAsync/);
  assert.match(bridge, /kit\.estimateBridge/);
  assert.match(bridge, /submissionGuard\.current\.run/);
  assert.match(bridge, /kit\.bridge/);
});
