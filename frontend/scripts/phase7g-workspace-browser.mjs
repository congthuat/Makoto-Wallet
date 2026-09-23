import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { root, fixtureSource, accountA, accountB, arc } from "./phase7g-workspace-fixture.mjs";

const require = createRequire(import.meta.url);
const output = path.resolve(process.env.PHASE7G_OUTPUT ?? path.join(tmpdir(), "makoto-phase7g-qa"));
assert.ok(!output.startsWith(path.resolve(root, "..") + path.sep), "Artifacts must be outside worktree");
mkdirSync(output, { recursive: true });
const port = Number(process.env.PHASE7G_PORT ?? 3187);
const base = `http://127.0.0.1:${port}`;

if (process.argv.includes("--serve")) {
  writeFileSync(path.join(output, "WorkspaceFixture.tsx"), fixtureSource);
  writeFileSync(path.join(output, "entry.tsx"), `import * as React from "react"; import {createRoot} from "react-dom/client"; import {Fixture} from "./WorkspaceFixture"; const root=createRoot(document.querySelector('#fixture')); let revision=0; function Mounted({options,version}){React.useEffect(()=>{window.fixtureVersion=version;},[version]);return <Fixture options={options}/>;} window.mountWorkspace=(o={})=>{window.fixtureConnection={address:o.account??(['account','prepare'].includes(o.scenario)?${JSON.stringify(accountB)}:${JSON.stringify(accountA)})};window.fixtureChain=o.chainId??(o.scenario==='chain'?84532:${arc});window.fixturePushed='';sessionStorage.clear();const version=++revision;root.render(<Mounted key={version} options={o} version={version}/>);return version;}; window.mountWorkspace();`);
  writeFileSync(path.join(output, "wagmiMock.ts"), `export const useConnection=()=>window.fixtureConnection;`);
  writeFileSync(path.join(output, "walletAccountMock.ts"), `export const useWalletReadContext=()=>({kind:"external",status:"connected",address:window.fixtureConnection.address,providerChainId:window.fixtureChain,isArc:window.fixtureChain===${arc},providerName:"Fixture wallet"});`);
  writeFileSync(path.join(output, "navigationMock.ts"), `export const useRouter=()=>({push:(url)=>{window.fixturePushed=url;}}); export const useSearchParams=()=>new URLSearchParams(window.location.search);`);
  writeFileSync(path.join(output, "chainMock.ts"), `export const useVerifiedWalletChain=()=>({providerChainId:window.fixtureChain});`);
  writeFileSync(path.join(output, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=function(source){if(this.resourcePath.endsWith('.css'))return '';return ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;};`);
  const { webpack } = require("next/dist/compiled/webpack/webpack");
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: "development", devtool: false, entry: path.join(output, "entry.tsx"), output: { path: output, filename: "fixture.js" }, resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(root, "node_modules")], alias: { "@": root } }, module: { rules: [{ test: /\.(tsx?|css)$/, exclude: /node_modules/, use: path.join(output, "loader.cjs") }] }, plugins: [new webpack.DefinePlugin({ "process.env": "({})" }), new webpack.NormalModuleReplacementPlugin(/^wagmi$/, (resource) => { resource.request = path.join(output, "wagmiMock.ts"); }), new webpack.NormalModuleReplacementPlugin(/^next\/navigation$/, (resource) => { resource.request = path.join(output, "navigationMock.ts"); }), new webpack.NormalModuleReplacementPlugin(/^@\/hooks\/useWalletAccount$/, (resource) => { resource.request = path.join(output, "walletAccountMock.ts"); }), new webpack.NormalModuleReplacementPlugin(/^@\/hooks\/useVerifiedWalletChain$/, (resource) => { resource.request = path.join(output, "chainMock.ts"); })] });
    compiler.run((error, stats) => { compiler.close(() => {}); if (error || stats.hasErrors()) reject(error ?? new Error(stats.toString({ all: false, errors: true }))); else resolve(); });
  });
  const css = readFileSync(path.join(root, "app/ledger-calm.css"), "utf8") + readFileSync(path.join(root, "components/MakotoAgentPage.module.css"), "utf8");
  createServer((req, res) => { res.setHeader("Content-Type", req.url === "/fixture.js" ? "text/javascript" : "text/html; charset=utf-8"); res.end(req.url === "/fixture.js" ? readFileSync(path.join(output, "fixture.js")) : `<!doctype html><html lang="en" data-theme="light"><head><title>Phase 7G synthetic workspace</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0;background:var(--lc-canvas);font-family:Arial,sans-serif}main{max-width:1160px;margin:auto;padding:24px;box-sizing:border-box}@media(max-width:599px){main{padding:16px}}</style></head><body><main id="fixture"></main><script src="/fixture.js"></script></body></html>`); }).listen(port, "127.0.0.1", () => console.log(`Fixture ready ${base}`));
} else if (process.argv.includes("--qa")) {
  const binary = process.env.AGENT_BROWSER_BINARY ?? (process.platform === "win32" ? path.join(process.env.APPDATA, "npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe") : "agent-browser");
  const session = "makoto-phase7g-agent-context";
  function execute(args, input) { const file = path.join(output, "command.json"); const fd = openSync(file, "w"); try { execFileSync(binary, ["--session", session, "--json", ...args], { input, timeout: 45_000, windowsHide: true, stdio: [input === undefined ? "ignore" : "pipe", fd, "inherit"] }); } finally { closeSync(fd); } const result = JSON.parse(readFileSync(file, "utf8")); assert.equal(result.success, true, result.error); return result.data; }
  const run = (...args) => execute(args);
  const evaluate = (code) => execute(["eval", "--stdin"], code).result;
  const checks = [];
  function check(name, fn) { try { fn(); checks.push({ name, pass: true }); console.log(`PASS ${name}`); } catch (error) { checks.push({ name, pass: false, error: error.message }); console.log(`FAIL ${name}: ${error.message}`); } }
  function mount(options) { const version = evaluate(`window.mountWorkspace(${JSON.stringify(options)})`); run("wait", "--fn", `window.fixtureVersion===${version}`); }
  try {
    run("open", base); run("wait", "--fn", "!!window.fixtureVersion");
    for (const width of [390, 900, 1440]) for (const locale of ["en", "vi"]) for (const theme of ["light", "dark"]) {
      run("set", "viewport", String(width), width === 390 ? "844" : "1000");
      evaluate(`document.documentElement.lang=${JSON.stringify(locale)};document.documentElement.dataset.theme=${JSON.stringify(theme)};document.documentElement.style.colorScheme=${JSON.stringify(theme)};true`);
      for (const scenario of ["read","fresh","account","chain","prepare","ready","unavailable","insufficient","result","invalid","history","empty"]) {
        mount({scenario,locale});
        const label = `${scenario} ${width}-${locale}-${theme}`;
        const value = evaluate(`(()=>{const card=document.querySelector('[data-context-status]');return {page:document.documentElement.scrollWidth,width:innerWidth,status:card?.dataset.contextStatus,disabled:card?.querySelector('button')?.disabled,text:document.querySelector('main').innerText,mode:document.querySelector('[data-operation-mode]')?.dataset.operationMode,overflow:[...document.querySelectorAll('main *')].filter(e=>!e.classList.contains('srOnly') && e.getClientRects().length && e.scrollWidth>e.clientWidth+1 && getComputedStyle(e).display!=='inline').map(e=>e.className)}})()`);
        check(`semantics ${label}`,()=>{
          assert.equal(value.mode,scenario==='empty'?undefined:scenario==='read'?'read':scenario==='result'?'result':'action');
          if (['account','chain','prepare'].includes(scenario)) {assert.equal(value.status,'historical');assert.ok(value.text.includes(accountA));assert.match(value.text,locale==='vi'?/Chuẩn bị cho ví hiện tại/:/Prepare for current wallet/);}
          if (['fresh','ready'].includes(scenario)) {assert.equal(value.status,'current');assert.equal(value.disabled,false);}
          if (scenario==='invalid') assert.equal(value.disabled,true);
          if (scenario==='read') assert.doesNotMatch(value.text,locale==='vi'?/Kế hoạch để kiểm tra/:/Plan for review/);
          if (scenario==='result') assert.match(value.text,locale==='vi'?/Kết quả từ luồng giao dịch/:/Reported by the transaction flow/);
          if (scenario==='unavailable') assert.match(value.text,locale==='vi'?/Không khả dụng/:/Unavailable/);
          if (scenario==='insufficient') assert.match(value.text,locale==='vi'?/không đủ/i:/does not cover|do not cover/i);
          assert.doesNotMatch(value.text,/agent[.](workspace|draft|page)[.]/);
        });
        check(`responsive ${label}`,()=>{assert.ok(value.page<=value.width,JSON.stringify(value));assert.deepEqual(value.overflow,[]);});
        check(`accessibility ${label}`,()=>{const result=run('a11y','--selector','main');assert.equal(result.counts.violations,0,JSON.stringify(result.violations));});
        if (scenario==='prepare') {
          run('click','[data-context-status] button');run('wait','--fn',"!!window.fixturePushed");
          check(`explicit current-wallet handoff ${label}`,()=>{const result=evaluate(`({url:window.fixturePushed,handoff:JSON.parse(sessionStorage.getItem('makoto.agent.handoff.v1'))})`);assert.match(result.url,/agentHandoff=/);assert.equal(result.handoff.account,accountB);assert.equal(result.handoff.sourceChain,'Arc Testnet');});
        }
        if (scenario==='fresh') {
          run('focus','#agent-question'); run('press','Shift+Tab');
          check(`keyboard and visible focus ${label}`,()=>{assert.equal(evaluate(`document.activeElement.className`),'suggestionTrigger');assert.equal(evaluate(`getComputedStyle(document.activeElement).outlineStyle`),'solid');});
          run('press','Tab');check(`suggestion selection stays in composer order ${label}`,()=>assert.equal(evaluate(`document.activeElement.id`),'agent-question'));
          run('fill','#agent-question',locale==='vi'?'Hiển thị số dư ví của tôi':'Show my wallet balances');
          run('press','Tab');check(`compact send follows the input ${label}`,()=>assert.equal(evaluate(`document.activeElement.className`),'sendButton'));
          run('press','Tab');check(`collapsed suggestions stay inert ${label}`,()=>assert.equal(evaluate(`document.activeElement.tagName`),'SUMMARY'));
          run('press','Enter');run('press','Tab');check(`history clear reachable ${label}`,()=>assert.equal(evaluate(`document.activeElement.closest('.history')!==null && document.activeElement.tagName==='BUTTON'`),true));
        }
        if (['fresh','account','read','result'].includes(scenario)) run('screenshot',path.join(output,`${scenario}-${width}-${locale}-${theme}.png`),'--full');
      }
    }
  } finally { writeFileSync(path.join(output, "results.json"), JSON.stringify(checks, null, 2)); run("close"); }
  console.log(`Browser QA ${checks.filter((entry) => entry.pass).length}/${checks.length}; ${output}`); if (checks.some((entry) => !entry.pass)) process.exitCode = 1;
} else console.log("Use --serve or --qa");
