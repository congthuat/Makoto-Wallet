import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { openSync, closeSync, readFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

// Run with phase7g-workspace-browser.mjs --serve; it mounts the production AgentWorkspace.
const binary = process.env.AGENT_BROWSER_BINARY ?? path.join(process.env.APPDATA, "npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe");
const session = "makoto-aei-b1-proposal";
function command(...args) {
  const file = path.join(tmpdir(), "makoto-aei-b1-browser-command.json");
  const fd = openSync(file, "w");
  try { execFileSync(binary, ["--session", session, "--json", ...args], { stdio: ["ignore", fd, "inherit"], timeout: 45_000, windowsHide: true }); }
  finally { closeSync(fd); }
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(parsed.success, true, parsed.error);
  return parsed.data;
}
const evaluate = (code) => command("eval", code).result;
try {
  command("open", "http://127.0.0.1:3187");
  command("wait", "--fn", "!!window.fixtureVersion");
  for (const [locale, width] of [["en", 1440], ["vi", 390]]) {
    command("set", "viewport", String(width), width === 390 ? "844" : "900");
    const version = evaluate(`window.mountWorkspace({scenario:"planner-proposal",locale:${JSON.stringify(locale)}})`);
    command("wait", "--fn", `window.fixtureVersion===${version}`);
    const state = evaluate(`(()=>({mode:document.querySelector('[data-operation-mode]')?.dataset.operationMode,text:document.querySelector('main')?.innerText,buttons:[...document.querySelectorAll('[data-operation-mode] button')].map(b=>b.innerText),viewport:innerWidth,page:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('main *')].filter(e=>!e.classList.contains('srOnly')&&e.getClientRects().length&&e.scrollWidth>e.clientWidth+1&&getComputedStyle(e).display!=='inline').map(e=>e.className),handoff:window.fixturePushed}))()`);
    assert.equal(state.mode, "planner-proposal");
    assert.match(state.text, locale === "en" ? /Planner proposal|Review parameters/ : /Đề xuất kế hoạch|Xem lại thông số/);
    assert.match(state.text, /swap|SWAP/); assert.match(state.text, /send|SEND/);
    assert.match(state.text, /10/); assert.match(state.text, /5/); assert.match(state.text, /0x2222222222222222222222222222222222222222/);
    assert.match(state.text, locale === "en" ? /Unverified candidate|cannot be executed/ : /chưa xác minh|chưa thể thực thi/);
    assert.deepEqual(state.buttons, [locale === "en" ? "Confirm parameters" : "Xác nhận thông số"]); assert.equal(state.handoff, "");
    assert.ok(state.page <= state.viewport, JSON.stringify(state)); assert.deepEqual(state.overflow, []);
    assert.doesNotMatch(state.text, /agent\.planner\.|FIXED_USER_INPUT|Ready to send|Transaction prepared/);
    command("focus", "[data-operation-mode] button"); command("press", "Enter");
    const confirmed = evaluate(`(()=>({text:document.querySelector('[data-operation-mode]')?.innerText,buttons:[...document.querySelectorAll('[data-operation-mode] button')].map(b=>b.innerText),handoff:window.fixturePushed}))()`);
    assert.match(confirmed.text, locale === "en" ? /Parameters confirmed/ : /Đã xác nhận thông số/);
    assert.deepEqual(confirmed.buttons, []); assert.equal(confirmed.handoff, "");
    assert.doesNotMatch(confirmed.text, /agent\.planner\.|FIXED_USER_INPUT|Transaction prepared|Ready to execute/);
    const audit = command("a11y", "--selector", "main");
    assert.equal(audit.counts.violations, 0, JSON.stringify(audit.violations));
    command("screenshot", path.join(tmpdir(), `makoto-aei-b1-${locale}-${width}.png`));
    console.log(`AEI-B1 browser ${locale} ${width}px PASS`);
  }
  for (const [scenario, expected] of [["planner-send", ["10", "0x2222222222222222222222222222222222222222", "5042002"]],
    ["planner-swap", ["usdc", "eurc", "10", "5042002"]],
    ["planner-bridge", ["usdc", "5", "5042002", "84532", "0x2222222222222222222222222222222222222222"]],
    ["planner-dynamic", ["Dynamic amount", "Previous output"]]]) {
    const version = evaluate(`window.mountWorkspace({scenario:${JSON.stringify(scenario)},locale:"en"})`);
    command("wait", "--fn", `window.fixtureVersion===${version}`);
    const before = evaluate(`(()=>({text:document.querySelector('[data-operation-mode]')?.innerText,buttons:[...document.querySelectorAll('[data-operation-mode] button')].map(b=>b.innerText)}))()`);
    for (const value of expected) assert.ok(before.text.includes(value), `${scenario}: ${value}`);
    assert.equal(before.buttons.length, scenario === "planner-dynamic" ? 0 : 1);
    if (before.buttons.length) {
      command("click", "[data-operation-mode] button");
      const after = evaluate(`document.querySelector('[data-operation-mode]')?.innerText`);
      assert.match(after, /Parameters confirmed/);
      assert.equal(evaluate(`window.fixturePushed`), "");
    }
    console.log(`AEI-B2 browser ${scenario} PASS`);
  }
  const replacementVersion = evaluate(`window.mountWorkspace({scenario:"planner-send",locale:"en"})`);
  command("wait", "--fn", `window.fixtureVersion===${replacementVersion}`);
  command("click", "[data-operation-mode] button");
  assert.match(evaluate(`document.querySelector('[data-operation-mode]')?.innerText`), /Parameters confirmed/);
  console.log("AEI-B2 dynamic request replaced by fresh fixed proposal PASS");
  const b2Version = evaluate(`window.mountB2()`);
  command("wait", "--fn", `window.fixtureVersion===${b2Version}`);
  const attack = evaluate(`(()=>{const button=document.querySelector('button');const key=Object.keys(button).find(key=>key.startsWith('__reactProps'));const handler=button[key].onClick;const results=[];for(const event of [undefined,{}, {nativeEvent:{isTrusted:true},currentTarget:button},{nativeEvent:{isTrusted:false},currentTarget:button},{nativeEvent:Object.assign(Object.create(MouseEvent.prototype),{isTrusted:true}),currentTarget:button}]){try{handler(event)}catch{}results.push(!!window.fixtureB2)}button.click();results.push(!!window.fixtureB2);button.dispatchEvent(new MouseEvent('click',{bubbles:true}));results.push(!!window.fixtureB2);window.fixtureB2Handler=handler;document.querySelector('#fixture').addEventListener('click',event=>{window.fixtureB2TrustedEvent=event;handler({nativeEvent:event,currentTarget:button});},{once:true});return results})()`);
  assert.deepEqual(attack, Array(7).fill(false), "direct, fabricated and synthetic event attacks must fail");
  command("click", "button");
  const replay = evaluate(`(()=>{const button=document.querySelector('button');try{window.fixtureB2Handler({nativeEvent:window.fixtureB2TrustedEvent,currentTarget:button})}catch{}return {count:window.fixtureB2ConfirmCount,live:window.fixtureB2CheckLive()}})()`);
  assert.deepEqual(replay, { count: 1, live: true }, "rapid double dispatch and trusted-event replay must not create a second confirmation");
  const evidence = evaluate(`(()=>{const x=window.fixtureB2;return {valid:x.valid,copyValid:x.copyValid,live:x.live,status:x.result?.value?.status,count:x.result?.value?.evidence?.length,proposalIds:x.result?.value?.evidence?.map(e=>e.proposalId),executionEnabled:x.compiled?.executionEnabled,compiled:x.compiled?.status,bindingDigest:x.compiled?.binding?.parameterEvidenceDigest,evidenceDigest:x.result?.value?.evidenceDigest}})()`);
  assert.equal(evidence.valid, true); assert.equal(evidence.copyValid, false); assert.equal(evidence.live, true);
  assert.equal(evidence.status, "RESOLVED_WITH_EVIDENCE"); assert.equal(evidence.count, 4);
  assert.deepEqual(evidence.proposalIds, Array(4).fill("fixture-b2-proposal"));
  assert.equal(evidence.compiled, "COMPILED"); assert.equal(evidence.executionEnabled, false);
  assert.equal(evidence.bindingDigest, evidence.evidenceDigest);
  const evidenceAttacks = evaluate(`(()=>{const changes=[
    ["status",x=>x.status="UNVERIFIED"],["version",x=>x.version=1],["planId",x=>x.planId="other"],
    ["intentAmount",x=>x.intents[0].amount="11"],["intentRecipient",x=>x.intents[0].recipient="0x3333333333333333333333333333333333333333"],
    ["missing",x=>x.evidence.pop()],["duplicate",x=>x.evidence.push(x.evidence[0])],["reordered",x=>x.evidence.reverse()],
    ["unexpected",x=>x.evidence.push({...x.evidence[0],parameterKey:"extra"})],["setDigest",x=>x.evidenceDigest="0x"+"0".repeat(64)],
    ["value",x=>x.evidence[0].value="other"],["field",x=>x.evidence[0].parameterKey="other"],
    ["goal",x=>x.evidence[0].goalId="other"],["request",x=>x.evidence[0].requestId="other"],
    ["session",x=>x.evidence[0].sessionId="other"],["requestDigest",x=>x.evidence[0].requestDigest="0x"+"0".repeat(64)],
    ["plan",x=>x.evidence[0].planId="other"],["planDigest",x=>x.evidence[0].planDigest="0x"+"0".repeat(64)],
    ["proposal",x=>x.evidence[0].proposalId="other"],["proposalDigest",x=>x.evidence[0].proposalDigest="0x"+"0".repeat(64)],
    ["event",x=>x.evidence[0].source.eventId="other"],["eventDigest",x=>x.evidence[0].source.eventDigest="0x"+"0".repeat(64)],
    ["origin",x=>x.evidence[0].origin="UNVERIFIED_PROVIDER"],["itemDigest",x=>x.evidence[0].digest="0x"+"0".repeat(64)],
    ["extra",x=>x.evidence[0].extra=true],["symbol",x=>x.evidence[0][Symbol("hidden")]=true]
  ];return changes.map(([name,change])=>{const x=JSON.parse(JSON.stringify(window.fixtureB2.result.value));change(x);return [name,window.fixtureB2Validate(x)]})})()`);
  assert.equal(evidenceAttacks.length, 26);
  for (const [name, valid] of evidenceAttacks) assert.equal(valid, false, `serialized evidence attack ${name}`);
  const multiVersion = evaluate(`window.mountB2("multi")`);
  command("wait", "--fn", `window.fixtureVersion===${multiVersion}`);
  command("click", "button");
  const multi = evaluate(`(()=>{const x=window.fixtureB2;return {compiled:x.compiled?.status,enabled:x.compiled?.executionEnabled,fields:x.result?.value?.evidence?.map(e=>[e.goalId,e.parameterKey,e.value]),edges:x.source.plan.goals.map(g=>[g.id,g.dependsOn]),valid:x.valid}})()`);
  assert.equal(multi.compiled, "COMPILED"); assert.equal(multi.enabled, false); assert.equal(multi.valid, true);
  assert.deepEqual(multi.edges, [["send", ["swap"]], ["swap", []]]);
  assert.deepEqual(multi.fields.filter(([goal])=>goal==="swap").map(([,key])=>key).sort(), ["amount","chainId","fromAsset","toAsset"]);
  assert.deepEqual(multi.fields.filter(([goal])=>goal==="send").map(([,key])=>key).sort(), ["amount","asset","chainId","recipient"]);
  assert.equal(multi.fields.find(([goal,key])=>goal==="send"&&key==="amount")[2], "5");
  assert.equal(multi.fields.find(([goal,key])=>goal==="swap"&&key==="amount")[2], "10");
  assert.deepEqual(evaluate(`(()=>{window.fixtureB2.source.resolution.intents[1].amount="6";return {live:window.fixtureB2CheckLive(),valid:window.fixtureB2CheckValid()}})()`), {live:false,valid:false});
  for (const [name, mutation] of [["amount", "s.resolution.intents[0].amount='11'"],
    ["recipient", "s.resolution.intents[0].recipient='0x3333333333333333333333333333333333333333'"],
    ["asset", "s.resolution.intents[0].asset='usdc'"], ["chain", "s.resolution.intents[0].chainId=84532"],
    ["goal", "s.plan.goals[0].kind='SWAP'"], ["dependency", "s.plan.goals[0].dependsOn.push('other')"],
    ["plan", "s.plan.id='other'"], ["proposal", "s.structuredInput.proposalId='other'"],
    ["request", "s.request={text:'other',locale:'en'}"], ["session", "s.sessionId='other'"]]) {
    const version = evaluate(`window.mountB2()`); command("wait", "--fn", `window.fixtureVersion===${version}`);
    command("click", "button");
    const result = evaluate(`(()=>{const s=window.fixtureB2.source;${mutation};return {live:window.fixtureB2CheckLive(),valid:window.fixtureB2CheckValid()}})()`);
    assert.deepEqual(result, { live: false, valid: false }, name);
  }
  const freshVersion = evaluate(`window.mountB2()`); command("wait", "--fn", `window.fixtureVersion===${freshVersion}`);
  command("click", "button"); assert.equal(evaluate(`window.fixtureB2CheckLive()`), true);
  const revokedVersion = evaluate(`window.mountWorkspace({scenario:"empty"})`);
  command("wait", "--fn", `window.fixtureVersion===${revokedVersion}`);
  command("wait", "--fn", `window.fixtureB2CheckLive()===false`);
  for (const scenario of ["planner-spoof", "planner-missing-source", "ready"]) {
    const version = evaluate(`window.mountWorkspace({scenario:${JSON.stringify(scenario)},locale:"en"})`);
    command("wait", "--fn", `window.fixtureVersion===${version}`);
    const isolation = evaluate(`({b2Buttons:[...document.querySelectorAll('[data-operation-mode="planner-proposal"] button')].length,live:window.fixtureB2CheckLive(),mode:document.querySelector('[data-operation-mode]')?.dataset.operationMode})`);
    assert.equal(isolation.b2Buttons, 0, scenario);
    assert.equal(isolation.live, false, scenario);
    if (scenario === "ready") assert.equal(isolation.mode, "action");
  }
  command("open", "http://127.0.0.1:3187");
  command("wait", "--fn", "!!window.fixtureVersion");
  assert.equal(evaluate(`typeof window.fixtureB2CheckLive`), "undefined", "refresh must discard the old runtime capability");
  console.log("AEI-B2 live evidence, AEI-B skeleton, AEI-A v2 digest and revocation PASS");
} finally { try { command("close"); } catch { /* preserve primary failure */ } }
