import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { en } from "../i18n/en.ts";
import { vi } from "../i18n/vi.ts";

const review = readFileSync(new URL("../components/TransactionSafetyReview.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("Phase 7C Review grammar keeps intent, cost, expected change, evidence, limitations, and wallet handoff distinct", () => {
  for (const marker of ["review.intent", "costDetails", "TransactionExpectedChanges", "review.safetyEvidence", "ReviewLimitations", "WalletHandoffNotice"]) assert.ok(review.includes(marker), marker);
  assert.match(review, /t\("review\.walletHandoffDescription"\)/);
  assert.match(readFileSync(new URL("../components/SendFlow.tsx", import.meta.url), "utf8"), /costDetails=\{/);
});

test("Phase 7C review preserves effective assessment gating and truthful Circle evidence", () => {
  assert.match(review, /priority\[assessment\.status\] > priority\[snapshotAssessment\.status\]/);
  assert.match(review, /effectiveAssessment\?\.status === "blocked" \|\| effectiveAssessment\?\.status === "unknown"/);
  assert.match(review, /request-simulation-not-performed/);
  assert.match(review, /review\.simulationNotPerformed/);
});

test("Phase 7C labels are localized and scoped styles use Ledger Calm tokens", () => {
  for (const key of ["review.intent", "review.cost", "review.safetyEvidence", "review.limitations", "review.walletHandoff", "review.walletHandoffDescription"] as const) {
    assert.ok(en[key].length > 0);
    assert.ok(vi[key].length > 0);
    assert.notEqual(en[key], vi[key]);
  }
  assert.match(styles, /\.transaction-safety-review \.review-section/);
  assert.match(styles, /var\(--lc-separator\)/);
  assert.match(styles, /var\(--lc-attention-surface\)/);
  assert.match(styles, /@media\(max-width:600px\)/);
});
