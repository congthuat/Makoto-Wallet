// Isolated local fixture using production Review/WalletPanel and extracted Swap/Bridge JSX.
// Run --serve in one process, then --qa in another. No wallet/provider module is bundled.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { root, fixtureSource, fixtureCss } from "./phase7f-fixture.mjs";
const require = createRequire(import.meta.url);
const output=path.resolve(process.env.PHASE7F_OUTPUT ?? path.join(tmpdir(),"makoto-phase7f-qa"));
assert.ok(!output.startsWith(path.resolve(root,"..")+path.sep),"Artifacts must be outside worktree");
mkdirSync(output,{recursive:true});
const port=Number(process.env.PHASE7F_PORT ?? 3180);
const base=`http://127.0.0.1:${port}`;
if(process.argv.includes("--serve")) {
  writeFileSync(path.join(output,"ExchangeFixture.tsx"),fixtureSource);
  writeFileSync(path.join(output,"preferences.ts"),`import {translate} from "@/i18n/index"; export function usePreferences(){const locale=document.documentElement.lang;return {locale,t:(key)=>translate(locale,key)};}`);
  writeFileSync(path.join(output,"loader.cjs"),`const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=function(source){if(this.resourcePath.endsWith('.css'))return '';return ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;};`);
  writeFileSync(path.join(output,"entry.tsx"),`
import * as React from "react"; import {createRoot} from "react-dom/client";
import {ExchangeFixture} from "./ExchangeFixture";
import {modalTabStops} from "@/lib/modalFocus";
const root=createRoot(document.querySelector('#fixture'));let revision=0;
const close=()=>{window.fixtureClosed=true;root.render(null);};
function Mounted({kind,options,version}) {
 React.useEffect(()=>{const dialog=document.querySelector('[role=dialog]');dialog?.setAttribute('data-fixture-version',String(version));window.fixtureVersion=version;},[version]);
 return <ExchangeFixture kind={kind} options={options} onClose={close}/>;
}
window.fixtureError=null;window.addEventListener('error',event=>{window.fixtureError=event.error?.message??event.message??'Unknown fixture error';});
window.mountFixture=(kind,options={})=>{window.fixtureClosed=false;window.fixtureError=null;const version=++revision;root.render(<Mounted key={version} version={version} kind={kind} options={options}/>);return version;};
window.fixtureTabStops=()=>modalTabStops(document.querySelector('[role=dialog]'));
window.mountFixture('swap',{state:'form'});`);
  // Preserve public registry constants without bundling the executable SDK.
  writeFileSync(path.join(output,'appKitConstants.ts'),readFileSync(path.join(root,'lib/circle/appKit.ts'),'utf8').split('\n').filter(line=>line.startsWith('export const ')).join('\n'));
  const {webpack}=require("next/dist/compiled/webpack/webpack");
  await new Promise((resolve,reject)=>{
    const compiler=webpack({mode:"development",devtool:false,entry:path.join(output,"entry.tsx"),output:{path:output,filename:"fixture.js"},resolve:{extensions:[".tsx",".ts",".js"],modules:[path.join(root,"node_modules")],alias:{"@/hooks/usePreferences$":path.join(output,"preferences.ts"),"@":root}},module:{rules:[{test:/\.(tsx?|css)$/,exclude:/node_modules/,use:path.join(output,"loader.cjs")}]},plugins:[new webpack.DefinePlugin({"process.env":"({})"}),new webpack.NormalModuleReplacementPlugin(/circle\/appKit\.ts$/,resource=>{resource.request=path.join(output,'appKitConstants.ts');}),new webpack.NormalModuleReplacementPlugin(/wagmi|useVerifiedWalletChain|RealSwapFlow|UniversalBridgeFlow|@circle-fin/,()=>{throw new Error("Wallet module forbidden in QA");})]});
    compiler.run((error,stats)=>{compiler.close(()=>{});if(error||stats.hasErrors())reject(error??new Error(stats.toString({all:false,errors:true})));else resolve();});
  });
  let fonts="";
  const chunks=path.join(root,".next/static/chunks"),media=path.join(root,".next/static/media");
  for(const file of readdirSync(chunks).filter(f=>f.endsWith('.css'))) {
    const css=readFileSync(path.join(chunks,file),'utf8');
    for(const face of css.match(/@font-face\{[^}]+\}/g)??[]) if(/Manrope/i.test(face)) fonts+=face.replace(/url\(([^)]+)\)/g,(_,url)=>`url(data:font/woff2;base64,${readFileSync(path.join(media,path.basename(url.replace(/["']/g,'')))).toString('base64')})`);
  }
  const family=fonts.match(/font-family:([^;]+)/)?.[1];
  assert.ok(family?.includes('Manrope'),'Run the production build first: local Manrope assets are required');
  // Product body derives both font roles from Next/font's --font-ui variable.
  const css=fonts+fixtureCss()+`\n:root{--font-ui:${family},sans-serif;}.fixture-label{margin:8px;font-size:12px;}`;
  createServer((req,res)=>{
    if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(readFileSync(path.join(output,'fixture.js')));return;}
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html lang="en" data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Makoto test-only Swap/Bridge fixture</title><style>${css}</style></head><body><button id="fixture-trigger" class="fixture-label">Test-only presentation fixture · no wallet/provider</button><main id="fixture"></main><script src="/fixture.js"></script></body></html>`);
  }).listen(port,"127.0.0.1",()=>console.log("Fixture ready "+base));
} else if(process.argv.includes('--qa')) {
 const binary=process.env.AGENT_BROWSER_BINARY ?? (process.platform==='win32'?path.join(process.env.APPDATA,'npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe'):'agent-browser');
 const session='makoto-phase7f-isolated-qa';
 function execute(args,input){const file=path.join(output,'command.json'),fd=openSync(file,'w');try{execFileSync(binary,['--session',session,'--json',...args],{input,timeout:45000,windowsHide:true,stdio:[input===undefined?'ignore':'pipe',fd,'inherit']});}finally{closeSync(fd);}const r=JSON.parse(readFileSync(file,'utf8'));assert.equal(r.success,true,r.error);return r.data;}
 const run=(...args)=>execute(args),evaluate=code=>execute(['eval','--stdin'],code).result;
 const checks=[];
 function check(name,fn){try{fn();checks.push({name,pass:true});console.log('PASS '+name);}catch(e){checks.push({name,pass:false,error:e.message});console.log('FAIL '+name+': '+e.message);}}
 function mount(kind,options){const version=evaluate(`window.mountFixture(${JSON.stringify(kind)},${JSON.stringify(options)})`);run('wait','--fn',`!!document.querySelector('[role=dialog][data-fixture-version="${version}"]') || !!window.fixtureError`);const error=evaluate('window.fixtureError');assert.equal(error,null,`Fixture render failed: ${error}`);}
 function layout(){const r=evaluate(`(()=>{const p=document.querySelector('[role=dialog]');return {page:document.documentElement.scrollWidth,width:innerWidth,panel:p.clientWidth,scroll:p.scrollWidth,clipped:[...p.querySelectorAll('*')].filter(e=>{const s=getComputedStyle(e);const sr=s.position==='absolute'&&s.width==='1px'&&s.height==='1px';return !sr&&e.checkVisibility()&&e.clientWidth>0&&e.scrollWidth>e.clientWidth+2&&s.overflowX!=='auto'&&!['INPUT','TEXTAREA'].includes(e.tagName);}).map(e=>e.tagName+'.'+e.className)}})()`);assert.ok(r.page<=r.width&&r.scroll<=r.panel+1,JSON.stringify(r));assert.deepEqual(r.clipped,[]);}
 function keyboard(){
  const n=evaluate('window.fixtureTabStops().length');
  run('focus','[role=dialog]');
  for(let i=0;i<n;i++){
   run('press','Tab');
   const r=evaluate(`(()=>{const e=document.activeElement,s=getComputedStyle(e),r=e.getBoundingClientRect(),p=e.closest('[role=dialog]'),h=p?.querySelector('.modal-header').getBoundingClientRect(),visibleColor=v=>v&&!/\\btransparent\\b/.test(v)&&!/rgba\\([^)]*,\\s*0(?:\\.0+)?\\s*\\)/.test(v)&&!/\\/\\s*0(?:\\.0+)?\\s*\\)/.test(v),outline=s.outlineStyle==='solid'&&parseFloat(s.outlineWidth)>=2&&visibleColor(s.outlineColor),shadow=s.boxShadow!=='none'&&visibleColor(s.boxShadow);return {expected:e===window.fixtureTabStops()[${i}],visible:e.checkVisibility(),inside:!!p,disabled:e.matches(':disabled'),focusVisible:e.matches(':focus-visible'),outline,shadow,outlineStyle:s.outlineStyle,outlineWidth:s.outlineWidth,outlineColor:s.outlineColor,boxShadow:s.boxShadow,fits:r.top>=0&&r.bottom<=innerHeight&&(!!e.closest('.modal-header')||r.top>=h.bottom),hiddenDisclosure:!!e.closest('details:not([open])')&&e.tagName!=='SUMMARY'};})()`);
   assert.ok(r.expected&&r.visible&&r.inside&&!r.disabled&&!r.hiddenDisclosure&&r.fits,JSON.stringify(r));assert.equal(r.focusVisible,true,JSON.stringify(r));assert.equal(r.outline||r.shadow,true,JSON.stringify(r));
  }
  run('press','Tab');assert.equal(evaluate(`document.activeElement===window.fixtureTabStops()[0]`),true);
  run('press','Shift+Tab');assert.equal(evaluate(`document.activeElement===window.fixtureTabStops().at(-1)`),true);
 }
 try {
  run('open',base);run('wait','--fn','!!window.mountFixture && document.fonts.status === "loaded"');
  for(const width of [390,900,1440])for(const locale of ['en','vi'])for(const theme of ['light','dark']) {
   const name=`${width}-${locale}-${theme}`;run('set','viewport',String(width),width===390?'844':'1000');
   evaluate(`document.documentElement.lang=${JSON.stringify(locale)};document.documentElement.dataset.theme=${JSON.stringify(theme)};true`);
   for(const kind of process.argv.includes('--bridge-only')?['bridge']:['swap','bridge'])for(const state of kind==='swap'?['form','review','approval','max','preflight','awaiting','pending','unknown','failure','success','success-unavailable','unavailable','expired']:['form','review','executing','failure','success','unavailable']) {
    mount(kind,{state});
    check(`${kind} ${state} layout ${name}`,layout);
    check(`${kind} ${state} axe ${name}`,()=>{const a=run('a11y','--selector','[role=dialog]');assert.equal(a.counts.violations,0,JSON.stringify(a.violations));});
    if(['form','review','success','unknown'].includes(state))run('screenshot',path.join(output,`${kind}-${state}-${name}.png`));
    if(['form','review','approval','max','unknown','success'].includes(state))check(`${kind} ${state} keyboard ${name}`,keyboard);
    if(['preflight','awaiting','pending','executing'].includes(state))check(`${kind} ${state} inert controls ${name}`,()=>{
     assert.equal(evaluate(`document.querySelector('.secondary-action').disabled && document.querySelector('.modal-header button').disabled && document.querySelector('.primary-action').disabled`),true);
     evaluate(`document.querySelector('.secondary-action').click();document.querySelector('.modal-header button').click();document.querySelector('.modal-backdrop').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));true`);run('press','Escape');assert.equal(evaluate('window.fixtureClosed'),false);
    });
    if(state==='form'){
     check(`${kind} disclosure keyboard ${name}`,()=>{
      run('focus',kind==='swap'?'.swap-advanced summary':'.bridge-options summary');run('press','Enter');assert.equal(evaluate(`document.querySelector(${JSON.stringify(kind==='swap'?'.swap-advanced':'.bridge-options')}).open`),true);layout();keyboard();
     });
     check(`${kind} expanded axe ${name}`,()=>{const a=run('a11y','--selector','[role=dialog]');assert.equal(a.counts.violations,0,JSON.stringify(a.violations));});
    }
   }
   check(`focus restoration ${name}`,()=>{run('press','Escape');run('focus','#fixture-trigger');mount('swap',{state:'form'});run('press','Escape');run('wait','--fn',`!document.querySelector('[role=dialog]')`);assert.equal(evaluate(`document.activeElement.id`),'fixture-trigger');});
  }
 } finally {writeFileSync(path.join(output,process.argv.includes('--bridge-only')?'results-bridge.json':'results.json'),JSON.stringify(checks,null,2));run('close');}
 console.log(`Browser QA ${checks.filter(x=>x.pass).length}/${checks.length}; ${output}`);if(checks.some(x=>!x.pass))process.exitCode=1;
} else {console.log('Use --serve or --qa');}
