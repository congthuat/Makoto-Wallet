import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = (name: string) => readFileSync(new URL(`../components/${name}`, import.meta.url), "utf8");
const shared = component("TransactionSafetyReview.tsx");

test("shared review uniformly renders safety, expected changes, and wallet confirmation", () => { assert.match(shared, /TransactionSafetyAssessmentView/); assert.match(shared, /review && <TransactionExpectedChanges intent=\{review\.intent\}/); assert.match(shared, /wallet-confirmation/); });
test("Universal Bridge uses the shared review while preserving Circle lifecycle details", () => { const source = component("UniversalBridgeFlow.tsx"); assert.match(source, /if \(estimate && reviewSnapshot\)[\s\S]*?<TransactionSafetyReview/); assert.match(source, /walletNotice=""/); assert.match(source, /bridge-timeline/); });

test("compact review keeps technical PASS details collapsed without hiding warnings", () => {
  const compact = shared.slice(shared.indexOf("if (compact)"), shared.indexOf("function CompactSafetySummary"));
  assert.match(compact, /<details className="compact-review-details">\s*<summary>\{t\("review\.details"\)\}<\/summary>/);
  assert.match(compact, /<TransactionSafetyChecks checks=\{checks\} \/>/);
  assert.ok(compact.indexOf("attentionChecks.length > 0") < compact.indexOf('<details className="compact-review-details">'));
  assert.match(compact, /<TransactionSafetyChecks checks=\{attentionChecks\} \/>/);
  assert.doesNotMatch(compact, /onToggle=|setDetails|onClick=.*details/);
  assert.ok(compact.indexOf('<details className="compact-review-details">') < compact.indexOf("onContinue"));
});
test("Vault withdrawal uses the shared review and expected-change intent", () => { const source = component("OwnerWithdrawalFlow.tsx"); assert.match(source, /step === "review" && reviewSnapshot.*<TransactionSafetyReview/); assert.match(source, /review=\{reviewSnapshot\}/); assert.match(source, /walletNotice=/); });
test("real Vault goal creation binds exact calldata, revalidates, and uses guarded writes", () => { const source = component("CreateJarFlow.tsx"); assert.match(source, /kind: "vault-create"/); assert.match(source, /encodeFunctionData/); assert.match(source, /prepareFlowReview/); assert.match(source, /revalidateTransactionReview/); assert.match(source, /submissionGuard\.current\.run/); assert.match(source, /step === "review" && parsed && reviewSnapshot.*<TransactionSafetyReview/); });
test("private goal creation signs metadata before presenting the exact transaction review", () => { const source = component("CreateJarFlow.tsx"), intent = source.indexOf("goalIntent(safe, encrypted.metadataCommitment)"); assert.ok(source.indexOf("signMessage.mutateAsync") < intent); assert.ok(intent < source.indexOf("setStep(\"review\")", intent)); });
