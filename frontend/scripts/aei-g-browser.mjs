import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { openSync, closeSync, readFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

// Production components and A–F functions, deterministic local host only.
const binary = process.env.AGENT_BROWSER_BINARY ?? path.join(process.env.APPDATA, "npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe");
const session = "makoto-aei-g-integration";
const port = Number(process.env.PHASE7G_PORT ?? 3187);
const checks = [];
function command(...args) {
  const file = path.join(tmpdir(), "makoto-aei-g-command.json");
  const fd = openSync(file, "w");
  try { execFileSync(binary, ["--session", session, "--json", ...args], { stdio: ["ignore", fd, "inherit"], timeout: 60_000, windowsHide: true }); }
  finally { closeSync(fd); }
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(parsed.success, true, parsed.error);
  return parsed.data;
}
const evaluate = (code) => command("eval", code).result;
function check(name, actual, expected) { assert.deepEqual(actual, expected, name); checks.push(name); }
function mount(scenario, locale = "en") {
  const version = evaluate(`window.mountWorkspace({scenario:${JSON.stringify(scenario)},locale:${JSON.stringify(locale)},production:true})`);
  command("wait", "--fn", `window.fixtureVersion===${version}`);
}
function b2(scenario) {
  const version = evaluate(`window.mountB2(${JSON.stringify(scenario)})`);
  command("wait", "--fn", `window.fixtureVersion===${version}`);
  command("click", "button");
}
const review = () => evaluate(`document.querySelector('[aria-label="Prepared transaction review"]')?.innerText ?? null`);
const reviewButton = () => evaluate(`!!document.querySelector('[aria-label="Agent preparation"] button.plannerConfirmButton')`);
function confirm() { command("click", "[data-operation-mode='planner-proposal'] button"); command("wait", "--fn", `!!document.querySelector('[aria-label="Agent preparation"]')`); }
function openReview() { command("click", "[aria-label='Agent preparation'] button.plannerConfirmButton"); command("wait", "--fn", `!!document.querySelector('[aria-label="Prepared transaction review"]')`); }

try {
  command("open", `http://127.0.0.1:${port}`);
  command("wait", "--fn", "!!window.fixtureVersion");

  b2("send");
  check("B2 source is live only in mounted control", evaluate("window.fixtureB2.live"), true);
  check("copied B2 source rejected", evaluate("window.fixtureB2.copyValid"), false);
  check("B2 compilation remains non executable", evaluate("window.fixtureB2.compiled.executionEnabled"), false);
  check("AEI-A v2 binding", evaluate("window.fixtureB2.compiled.binding.version"), 2);
  check("v1 downgrade fails C", evaluate(`window.fixtureCMaterialize({...window.fixtureCMaterializationInput,compilation:{...window.fixtureB2.compiled,binding:{...window.fixtureB2.compiled.binding,version:1}}}).status`), "REJECTED");
  check("caller rehash does not register D", await evaluate(`window.fixtureDValidate({version:1,stage:"OPERATIONAL_ONLY",executionEnabled:false,executionAuthority:"FORBIDDEN",digest:window.fixtureCRehash("fake",[])},window.fixtureCMaterializationInput)`), false);
  check("direct E PREPARED proof cannot be forged", evaluate(`window.fixtureETransition(
    {version:2,kind:"PLAN_READY",sessionId:"fixture-b2-session",stateId:"plan-state",plan:{kind:"PLANNER_PLAN",id:"fixture-b2-plan"}},
    {version:2,kind:"TRANSACTION",status:"PREPARED",sessionId:"fixture-b2-session",stateId:"prepared-state"},
    {kind:"AEI_E_PREPARED",sessionId:"fixture-b2-session",stateId:"plan-state",proof:{digest:window.fixtureCRehash("fake",[])}}).allowed`), false);
  check("copied E result cannot claim Review", await evaluate("window.fixtureEReview({status:'MAPPED',state:{kind:'TRANSACTION',status:'PREPARED'},sidecar:{currentness:'ISSUED_LIVE'}})"), { eligible: false, reason: "UNREGISTERED" });
  check("duplicate B2 confirmation does not mint second source", evaluate("window.fixtureB2ConfirmCount"), 1);
  evaluate("window.fixtureGOldB2Live=window.fixtureB2CheckLive;window.fixtureGOldCInput=window.fixtureCMaterializationInput;window.fixtureGOldMaterialization=window.fixtureCMaterialize(window.fixtureCMaterializationInput).materialization");
  check("B2 still current before replacement", evaluate("window.fixtureGOldB2Live()"), true);
  b2("send-alt");
  check("old B2 revoked on remount", evaluate("window.fixtureGOldB2Live()"), false);
  check("new B2 is current", evaluate("window.fixtureB2CheckLive()"), true);
  check("cross Strategy C transplant rejected", evaluate("window.fixtureCValidate(window.fixtureGOldMaterialization,window.fixtureCMaterializationInput).valid"), false);
  check("cross Strategy old C input rejected", evaluate("window.fixtureCValidate(window.fixtureGOldMaterialization,window.fixtureGOldCInput).valid"), false);

  b2("multi");
  const multi = await evaluate(`(async()=>{
    const state={account:"0x1111111111111111111111111111111111111111",chainId:5042002,clock:Date.now(),
      balances:{usdc:100000000n,eurc:100000000n,cirbtc:100000000n},allowance:0n};
    const host={now:()=>state.clock,current:async()=>({wallet:{kind:"external",address:state.account,
      chainId:state.chainId,providerChainId:state.chainId,status:"connected",connectionStatus:"connected",isArc:true},
      snapshot:{connected:true,account:state.account,accountKind:"external",walletStatus:"connected",
      verifiedChainId:state.chainId,isArc:true,balances:state.balances,activity:[],activityLoadState:"loaded",
      activityPartial:false,activityUnavailable:false,vault:{available:false},safetyCapabilities:[],timestamp:state.clock}}),
      reads:{readBalance:async(_account,asset)=>state.balances[asset],readAllowance:async()=>state.allowance},
      quotes:{estimateSendMaximumFee:async()=>1000000000000n,readXyloOutput:async()=>({amountOut:10000000n,quotedAt:state.clock})}};
    const m=window.fixtureCMaterialize(window.fixtureCMaterializationInput).materialization;
    const root=m.actions.find(a=>a.dependsOnStepIds.length===0),dependent=m.actions.find(a=>a.dependsOnStepIds.length>0);
    const d=window.fixtureDCreate(host);
    const first=await d.orchestrate({materialization:m,retainedLiveInput:window.fixtureCMaterializationInput,
      actionStepId:root.actionStepId,slippage:0.01});
    const blocked=await d.orchestrate({materialization:m,retainedLiveInput:window.fixtureCMaterializationInput,
      actionStepId:dependent.actionStepId});
    const from={version:2,kind:"PLAN_READY",sessionId:m.sessionId,stateId:"g-plan",
      plan:{kind:"PLANNER_PLAN",id:m.planId}};
    const e=await window.fixtureEIntegrate({version:1,envelope:first.envelope,
      retainedLiveInput:window.fixtureCMaterializationInput,currentState:from});
    window.fixtureGChain={state,m,root,dependent,d,first,blocked,e,from};
    return {first:first.status,blocked:blocked.status,mapped:e.status,state:e.state?.status,
      action:e.sidecar?.actionStepId===root.actionStepId,goal:e.sidecar?.goalId===root.goalId,
      strategy:e.sidecar?.strategyId===m.strategyId,account:e.sidecar?.account===state.account.toLowerCase(),
      chain:e.sidecar?.chainId===state.chainId,quote:e.sidecar?.quoteDigest===first.envelope?.quote?.digest,
      prep:e.sidecar?.preparationDigest===first.envelope?.prepared?.digest,
      policy:e.sidecar?.policyDigest===first.envelope?.policy?.digest};
  })()`);
  check("multi ACTION root D/E result", [multi.first,multi.blocked,multi.mapped,multi.state],
    ["REVIEW_REQUIRED","DEPENDENCY_BLOCKED","MAPPED","PREPARED"]);
  check("whole chain identity continuity", [multi.action,multi.goal,multi.strategy,multi.account,multi.chain,multi.quote,multi.prep,multi.policy],
    Array(8).fill(true));
  check("root E Review currently eligible", await evaluate("window.fixtureEReview(window.fixtureGChain.e)"), {eligible:true});
  check("dependent ACTION cannot borrow root preparation", evaluate("window.fixtureGChain.blocked.envelope?.prepared ?? null"), null);
  const superseded = await evaluate(`(async()=>{
    const g=window.fixtureGChain;
    g.state.balances.usdc=0n;
    const newer=await g.d.orchestrate({materialization:g.m,retainedLiveInput:window.fixtureCMaterializationInput,
      actionStepId:g.root.actionStepId,slippage:0.01});
    return {status:newer.status,old:await window.fixtureEReview(g.e)};
  })()`);
  check("newer D supersedes old E Review", superseded.old.eligible, false);
  check("newer policy cannot turn old PREPARED into completion", evaluate("window.fixtureGChain.e.state.status"), "PREPARED");

  mount("planner-send");
  check("B2 initially separate from Review", review(), null);
  confirm();
  command("wait", "--fn", `!!document.querySelector('[aria-label="Agent preparation"] button.plannerConfirmButton')`);
  check("B2 does not imply transaction Review", review(), null);
  check("D reads acquired", evaluate("window.fixtureFState.readCalls > 0"), true);
  check("D quote acquired", evaluate("window.fixtureFState.quoteCalls > 0"), true);
  openReview();
  assert.match(review(), /SEND/); checks.push("SEND A–F Review presentation");
  check("Review has no execution callback", evaluate(`document.querySelectorAll('[aria-label="Prepared transaction review"] button').length`), 0);
  check("duplicate Review click unavailable", reviewButton(), false);
  check("no attempt/hash/receipt in Review", evaluate(`/transaction hash|receipt|attempt id|submit transaction/i.test(document.querySelector('[aria-label="Prepared transaction review"]').innerText)`), false);
  check("Review control is single use", evaluate(`document.querySelector('[aria-label="Agent preparation"] button.plannerConfirmButton') === null`), true);
  command("set", "viewport", "390", "844");
  check("mobile Review has no horizontal overflow", evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
  check("Review accessibility", command("a11y", "--selector", "main").counts.violations, 0);
  command("set", "viewport", "1440", "900");

  mount("planner-send"); confirm();
  command("wait", "--fn", `!!document.querySelector('[aria-label="Agent preparation"] button.plannerConfirmButton')`);
  evaluate("window.fixtureFState.clock+=1000000");
  command("click", "[aria-label='Agent preparation'] button.plannerConfirmButton");
  command("wait", "--fn", `document.querySelector('[aria-label="Agent preparation"] [role="status"]')?.innerText.includes('no longer current')`);
  check("expired quote/preparation cannot open Review", review(), null);

  mount("planner-send"); confirm();
  command("wait", "--fn", `!!document.querySelector('[aria-label="Agent preparation"] button.plannerConfirmButton')`);
  evaluate("window.fixtureFSwitchChain(84532)");
  check("chain change revokes Review control", reviewButton(), false);
  mount("planner-send"); confirm();
  command("wait", "--fn", `!!document.querySelector('[aria-label="Agent preparation"] button.plannerConfirmButton')`);
  openReview();
  evaluate("window.fixtureFSwitchAccount('0x3333333333333333333333333333333333333333')");
  command("wait", "--fn", `!document.querySelector('[aria-label="Prepared transaction review"]')`);
  check("account switch closes Review", review(), null);

  mount("planner-swap"); confirm();
  command("wait", "--fn", `!!document.querySelector('[aria-label="Agent preparation"] button.plannerConfirmButton')`);
  openReview();
  assert.match(review(), /finite-approval/); checks.push("Xylo finite approval distinct from swap");
  assert.match(review(), /Gas fee not estimated/); checks.push("unknown swap gas remains unknown");
  check("Xylo has no auto approval", evaluate(`document.querySelectorAll('[aria-label="Prepared transaction review"] button').length`), 0);

  for (const scenario of ["planner-bridge", "planner-dynamic"]) {
    mount(scenario);
    if (scenario === "planner-bridge") {
      confirm();
      command("wait", "--fn", `document.querySelector('[aria-label="Agent preparation"] [role="status"]')?.innerText.includes('unsupported')`);
    }
    check(`${scenario} cannot open Review`, review(), null);
  }
  mount("planner-spoof");
  check("mixed legacy draft/proposal has no B2 control", evaluate(`!!document.querySelector('[data-operation-mode="planner-proposal"] button')`), false);
  check("mixed legacy draft/proposal has no action control", evaluate(`document.querySelectorAll('[data-operation-mode="action"] button').length`), 0);
  mount("planner-missing-source");
  check("missing B1 host source has no B2 control", evaluate(`!!document.querySelector('[data-operation-mode="planner-proposal"] button')`), false);
  mount("planner-send", "vi");
  check("Vietnamese B2 shown", evaluate(`!!document.querySelector('[data-operation-mode="planner-proposal"] button')`), true);
  console.log(`AEI-G deterministic browser ${checks.length}/${checks.length} PASS`);
} finally { try { command("close"); } catch { /* preserve primary failure */ } }
