import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { openSync, closeSync, readFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

// Deterministic live B2 fixture; serve with phase7g-workspace-browser.mjs --serve.
const binary = process.env.AGENT_BROWSER_BINARY ?? path.join(process.env.APPDATA, "npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe");
const session = "makoto-aei-c";
const port = Number(process.env.PHASE7G_PORT ?? 3187);
function command(...args) {
  const file = path.join(tmpdir(), "makoto-aei-c-command.json");
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
function mount(scenario) { const version = evaluate(`window.mountB2(${JSON.stringify(scenario)})`); command("wait", "--fn", `window.fixtureVersion===${version}`); command("click", "button"); }
const fresh = `(()=>{const x=structuredClone(window.fixtureCMaterializationInput);x.bindingSource.provenanceSource=window.fixtureB2.source;return x})()`;
try {
  command("open", `http://127.0.0.1:${port}`); command("wait", "--fn", "!!window.fixtureVersion");
  for (const [scenario, count, kind] of [["send", 1, "SEND"], ["swap", 1, "SWAP"], ["bridge", 1, "BRIDGE"], ["multi", 2, "SEND"]]) {
    mount(scenario);
    const result = evaluate(`(()=>{const m=window.fixtureCMaterialize(window.fixtureCMaterializationInput);return {status:m.status,enabled:m.executionEnabled,count:m.materialization?.actions.length,
      kinds:m.materialization?.actions.map(a=>a.actionKind),valid:m.status==='MATERIALIZED'&&window.fixtureCValidate(m.materialization).valid,
      strategy:m.materialization?.strategyId===window.fixtureB2.compiled.strategy.id,
      strategyDigest:m.materialization?.strategyDigest===window.fixtureB2.compiled.binding.strategy.digest,
      binding:m.materialization?.bindingDigest===window.fixtureB2.compiled.binding.digest,
      bindingCopy:JSON.stringify(m.materialization?.binding)===JSON.stringify(window.fixtureB2.compiled.binding),
      evidence:m.materialization?.parameterEvidenceDigest===window.fixtureB2.result.value.evidenceDigest,
      ids:m.materialization?.actions.every(a=>window.fixtureB2.compiled.binding.goalSteps.some(g=>g.goalId===a.goalId&&g.actionStepId===a.actionStepId)),
      requirements:m.materialization?.actions.every(a=>a.requirements.includes('ACCOUNT_CONTEXT')&&a.requirements.includes('QUOTE')&&a.requirements.includes('POLICY_EVALUATION')&&a.requirements.includes('PREPARATION'))}})()`);
    check(`${scenario} materializes`, result.status, "MATERIALIZED");
    check(`${scenario} disabled`, result.enabled, false);
    check(`${scenario} action count`, result.count, count);
    check(`${scenario} first action`, result.kinds?.[0], kind);
    check(`${scenario} validates`, result.valid, true);
    check(`${scenario} Strategy ID`, result.strategy, true);
    check(`${scenario} Strategy digest`, result.strategyDigest, true);
    check(`${scenario} binding digest`, result.binding, true);
    check(`${scenario} exact binding`, result.bindingCopy, true);
    check(`${scenario} evidence digest`, result.evidence, true);
    check(`${scenario} mapping`, result.ids, true);
    check(`${scenario} requirements`, result.requirements, true);
  }
  const multi = evaluate(`(()=>{const m=window.fixtureCMaterialize(window.fixtureCMaterializationInput).materialization;return {kinds:m.actions.map(a=>a.actionKind),edge:m.actions.find(a=>a.actionKind==='SEND').dependsOnStepIds,
    swap:m.actions.find(a=>a.actionKind==='SWAP').actionStepId,unique:new Set(m.actions.map(a=>a.actionStepId)).size===2,
    inputs:m.actions.map(a=>a.parameters.amount),digest:m.digest,revision:m.revision}})()`);
  check("multi action kinds", multi.kinds, ["SEND", "SWAP"]);
  check("multi order edge", multi.edge, [multi.swap]);
  check("multi unique steps", multi.unique, true);
  check("multi fixed amounts", multi.inputs, ["5", "10"]);

  mount("send");
  const positive = evaluate(`(()=>{const m=window.fixtureCMaterialize(window.fixtureCMaterializationInput).materialization;
    const again=window.fixtureCMaterialize(window.fixtureCMaterializationInput).materialization;
    const reversed=${fresh};reversed.bindingSource.provenance={...reversed.bindingSource.provenance,intents:reversed.bindingSource.provenance.intents.map(i=>Object.fromEntries(Object.entries(i).reverse()))};
    return {same:JSON.stringify(m)===JSON.stringify(again),revision:m.revision,digest:m.digest,actionDigest:m.actions[0].digest,
      reordered:window.fixtureCMaterialize(reversed).materialization?.digest===m.digest,
      provenance:[m.requestId,m.sessionId,m.requestDigest,m.proposalId,m.proposalDigest,m.planId,m.planDigest,m.parameterEvidenceDigest].every(Boolean),
      semantic:m.actions[0].parameters,stage:m.stage,createdAt:m.strategyCreatedAt,requirements:m.actions[0].requirements}})()`);
  check("deterministic full artifact", positive.same, true);
  check("revision hash", /^0x[0-9a-f]{64}$/.test(positive.revision), true);
  check("set digest hash", /^0x[0-9a-f]{64}$/.test(positive.digest), true);
  check("action digest hash", /^0x[0-9a-f]{64}$/.test(positive.actionDigest), true);
  check("object insertion order inert", positive.reordered, true);
  check("full lineage present", positive.provenance, true);
  check("semantic-only stage", positive.stage, "SEMANTIC_ONLY");
  check("host createdAt retained", positive.createdAt, 1);
  check("exact Send intent", positive.semantic, { version: 1, id: "send", kind: "SEND", asset: "eurc", amount: "10", recipient: "0x2222222222222222222222222222222222222222", chainId: 5042002 });
  check("requirements exact", positive.requirements, ["ACCOUNT_CONTEXT", "LIVE_READ", "QUOTE", "POLICY_EVALUATION", "PREPARATION", "EXPLICIT_REVIEW", "SUPPORTED_WALLET_HANDOFF"]);

  mount("send-alt");
  const changedAmount = evaluate(`(()=>{const m=window.fixtureCMaterialize(window.fixtureCMaterializationInput);return {status:m.status,amount:m.materialization?.actions[0].parameters.amount,digest:m.materialization?.digest,revision:m.materialization?.revision}})()`);
  check("fresh confirmed amount materializes", changedAmount.status, "MATERIALIZED");
  check("fresh amount retained", changedAmount.amount, "11");
  check("changed amount changes set digest", changedAmount.digest === positive.digest, false);
  check("changed amount changes revision", changedAmount.revision === positive.revision, false);
  mount("send");

  const attacks = evaluate(`(()=>{const mutations=[
    ['result status',x=>x.compilation.status='REJECTED'],['enabled',x=>x.compilation.executionEnabled=true],
    ['v1 binding',x=>x.compilation.binding.version=1],['binding digest',x=>x.compilation.binding.digest='0x'+'0'.repeat(64)],
    ['Strategy ID',x=>x.compilation.strategy.id='other'],['Strategy createdAt',x=>x.compilation.strategy.createdAt=2],
    ['Strategy action',x=>x.compilation.strategy.steps[0].action='SWAP'],['prepared reference',x=>x.compilation.strategy.steps[0].preparedAction={}],
    ['ACTION ID',x=>x.compilation.strategy.steps[0].id='other'],['extra ACTION',x=>x.compilation.strategy.steps.push({...x.compilation.strategy.steps[0],id:'other'})],
    ['mapping goal',x=>x.compilation.binding.goalSteps[0].goalId='other'],['mapping step',x=>x.compilation.binding.goalSteps[0].actionStepId='other'],
    ['request',x=>x.bindingSource.requestId='other'],['session',x=>x.bindingSource.sessionId='other'],
    ['plan',x=>x.bindingSource.plan.id='other'],['proposal',x=>x.bindingSource.provenanceSource={...x.bindingSource.provenanceSource,structuredInput:{...x.bindingSource.provenanceSource.structuredInput,proposalId:'other'}}],
    ['missing evidence',x=>x.bindingSource.provenance.evidence.pop()],['evidence digest',x=>x.bindingSource.provenance.evidenceDigest='0x'+'0'.repeat(64)],
    ['amount',x=>x.bindingSource.provenance.intents[0].amount='11'],['recipient',x=>x.bindingSource.provenance.intents[0].recipient='0x3333333333333333333333333333333333333333'],
    ['asset',x=>x.bindingSource.provenance.intents[0].asset='usdc'],['chain',x=>x.bindingSource.provenance.intents[0].chainId=84532],
    ['zero amount',x=>x.bindingSource.provenance.intents[0].amount='0'],['malformed amount',x=>x.bindingSource.provenance.intents[0].amount='1e3'],
    ['unsupported asset',x=>x.bindingSource.provenance.intents[0].asset='dai'],['malformed recipient',x=>x.bindingSource.provenance.intents[0].recipient='bad'],
    ['source copy',x=>x.bindingSource.provenanceSource=structuredClone(window.fixtureB2.source)],
    ['extra authority',x=>x.walletClient=true],['legacy version',x=>x.version=2],['missing binding',x=>delete x.compilation.binding]
  ];return mutations.map(([name,change])=>{const x=${fresh};change(x);return [name,window.fixtureCMaterialize(x).status]})})()`);
  for (const [name, status] of attacks) check(`reject ${name}`, status, "REJECTED");
  const artifactAttacks = evaluate(`(()=>{const source=window.fixtureCMaterializationInput;const initial=window.fixtureCMaterialize(source).materialization;const tests=[
    ['set digest',m=>m.digest='0x'+'0'.repeat(64)],['action digest',m=>m.actions[0].digest='0x'+'0'.repeat(64)],
    ['cross Strategy',m=>m.actions[0].strategyId='other'],['cross binding',m=>m.actions[0].bindingDigest='0x'+'0'.repeat(64)],
    ['changed action',m=>m.actions[0].parameters.amount='11'],['extra wallet',m=>m.walletClient=true],
    ['enabled artifact',m=>m.executionEnabled=true],['changed dependency',m=>m.actions[0].dependsOnStepIds=['other']]
  ];return tests.map(([name,change])=>{const m=structuredClone(initial);change(m);return [name,window.fixtureCValidate(m).valid]})})()`);
  for (const [name, valid] of artifactAttacks) check(`artifact rejects ${name}`, valid, false);
  const original = evaluate(`window.fixtureCMaterialize(window.fixtureCMaterializationInput).materialization`);
  check("original still validates", evaluate(`window.fixtureCValidate(window.fixtureCMaterialize(window.fixtureCMaterializationInput).materialization).valid`), true);
  const version = evaluate(`window.mountB2('send')`); command("wait", "--fn", `window.fixtureVersion===${version}`);
  check("old source revoked", evaluate(`window.fixtureB2CheckLive()`), false);
  check("old materialization cannot validate", evaluate(`window.fixtureCValidate(${JSON.stringify(original)}).valid`), false);
  assert.ok(cases.length >= 50, `Only ${cases.length} cases`);
  console.log(`AEI-C live browser matrix ${cases.length}/${cases.length} PASS`);
} finally { try { command("close"); } catch { /* preserve primary failure */ } }
