import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { root, fixtureSource, accountA, accountB, arc, otherChain } from "./phase7g1-agent-context-fixture.mjs";

const require = createRequire(import.meta.url);
const output = path.resolve(process.env.PHASE7G1_OUTPUT ?? path.join(tmpdir(), "makoto-phase7g1-qa"));
assert.ok(!output.startsWith(path.resolve(root, "..") + path.sep), "Artifacts must be outside worktree");
mkdirSync(output, { recursive: true });
const port = Number(process.env.PHASE7G1_PORT ?? 3181);
const base = `http://127.0.0.1:${port}`;

if (process.argv.includes("--serve")) {
  writeFileSync(path.join(output, "AgentDraftFixture.tsx"), fixtureSource);
  writeFileSync(path.join(output, "entry.tsx"), `import * as React from "react"; import {createRoot} from "react-dom/client"; import {ActionDraftCard} from "./AgentDraftFixture"; const root=createRoot(document.querySelector('#fixture')); let revision=0; window.mountDraft=(o={})=>{window.fixtureConnection={address:o.account??${JSON.stringify(accountA)}};window.fixtureChain=o.chain??${arc};window.fixturePushed='';window.fixtureOrigin=o.origin==='missing'?undefined:{account:o.originAccount??${JSON.stringify(accountA)},chainId:o.originChain??${arc}};const version=++revision;root.render(<ActionDraftCard key={version} draft={{version:1,mode:'prepare-only',rawUserText:'send 5 USDC',executionEnabled:false,kind:'send',asset:'USDC',amount:'5',recipient:${JSON.stringify(accountB)},sourceChain:'Arc Testnet'}} draftContext={window.fixtureOrigin} vi={o.locale==='vi'}/>);return version;}; window.mountDraft();`);
  writeFileSync(path.join(output, "wagmiMock.ts"), `export const useConnection=()=>window.fixtureConnection;`);
  writeFileSync(path.join(output, "navigationMock.ts"), `export const useRouter=()=>({push:(url)=>{window.fixturePushed=url;}}); export const useSearchParams=()=>new URLSearchParams(window.location.search);`);
  writeFileSync(path.join(output, "chainMock.ts"), `export const useVerifiedWalletChain=()=>({providerChainId:window.fixtureChain});`);
  writeFileSync(path.join(output, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=function(source){if(this.resourcePath.endsWith('.css'))return '';return ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;};`);
  const { webpack } = require("next/dist/compiled/webpack/webpack");
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: "development", devtool: false, entry: path.join(output, "entry.tsx"), output: { path: output, filename: "fixture.js" }, resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(root, "node_modules")], alias: { "@": root } }, module: { rules: [{ test: /\.(tsx?|css)$/, exclude: /node_modules/, use: path.join(output, "loader.cjs") }] }, plugins: [new webpack.DefinePlugin({ "process.env": "({})" }), new webpack.NormalModuleReplacementPlugin(/^wagmi$/, (resource) => { resource.request = path.join(output, "wagmiMock.ts"); }), new webpack.NormalModuleReplacementPlugin(/^next\/navigation$/, (resource) => { resource.request = path.join(output, "navigationMock.ts"); }), new webpack.NormalModuleReplacementPlugin(/^@\/hooks\/useVerifiedWalletChain$/, (resource) => { resource.request = path.join(output, "chainMock.ts"); })] });
    compiler.run((error, stats) => { compiler.close(() => {}); if (error || stats.hasErrors()) reject(error ?? new Error(stats.toString({ all: false, errors: true }))); else resolve(); });
  });
  const cssFiles = readdirSync(path.join(root, ".next/static/chunks")).filter((file) => file.endsWith(".css"));
  const css = cssFiles.map((file) => readFileSync(path.join(root, ".next/static/chunks", file), "utf8")).join("\n") + readFileSync(path.join(root, "app/ledger-calm.css"), "utf8") + readFileSync(path.join(root, "components/MakotoAgentPage.module.css"), "utf8");
  createServer((req, res) => { res.setHeader("Content-Type", req.url === "/fixture.js" ? "text/javascript" : "text/html; charset=utf-8"); res.end(req.url === "/fixture.js" ? readFileSync(path.join(output, "fixture.js")) : `<!doctype html><html lang="en" data-theme="light"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body><main id="fixture"></main><script src="/fixture.js"></script></body></html>`); }).listen(port, "127.0.0.1", () => console.log(`Fixture ready ${base}`));
} else if (process.argv.includes("--qa")) {
  const binary = process.env.AGENT_BROWSER_BINARY ?? (process.platform === "win32" ? path.join(process.env.APPDATA, "npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe") : "agent-browser");
  const session = "makoto-phase7g1-agent-context";
  function execute(args, input) { const file = path.join(output, "command.json"); const fd = openSync(file, "w"); try { execFileSync(binary, ["--session", session, "--json", ...args], { input, timeout: 45_000, windowsHide: true, stdio: [input === undefined ? "ignore" : "pipe", fd, "inherit"] }); } finally { closeSync(fd); } const result = JSON.parse(readFileSync(file, "utf8")); assert.equal(result.success, true, result.error); return result.data; }
  const run = (...args) => execute(args);
  const evaluate = (code) => execute(["eval", "--stdin"], code).result;
  const checks = [];
  function check(name, fn) { try { fn(); checks.push({ name, pass: true }); console.log(`PASS ${name}`); } catch (error) { checks.push({ name, pass: false, error: error.message }); console.log(`FAIL ${name}: ${error.message}`); } }
  function mount(options) { const version = evaluate(`window.mountDraft(${JSON.stringify(options)})`); run("wait", "--fn", `window.fixtureVersion===${version} || !!document.querySelector('[data-context-status]')`); }
  function layout() { const value = evaluate(`(()=>{const card=document.querySelector('[data-context-status]');return {page:document.documentElement.scrollWidth,width:innerWidth,card:card.clientWidth,scroll:card.scrollWidth,status:card.dataset.contextStatus,button:card.querySelector('button')?.innerText,disabled:card.querySelector('button')?.disabled,text:card.innerText}})()`); assert.ok(value.page <= value.width && value.scroll <= value.card + 1, JSON.stringify(value)); return value; }
  try {
    run("open", base); run("wait", "--fn", "!!document.querySelector('[data-context-status]')");
    for (const width of [390, 900, 1440]) for (const locale of ["en", "vi"]) for (const theme of ["light", "dark"]) {
      run("set", "viewport", String(width), width === 390 ? "844" : "1000");
      evaluate(`document.documentElement.lang=${JSON.stringify(locale)};document.documentElement.dataset.theme=${JSON.stringify(theme)};document.documentElement.style.colorScheme=${JSON.stringify(theme)};true`);
      for (const scenario of [
        ["current", { account: accountA, chain: arc, originAccount: accountA, originChain: arc, locale }],
        ["account-rebound", { account: accountB, chain: arc, originAccount: accountA, originChain: arc, locale }],
        ["chain-rebound", { account: accountA, chain: otherChain, originAccount: accountA, originChain: arc, locale }],
        ["missing-origin", { account: accountB, chain: arc, origin: "missing", locale }],
      ]) {
        mount(scenario[1]);
        const value = layout();
        const expected = scenario[0] === "current" ? { status: "current", disabled: false } : { status: scenario[0] === "missing-origin" ? "unknown" : "historical", disabled: false };
        check(`${scenario[0]} semantic status ${width}-${locale}-${theme}`, () => { assert.equal(value.status, expected.status); assert.equal(value.disabled, expected.disabled); assert.match(value.text, scenario[0] === "current" ? (locale === "vi" ? /Sẵn sàng/ : /Ready/) : (scenario[0] === "missing-origin" ? (locale === "vi" ? /Không có ngữ cảnh/ : /Context unavailable/) : (locale === "vi" ? /Ngữ cảnh ví trước đó/ : /Previous wallet context/))); assert.match(value.button, scenario[0] === "current" ? (locale === "vi" ? /Xem lại giao dịch/ : /Review transaction/) : (locale === "vi" ? /Chuẩn bị cho ví hiện tại/ : /Prepare for current wallet/)); });
        check(`${scenario[0]} no overflow ${width}-${locale}-${theme}`, () => { assert.ok(value.page <= value.width && value.scroll <= value.card + 1, JSON.stringify(value)); });
        check(`${scenario[0]} accessible ${width}-${locale}-${theme}`, () => { const result = run("a11y", "--selector", "[data-context-status]"); assert.equal(result.counts.violations, 0, JSON.stringify(result.violations)); });
        if (scenario[0] === "account-rebound" && locale === "en" && theme === "light" && width === 900) { run("click", "[data-context-status] button"); run("wait", 50); check("explicit rebind creates only an account-bound handoff", () => { const result = evaluate(`(()=>{const pushed=window.fixturePushed;const raw=sessionStorage.getItem('makoto.agent.handoff.v1');return {pushed,account:raw?JSON.parse(raw).account:undefined};})()`); assert.match(result.pushed, /agentHandoff=/); assert.equal(result.account, accountB); }); }
      }
    }
  } finally { writeFileSync(path.join(output, "results.json"), JSON.stringify(checks, null, 2)); run("close"); }
  console.log(`Browser QA ${checks.filter((entry) => entry.pass).length}/${checks.length}; ${output}`); if (checks.some((entry) => !entry.pass)) process.exitCode = 1;
} else console.log("Use --serve or --qa");
