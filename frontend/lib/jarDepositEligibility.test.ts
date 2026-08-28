import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Jar } from "./types.ts";
import { assertJarAcceptsDeposits, canJarAcceptDeposits, JarDepositEligibilityError } from "./jarDepositEligibility.ts";

const jar = (overrides: Partial<Jar> = {}) => ({ closed: false, unlockTime: 2_000n, ...overrides }) as Jar;
const component = (name: string) => readFileSync(new URL(`../components/${name}`, import.meta.url), "utf8");

test("closed Vault goal is not deposit eligible", () => assert.equal(canJarAcceptDeposits(jar({ closed: true }), 1_000n), false));
test("unlocked Vault goal is not deposit eligible", () => assert.equal(canJarAcceptDeposits(jar(), 2_000n), false));
test("active Vault goal is deposit eligible", () => assert.equal(canJarAcceptDeposits(jar(), 1_999n), true));
test("ineligible helper throws a classified error", () => assert.throws(() => assertJarAcceptsDeposits(jar({ closed: true }), 1_000n), JarDepositEligibilityError));

test("Agent deposit selector uses shared eligibility and has a clear empty state", () => { const dashboard = component("Dashboard.tsx"); assert.match(dashboard, /canJarAcceptDeposits\(jar\)/); assert.match(dashboard, /agentGoalOptions\.map/); assert.match(dashboard, /No active Vault goal can receive this deposit/); assert.doesNotMatch(dashboard, /jars\.filter\(\(jar\) => !jar\.closed.*chooseAgentGoal/); });
test("stale selected deposit goal returns to exact goal selection", () => { const detail = component("JarDetail.tsx"), flow = component("OwnerDepositFlow.tsx"); assert.match(detail, /!canJarAcceptDeposits\(jar\)/); assert.match(detail, /resetAgentHandoffGoal/); assert.match(detail, /window\.location\.assign\(handoffUrl\(reselection\)\)/); assert.match(detail, /onAgentGoalIneligible=\{reselectAgentGoal\}/); assert.match(flow, /reason instanceof JarDepositEligibilityError && origin === "agent"/); });
test("ineligible goal is not mislabeled Approval required", () => { const flow = component("OwnerDepositFlow.tsx"); assert.match(flow, /reason instanceof JarDepositEligibilityError.*flow\.depositIneligible/); assert.doesNotMatch(flow.slice(flow.indexOf("function transactionError")), /action === "approval".*flow\.approvalRequired/); });
test("actual insufficient allowance still maps to Approval required", () => assert.match(component("OwnerDepositFlow.tsx"), /\/allowance\/i\.test\(message\).*flow\.approvalRequired/));
test("real low allowance retains exact finite approval and separate fresh review", () => { const flow = component("OwnerDepositFlow.tsx"); assert.match(flow, /freshAllowance\.data \?\? 0n\) >= amount[\s\S]*setStep\("approval-required"\)/); assert.match(flow, /args: \[contractAddress!, amount\]/); assert.match(flow, /setStep\("approval-confirmed"\)/); assert.match(flow, /onClick=\{\(\) => setStep\("review"\)\}/); assert.doesNotMatch(flow, /setStep\("approval-confirmed"\).*void deposit\(\)/); });
test("outdated Agent preview-only copy is removed", () => { const formatter = readFileSync(new URL("./agent/formatter.ts", import.meta.url), "utf8"); assert.doesNotMatch(formatter, /preview-only|Transaction execution by Makoto Agent is not enabled/); assert.match(formatter, /cannot sign or confirm transactions/); });
test("verified Bridge account never displays changed-details copy", () => { const review = component("TransactionSafetyReview.tsx"), bridge = component("UniversalBridgeFlow.tsx"); assert.match(review, /check\.status === "verified" \? check\.label : t\("review\.changed"\)/); assert.match(bridge, /status:\s*connection\.address\?\.toLowerCase\(\) === estimate\.raw\.source\.address\.toLowerCase\(\) \? "verified" : "blocking"/); });
