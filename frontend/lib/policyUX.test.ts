import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mapPolicyResultToUX, existingGateOutcome } from "./policyUX.ts";
import type { PolicyDecision, PolicyReason, PolicyResult } from "./policyEngine.ts";
import { en } from "../i18n/en.ts";
import { vi } from "../i18n/vi.ts";
// @ts-expect-error Test-only renderers extract production JSX without wallet execution.
import { renderSend } from "../scripts/phase7e-fixture.mjs";
// @ts-expect-error Test-only renderers extract production JSX without wallet execution.
import { renderExchange } from "../scripts/phase7f-fixture.mjs";

function result(decision: PolicyDecision, reason: PolicyReason = "STALE_EVIDENCE"): PolicyResult {
  return { decision, findings: [{ decision, code: reason, evidence: "current.wallet" }], winningReason: reason,
    requiredAction: decision === "BLOCK" ? "STOP" : decision === "REQUOTE" ? "REQUOTE" : decision === "REVALIDATE" ? "REVALIDATE" : decision === "REQUIRE_REVIEW" ? "REVIEW" : "NONE",
    mustStop: decision === "BLOCK" || decision === "REQUOTE" || decision === "REVALIDATE",
    requiresUserReview: decision === "ALLOW" || decision === "WARN" || decision === "REQUIRE_REVIEW",
    requiresFreshQuote: decision === "REQUOTE", requiresRevalidation: decision === "REVALIDATE" };
}

test("all six deterministic decisions retain their progression and next-action meaning", () => {
  for (const decision of ["BLOCK", "REQUOTE", "REVALIDATE", "REQUIRE_REVIEW", "WARN", "ALLOW"] as const) {
    const ux = mapPolicyResultToUX(result(decision), "en");
    assert.equal(ux.decision, decision);
    assert.equal(ux.requiredAction, result(decision).requiredAction);
    assert.equal(ux.blocksProgression, ["BLOCK", "REQUOTE", "REVALIDATE"].includes(decision));
    assert.equal(ux.requiresFreshQuote, decision === "REQUOTE");
    assert.equal(ux.requiresRevalidation, decision === "REVALIDATE");
    assert.equal(ux.requiresExplicitReview, ["REQUIRE_REVIEW", "WARN", "ALLOW"].includes(decision));
    assert.equal(ux.warningIsNonBlocking, decision === "WARN");
    assert.ok(ux.nextAction.length > 8);
    assert.equal(ux.primaryReason, "STALE_EVIDENCE");
  }
  assert.match(mapPolicyResultToUX(result("ALLOW"), "en").summary, /No transaction has been submitted/);
});

test("Send and Swap production review JSX disables blocked decisions in EN and VI", () => {
  for (const locale of ["en", "vi"] as const) {
    for (const decision of ["BLOCK", "REQUOTE", "REVALIDATE"] as const) {
      const policyResult = result(decision);
      for (const html of [renderSend({ locale, reviewing: true, policyResult }), renderExchange("swap", { locale, state: "review", policyResult })]) {
        assert.match(html, new RegExp(`data-policy-decision="${decision}"`));
        assert.match(html, /role="alert"/);
        assert.match(html, /class="primary-action" disabled/);
      }
    }
    for (const decision of ["REQUIRE_REVIEW", "WARN", "ALLOW"] as const) {
      const policyResult = result(decision);
      for (const html of [renderSend({ locale, reviewing: true, policyResult }), renderExchange("swap", { locale, state: "review", policyResult })]) {
        assert.match(html, new RegExp(`data-policy-decision="${decision}"`));
        assert.doesNotMatch(html, /class="primary-action" disabled/);
      }
    }
  }
});

test("winning BLOCK reason appears first without downgrading secondary findings", () => {
  const input = { ...result("BLOCK", "SIMULATION_FAILED"), findings: [
    { decision: "WARN" as const, code: "QUOTE_WARNING" as const, evidence: "quote.warnings" },
    { decision: "BLOCK" as const, code: "SIMULATION_FAILED" as const, evidence: "simulation.status" },
    { decision: "REQUOTE" as const, code: "EXPIRED_QUOTE" as const, evidence: "quote.expiresAt" },
  ] };
  const ux = mapPolicyResultToUX(input, "en");
  assert.equal(ux.primaryReason, "SIMULATION_FAILED");
  assert.deepEqual(ux.reasons.map((item) => item.code), ["SIMULATION_FAILED", "EXPIRED_QUOTE", "QUOTE_WARNING"]);
  assert.equal(ux.blocksProgression, true);
});

test("existing Send, Swap and CCTP gate outcomes remain stopping decisions", () => {
  assert.equal(mapPolicyResultToUX(existingGateOutcome("REVALIDATE", "FEE_UNAVAILABLE", "send.fee"), "en").requiresRevalidation, true);
  assert.equal(mapPolicyResultToUX(existingGateOutcome("REQUOTE", "EXPIRED_QUOTE", "swap.quote"), "en").requiresFreshQuote, true);
  assert.equal(mapPolicyResultToUX(existingGateOutcome("BLOCK", "SIMULATION_FAILED", "cctp.simulation"), "en").blocksProgression, true);
});

test("policy text is localized in English and Vietnamese without raw codes as primary copy", () => {
  for (const locale of ["en", "vi"] as const) for (const decision of ["BLOCK", "REQUOTE", "REVALIDATE", "REQUIRE_REVIEW", "WARN", "ALLOW"] as const) {
    const ux = mapPolicyResultToUX(result(decision, "SPENDER_MISMATCH"), locale);
    assert.ok(ux.title && ux.summary && ux.nextAction && ux.reasons[0]?.text);
    assert.ok(!ux.title.includes("SPENDER_MISMATCH"));
    assert.ok(!ux.reasons[0].text.includes("SPENDER_MISMATCH"));
  }
  for (const key of Object.keys(en).filter((key) => key.startsWith("policy."))) assert.ok(key in vi, key);
});

test("real review and Agent surfaces consume policy decisions before progression", () => {
  const component = (name: string) => readFileSync(new URL(`../components/${name}`, import.meta.url), "utf8");
  const review = component("TransactionSafetyReview.tsx"), swap = component("RealSwapFlow.tsx"), agent = component("MakotoAgentPage.tsx");
  const send = component("SendFlow.tsx"), cctp = component("CctpBridgeFlow.tsx");
  assert.match(review, /const blocked = policyBlocked \|\|/);
  assert.match(review, /disabled=\{blocked \|\| continueDisabled\}/);
  assert.match(swap, /setPolicyResult\(finalPolicy\)/);
  assert.match(swap, /if \(finalPolicy.mustStop\)/);
  assert.match(send, /refreshReviewedSendFee/);
  assert.match(send, /existingGateOutcome\("REVALIDATE", "FEE_UNAVAILABLE"/);
  assert.match(cctp, /refreshReviewedCctpBurnFee/);
  assert.match(cctp, /existingGateOutcome\("BLOCK", "SIMULATION_FAILED"/);
  assert.match(agent, /message.policy && <PolicyDecisionNotice/);
  const formatter = readFileSync(new URL("./agent/formatter.ts", import.meta.url), "utf8");
  assert.match(formatter, /handoff && !policy\?\.mustStop/);
});
