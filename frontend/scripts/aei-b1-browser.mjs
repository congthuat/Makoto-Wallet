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
  command("click", "button");
  const evidence = evaluate(`(()=>{const x=window.fixtureB2;return {valid:x.valid,copyValid:x.copyValid,live:x.live,status:x.result?.value?.status,count:x.result?.value?.evidence?.length,proposalIds:x.result?.value?.evidence?.map(e=>e.proposalId),executionEnabled:x.compiled?.executionEnabled,compiled:x.compiled?.status,bindingDigest:x.compiled?.binding?.parameterEvidenceDigest,evidenceDigest:x.result?.value?.evidenceDigest}})()`);
  assert.equal(evidence.valid, true); assert.equal(evidence.copyValid, false); assert.equal(evidence.live, true);
  assert.equal(evidence.status, "RESOLVED_WITH_EVIDENCE"); assert.equal(evidence.count, 4);
  assert.deepEqual(evidence.proposalIds, Array(4).fill("fixture-b2-proposal"));
  assert.equal(evidence.compiled, "COMPILED"); assert.equal(evidence.executionEnabled, false);
  assert.equal(evidence.bindingDigest, evidence.evidenceDigest);
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
  console.log("AEI-B2 live evidence, AEI-B skeleton, AEI-A v2 digest and revocation PASS");
} finally { try { command("close"); } catch { /* preserve primary failure */ } }
