import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { root, fixtureSource, wallet, arc } from "./phase7h-receipt-fixture.mjs";

const require = createRequire(import.meta.url);
const output = path.resolve(process.env.PHASE7H_OUTPUT ?? path.join(tmpdir(), "makoto-phase7h-receipt-qa"));
assert.ok(!output.startsWith(path.resolve(root, "..") + path.sep), "Artifacts must be outside worktree");
mkdirSync(output, { recursive: true });
const port = Number(process.env.PHASE7H_PORT ?? 3191);
const base = `http://127.0.0.1:${port}`;

if (process.argv.includes("--serve")) {
  writeFileSync(path.join(output, "ReceiptFixture.tsx"), fixtureSource);
  writeFileSync(path.join(output, "entry.tsx"), `import * as React from "react"; import {createRoot} from "react-dom/client"; import {Fixture} from "./ReceiptFixture"; const root=createRoot(document.querySelector('#fixture')); let revision=0; function Mounted({options,version}){React.useEffect(()=>{window.fixtureVersion=version;},[version]);return <Fixture options={options}/>;} window.mountReceipt=(o={})=>{window.__fixtureLocale=o.locale??'en';const version=++revision;root.render(<Mounted key={version} options={o} version={version}/>);return version;}; window.mountReceipt();`);
  writeFileSync(path.join(output, "wagmiMock.ts"), `export const usePublicClient=()=>globalThis.__fixtureClient;`);
  writeFileSync(path.join(output, "preferencesMock.ts"), `export const usePreferences=()=>({locale:globalThis.__fixtureLocale??'en',t:(key)=>key==='common.close'?'Close':key});`);
  writeFileSync(path.join(output, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=function(source){if(this.resourcePath.endsWith('.css'))return '';return ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;};`);
  const { webpack } = require("next/dist/compiled/webpack/webpack");
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: "development", devtool: false, entry: path.join(output, "entry.tsx"), output: { path: output, filename: "fixture.js" }, resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(root, "node_modules")], alias: { "@": root } }, module: { rules: [{ test: /\.(tsx?|css)$/, exclude: /node_modules/, use: path.join(output, "loader.cjs") }] }, plugins: [new webpack.DefinePlugin({ "process.env": "({})" }), new webpack.NormalModuleReplacementPlugin(/^wagmi$/, (resource) => { resource.request = path.join(output, "wagmiMock.ts"); }), new webpack.NormalModuleReplacementPlugin(/^@\/hooks\/usePreferences$/, (resource) => { resource.request = path.join(output, "preferencesMock.ts"); })] });
    compiler.run((error, stats) => { compiler.close(() => {}); if (error || stats.hasErrors()) reject(error ?? new Error(stats.toString({ all: false, errors: true }))); else resolve(); });
  });
  const css = readFileSync(path.join(root, "app/ledger-calm.css"), "utf8") + readFileSync(path.join(root, "app/globals.css"), "utf8");
  createServer((req, res) => { res.setHeader("Content-Type", req.url === "/fixture.js" ? "text/javascript" : "text/html; charset=utf-8"); res.end(req.url === "/fixture.js" ? readFileSync(path.join(output, "fixture.js")) : `<!doctype html><html lang="en" data-theme="light"><head><title>Phase 7H synthetic receipt</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0;background:var(--lc-canvas);font-family:Arial,sans-serif}</style></head><body><div id="fixture"></div><script src="/fixture.js"></script></body></html>`); }).listen(port, "127.0.0.1", () => console.log(`Fixture ready ${base}`));
} else if (process.argv.includes("--qa")) {
  const binary = process.env.AGENT_BROWSER_BINARY ?? (process.platform === "win32" ? path.join(process.env.APPDATA, "npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe") : "agent-browser");
  const session = "makoto-phase7h-receipt";
  function execute(args, input) { const file = path.join(output, "command.json"); const fd = openSync(file, "w"); try { execFileSync(binary, ["--session", session, "--json", ...args], { input, timeout: 45_000, windowsHide: true, stdio: [input === undefined ? "ignore" : "pipe", fd, "inherit"] }); } finally { closeSync(fd); } const result = JSON.parse(readFileSync(file, "utf8")); assert.equal(result.success, true, result.error); return result.data; }
  const run = (...args) => execute(args);
  const evaluate = (code) => execute(["eval", "--stdin"], code).result;
  const checks = [];
  function check(name, fn) { try { fn(); checks.push({ name, pass: true }); console.log(`PASS ${name}`); } catch (error) { checks.push({ name, pass: false, error: error.message }); console.log(`FAIL ${name}: ${error.message}`); } }
  function mount(options) { evaluate("window.__sharedPayload=null"); const version = evaluate(`window.mountReceipt(${JSON.stringify(options)})`); run("wait", "--fn", `window.fixtureVersion===${version}`); if (options.scenario !== "not-submitted" && options.scenario !== "result-unknown") run("wait", "--fn", "!!document.querySelector('[data-receipt-status]')"); }
  try {
    run("open", base); run("wait", "--fn", "!!window.fixtureVersion");
    evaluate(`Object.defineProperty(navigator,'share',{value:async(payload)=>{window.__sharedPayload=payload},configurable:true});Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{}},configurable:true});true`);
    const scenarios = ["not-submitted", "result-unknown", "confirmed", "failed", "unknown", "unavailable", "swap-success", "swap-unknown"];
    for (const width of [390, 900, 1440]) for (const locale of ["en", "vi"]) for (const theme of ["light", "dark"]) {
      run("set", "viewport", String(width), width === 390 ? "844" : "1000");
      evaluate(`document.documentElement.lang=${JSON.stringify(locale)};document.documentElement.dataset.theme=${JSON.stringify(theme)};document.documentElement.style.colorScheme=${JSON.stringify(theme)};true`);
      for (const scenario of scenarios) {
        mount({ scenario, locale });
        const label = `${scenario} ${width}-${locale}-${theme}`;
        const value = evaluate(`(()=>{const root=document.querySelector('#fixture');const status=root?.querySelector('[data-receipt-status]')?.dataset.receiptStatus;return {status,text:root?.innerText??'',buttons:[...root.querySelectorAll('button')].map((button)=>({text:button.innerText,disabled:button.disabled})),page:document.documentElement.scrollWidth,width:innerWidth,overflow:[...root.querySelectorAll('*')].filter(e=>e.getClientRects().length&&e.scrollWidth>e.clientWidth+1&&getComputedStyle(e).display!=='inline').map(e=>e.className)}})()`);
        check(`status semantics ${label}`, () => {
          assert.equal(value.status, scenario === "not-submitted" ? "not-submitted" : scenario === "result-unknown" || scenario === "unknown" || scenario === "swap-unknown" || scenario === "unavailable" ? "submitted-unknown" : scenario === "failed" ? "confirmed-failure" : "confirmed-success");
          if (scenario === "not-submitted") assert.doesNotMatch(value.text, /Submitted|Confirmed/);
          if (scenario === "result-unknown") { assert.match(value.text, locale === "vi" ? /chưa xác định|không rõ/i : /unknown/i); assert.doesNotMatch(value.text, /confirmed/i); }
          if (scenario === "confirmed" || scenario === "swap-success") assert.match(value.text, locale === "vi" ? /Đã xác nhận/ : /Confirmed/);
          if (scenario === "failed") { assert.match(value.text, locale === "vi" ? /thất bại/ : /failure|failed/i); assert.doesNotMatch(value.text, /Verified on Arc/); }
          if (["unknown", "swap-unknown", "unavailable"].includes(scenario)) { assert.doesNotMatch(value.text, locale === "vi" ? /Đã xác nhận/ : /Confirmed/); }
          if (scenario === "swap-success") assert.match(value.text, /4\.99 EURC/);
          if (scenario === "swap-unknown") assert.doesNotMatch(value.text, /4\.99 EURC/);
        });
        if (!["not-submitted", "result-unknown"].includes(scenario)) check(`export controls ${label}`, () => {
          const copy = value.buttons.find((button) => /copy|sao chép/i.test(button.text));
          assert.ok(copy);
          assert.equal(copy.disabled, scenario === "unavailable");
          const share = value.buttons.find((button) => /share|chia sẻ/i.test(button.text));
          assert.ok(share);
          assert.equal(share.disabled, scenario === "unavailable");
        });
        if (["confirmed", "failed", "unknown", "swap-success", "swap-unknown"].includes(scenario)) check(`share payload ${label}`, () => {
          evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find((item)=>/share|chia sẻ/i.test(item.innerText));button?.click();return true})()`);
          const payload = evaluate("window.__sharedPayload");
          assert.ok(payload?.text);
          if (scenario === "confirmed" || scenario === "swap-success") assert.match(payload.text, locale === "vi" ? /Trạng thái: Đã xác nhận/ : /Status: Confirmed/);
          if (scenario === "failed") assert.match(payload.text, locale === "vi" ? /Trạng thái: Xác nhận thất bại/ : /Status: Confirmed failure/);
          if (["unknown", "swap-unknown"].includes(scenario)) { assert.match(payload.text, locale === "vi" ? /Đã gửi/ : /Submitted — confirmation status unknown/); assert.doesNotMatch(payload.text, /Status: Confirmed(?:\n|$)/); }
          if (scenario === "swap-unknown") assert.doesNotMatch(payload.text, /4\.99 EURC/);
        });
        check(`responsive ${label}`, () => { assert.ok(value.page <= value.width, JSON.stringify(value)); assert.deepEqual(value.overflow, []); });
        if (!["not-submitted", "result-unknown"].includes(scenario)) check(`accessibility ${label}`, () => { const result = run("a11y", "--selector", ".receipt-card"); assert.equal(result.counts.violations, 0, JSON.stringify(result.violations)); });
        if ((scenario === "confirmed" || scenario === "unknown" || scenario === "failed") && width !== 900 && locale === "en" && theme === "light") run("screenshot", path.join(output, `${scenario}-${width}.png`), "--full");
      }
    }
  } finally { writeFileSync(path.join(output, "results.json"), JSON.stringify(checks, null, 2)); run("close"); }
  console.log(`Browser QA ${checks.filter((entry) => entry.pass).length}/${checks.length}; ${output}`); if (checks.some((entry) => !entry.pass)) process.exitCode = 1;
} else console.log("Use --serve or --qa");
