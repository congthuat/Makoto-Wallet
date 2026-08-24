import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { planSwapReview, safeMaxCanUseSwapEstimate, stageAfterApproval } from "./swapApprovalFlow.ts";
import { swapCostWithArcFee } from "./arcFees.ts";

const flow = readFileSync(new URL("../components/RealSwapFlow.tsx", import.meta.url), "utf8");

test("1 sufficient allowance estimates swap gas immediately", () => assert.deepEqual(planSwapReview(10n, 10n), { stage: "swap", estimateApprovalGas: false, estimateSwapGas: true }));
test("2 insufficient allowance never estimates swap gas before approval", () => assert.deepEqual(planSwapReview(9n, 10n), { stage: "approval", estimateApprovalGas: true, estimateSwapGas: false }));
test("3 approval gas uses a real approve estimate", () => assert.match(flow, /estimateApprovalFee[\s\S]*estimateContractGas[\s\S]*functionName: "approve"/));
test("4 approval review distinguishes both network fees", () => { assert.match(flow, /Approval network fee/); assert.match(flow, /Estimated after approval/); });
test("5 approval remains exact", () => { assert.match(flow, /exactApprovalRequired/); assert.match(flow, /args: \[XYLO_ROUTER, approval\]/); });
test("6 a fresh quote is fetched after approval", () => assert.match(flow, /approvalHash[\s\S]*getAmountOut[\s\S]*createXyloQuote/));
test("7 swap gas is estimated from the fresh post-approval quote", () => assert.match(flow, /freshQuote = createXyloQuote[\s\S]*prepareSwapEnvelope\(freshQuote\)/));
test("8 successful approval advances to a second review", () => assert.equal(stageAfterApproval(true, 10n, 10n), "swap-review"));
test("9 approval never advances directly to swap execution", () => { assert.equal(stageAfterApproval(false, 10n, 10n), "approval"); assert.match(flow, /setReviewStage\("swap"\)/); });
test("10 stale pre-approval quote is rejected and replaced after mined approval", () => { assert.match(flow, /Quote expired\. Get a fresh quote before approving/); assert.match(flow, /const freshQuote/); });
test("11 approval rejection has a dedicated cancellation", () => assert.match(flow, /You rejected the approval request/));
test("12 swap rejection remains handled after approval", () => { assert.match(flow, /classifyWalletFailure\(caught, submitted\)/); assert.match(flow, /You rejected the wallet request/); });
test("13 USDC amount plus post-approval swap gas must fit", () => assert.equal(swapCostWithArcFee(9n, "usdc", 10n, 2_000_000_000_000n).sufficientGasBalance, false));
test("14 EURC input still requires sufficient USDC gas", () => assert.equal(swapCostWithArcFee(9n, "eurc", 1n, 2_000_000_000_000n).sufficientGasBalance, false));
test("15 MAX uses swap gas only with sufficient allowance", () => { assert.equal(safeMaxCanUseSwapEstimate(9n, 10n), false); assert.equal(safeMaxCanUseSwapEstimate(10n, 10n), true); assert.match(flow, /Approve for MAX/); });
test("16 Smart and XyloNet route selection remains present", () => { assert.match(flow, /mode === "smart"/); assert.match(flow, /mode === "xylonet"/); assert.match(flow, /selectRouteForMode/); });
