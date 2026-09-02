import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const component = (name: string) => readFileSync(new URL(`../components/${name}`, import.meta.url), "utf8");
const action = (name: string) => readFileSync(new URL(`./agent/actions/${name}`, import.meta.url), "utf8");
const hook = (name: string) => readFileSync(new URL(`../hooks/${name}`, import.meta.url), "utf8");

test("Universal Bridge consumes Agent values in the existing Circle flow", () => {
  const dashboard = component("WalletDashboard.tsx"), swap = component("SwapPanel.tsx"), bridge = component("UniversalBridgeFlow.tsx");
  assert.match(dashboard, /setAction\(handoff\.action === "bridge" \? "bridge" : handoff\.action === "swap" \? "swap" : "send"\)/); assert.match(dashboard, /initialMode=\{action\}/); assert.match(swap, /initialMode/); assert.doesNotMatch(swap, /setMode\(/); assert.match(bridge, /initialValues\?\.amount/); assert.match(bridge, /destinationChain/); assert.match(bridge, /getCircleAppKit/); assert.match(bridge, /estimateBridge/); assert.match(bridge, /TransactionSafetyReview/); assert.match(bridge, /ReviewSubmissionGuard/); assert.doesNotMatch(bridge, /setAdvanced\(true\).*initialValues/);
});

test("Bridge handoff never submits or switches before explicit preparation", () => {
  const agent = component("MakotoAgentPage.tsx"), prepare = action("prepare.ts");
  for (const forbidden of ["kit.bridge", "switchChain", "writeContract", "sendTransaction"]) assert.equal(`${agent}\n${prepare}`.includes(forbidden), false, forbidden);
});

test("Vault handoff requires a real goal selection and binds exact jar id", () => {
  const dashboard = component("Dashboard.tsx"), detail = component("JarDetail.tsx"), prepare = action("prepare.ts");
  assert.match(dashboard, /Choose Vault goal/); assert.match(dashboard, /agentGoalOptions/); assert.match(dashboard, /privacyMode/); assert.match(dashboard, /chooseAgentGoal\(jar\.id\)/); assert.match(prepare, /bindAgentHandoffJar/); assert.match(detail, /handoff\.jarId !== jar\.id\.toString\(\)/); assert.match(detail, /setDepositOpen\(true\)/); assert.match(detail, /setWithdrawalOpen\(true\)/);
});

test("Vault deposit preserves finite approval and never auto-deposits after approval", () => {
  const source = component("OwnerDepositFlow.tsx");
  assert.match(source, /amount, assetId: "usdc"/); assert.match(source, /setStep\("approval-confirmed"\)/); assert.match(source, /onClick=\{\(\) => setStep\("review"\)\}/); assert.doesNotMatch(source, /setStep\("approval-confirmed"\).*void deposit\(\)/);
});

test("handoffs are minimal session-only, account-bound, expiring, and one-shot", () => {
  const source = action("handoff.ts");
  assert.match(source, /store\.removeItem\(HANDOFF_KEY\)/); assert.match(source, /value\.account\.toLowerCase\(\) !== account\.toLowerCase\(\)/); assert.match(source, /value\.expiresAt < now/); assert.doesNotMatch(source, /localStorage|conversation|provider|signer|privateKey|walletClient/);
});

test("Agent-origin outcomes are receipt-backed and cancellation is not success", () => {
  for (const name of ["SendFlow.tsx", "RealSwapFlow.tsx", "UniversalBridgeFlow.tsx", "OwnerDepositFlow.tsx", "OwnerWithdrawalFlow.tsx"]) assert.match(component(name), /storeAgentResult/);
  const agentResultUi = `${component("MakotoAgentPage.tsx")}\n${hook("useMakotoAgent.ts")}\n${readFileSync(new URL("./agent/resultFormatter.ts", import.meta.url), "utf8")}`; assert.match(agentResultUi, /agent\.result\.cancelled/); assert.match(agentResultUi, /agent\.result\.unknown/); assert.match(agentResultUi, /agent\.result\.failed/);
  assert.match(component("SendFlow.tsx"), /status: failure === "rejected" \? "cancelled"/); assert.match(component("RealSwapFlow.tsx"), /status: kind === "rejected" \? "cancelled"/);
});

test("non-Agent origin grants no privileges and creates no result", () => {
  for (const name of ["SendFlow.tsx", "RealSwapFlow.tsx", "UniversalBridgeFlow.tsx", "OwnerDepositFlow.tsx", "OwnerWithdrawalFlow.tsx"]) assert.match(component(name), /(?:origin|initialValues\?\.origin).*===\s*"agent"/);
  assert.match(component("TransactionSafetyReview.tsx"), /onContinue/); assert.match(component("RealSwapFlow.tsx"), /revalidateTransactionReview/);
});

test("goal selection and result UI retain accessible responsive primitives", () => {
  const dashboard = component("Dashboard.tsx"), css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8"), agent = component("MakotoAgentPage.tsx");
  assert.match(dashboard, /type="button"/); assert.match(dashboard, /aria-live="polite"/); assert.match(dashboard, /tabIndex=\{-1\}/); assert.match(css, /\.agent-goal-option/); assert.match(css, /overflow-wrap:anywhere/); assert.match(agent, /aria-live="polite"/);
});
