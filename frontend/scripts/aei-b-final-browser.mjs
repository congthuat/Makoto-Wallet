import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { openSync, closeSync, readFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

// Deterministic B1/B2/AEI-B/AEI-A review; serve with phase7g-workspace-browser.mjs --serve.
const binary = process.env.AGENT_BROWSER_BINARY ?? path.join(process.env.APPDATA, "npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe");
const session = "makoto-aei-b-final";
function command(...args) {
  const file = path.join(tmpdir(), "makoto-aei-b-final-command.json");
  const fd = openSync(file, "w");
  try { execFileSync(binary, ["--session", session, "--json", ...args], { stdio: ["ignore", fd, "inherit"], timeout: 45_000, windowsHide: true }); }
  finally { closeSync(fd); }
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(parsed.success, true, parsed.error);
  return parsed.data;
}
const evaluate = (code) => command("eval", code).result;
const cases = [];
function check(name, actual, expected) { assert.deepEqual(actual, expected, name); cases.push(name); }
function mount(scenario) { const version = evaluate(`window.mountB2(${JSON.stringify(scenario)})`); command("wait", "--fn", `window.fixtureVersion===${version}`); }
try {
  command("open", "http://127.0.0.1:3187"); command("wait", "--fn", "!!window.fixtureVersion");
  for (const [scenario, count] of [["send", 4], ["swap", 4], ["bridge", 5], ["multi", 8]]) {
    mount(scenario);
    check(`${scenario} unconfirmed has no source`, evaluate(`window.fixtureB2===null`), true);
    command("click", "button");
    const positive = evaluate(`(()=>{const x=window.fixtureB2;return {valid:x.valid,compiled:x.compiled?.status,enabled:x.compiled?.executionEnabled,count:x.result?.value?.evidence?.length,digest:x.compiled?.binding?.parameterEvidenceDigest===x.result?.value?.evidenceDigest,steps:x.compiled?.strategy?.steps?.length}})()`);
    check(`${scenario} confirmed evidence`, positive.valid, true);
    check(`${scenario} compiles`, positive.compiled, "COMPILED");
    check(`${scenario} execution disabled`, positive.enabled, false);
    check(`${scenario} evidence complete`, positive.count, count);
    check(`${scenario} v2 evidence digest exact`, positive.digest, true);
    check(`${scenario} one action per goal`, positive.steps, scenario === "multi" ? 2 : 1);
  }
  const multiGraph = evaluate(`(()=>{const x=window.fixtureB2;const byId=new Map(x.compiled.binding.goalSteps.map(m=>[m.goalId,m.actionStepId]));const steps=x.compiled.strategy.steps;return {goals:[...byId.keys()],actions:steps.map(s=>s.action),sendDependsOn:steps.find(s=>s.id===byId.get('send'))?.dependsOn,swapStep:byId.get('swap'),unique:new Set(steps.map(s=>s.id)).size===2}})()`);
  check("multi-goal IDs retained", multiGraph.goals, ["send", "swap"]);
  check("multi-goal ACTION kinds", multiGraph.actions, ["SEND", "SWAP"]);
  check("multi-goal dependency maps by ID", multiGraph.sendDependsOn, [multiGraph.swapStep]);
  check("multi-goal step IDs unique", multiGraph.unique, true);
  check("mapping array order is semantic-neutral", evaluate(`(()=>{const b=structuredClone(window.fixtureB2.compiled.binding);b.goalSteps.reverse();return window.fixtureB2ValidateBinding(b)})()`), true);
  mount("send"); command("click", "button");
  const deterministic = evaluate(`(()=>{const a=window.fixtureB2.compiled,b=window.fixtureB2Compile(window.fixtureB2CompileInput),c=window.fixtureB2Compile({...window.fixtureB2CompileInput,createdAt:2});return {sameId:a.strategy.id===b.strategy.id,sameSteps:JSON.stringify(a.strategy.steps)===JSON.stringify(b.strategy.steps),sameBinding:a.binding.digest===b.binding.digest,createdAtId:a.strategy.id===c.strategy.id,createdAtSteps:JSON.stringify(a.strategy.steps)===JSON.stringify(c.strategy.steps),createdAtDigest:a.binding.strategy.digest===c.binding.strategy.digest,createdAtEnabled:c.executionEnabled}})()`);
  check("identical input Strategy ID", deterministic.sameId, true);
  check("identical input steps", deterministic.sameSteps, true);
  check("identical input binding", deterministic.sameBinding, true);
  check("createdAt does not change Strategy ID", deterministic.createdAtId, true);
  check("createdAt does not change step mapping", deterministic.createdAtSteps, true);
  check("createdAt changes bound content digest", deterministic.createdAtDigest, false);
  check("createdAt cannot enable execution", deterministic.createdAtEnabled, false);
  const compilerAttacks = evaluate(`(()=>{const tests=[
    ["request ID",c=>c.requestId="other"],["session ID",c=>c.sessionId="other"],
    ["negative createdAt",c=>c.createdAt=-1],["fractional createdAt",c=>c.createdAt=1.5],
    ["plan ID",c=>c.plan.id="other"],["goal ID",c=>c.plan.goals[0].id="other"],
    ["goal kind",c=>c.plan.goals[0].kind="SWAP"],["unknown dependency",c=>c.plan.goals[0].dependsOn=["other"]],
    ["unconfirmed status",c=>c.resolution.status="UNVERIFIED"],["resolution plan ID",c=>c.resolution.planId="other"],
    ["missing evidence",c=>c.resolution.evidence.pop()],["duplicate evidence",c=>c.resolution.evidence.push(c.resolution.evidence[0])],
    ["extra evidence",c=>c.resolution.evidence.push({...c.resolution.evidence[0],parameterKey:"extra"})],
    ["wrong origin",c=>c.resolution.evidence[0].origin="UNVERIFIED_PROVIDER"],
    ["changed evidence value",c=>c.resolution.evidence[0].value="other"],
    ["changed evidence key",c=>c.resolution.evidence[0].parameterKey="other"],
    ["changed evidence goal",c=>c.resolution.evidence[0].goalId="other"],
    ["changed evidence request",c=>c.resolution.evidence[0].requestId="other"],
    ["changed evidence session",c=>c.resolution.evidence[0].sessionId="other"],
    ["changed evidence plan",c=>c.resolution.evidence[0].planId="other"],
    ["changed evidence proposal",c=>c.resolution.evidence[0].proposalId="other"],
    ["changed evidence proposal digest",c=>c.resolution.evidence[0].proposalDigest="0x"+"0".repeat(64)],
    ["changed evidence item digest",c=>c.resolution.evidence[0].digest="0x"+"0".repeat(64)],
    ["changed evidence set digest",c=>c.resolution.evidenceDigest="0x"+"0".repeat(64)],
    ["changed intent amount",c=>c.resolution.intents[0].amount="11"],
    ["changed intent recipient",c=>c.resolution.intents[0].recipient="0x3333333333333333333333333333333333333333"],
    ["changed intent asset",c=>c.resolution.intents[0].asset="usdc"],
    ["changed intent chain",c=>c.resolution.intents[0].chainId=84532],
    ["zero amount",c=>c.resolution.intents[0].amount="0"],
    ["scientific amount",c=>c.resolution.intents[0].amount="1e3"],
    ["unsupported asset",c=>c.resolution.intents[0].asset="dai"],
    ["malformed recipient",c=>c.resolution.intents[0].recipient="bad"],
    ["legacy compiler version",c=>c.version=1],["unknown compiler version",c=>c.version=3],
    ["extra authority field",c=>c.sign=true],["missing intent",c=>c.resolution.intents.pop()],
    ["extra intent",c=>c.resolution.intents.push(c.resolution.intents[0])]
  ];return tests.map(([name,mutate])=>{const c=structuredClone(window.fixtureB2CompileInput);c.provenanceSource=window.fixtureB2.source;mutate(c);return [name,window.fixtureB2Compile(c).status]})})()`);
  for (const [name, status] of compilerAttacks) check(`compiler rejects ${name}`, status, "REJECTED");
  const bindingAttacks = evaluate(`(()=>{const tests=[
    ["plan digest",b=>b.plan.digest="0x"+"0".repeat(64)],
    ["intent digest",b=>b.resolvedIntentsDigest="0x"+"0".repeat(64)],
    ["Strategy digest",b=>b.strategy.digest="0x"+"0".repeat(64)],
    ["evidence digest",b=>b.parameterEvidenceDigest="0x"+"0".repeat(64)],
    ["binding digest",b=>b.digest="0x"+"0".repeat(64)],
    ["goal mapping",b=>b.goalSteps[0].goalId="other"],
    ["step mapping",b=>b.goalSteps[0].actionStepId="other"],
    ["v1 downgrade",b=>b.version=1],
    ["unknown version",b=>b.version=3],
    ["missing evidence digest",b=>delete b.parameterEvidenceDigest],
    ["extra authority",b=>b.walletApproval=true]
  ];return tests.map(([name,mutate])=>{const b=structuredClone(window.fixtureB2.compiled.binding);mutate(b);return [name,window.fixtureB2ValidateBinding(b)]})})()`);
  for (const [name, valid] of bindingAttacks) check(`binding rejects ${name}`, valid, false);
  const sourceAttacks = evaluate(`(()=>{const b=window.fixtureB2.compiled.binding;const strategy=structuredClone(window.fixtureB2.compiled.strategy);strategy.steps[0].action="SWAP";const plan=structuredClone(window.fixtureB2.source.plan);plan.id="other";return {strategy:window.fixtureB2ValidateBinding(b,{strategy}),plan:window.fixtureB2ValidateBinding(b,{plan}),copied:window.fixtureB2Compile({...window.fixtureB2CompileInput,provenanceSource:structuredClone(window.fixtureB2.source)}).status}})()`);
  check("Strategy mutation invalidates binding", sourceAttacks.strategy, false);
  check("plan mutation invalidates binding", sourceAttacks.plan, false);
  check("copied source cannot compile", sourceAttacks.copied, "REJECTED");
  assert.ok(cases.length >= 50, `Only ${cases.length} matrix cases`);
  console.log(`AEI-B final browser matrix ${cases.length}/${cases.length} PASS`);
} finally { try { command("close"); } catch { /* preserve primary failure */ } }
