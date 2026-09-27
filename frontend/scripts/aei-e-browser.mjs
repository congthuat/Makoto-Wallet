import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { openSync, closeSync, readFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

// Local deterministic browser fixture; no live provider, RPC, model or wallet call.
const binary = process.env.AGENT_BROWSER_BINARY ?? path.join(process.env.APPDATA, "npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe");
const session = "makoto-aei-e";
const port = Number(process.env.PHASE7G_PORT ?? 3189);
function command(...args) {
  const file = path.join(tmpdir(), "makoto-aei-e-command.json");
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
 const state={account,chain:arc,clock:1000,allowance:0n,balances:{usdc:100000000n,eurc:100000000n,cirbtc:100000000n},fee:1000000000000n,swapOutput:10000000n,quoteAt:1000,reads:0,quotes:0};
 const snapshot=()=>({connected:true,account:state.account,accountKind:"external",walletStatus:"connected",verifiedChainId:state.chain,isArc:state.chain===arc,
  balances:state.balances,activity:[],activityLoadState:"loaded",activityPartial:false,activityUnavailable:false,vault:{available:false},safetyCapabilities:[],timestamp:state.clock});
 const wallet=()=>({kind:"external",address:state.account,chainId:state.chain,providerChainId:state.chain,status:"connected",connectionStatus:"connected",isArc:state.chain===arc});
 const host={current:async()=>({wallet:wallet(),snapshot:snapshot()}),now:()=>state.clock,
  reads:{readBalance:async(_a,id)=>{state.reads++;return state.balances[id]},readAllowance:async()=>{state.reads++;return state.allowance}},
  quotes:{estimateSendMaximumFee:async()=>{state.quotes++;return state.fee},readXyloOutput:async()=>{state.quotes++;return {amountOut:state.swapOutput,quotedAt:state.quoteAt}}}};
 window.fixtureEState=state;window.fixtureEHost=host;window.fixtureD=window.fixtureDCreate(host);return true;
})()`;
async function run(scenario, transform = "", actionIndex = 0) {
  mount(scenario);
  check(`${scenario} host`, evaluate(setup), true);
  return evaluate(`(async()=>{const m=window.fixtureCMaterialize(window.fixtureCMaterializationInput).materialization;
    const a=${actionIndex === -1 ? 'm.actions.find(x=>x.dependsOnStepIds.length)' : `m.actions[${actionIndex}]`}; ${transform}
    const d=await window.fixtureD.orchestrate({materialization:m,retainedLiveInput:window.fixtureCMaterializationInput,actionStepId:a.actionStepId,...(a.actionKind==="SWAP"?{slippage:0.005}:{})});
    const from={version:2,kind:"PLAN_READY",sessionId:m.sessionId,stateId:"plan-state",plan:{kind:"PLANNER_PLAN",id:m.planId}};
    const result=d.envelope?await window.fixtureEIntegrate({version:1,envelope:d.envelope,retainedLiveInput:window.fixtureCMaterializationInput,currentState:from}):null;
    window.fixtureELast={d,from,result};return {d:d.status,result:result?.status,reason:result?.reason,kind:result?.state?.kind,
      transaction:result?.state?.status,action:result?.state?.binding?.action,index:result?.state?.binding?.preparedAction?.stepIndex,
      outcome:result?.sidecar?.outcome,decision:result?.sidecar?.policyDecision,technical:result?.sidecar?.technicalSteps?.map(x=>x.kind)};
  })()`);
}
try {
  command("open", `http://127.0.0.1:${port}`);
  command("wait", "--fn", "!!window.fixtureVersion");
  const send = await run("send");
  check("SEND operational outcome", send.d, "ORCHESTRATED");
  check("SEND guarded PREPARED", [send.result, send.kind, send.transaction, send.action, send.index], ["MAPPED", "TRANSACTION", "PREPARED", "SEND", 0]);
  check("SEND review eligible", await evaluate("window.fixtureEReview(window.fixtureELast.result)"), { eligible: true });
  check("SEND dynamically current", await evaluate("window.fixtureECurrentness(window.fixtureELast.result)"), { status: "CURRENT" });
  check("SEND issuance label is not a cached current claim", evaluate("window.fixtureELast.result.sidecar.currentness"), "ISSUED_LIVE");
  check("SEND has no attempt/hash/receipt", evaluate(`(()=>{const s=window.fixtureELast.result.state;return ["attempt" in s,"submittedHash" in s,"receipt" in s]})()`), [false,false,false]);
  check("SEND policy ALLOW only", evaluate(`(()=>{const x=window.fixtureELast.result;return [x.sidecar.policyDecision,x.state.status,x.sidecar.reviewRequirements.includes("EXPLICIT_REVIEW")]})()`), ["ALLOW","PREPARED",true]);
  check("SEND exact ACTION/goal", evaluate(`(()=>{const {d,result}=window.fixtureELast;return [result.sidecar.actionStepId===d.envelope.action.actionStepId,result.sidecar.goalId===d.envelope.action.goalId]})()`), [true,true]);
  check("SEND account/chain bound", evaluate(`(()=>{const {d,result}=window.fixtureELast;return [result.sidecar.account===d.envelope.accountContext.account.toLowerCase(),result.sidecar.chainId===5042002,result.state.binding.account===result.sidecar.account]})()`), [true,true,true]);
  check("SEND reads bound", evaluate(`(()=>{const {d,result}=window.fixtureELast;return JSON.stringify(result.sidecar.readDigests)===JSON.stringify(d.envelope.reads.map(x=>x.digest))})()`), true);
  check("SEND quote/prep expiry bound", evaluate(`(()=>{const {d,result}=window.fixtureELast;return [result.sidecar.quoteExpiresAt===d.envelope.quote.result.expiresAt,result.sidecar.preparationExpiresAt===d.envelope.prepared.result.data.expiresAt]})()`), [true,true]);
  check("SEND sidecar provenance", evaluate(`(()=>{const {d,result}=window.fixtureELast;return [result.sidecar.orchestrationDigest===d.envelope.digest,
    result.sidecar.materializationRevision===d.envelope.materialization.revision,result.sidecar.quoteDigest===d.envelope.quote.digest,
    result.sidecar.preparationDigest===d.envelope.prepared.digest,result.sidecar.policyDigest===d.envelope.policy.digest,
    result.sidecar.executionEnabled,result.sidecar.executionAuthority]})()`), [true,true,true,true,true,false,"FORBIDDEN"]);
  check("direct reducer bypass denied", evaluate(`(()=>{const {from,result}=window.fixtureELast;return window.fixtureETransition(from,result.state,
    {kind:"AEI_E_PREPARED",sessionId:from.sessionId,stateId:from.stateId,proof:{}})})()`), { allowed: false, reason: "MISSING_CANONICAL_STRATEGY_BINDING" });
  check("plain direct reducer bypass denied", evaluate(`(()=>{const {from,result}=window.fixtureELast;return window.fixtureETransition(from,result.state,
    {kind:"PLAN",sessionId:from.sessionId,stateId:from.stateId,result:{status:"GENERATED"}})})()`), { allowed: false, reason: "MISSING_CANONICAL_STRATEGY_BINDING" });
  check("copied integration is not review eligible", await evaluate("window.fixtureEReview({...window.fixtureELast.result})"), { eligible: false, reason: "UNREGISTERED" });
  check("copied D envelope rejected", await evaluate(`(async()=>{const {d,from}=window.fixtureELast;return (await window.fixtureEIntegrate({version:1,envelope:{...d.envelope},
    retainedLiveInput:window.fixtureCMaterializationInput,currentState:from})).reason})()`), "INVALID_OPERATIONAL_ENVELOPE");
  check("same D cannot mint duplicate PREPARED", await evaluate(`(async()=>{const {d,from}=window.fixtureELast;return (await window.fixtureEIntegrate({version:1,envelope:d.envelope,
    retainedLiveInput:window.fixtureCMaterializationInput,currentState:from})).reason})()`), "IDENTITY_MISMATCH");
  check("wrong plan rejects", await evaluate(`(async()=>{const {d,from}=window.fixtureELast;return (await window.fixtureEIntegrate({version:1,envelope:d.envelope,
    retainedLiveInput:window.fixtureCMaterializationInput,currentState:{...from,plan:{kind:"PLANNER_PLAN",id:"other"}}})).reason})()`), "IDENTITY_MISMATCH");
  check("wrong session rejects", await evaluate(`(async()=>{const {d,from}=window.fixtureELast;return (await window.fixtureEIntegrate({version:1,envelope:d.envelope,
    retainedLiveInput:window.fixtureCMaterializationInput,currentState:{...from,sessionId:"other"}})).reason})()`), "IDENTITY_MISMATCH");
  check("copied source rejects", await evaluate(`(async()=>{const {d,from}=window.fixtureELast;return (await window.fixtureEIntegrate({version:1,envelope:d.envelope,
    retainedLiveInput:structuredClone(window.fixtureCMaterializationInput),currentState:from})).reason})()`), "INVALID_OPERATIONAL_ENVELOPE");
  check("persisted composite", evaluate(`(()=>{const {result,d}=window.fixtureELast;const b={account:d.envelope.accountContext.account,chainId:d.envelope.accountContext.chainId};
    return window.fixtureEStore(sessionStorage,result,b)})()`), true);
  check("restored PREPARED is historical", evaluate(`(()=>{const {d,from}=window.fixtureELast;const b={account:d.envelope.accountContext.account,chainId:d.envelope.accountContext.chainId};
    const x=window.fixtureERestore(sessionStorage,from.sessionId,b);window.fixtureERestored=x;return [x.status,x.state.status,x.sidecar.currentness]})()`), ["HISTORICAL","PREPARED","HISTORICAL"]);
  check("restored JSON cannot recreate review", await evaluate("window.fixtureEReview(window.fixtureERestored)"), { eligible: false, reason: "UNREGISTERED" });
  check("restored currentness is historical", await evaluate("window.fixtureECurrentness(window.fixtureERestored)"), { status: "HISTORICAL" });
  check("wrong-account restore is absent", evaluate(`(()=>{const {from}=window.fixtureELast;return window.fixtureERestore(sessionStorage,from.sessionId,
    {account:"0x3333333333333333333333333333333333333333",chainId:5042002}).status})()`), "ABSENT");
  check("wrong-chain restore is absent", evaluate(`(()=>{const {d,from}=window.fixtureELast;return window.fixtureERestore(sessionStorage,from.sessionId,
    {account:d.envelope.accountContext.account,chainId:84532}).status})()`), "ABSENT");
  check("unmapped newer D result revokes old review", await evaluate(`(async()=>{const old=window.fixtureELast;
    window.fixtureEState.fee=1500000000000n;
    const d=await window.fixtureD.orchestrate({materialization:old.d.envelope.materialization,
      retainedLiveInput:window.fixtureCMaterializationInput,actionStepId:old.d.envelope.action.actionStepId});
    return [d.status,(await window.fixtureEReview(old.result)).reason]})()`), ["ORCHESTRATED","STALE"]);
  check("new quote/prep/policy creates new lineage", await evaluate(`(async()=>{const old=window.fixtureELast;const m=old.d.envelope.materialization;
    window.fixtureEState.fee=2000000000000n;
    const d=await window.fixtureD.orchestrate({materialization:m,retainedLiveInput:window.fixtureCMaterializationInput,actionStepId:old.d.envelope.action.actionStepId});
    const next=await window.fixtureEIntegrate({version:1,envelope:d.envelope,retainedLiveInput:window.fixtureCMaterializationInput,currentState:old.from});
    window.fixtureENew={d,next};return [d.status,next.status,next.state.stateId!==old.result.state.stateId,
      next.sidecar.quoteDigest!==old.result.sidecar.quoteDigest,next.sidecar.preparationDigest!==old.result.sidecar.preparationDigest,
      next.sidecar.policyDigest!==old.result.sidecar.policyDigest]})()`), ["ORCHESTRATED","MAPPED",true,true,true,true]);
  check("old quote lineage loses review eligibility", await evaluate("window.fixtureEReview(window.fixtureELast.result)"), { eligible: false, reason: "STALE" });
  check("old quote lineage is dynamically stale", await evaluate("window.fixtureECurrentness(window.fixtureELast.result)"), { status: "STALE" });
  check("new quote lineage is eligible", await evaluate("window.fixtureEReview(window.fixtureENew.next)"), { eligible: true });
  check("old and new quote persist as separate history", evaluate(`(()=>{const old=window.fixtureELast,newer=window.fixtureENew;
    const b={account:old.d.envelope.accountContext.account,chainId:5042002};
    if(!window.fixtureEStore(sessionStorage,newer.next,b))return false;
    const h=window.fixtureEHistory(sessionStorage,old.from.sessionId,b);
    return [h.status,h.records.length,h.records[0].sidecar.digest!==h.records[1].sidecar.digest,
      h.records[0].sidecar.currentness,h.records[1].sidecar.currentness]})()`), ["HISTORICAL",2,true,"HISTORICAL","HISTORICAL"]);
  check("ALLOW to REQUOTE revokes old lineage", await evaluate(`(async()=>{const old=window.fixtureENew;const m=old.d.envelope.materialization;
    let quotes=0;window.fixtureEHost.quotes.estimateSendMaximumFee=async()=>++quotes===1?2000000000000n:3000000000000n;
    const d=await window.fixtureD.orchestrate({materialization:m,retainedLiveInput:window.fixtureCMaterializationInput,actionStepId:old.d.envelope.action.actionStepId});
    const stopped=await window.fixtureEIntegrate({version:1,envelope:d.envelope,retainedLiveInput:window.fixtureCMaterializationInput,currentState:window.fixtureELast.from});
    return [d.status,stopped.status,stopped.state.kind,(await window.fixtureEReview(old.next)).reason]})()`),
    ["REQUOTE_REQUIRED","MAPPED","PLAN_READY","STALE"]);
  check("account switch invalidates", await evaluate(`(async()=>{window.fixtureEState.account="0x3333333333333333333333333333333333333333";
    return window.fixtureEReview(window.fixtureELast.result)})()`), { eligible: false, reason: "STALE" });
  const swap = await run("swap");
  check("SWAP policy review", [swap.d,swap.decision], ["REVIEW_REQUIRED","REQUIRE_REVIEW"]);
  check("SWAP approval first", [swap.result,swap.action,swap.index,swap.technical], ["MAPPED","APPROVE",0,["finite-approval","swap"]]);
  check("SWAP warning retained", evaluate(`(()=>{const {d,result}=window.fixtureELast;return [result.sidecar.warnings.includes("Swap gas fee is not estimated."),
    result.sidecar.warnings.length===d.envelope.warnings.length,result.sidecar.reviewRequirements.includes("EXPLICIT_REVIEW")]})()`), [true,true,true]);
  check("SWAP approval is distinct from semantic step", evaluate(`(()=>{const {d,result}=window.fixtureELast;return [result.sidecar.actionStepId===d.envelope.action.actionStepId,
    result.state.step.stepId!==d.envelope.action.actionStepId,result.sidecar.technicalStepId===result.state.step.stepId,result.sidecar.overlayDigest!==null]})()`), [true,true,true,true]);
  check("approval has no attempt/hash", evaluate(`(()=>{const s=window.fixtureELast.result.state;return ["attempt" in s,"submittedHash" in s,"receipt" in s]})()`), [false,false,false]);
  check("SWAP review eligible", await evaluate("window.fixtureEReview(window.fixtureELast.result)"), { eligible: true });
  check("chain switch invalidates", await evaluate(`(async()=>{window.fixtureEState.chain=84532;
    const result=await window.fixtureEReview(window.fixtureELast.result);window.fixtureEState.chain=5042002;return result})()`), { eligible: false, reason: "STALE" });
  check("disconnect invalidates", await evaluate(`(async()=>{const original=window.fixtureEHost.current;
    window.fixtureEHost.current=async()=>({wallet:{kind:"external",status:"disconnected"},snapshot:{connected:false}});
    const result=await window.fixtureEReview(window.fixtureELast.result);window.fixtureEHost.current=original;return result})()`), { eligible: false, reason: "STALE" });
  check("reconnect with new observation invalidates", await evaluate(`(async()=>{window.fixtureEState.clock=1001;
    return window.fixtureEReview(window.fixtureELast.result)})()`), { eligible: false, reason: "STALE" });
  check("quote expiry invalidates without remount", await evaluate(`(async()=>{window.fixtureEState.clock=40000;
    return window.fixtureEReview(window.fixtureELast.result)})()`), { eligible: false, reason: "STALE" });
  check("expired currentness is stale", await evaluate("window.fixtureECurrentness(window.fixtureELast.result)"), { status: "STALE" });
  await run("swap");
  check("prepared artifact expiry invalidates review", await evaluate(`(async()=>{const e=window.fixtureELast.d.envelope;
    window.fixtureEState.clock=e.prepared.result.data.expiresAt+1;
    return window.fixtureEReview(window.fixtureELast.result)})()`), { eligible: false, reason: "STALE" });
  const bridge = await run("bridge");
  check("bridge handoff remains PLAN_READY", [bridge.d,bridge.result,bridge.kind,bridge.transaction], ["HANDOFF_REQUIRED","MAPPED","PLAN_READY",undefined]);
  check("bridge never review eligible", await evaluate("window.fixtureEReview(window.fixtureELast.result)"), { eligible: false, reason: "STALE" });
  check("bridge history remains non-executable", evaluate(`(()=>{const {d,result,from}=window.fixtureELast;const b={account:d.envelope.accountContext.account,chainId:5042002};
    if(!window.fixtureEStore(sessionStorage,result,b))return false;const restored=window.fixtureERestore(sessionStorage,from.sessionId,b);
    return [restored.status,restored.state.kind,restored.sidecar.outcome,restored.sidecar.currentness,restored.sidecar.executionAuthority]})()`),
    ["HISTORICAL","PLAN_READY","HANDOFF_REQUIRED","HISTORICAL","FORBIDDEN"]);
  const changedQuote = await run("swap", `window.fixtureEHost.quotes.readXyloOutput=async()=>({amountOut:++window.fixtureEState.quotes===1?10000000n:11000000n,quotedAt:1000});`);
  check("requote remains PLAN_READY", [changedQuote.d,changedQuote.result,changedQuote.kind], ["REQUOTE_REQUIRED","MAPPED","PLAN_READY"]);
  check("requote history is descriptive", evaluate(`(()=>{const {d,result,from}=window.fixtureELast;const b={account:d.envelope.accountContext.account,chainId:5042002};
    if(!window.fixtureEStore(sessionStorage,result,b))return false;const x=window.fixtureERestore(sessionStorage,from.sessionId,b);
    return [x.status,x.sidecar.outcome,x.sidecar.quoteDigest===null,x.sidecar.currentness]})()`), ["HISTORICAL","REQUOTE_REQUIRED",true,"HISTORICAL"]);
  const revalidate = await run("swap", `window.fixtureEHost.reads.readAllowance=async()=>{window.fixtureEState.reads++;return window.fixtureEState.reads>9?1n:0n};`);
  check("revalidation remains PLAN_READY", [revalidate.d,revalidate.result,revalidate.kind], ["REVALIDATION_REQUIRED","MAPPED","PLAN_READY"]);
  check("revalidation has no review eligibility", await evaluate("window.fixtureEReview(window.fixtureELast.result)"), { eligible: false, reason: "STALE" });
  const quoteFailed = await run("swap", `window.fixtureEHost.quotes.readXyloOutput=async()=>{throw Error("offline")};`);
  check("quote failure is pre-transaction", [quoteFailed.d,quoteFailed.result,quoteFailed.kind], ["QUOTE_FAILED","MAPPED","PLAN_READY"]);
  check("quote failure has no tx FAILED state", evaluate(`(()=>{const x=window.fixtureELast.result;return [x.sidecar.outcome,x.state.kind,x.sidecar.executionAuthority]})()`),
    ["QUOTE_FAILED","PLAN_READY","FORBIDDEN"]);
  const prepareFailed = await run("send", `(()=>{let calls=0;window.fixtureEHost.quotes.estimateSendMaximumFee=async()=>++calls===1?1000000000000n:undefined})()`);
  check("preparation failure is pre-transaction", [prepareFailed.d,prepareFailed.result,prepareFailed.kind], ["PREPARATION_FAILED","MAPPED","PLAN_READY"]);
  const readFailed = await run("send", `window.fixtureEHost.reads.readBalance=async()=>{throw Error("offline")};`);
  check("unavailable read requires revalidation", [readFailed.d,readFailed.result,readFailed.kind], ["REVALIDATION_REQUIRED","MAPPED","PLAN_READY"]);
  const dependent = await run("multi", "", -1);
  check("dependent ACTION blocked", [dependent.d,dependent.result,dependent.kind], ["DEPENDENCY_BLOCKED","MAPPED","PLAN_READY"]);
  check("dependent ACTION retains requirement", evaluate("window.fixtureELast.result.sidecar.reviewRequirements.includes('VERIFIED_PRIOR_ACTION')"), true);
  check("old result no longer current after fresh same-ACTION lineage", await evaluate("window.fixtureEReview(window.fixtureELast.result)"), { eligible: false, reason: "STALE" });
  console.log(`AEI-E browser: ${cases.length}/${cases.length} passed`);
} finally { try { command("close"); } catch { /* isolated session cleanup */ } }
