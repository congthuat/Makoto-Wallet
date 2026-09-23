import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { formatAgentActionResult } from "./agent/resultFormatter.ts";
import { consumeAgentResult, storeAgentResult } from "./agent/actions/index.ts";
import { swapContinueAllowed, swapStatusAfterConfirmation, type SwapSubmissionStatus } from "./swapSubmissionState.ts";

const hash = `0x${"ab".repeat(32)}` as `0x${string}`;
const source = readFileSync(new URL("../components/RealSwapFlow.tsx", import.meta.url), "utf8");

function store() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
  };
}

test("Repair Gate F2: wallet submission hash is captured in durable component state", () => {
  assert.match(source, /\[submittedHash, setSubmittedHash\] = useState<Hex>\(\)/);
  assert.match(source, /setSubmittedHash\(hash\)/);
  assert.match(source, /transactionHash: submittedHash/);
});

test("Repair Gate F2: confirmation unknown preserves the submitted hash", () => {
  assert.equal(swapStatusAfterConfirmation("submitted-pending", "unknown"), "submitted-unknown");
  assert.match(source, /setUnknown\(\{ hash: submittedHashLocal, quote \}\)/);
  assert.match(source, /<code>\{unknown\.hash\}<\/code>/);
});

test("Repair Gate F2: submitted-unknown is distinct from not-submitted", () => {
  const states: SwapSubmissionStatus[] = ["not-submitted", "submitted-pending", "submitted-unknown", "confirmed", "failed"];
  assert.notEqual(states.indexOf("not-submitted"), states.indexOf("submitted-unknown"));
  assert.equal(swapContinueAllowed("not-submitted", "swap", false), true);
  assert.equal(swapContinueAllowed("submitted-unknown", "swap", false), false);
});

test("Repair Gate F2: unknown result makes no success or unsupported failure claim", () => {
  assert.match(source, /data-status="submitted-unknown"/);
  assert.match(source, /confirmation status unknown/);
  assert.match(source, /Network.*Arc Testnet/);
  assert.doesNotMatch(source.slice(source.indexOf("if (unknown)"), source.indexOf("if (success)")), /Swap confirmed|Hoán đổi thành công|failed|revert/i);
});

test("Repair Gate F2: unknown result retains Agent hash and operation context without actual output", () => {
  const memory = store();
  storeAgentResult(memory, { id: "swap", account: "0x1111111111111111111111111111111111111111", action: "swap", status: "unknown", createdAt: 1, amount: "1", asset: "USDC", outputAsset: "EURC", transactionHash: hash });
  const result = consumeAgentResult(memory, "0x1111111111111111111111111111111111111111");
  assert.equal(result?.status, "unknown");
  assert.equal(result?.transactionHash, hash);
  assert.equal(result?.outputAmount, undefined);
  assert.match(formatAgentActionResult(result!, "en"), /unknown/i);
  assert.match(formatAgentActionResult(result!, "en"), new RegExp(hash));
  assert.match(source, /status: .*"unknown"/);
  assert.match(source, /outputAsset: to\.symbol/);
});

test("Repair Gate F2: unresolved unknown state cannot reach a second wallet write callback", () => {
  let writes = 0;
  const write = () => { writes += 1; };
  if (swapContinueAllowed("submitted-unknown", "swap", false)) write();
  assert.equal(writes, 0);
  assert.match(source, /if \(submittedHash \|\| !swapContinueAllowed\(submissionStatus, reviewStage, Boolean\(pending\)\)\) return/);
  assert.match(source, /setReviewStage\(undefined\);\s*setSwapReview\(undefined\);/);
});

test("Repair Gate F2: recovery link uses the preserved hash and no confirmed Activity is fabricated", () => {
  assert.match(source, /ARC_EXPLORER_URL}\/tx\/\$\{unknown\.hash\}/);
  const unknownBlock = source.slice(source.indexOf("if (unknown)"), source.indexOf("if (success)"));
  assert.doesNotMatch(unknownBlock, /recordWalletActivity|swapReceive|Actual received/);
});

test("Repair Gate F2: success and confirmed failure transitions remain explicit", () => {
  assert.equal(swapStatusAfterConfirmation("submitted-pending", "success"), "confirmed");
  assert.equal(swapStatusAfterConfirmation("submitted-pending", "failure"), "failed");
  assert.equal(swapContinueAllowed("not-submitted", "swap", false), true);
  assert.match(source, /setSuccess\(\{/);
  assert.match(source, /setError\(/);
  assert.match(source, /setSubmissionStatus\("not-submitted"\)/);
});

test("Repair Gate F2: no live signing/provider execution is used by deterministic coverage", () => {
  assert.equal(hash.startsWith("0x"), true);
  const testSource = readFileSync(new URL("./repairGateF2.test.ts", import.meta.url), "utf8");
  for (const token of ["write" + "ContractAsync", "sign" + "Transaction", "eth_" + "sendTransaction"]) assert.doesNotMatch(testSource, new RegExp(token));
});
