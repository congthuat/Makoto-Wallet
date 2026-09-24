// Transaction-free policy notice checks against the existing isolated production JSX fixtures.
// Start phase7e-browser.mjs --serve and phase7f-browser.mjs --serve before running this script.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { openSync, closeSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const binary = process.env.AGENT_BROWSER_BINARY ?? (process.platform === "win32" ? path.join(process.env.APPDATA, "npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe") : "agent-browser");
const responseFile = path.join(tmpdir(), "makoto-phase9g-policy-browser.json");
const session = "makoto-phase9g-policy";
function command(args, input) {
  const fd = openSync(responseFile, "w");
  try { execFileSync(binary, ["--session", session, "--json", ...args], { input, timeout: 45000, windowsHide: true, stdio: [input === undefined ? "ignore" : "pipe", fd, "inherit"] }); }
  finally { closeSync(fd); }
  const result = JSON.parse(readFileSync(responseFile, "utf8"));
  assert.equal(result.success, true, result.error);
  return result.data;
}
const run = (...args) => command(args);
const evaluate = (code) => command(["eval", "--stdin"], code).result;
let checks = 0, audits = 0;
try {
  for (const [port, kind, options] of [[3179, "send", { reviewing: true }], [3180, "swap", { state: "review" }]]) {
    run("open", `http://127.0.0.1:${port}`);
    run("wait", "--fn", "!!window.mountFixture && document.fonts.status === 'loaded'");
    for (const width of [390, 900, 1440]) for (const locale of ["en", "vi"]) for (const theme of ["light", "dark"]) for (const decision of ["BLOCK", "REQUOTE", "REVALIDATE"]) {
      run("set", "viewport", String(width), width === 390 ? "844" : "1000");
      const policyResult = { decision, findings: [{ decision, code: decision === "BLOCK" ? "SIMULATION_FAILED" : decision === "REQUOTE" ? "EXPIRED_QUOTE" : "FEE_UNAVAILABLE", evidence: "test.evidence" }], requiredAction: decision === "BLOCK" ? "STOP" : decision, mustStop: true, requiresUserReview: false, requiresFreshQuote: decision === "REQUOTE", requiresRevalidation: decision === "REVALIDATE" };
      const version = evaluate(`document.documentElement.lang=${JSON.stringify(locale)};document.documentElement.dataset.theme=${JSON.stringify(theme)};window.mountFixture(${JSON.stringify(kind)},${JSON.stringify({ ...options, policyResult })})`);
      run("wait", "--fn", `window.fixtureVersion===${version} && !!document.querySelector('[data-policy-decision="${decision}"]')`);
      const state = evaluate(`(()=>{const notice=document.querySelector('[data-policy-decision]'),button=document.querySelector('.primary-action'),dialog=document.querySelector('[role=dialog]');return {decision:notice.dataset.policyDecision,role:notice.getAttribute('role'),text:notice.textContent.trim(),disabled:button.disabled,overflow:document.documentElement.scrollWidth>innerWidth||dialog.scrollWidth>dialog.clientWidth+1}})()`);
      assert.equal(state.decision, decision);
      assert.equal(state.role, "alert");
      assert.ok(state.text.length > 20);
      assert.equal(state.disabled, true);
      assert.equal(state.overflow, false);
      checks++;
      if (width === 390 && theme === "light") {
        const audit = run("a11y", "--selector", "[role=dialog]");
        assert.equal(audit.counts.violations, 0, JSON.stringify(audit.violations));
        audits++;
      }
    }
  }
  console.log(`Policy browser states ${checks}/72 PASS; axe dialogs ${audits}/12 PASS (0 violations)`);
} finally { run("close"); }
