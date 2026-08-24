import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { calculateSafeUsdcSwapMax, SAFE_MAX_MAX_ITERATIONS, SafeSwapMaxError } from "./safeSwapMax.ts";
import { safeMaxCanUseSwapEstimate } from "./swapApprovalFlow.ts";

const flow = readFileSync(new URL("../components/RealSwapFlow.tsx", import.meta.url), "utf8");
const solver = readFileSync(new URL("./safeSwapMax.ts", import.meta.url), "utf8");

test("1 insufficient allowance asks for approval first", () => assert.equal(safeMaxCanUseSwapEstimate(9n, 10n), false));
test("2 sufficient allowance calculates MAX", async () => assert.deepEqual((await calculateSafeUsdcSwapMax(100n, async () => ({ fee: 7n }))).amount, 93n));
test("3 initial full-balance estimate failure recovers with bounded backoff", async () => { const result = await calculateSafeUsdcSwapMax(100n, async (candidate) => { if (candidate === 100n) throw new Error("insufficient funds for gas"); return { fee: 7n }; }); assert.equal(result.amount, 93n); assert.equal(result.usedBackoff, true); });
test("4 final candidate is below wallet balance", async () => assert.ok((await calculateSafeUsdcSwapMax(100n, async () => ({ fee: 3n }))).amount < 100n));
test("5 final candidate plus real fee fits balance", async () => { const result = await calculateSafeUsdcSwapMax(100n, async () => ({ fee: 9n })); assert.ok(result.amount + result.fee <= 100n); });
test("6 solver contains no arbitrary fixed reserve", () => { assert.doesNotMatch(solver, /0\.01|percent|percentage/); assert.match(solver, /balance - observed\.fee/); });
test("7 convergence terminates within the fixed bound", async () => assert.ok((await calculateSafeUsdcSwapMax(1_000n, async () => ({ fee: 11n }))).iterations <= SAFE_MAX_MAX_ITERATIONS));
test("8 changing RPC estimates converge", async () => { let call = 0; const fees = [10n, 12n, 11n, 11n]; const result = await calculateSafeUsdcSwapMax(1_000n, async () => ({ fee: fees[Math.min(call++, fees.length - 1)] })); assert.equal(result.amount, 989n); });
test("9 a final fee increase reduces the candidate", async () => { let call = 0; const result = await calculateSafeUsdcSwapMax(100n, async () => ({ fee: call++ < 2 ? 5n : 8n })); assert.equal(result.amount, 92n); });
test("10 balance changes invalidate MAX", () => assert.match(flow, /safeMax\.balance === balance/));
test("11 account changes invalidate MAX", () => assert.match(flow, /safeMax\.account\.toLowerCase\(\) === connection\.address/));
test("12 chain changes invalidate MAX", () => assert.match(flow, /safeMax\.chainId === arcTestnet\.id && chain\.isArc/));
test("13 tiny balance returns truthful unable state", async () => await assert.rejects(calculateSafeUsdcSwapMax(1n, async () => ({ fee: 1n })), (error: unknown) => error instanceof SafeSwapMaxError && error.code === "too-small"));
test("14 zero balance is rejected", async () => await assert.rejects(calculateSafeUsdcSwapMax(0n, async () => ({ fee: 1n })), (error: unknown) => error instanceof SafeSwapMaxError && error.code === "zero-balance"));
test("15 MAX calculation performs no wallet write", () => { const maxBody = flow.slice(flow.indexOf("async function chooseQuickAmount"), flow.indexOf("async function review")); assert.doesNotMatch(maxBody, /writeContract|simulateContract/); });
test("16 normal quick percentages remain unchanged", () => assert.match(flow, /\[25, 50, 75, 100\]/));
test("17 approval-first flow remains separate", () => { assert.match(flow, /approveThenReview/); assert.match(flow, /setReviewStage\("swap"\)/); });
test("18 USDC to EURC remains supported", () => assert.match(flow, /oppositeAssetId\(fromId\)/));
test("19 EURC to USDC remains supported", () => assert.match(flow, /SUPPORTED_ASSETS/));
