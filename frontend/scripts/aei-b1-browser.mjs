import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";

// Run with phase7g-workspace-browser.mjs --serve; it mounts the production AgentWorkspace.
const binary = process.env.AGENT_BROWSER_BINARY ?? path.join(process.env.APPDATA, "npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe");
const session = "makoto-aei-b1-proposal";
function command(...args) {
  const output = execFileSync(binary, ["--session", session, "--json", ...args], { encoding: "utf8", timeout: 45_000, windowsHide: true });
  const parsed = JSON.parse(output);
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
    assert.deepEqual(state.buttons, []); assert.equal(state.handoff, "");
    assert.ok(state.page <= state.viewport, JSON.stringify(state)); assert.deepEqual(state.overflow, []);
    assert.doesNotMatch(state.text, /agent\.planner\.|FIXED_USER_INPUT|Ready to send|Confirm Parameters/);
    const audit = command("a11y", "--selector", "main");
    assert.equal(audit.counts.violations, 0, JSON.stringify(audit.violations));
    command("screenshot", path.join(tmpdir(), `makoto-aei-b1-${locale}-${width}.png`));
    console.log(`AEI-B1 browser ${locale} ${width}px PASS`);
  }
} finally { try { command("close"); } catch { /* preserve primary failure */ } }
