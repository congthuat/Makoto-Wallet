import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { root, fixtureSource } from "./phase7h-receipt-fixture.mjs";

const require = createRequire(import.meta.url);
const output = path.join(tmpdir(), "makoto-repair-gate-h4");
mkdirSync(output, { recursive: true });
const port = Number(process.env.H4_PORT ?? 3195);
const entry = `
import * as React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {TransactionReceiptPanel} from '@/components/TransactionReceiptPanel';
import {directActivity,swapActivity,receiptFor,wallet} from './fixture';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const root=createRoot(document.querySelector('#fixture'));
let requests=[],version=0,current,shared=[],copied=[];
const client={getTransactionReceipt:({hash})=>new Promise(resolve=>requests.push({hash,resolve}))};
globalThis.__fixtureClient=client;
Object.defineProperty(navigator,'share',{configurable:true,value:async p=>{shared.push(p);}});
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>{copied.push(t);}}});
const hash=id=>'0x'+({A:'ab',B:'cd',C:'ef'}[id]).repeat(32);
const activity=(id,swap=false)=>({...swap?swapActivity:directActivity,hash:hash(id)});
function receipt(id,scenario){const r=receiptFor(scenario);return {...r,transactionHash:hash(id),logs:r.logs.map(l=>({...l,transactionHash:hash(id)}))};}
function render(a){current=a;root.render(<TransactionReceiptPanel key={version} activity={a} walletAddress={wallet} onClose={()=>{}}/>);}
function snapshot(){const el=document.querySelector('#fixture');return {status:el.querySelector('[data-receipt-status]')?.dataset.receiptStatus,text:el.innerText,html:el.innerHTML};}
function check(value,message){if(!value)throw Error(message);}
function unresolved(s){check(!s.status,'stale terminal status');check(!/NOTE FROM|4\\.99|CASE NORMALIZED/.test(s.text),'stale memo/actual');check(!document.querySelector('.receipt-actions'),'stale export/share controls');}
async function resolve(id,scenario){const request=requests.find(r=>r.hash===hash(id));check(request,'missing request '+id);await React.act(async()=>request.resolve(receipt(id,scenario)));}
async function start(id,swap=false){version++;requests=[];shared=[];copied=[];await React.act(async()=>render(activity(id,swap)));}
async function select(id,swap=false){const s=await React.act(async()=>{flushSync(()=>render(activity(id,swap)));const immediate=snapshot();unresolved(immediate);return immediate;});return s;}
function exportCurrent(){document.querySelectorAll('.receipt-actions button').forEach(b=>b.click());}
window.runH4=async(locale,theme)=>{
 globalThis.__fixtureLocale=locale;document.documentElement.lang=locale;document.documentElement.dataset.theme=theme;
 const results=[];
 async function scenario(name,fn){try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.message});}}
 for(const [name,kind,swap] of [['success','confirmed',false],['failure','failed',false],['memo','memo-success',false],['actual','swap-success',true]]){
  await scenario(name+' A to B immediate',async()=>{await start('A',swap);await resolve('A',kind);check(snapshot().status===(kind==='failed'?'confirmed-failure':'confirmed-success'),'A own status');if(kind==='memo-success')check(snapshot().text.includes('NOTE FROM TRANSACTION A'),'valid memo lost');await select('B',swap);exportCurrent();check(!shared.length&&!copied.length,'mixed export/share');});
 }
 await scenario('late A after B selected',async()=>{await start('A');await select('B');await resolve('A','memo-success');unresolved(snapshot());await resolve('B','confirmed');check(snapshot().status==='confirmed-success','B own success');});
 await scenario('rapid A B C',async()=>{await start('A');await resolve('A','memo-success');await select('B');await select('C');await resolve('B','memo-success');unresolved(snapshot());await resolve('C','confirmed');check(snapshot().status==='confirmed-success','C own success');});
 await scenario('B own success export share',async()=>{await start('A');await resolve('A','memo-success');await select('B');await resolve('B','confirmed');await React.act(async()=>exportCurrent());check(shared.length===1&&copied.length===1,'export/share unavailable');check(shared[0].text===copied[0],'canonical text differs');check(shared[0].text.includes(hash('B'))&&!shared[0].text.includes(hash('A'))&&!shared[0].text.includes('NOTE FROM TRANSACTION A'),'stale payload');});
 await scenario('B own failure',async()=>{await start('A');await resolve('A','confirmed');await select('B');await resolve('B','failed');check(snapshot().status==='confirmed-failure','B own failure');await React.act(async()=>exportCurrent());check(shared[0].text.includes(locale==='vi'?'Xác nhận thất bại':'Confirmed failure'),'failure export');});
 check(document.documentElement.scrollWidth<=innerWidth,'horizontal overflow');
 return results;
};
`;

