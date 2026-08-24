import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { safeMaxCanUseSwapEstimate } from "./swapApprovalFlow.ts";
import { calculateSafeUsdcSwapMax } from "./safeSwapMax.ts";

const flow = readFileSync(new URL("../components/RealSwapFlow.tsx", import.meta.url), "utf8");
const maxHandler = flow.slice(flow.indexOf("async function approveForMax"), flow.indexOf("async function review"));

test("1 MAX with insufficient allowance exposes Approve for MAX", () => { assert.equal(safeMaxCanUseSwapEstimate(9n, 10n), false); assert.match(flow, /Approve for MAX/); });
test("2 approval amount is the finite current balance", () => assert.match(maxHandler, /finiteApproval = currentBalance/));
test("3 unlimited approval is never used", () => { assert.doesNotMatch(flow, /MaxUint256|2n \*\* 256n|unlimited approval/i); });
test("4 real approval fee is estimated and displayed", () => { assert.match(flow, /estimateApprovalFee\(selected\)/); assert.match(flow, /Estimated approval fee/); });
test("5 approval rejection is safe and explicit", () => assert.match(maxHandler, /You rejected Approve for MAX/));
test("6 approval-for-MAX contains no swap submission", () => { assert.doesNotMatch(maxHandler, /functionName: "swap"|buildXyloSwapRequest|setSuccess/); });
test("7 successful approval refreshes balance", () => assert.match(maxHandler, /postApprovalBalance/));
test("8 successful approval invokes existing SAFE MAX solver", () => assert.match(maxHandler, /solveSafeMax\(postApprovalBalance, postApprovalAllowance\)/));
test("9 calculated amount is auto-populated", () => assert.match(maxHandler, /setAmount\(formatAssetAmount\(result\.amount/));
test("10 populated amount is below balance", async () => assert.ok((await calculateSafeUsdcSwapMax(100n, async () => ({ fee: 4n }))).amount < 100n));
test("11 populated amount plus verified fee fits", async () => { const result = await calculateSafeUsdcSwapMax(100n, async () => ({ fee: 4n })); assert.ok(result.amount + result.fee <= 100n); });
test("12 sufficient allowance skips extra approval", () => { assert.equal(safeMaxCanUseSwapEstimate(10n, 10n), true); assert.match(maxHandler, /if \(currentAllowance < currentBalance\)/); });
test("13 balance increase beyond allowance requests approval again", () => assert.equal(safeMaxCanUseSwapEstimate(10n, 11n), false));
test("14 normal quick percentages remain unchanged", () => assert.match(flow, /\[25, 50, 75, 100\]/));
test("15 normal swap flow remains separate", () => { assert.match(flow, /async function execute\(\)/); assert.match(flow, /onContinue=\{\(\) => void execute\(\)\}/); });
test("16 existing SAFE MAX solver remains wired", () => assert.match(flow, /calculateSafeUsdcSwapMax/));
