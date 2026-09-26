import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { openSync, closeSync, readFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

// Local browser fixture only. All READ and QUOTE services are deterministic in-memory doubles.
const binary = process.env.AGENT_BROWSER_BINARY ?? path.join(process.env.APPDATA, "npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe");
const session = "makoto-aei-d";
const port = Number(process.env.PHASE7G_PORT ?? 3188);
function command(...args) {
  const file = path.join(tmpdir(), "makoto-aei-d-command.json");
  const fd = openSync(file, "w");
  try { execFileSync(binary, ["--session", session, "--json", ...args], { stdio: ["ignore", fd, "inherit"], timeout: 60_000, windowsHide: true }); }
  finally { closeSync(fd); }
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(parsed.success, true, parsed.error);
  return parsed.data;
}
const evaluate = (code) => command("eval", code).result;
const cases = [];
function check(name, actual, expected) { assert.deepEqual(actual, expected, name); cases.push(name); }
function mount(scenario) {
  const version = evaluate(`window.mountB2(${JSON.stringify(scenario)})`);
  command("wait", "--fn", `window.fixtureVersion===${version}`);
  command("click", "button");
}
const setup = `(()=>{
 const account="0x2222222222222222222222222222222222222222",arc=5042002;
 const state={account,chain:arc,clock:1000,allowance:0n,balances:{usdc:100000000n,eurc:100000000n,cirbtc:100000000n},fee:1000000000000n,swapOutput:10000000n,quoteAt:1000,reads:0,quotes:0,prepared:0};
 const snapshot=()=>({connected:true,account:state.account,accountKind:"external",walletStatus:"connected",verifiedChainId:state.chain,isArc:state.chain===arc,
  balances:state.balances,activity:[],activityLoadState:"loaded",activityPartial:false,activityUnavailable:false,vault:{available:false},safetyCapabilities:[],timestamp:state.clock});
 const wallet=()=>({kind:"external",address:state.account,chainId:state.chain,providerChainId:state.chain,status:"connected",connectionStatus:"connected",isArc:state.chain===arc});
 const host={current:async()=>({wallet:wallet(),snapshot:snapshot()}),now:()=>state.clock,
  reads:{readBalance:async(_a,id)=>{state.reads++;return state.balances[id]},readAllowance:async()=>{state.reads++;return state.allowance}},
  quotes:{estimateSendMaximumFee:async()=>{state.quotes++;return state.fee},readXyloOutput:async()=>{state.quotes++;return {amountOut:state.swapOutput,quotedAt:state.quoteAt}}}};
 window.fixtureDState=state;window.fixtureDHost=host;window.fixtureD=window.fixtureDCreate(host);
 return true;
})()`;
async function run(scenario, transform = "") {
  mount(scenario);
  check(`${scenario} valid AEI-C`, evaluate(`window.fixtureCMaterialize(window.fixtureCMaterializationInput).status`), "MATERIALIZED");
  check(`${scenario} host setup`, evaluate(setup), true);
  return evaluate(`(async()=>{const m=window.fixtureCMaterialize(window.fixtureCMaterializationInput).materialization;
    const a=m.actions.find(x=>!x.dependsOnStepIds.length); ${transform}
    const r=await window.fixtureD.orchestrate({materialization:m,retainedLiveInput:window.fixtureCMaterializationInput,actionStepId:a.actionStepId,...(a.actionKind==="SWAP"?{slippage:0.005}:{})});
    window.fixtureDLast=r;return {status:r.status,enabled:r.executionEnabled,stage:r.envelope?.stage,authority:r.envelope?.executionAuthority,
      action:r.envelope?.action.actionStepId,reads:r.envelope?.reads.length,quote:r.envelope?.quote?.result.status,
      prepared:r.envelope?.prepared?.result.status,policy:r.envelope?.policy?.result.decision,
      steps:r.envelope?.prepared?.result.data?.steps.map(s=>s.kind),requirements:r.envelope?.unmetRequirements};
  })()`);
}
try {
  command("open", `http://127.0.0.1:${port}`);
  command("wait", "--fn", "!!window.fixtureVersion");
  const send = await run("send");
  check("SEND orchestration", send.status, "ORCHESTRATED");
  check("SEND execution forbidden", [send.enabled, send.authority], [false, "FORBIDDEN"]);
  check("SEND signed data absent", send.steps, ["send"]);
  check("SEND policy", send.policy, "ALLOW");
  check("SEND live reads", send.reads, 4);
  check("SEND result registered", await evaluate("window.fixtureDValidate(window.fixtureDLast.envelope,window.fixtureCMaterializationInput)"), true);
  const sendBinding = evaluate(`(()=>{const e=window.fixtureDLast.envelope,a=e.action,c=e.accountContext,r=e.reads,q=e.quote,p=e.prepared,o=e.policy;
    return {live:e.materialization.stage,selected:e.action.actionStepId===r[0].actionStepId&&r.every(x=>x.actionDigest===a.digest),
      account:r.every(x=>x.accountDigest===c.digest)&&q.accountDigest===c.digest&&p.accountDigest===c.digest,
      chain:r.every(x=>x.chainId===c.chainId)&&q.chainId===c.chainId&&p.chainId===c.chainId,
      tools:r.map(x=>x.request.tool),requestDigests:r.every(x=>/^0x[0-9a-f]{64}$/.test(x.requestDigest)),
      quoteLink:p.quoteDigest===q.digest&&o.quoteDigest===q.digest,policyLink:o.preparedDigest===p.digest,
      policyFunction:o.evaluator,quoteProvider:q.result.provider,gas:q.result.data.maximumFeeRaw18!==undefined,
      expiry:p.result.data.expiresAt>=p.result.data.preparedAt,unmet:e.unmetRequirements.includes("EXPLICIT_REVIEW"),
      digest:/^0x[0-9a-f]{64}$/.test(e.digest),revision:/^0x[0-9a-f]{64}$/.test(e.revision)};})()`);
  check("live AEI-C retained", sendBinding.live, "SEMANTIC_ONLY");
  check("selected ACTION binds reads", sendBinding.selected, true);
  check("account digest binds all evidence", sendBinding.account, true);
  check("chain binds all evidence", sendBinding.chain, true);
  check("SEND required tools", sendBinding.tools, ["wallet.state","network.verified","assets.balances","assets.balances"]);
  check("read request digests", sendBinding.requestDigests, true);
  check("quote binds preparation and policy", sendBinding.quoteLink, true);
  check("policy binds preparation", sendBinding.policyLink, true);
  check("existing policy evaluator recorded", sendBinding.policyFunction, "evaluatePolicy");
  check("SEND canonical provider", sendBinding.quoteProvider, "Arc RPC");
  check("SEND fee evidence available", sendBinding.gas, true);
  check("SEND prepared expiry", sendBinding.expiry, true);
  check("explicit review remains unmet", sendBinding.unmet, true);
  check("operational digest", sendBinding.digest, true);
  check("operational revision", sendBinding.revision, true);
  check("copied envelope cannot mint authority", await evaluate("window.fixtureDValidate(structuredClone(window.fixtureDLast.envelope),window.fixtureCMaterializationInput)"), false);
  check("caller rehash cannot mint authority", await evaluate("window.fixtureDValidate({...window.fixtureDLast.envelope,digest:window.fixtureDLast.envelope.digest},window.fixtureCMaterializationInput)"), false);
  const swap = await run("swap");
  check("SWAP orchestration", swap.status, "REVIEW_REQUIRED");
  check("SWAP approval order", swap.steps, ["finite-approval", "swap"]);
  check("SWAP quote", swap.quote, "AVAILABLE");
  check("SWAP policy review", swap.policy, "REQUIRE_REVIEW");
  const swapBinding = evaluate(`(()=>{const e=window.fixtureDLast.envelope,p=e.prepared.result.data,q=e.quote.result;
    return {tools:e.reads.map(x=>x.request.tool),pair:[q.inputAsset,q.outputAsset],provider:q.provider,
      fee:q.data.fee,approval:p.steps[0].amount===q.inputAmount&&p.steps[0].spender===q.data.router,
      ordered:p.steps[1].requiresConfirmedPriorStep===true,execution:p.executionEnabled,
      quoteFingerprint:p.quoteFingerprint===e.quote.fingerprint,warning:e.warnings.includes("Swap gas fee is not estimated."),
      allowance:e.reads.filter(x=>x.request.tool==="token.allowance").every(x=>x.result.data.spender===q.data.router)};})()`);
  check("SWAP allowance read before and after", swapBinding.tools.filter(x=>x==="token.allowance").length, 2);
  check("SWAP Xylo pair", swapBinding.pair, ["usdc","eurc"]);
  check("SWAP canonical provider", swapBinding.provider, "XyloNet StableSwap");
  check("SWAP unknown gas", swapBinding.fee, "not-estimated");
  check("finite exact approval", swapBinding.approval, true);
  check("approval before dependent swap", swapBinding.ordered, true);
  check("prepared action disabled", swapBinding.execution, false);
  check("refreshed quote fingerprint bound", swapBinding.quoteFingerprint, true);
  check("gas warning retained", swapBinding.warning, true);
  check("allowance spender bound", swapBinding.allowance, true);
  const aging = await run("swap", "window.fixtureDState.quoteAt=-35000;");
  check("near-expiry SWAP initially reviewable", aging.status, "REVIEW_REQUIRED");
  check("near-expiry SWAP initially validates", await evaluate("window.fixtureDValidate(window.fixtureDLast.envelope,window.fixtureCMaterializationInput)"), true);
  check("expired quote invalidates registered envelope", await evaluate(`(async()=>{
    const observed=await window.fixtureDHost.current();
    window.fixtureDHost.current=async()=>observed;
    window.fixtureDState.clock=11001;
    return window.fixtureDValidate(window.fixtureDLast.envelope,window.fixtureCMaterializationInput);
  })()`), false);
  const bridge = await run("bridge");
  check("BRIDGE no handoff", bridge.status, "HANDOFF_REQUIRED");
  check("BRIDGE no prepared artifact", bridge.prepared, undefined);
  check("BRIDGE no quote or read call", evaluate("window.fixtureDState.quotes===0&&window.fixtureDState.reads===0"), true);
  const bridgeForeign = await run("bridge", "window.fixtureDState.account='0x3333333333333333333333333333333333333333';");
  check("BRIDGE foreign recipient unsupported", bridgeForeign.status, "UNSUPPORTED_ACTION");
  const multi = await run("multi");
  check("eligible first ACTION", multi.status, "REVIEW_REQUIRED");
  check("dependent ACTION blocked", await evaluate(`(async()=>{const m=window.fixtureCMaterialize(window.fixtureCMaterializationInput).materialization;
    const a=m.actions.find(x=>x.dependsOnStepIds.length);return (await window.fixtureD.orchestrate({materialization:m,retainedLiveInput:window.fixtureCMaterializationInput,actionStepId:a.actionStepId})).status})()`), "DEPENDENCY_BLOCKED");
  check("whole dependency graph retained", evaluate("window.fixtureDLast.envelope.dependencies.length"), 2);
  check("no dependency completion claim", evaluate("window.fixtureDLast.envelope.unmetRequirements.includes('EXPLICIT_REVIEW')"), true);
  check("account switch invalidates", await evaluate(`(async()=>{const m=window.fixtureCMaterialize(window.fixtureCMaterializationInput).materialization;
    const a=m.actions[0];window.fixtureDState.account="0x3333333333333333333333333333333333333333";
    return window.fixtureDValidate(window.fixtureDLast.envelope,window.fixtureCMaterializationInput)})()`), false);
  const wrongChain = await run("send", "window.fixtureDState.chain=84532;");
  check("wrong chain fails before reads", wrongChain.status, "UNSUPPORTED_ACCOUNT_CONTEXT");
  check("wrong chain no provider calls", evaluate("window.fixtureDState.reads===0&&window.fixtureDState.quotes===0"), true);
  const stale = await run("swap", "window.fixtureDState.quoteAt=-60000;");
  check("stale quote typed", stale.status, "QUOTE_STALE");
  check("stale quote never prepares", stale.prepared, undefined);
  const changedQuote = await run("swap", `window.fixtureDHost.quotes.readXyloOutput=async()=>({amountOut:++window.fixtureDState.quotes===1?10000000n:11000000n,quotedAt:1000});`);
  check("changed quote requires requote", changedQuote.status, "REQUOTE_REQUIRED");
  check("changed quote has no usable prepared artifact", changedQuote.prepared, undefined);
  const changedAccount = await run("send", `window.fixtureDHost.reads.readBalance=async(_a,id)=>{window.fixtureDState.reads++;window.fixtureDState.account="0x3333333333333333333333333333333333333333";return window.fixtureDState.balances[id]};`);
  check("mid-acquisition account switch", changedAccount.status, "REVALIDATION_REQUIRED");
  check("mid-acquisition no prepared artifact", changedAccount.prepared, undefined);
  for (const [label, switchAt, field] of [["after quote", 3, "account"], ["after prepare", 4, "account"],
    ["after policy", 6, "account"], ["chain after quote", 3, "chain"]]) {
    const changed = await run("send", `(()=>{const original=window.fixtureDHost.current;let calls=0;
      window.fixtureDHost.current=async()=>{if(++calls===${switchAt})window.fixtureDState.${field}=${field === "account" ? '"0x3333333333333333333333333333333333333333"' : '84532'};
        return original()};})();`);
    check(`${label} switch requires revalidation`, changed.status, "REVALIDATION_REQUIRED");
    check(`${label} switch has no policy authority`, changed.policy, undefined);
  }
  const changedAllowance = await run("swap", `window.fixtureDHost.reads.readAllowance=async()=>{window.fixtureDState.reads++;return window.fixtureDState.reads>9?1n:0n};`);
  check("allowance change is non-authoritative", changedAllowance.status, "REVALIDATION_REQUIRED");
  const transientBalance = await run("swap", `window.fixtureDHost.reads.readBalance=async(_a,id)=>{const n=++window.fixtureDState.reads;
    return n===7&&id==="usdc"?50000000n:window.fixtureDState.balances[id]};`);
  check("internal PREPARE balance change is detected", transientBalance.status, "REVALIDATION_REQUIRED");
  check("internal balance change cannot produce prepared authority", transientBalance.prepared, undefined);
  const malformed = evaluate(`(async()=>{const m=window.fixtureCMaterialize(window.fixtureCMaterializationInput).materialization;
    const a=m.actions.find(x=>!x.dependsOnStepIds.length);const x=structuredClone(m);x.actions[0].parameters.amount="999";
    return (await window.fixtureD.orchestrate({materialization:x,retainedLiveInput:window.fixtureCMaterializationInput,actionStepId:a.actionStepId,slippage:0.005})).status})()`);
  check("tampered AEI-C artifact rejected", await malformed, "PROVENANCE_MISMATCH");
  check("fake retained source rejected", await evaluate(`(async()=>{const m=window.fixtureCMaterialize(window.fixtureCMaterializationInput).materialization;
    return (await window.fixtureD.orchestrate({materialization:m,retainedLiveInput:structuredClone(window.fixtureCMaterializationInput),actionStepId:m.actions[0].actionStepId,slippage:0.005})).status})()`), "INVALID_MATERIALIZATION");
  check("unknown ACTION rejected", await evaluate(`(async()=>{const m=window.fixtureCMaterialize(window.fixtureCMaterializationInput).materialization;
    return (await window.fixtureD.orchestrate({materialization:m,retainedLiveInput:window.fixtureCMaterializationInput,actionStepId:"foreign"})).status})()`), "PROVENANCE_MISMATCH");
  check("unsupported slippage stops", await evaluate(`(async()=>{const m=window.fixtureCMaterialize(window.fixtureCMaterializationInput).materialization;
    return (await window.fixtureD.orchestrate({materialization:m,retainedLiveInput:window.fixtureCMaterializationInput,actionStepId:m.actions[0].actionStepId,slippage:0.123})).status})()`), "UNSUPPORTED_ACTION");
  console.log(`AEI-D browser: ${cases.length}/${cases.length} passed`);
} finally { try { command("close"); } catch { /* Session cleanup only. */ } }