if (process.argv.includes("--serve")) {
  writeFileSync(path.join(output, "fixture.tsx"), fixtureSource + "\nexport {directActivity,swapActivity,receiptFor,wallet};");
  writeFileSync(path.join(output, "entry.tsx"), entry);
  writeFileSync(path.join(output, "wagmi.ts"), "export const usePublicClient=()=>globalThis.__fixtureClient;");
  writeFileSync(path.join(output, "preferences.ts"), "export const usePreferences=()=>({locale:globalThis.__fixtureLocale??'en',t:()=> 'Close'});");
  writeFileSync(path.join(output, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
  const { webpack } = require("next/dist/compiled/webpack/webpack");
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: "development", devtool: false, entry: path.join(output, "entry.tsx"), output: { path: output, filename: "fixture.js" }, resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(root, "node_modules")], alias: { "@": root } }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(output, "loader.cjs") }] }, plugins: [new webpack.DefinePlugin({ "process.env": "({})" }), new webpack.NormalModuleReplacementPlugin(/^wagmi$/, r => { r.request = path.join(output, "wagmi.ts"); }), new webpack.NormalModuleReplacementPlugin(/^@\/hooks\/usePreferences$/, r => { r.request = path.join(output, "preferences.ts"); })] });
    compiler.run((err, stats) => { compiler.close(() => {}); if (err || stats.hasErrors()) reject(err ?? Error(stats.toString({ all: false, errors: true }))); else resolve(); });
  });
  const css = readFileSync(path.join(root, "app/ledger-calm.css"), "utf8") + readFileSync(path.join(root, "app/globals.css"), "utf8");
  createServer((req, res) => { res.setHeader("Content-Type", req.url === "/fixture.js" ? "text/javascript" : "text/html; charset=utf-8"); res.end(req.url === "/fixture.js" ? readFileSync(path.join(output, "fixture.js")) : `<!doctype html><html lang="en" data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>H4 synthetic transitions</title><style>${css}</style></head><body><div id="fixture"></div><script src="/fixture.js"></script></body></html>`); }).listen(port, "127.0.0.1", () => console.log(`H4 ready http://127.0.0.1:${port}`));
} else if (process.argv.includes("--qa")) {
  const binary = process.env.AGENT_BROWSER_BINARY ?? path.join(process.env.APPDATA, "npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe");
  const run = (args, input) => {
    const filename = path.join(output, "command.json"), fd = openSync(filename, "w");
    try { execFileSync(binary, ["--session", "makoto-h4", "--json", ...args], { input, timeout: 45_000, windowsHide: true, stdio: [input === undefined ? "ignore" : "pipe", fd, "inherit"] }); } finally { closeSync(fd); }
    const r = JSON.parse(readFileSync(filename, "utf8")); assert.equal(r.success, true, r.error); return r.data;
  };
  const results = [];
  try {
    run(["open", `http://127.0.0.1:${port}`]);
    run(["wait", "--fn", "typeof window.runH4==='function'"]);
    for (const width of [390, 900, 1440]) for (const locale of ["en", "vi"]) for (const theme of ["light", "dark"]) {
      run(["set", "viewport", String(width), "1000"]);
      const checks = run(["eval", "--stdin"], `window.runH4(${JSON.stringify(locale)},${JSON.stringify(theme)})`).result;
      results.push(...checks.map(check => ({ ...check, width, locale, theme })));
      console.log(`${width} ${locale} ${theme}: ${checks.filter(c => c.pass).length}/${checks.length}`);
    }
    writeFileSync(path.join(output, "results.json"), JSON.stringify(results, null, 2));
    assert.equal(results.filter(r => !r.pass).length, 0, JSON.stringify(results.filter(r => !r.pass)));
    console.log(`H4 React browser transitions: ${results.length}/${results.length} PASS`);
  } finally { run(["close"]); }
}
