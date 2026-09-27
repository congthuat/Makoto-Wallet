import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { openSync, closeSync, readFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

// Run against phase7g-workspace-browser.mjs --serve. All providers are local fixture functions.
const binary = process.env.AGENT_BROWSER_BINARY ?? path.join(process.env.APPDATA, "npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe");
const session = "makoto-aei-f-production-qa";
const port = Number(process.env.PHASE7G_PORT ?? 3187);
const checks = [];
function command(...args) {
  const file = path.join(tmpdir(), "makoto-aei-f-command.json");
  const fd = openSync(file, "w");
  try { execFileSync(binary, ["--session", session, "--json", ...args], { stdio: ["ignore", fd, "inherit"], timeout: 60_000, windowsHide: true }); }
  finally { closeSync(fd); }
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(parsed.success, true, parsed.error);
  return parsed.data;
}
const evaluate = (code) => command("eval", code).result;
function check(name, actual, expected) { assert.deepEqual(actual, expected, name); checks.push(name); }
function mount(scenario) {
  const version = evaluate(`window.mountWorkspace({scenario:${JSON.stringify(scenario)},locale:"en",production:true})`);
  command("wait", "--fn", `window.fixtureVersion===${version}`);
}
function stage() { return evaluate(`document.querySelector('[aria-label="Agent preparation"] [role="status"]')?.innerText`); }
function review() { return evaluate(`document.querySelector('[aria-label="Prepared transaction review"]')?.innerText ?? null`); }
function confirm() { command("click", "[data-operation-mode='planner-proposal'] button"); command("wait", "--fn", `!!document.querySelector('[aria-label="Agent preparation"]')`); }
function openReview() { command("click", "[aria-label='Agent preparation'] button.plannerConfirmButton"); command("wait", "--fn", `!!document.querySelector('[aria-label="Prepared transaction review"]')`); }

try {
  command("open", `http://127.0.0.1:${port}`);
  command("wait", "--fn", "!!window.fixtureVersion");
  mount("planner-send");
  check("B2 initially offered for originating account", evaluate(`!!document.querySelector('[data-operation-mode="planner-proposal"] button.plannerConfirmButton')`), true);
  evaluate(`window.fixtureFSwitchAccount('0x3333333333333333333333333333333333333333')`);
  check("account switch before B2 revokes old proposal", evaluate(`!!document.querySelector('[data-operation-mode="planner-proposal"] button.plannerConfirmButton')`), false);
  mount("planner-send");
  evaluate(`window.fixtureFSwitchChain(84532)`);
  check("chain switch before B2 revokes old proposal", evaluate(`!!document.querySelector('[data-operation-mode="planner-proposal"] button.plannerConfirmButton')`), false);
  mount("planner-send"); confirm();
  command("wait", "--fn", `!!document.querySelector('[aria-label="Agent preparation"] button.plannerConfirmButton')`);
  check("SEND preparation reaches Review gate", stage(), "Prepared details are available for Review");
  check("B2 click did not open Review", review(), null);
  openReview();
  assert.match(review(), /SEND · send/); checks.push("SEND exact technical action");
  assert.match(review(), /10 EURC/); checks.push("SEND amount and asset");
  assert.match(review(), /0x2222222222222222222222222222222222222222/); checks.push("SEND recipient");
  assert.match(review(), /No transaction has been submitted/); checks.push("SEND inert Review");
  check("no final wallet callback", evaluate(`document.querySelectorAll('[aria-label="Prepared transaction review"] button').length`), 0);
  command("set", "viewport", "390", "844");
  check("SEND mobile has no horizontal overflow", evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
  check("SEND Review accessibility", command("a11y", "--selector", "main").counts.violations, 0);
  command("set", "viewport", "1440", "900");
  const sendRead = evaluate(`window.fixtureFState.readCalls`);
  assert.ok(sendRead > 0); checks.push("canonical D read service used");

  mount("planner-swap"); confirm();
  command("wait", "--fn", `!!document.querySelector('[aria-label="Agent preparation"] button.plannerConfirmButton')`);
  openReview();
  assert.match(review(), /SWAP · finite-approval/); checks.push("SWAP approval is first technical step");
  assert.match(review(), /Gas fee not estimated/); checks.push("SWAP gas remains unknown");
  check("approval has no execution control", evaluate(`document.querySelectorAll('[aria-label="Prepared transaction review"] button').length`), 0);

  mount("planner-bridge"); confirm();
  command("wait", "--fn", `document.querySelector('[aria-label="Agent preparation"] [role="status"]')?.innerText.includes('unsupported')`);
  assert.match(stage(), /unsupported|unavailable/); checks.push("Direct CCTP stops before Review");
  check("bridge has no Review", review(), null);

  mount("planner-send"); confirm();
  command("wait", "--fn", `!!document.querySelector('[aria-label="Agent preparation"] button.plannerConfirmButton')`);
  openReview();
  evaluate(`window.fixtureFState.account='0x3333333333333333333333333333333333333333'`);
  command("wait", "--fn", `!document.querySelector('[aria-label="Prepared transaction review"]')`);
  assert.match(stage(), /no longer current/); checks.push("account switch invalidates open Review");

  mount("planner-send"); confirm();
  command("wait", "--fn", `!!document.querySelector('[aria-label="Agent preparation"] button.plannerConfirmButton')`);
  openReview();
  evaluate(`window.fixtureFState.clock+=1000000`);
  command("wait", "--fn", `!document.querySelector('[aria-label="Prepared transaction review"]')`);
  assert.match(stage(), /no longer current/); checks.push("expiry invalidates open Review");

  mount("planner-send"); confirm();
  command("wait", "--fn", `!!document.querySelector('[aria-label="Agent preparation"] button.plannerConfirmButton')`);
  openReview();
  mount("planner-swap");
  check("remount discards Review", review(), null);
  check("remount requires B2 again", evaluate(`!!document.querySelector('[data-operation-mode="planner-proposal"] button')`), true);
  mount("planner-send"); confirm();
  command("click", "[aria-label='Agent preparation'] button:not(.plannerConfirmButton)");
  check("cancel closes Review", review(), null);
  assert.match(stage(), /cancelled/); checks.push("cancelled flow cannot reopen Review");

  mount("planner-send");
  evaluate(`(()=>{window.fixtureFState.readGate=new Promise(resolve=>window.fixtureFRelease=resolve);return true})()`);
  confirm();
  assert.match(stage(), /Preparing transaction details/); checks.push("D pending stage visible");
  command("click", "[aria-label='Agent preparation'] button:not(.plannerConfirmButton)");
  evaluate(`window.fixtureFRelease()`);
  evaluate(`new Promise(resolve=>setTimeout(()=>resolve(true),100))`);
  assert.match(stage(), /cancelled/); checks.push("late D result discarded after cancel");
  check("late D has no Review button", evaluate(`!!document.querySelector('[aria-label="Agent preparation"] button.plannerConfirmButton')`), false);

  mount("planner-send");
  evaluate(`(()=>{window.fixtureFState.readGate=new Promise(resolve=>window.fixtureFRelease=resolve);return true})()`);
  confirm();
  evaluate(`window.fixtureFState.account='0x3333333333333333333333333333333333333333';window.fixtureFRelease()`);
  command("wait", "--fn", `!document.querySelector('[aria-label="Agent preparation"] [role="status"]')?.innerText.includes('Preparing')`);
  check("account switch during D has no Review", evaluate(`!!document.querySelector('[aria-label="Agent preparation"] button.plannerConfirmButton')`), false);
  console.log(`AEI-F deterministic browser ${checks.length}/${checks.length} PASS`);
} finally { try { command("close"); } catch { /* closing is best effort */ } }
