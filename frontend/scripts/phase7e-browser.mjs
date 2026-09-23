// Isolated local fixture using production Receive/Review/WalletPanel and extracted Send JSX.
// Run --serve in one process, then --qa in another. No wallet/provider module is bundled.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { root, sendSource, fixtureCss, account } from "./phase7e-fixture.mjs";
const require = createRequire(import.meta.url);
const output=path.resolve(process.env.PHASE7E_OUTPUT ?? path.join(tmpdir(),"makoto-phase7e-qa"));
assert.ok(!output.startsWith(path.resolve(root,"..")+path.sep),"Artifacts must be outside worktree");
mkdirSync(output,{recursive:true});
const port=Number(process.env.PHASE7E_PORT ?? 3179);
const base=`http://127.0.0.1:${port}`;
if(process.argv.includes("--serve")) {
  writeFileSync(path.join(output,"SendFixture.tsx"),sendSource);
  writeFileSync(path.join(output,"preferences.ts"),`import {translate} from "@/i18n/index"; export function usePreferences(){const locale=document.documentElement.lang;return {locale,t:(key)=>translate(locale,key)};}`);
  writeFileSync(path.join(output,"loader.cjs"),`const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=function(source){if(this.resourcePath.endsWith('.css'))return '';return ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;};`);
  writeFileSync(path.join(output,"entry.tsx"),`
import * as React from "react"; import {createRoot} from "react-dom/client";
import {SendFixture} from "./SendFixture"; import {ReceivePanel} from "@/components/ReceivePanel";
import {WalletPanel} from "@/components/WalletPanel";
import {modalTabStops} from "@/lib/modalFocus";
const root=createRoot(document.querySelector('#fixture'));let revision=0;
Object.defineProperty(navigator,'clipboard',{value:{writeText:async(text)=>{window.copiedText=text;}}});
const close=()=>{window.fixtureClosed=true;root.render(null);};
function Mounted({kind,options,version}) {
  React.useEffect(()=>{window.fixtureVersion=version;},[version]);
  if(kind==='focus-edge')return <WalletPanel title="Keyboard regression fixture" onClose={close} closeDisabled={options.empty}>
    {!options.empty && <><button id="edge-visible">Visible</button><button disabled id="edge-disabled">Disabled</button><button hidden id="edge-hidden">Hidden</button><div hidden><button id="edge-parent-hidden">Hidden parent</button></div><button style={{display:'none'}} id="edge-display">No display</button><button style={{visibility:'hidden'}} id="edge-visibility">No visibility</button><div inert><button id="edge-inert">Inert</button></div><button tabIndex={-1} id="edge-negative">Programmatic only</button><fieldset disabled><button id="edge-fieldset">Disabled fieldset</button></fieldset><details><summary id="edge-summary">Disclosure</summary><button id="edge-content">Disclosure content</button></details></>}
  </WalletPanel>;
  return kind==='receive'?<ReceivePanel address="${account}" onClose={close}/>:<SendFixture {...options} onClose={close}/>;
}
window.mountFixture=(kind,options={})=>{window.fixtureClosed=false;const version=++revision;root.render(<Mounted key={version} version={version} kind={kind} options={options}/>);return version;};
window.fixtureTabStops=()=>modalTabStops(document.querySelector('[role=dialog]')).map(e=>e.id||e.tagName);
window.mountFixture('send');`);
  const {webpack}=require("next/dist/compiled/webpack/webpack");
  await new Promise((resolve,reject)=>{
    const compiler=webpack({mode:"development",devtool:false,entry:path.join(output,"entry.tsx"),output:{path:output,filename:"fixture.js"},resolve:{extensions:[".tsx",".ts",".js"],modules:[path.join(root,"node_modules")],alias:{"@/hooks/usePreferences$":path.join(output,"preferences.ts"),"@":root}},module:{rules:[{test:/\.(tsx?|css)$/,exclude:/node_modules/,use:path.join(output,"loader.cjs")}]},plugins:[new webpack.DefinePlugin({"process.env":"({})"}),new webpack.NormalModuleReplacementPlugin(/wagmi|useVerifiedWalletChain|SendFlow/,()=>{throw new Error("Wallet module forbidden in QA");})]});
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
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html lang="en" data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Makoto test-only Send/Receive fixture</title><style>${css}</style></head><body><button id="fixture-trigger" class="fixture-label">Test-only presentation fixture · no wallet/provider</button><main id="fixture"></main><script src="/fixture.js"></script></body></html>`);
  }).listen(port,"127.0.0.1",()=>console.log("Fixture ready "+base));
} else if(process.argv.includes("--qa")) {
  const binary=process.env.AGENT_BROWSER_BINARY ?? (process.platform==='win32'?path.join(process.env.APPDATA,'npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe'):'agent-browser');
  const session='makoto-phase7e-isolated-qa';
  function execute(args,input){const file=path.join(output,'command.json'),fd=openSync(file,'w');try{execFileSync(binary,['--session',session,'--json',...args],{input,timeout:45000,windowsHide:true,stdio:[input===undefined?'ignore':'pipe',fd,'inherit']});}finally{closeSync(fd);}const r=JSON.parse(readFileSync(file,'utf8'));assert.equal(r.success,true,r.error);return r.data;}
  const run=(...args)=>execute(args),evaluate=code=>execute(['eval','--stdin'],code).result;
  const checks=[];
  function check(name,fn){try{fn();checks.push({name,pass:true});console.log('PASS '+name);}catch(e){checks.push({name,pass:false,error:e.message});console.log('FAIL '+name+': '+e.message);}}
  function mount(kind,options={}){const version=evaluate(`window.mountFixture(${JSON.stringify(kind)},${JSON.stringify(options)})`);run('wait','--fn',`window.fixtureVersion===${version} && !!document.querySelector('[role=dialog]')`);}
  function layout(){const r=evaluate(`(()=>{const p=document.querySelector('[role=dialog]');return {page:document.documentElement.scrollWidth,width:innerWidth,panel:p.clientWidth,scroll:p.scrollWidth,clipped:[...p.querySelectorAll('*')].filter(e=>{const s=getComputedStyle(e);const srOnly=s.position==='absolute'&&s.width==='1px'&&s.height==='1px'&&s.clip==='rect(0px, 0px, 0px, 0px)';return !srOnly&&e.checkVisibility()&&e.clientWidth>0&&e.scrollWidth>e.clientWidth+2&&s.overflowX!=='auto'&&e.tagName!=='INPUT'&&e.tagName!=='TEXTAREA';}).map(e=>e.tagName+'.'+e.className)}})()`);assert.ok(r.page<=r.width,JSON.stringify(r));assert.ok(r.scroll<=r.panel+1,JSON.stringify(r));assert.deepEqual(r.clipped,[]);}
  function active(selector){assert.equal(evaluate(`document.activeElement.matches(${JSON.stringify(selector)})`),true,`Expected keyboard focus on ${selector}`);}
  function contained(){assert.equal(evaluate(`!!document.activeElement.closest('[role=dialog]') && document.activeElement.checkVisibility()`),true,'Focus must remain on a visible modal target');}
  function visibleFocus(){
    const r=evaluate(`(()=>{const e=document.activeElement,s=getComputedStyle(e),r=e.getBoundingClientRect(),p=e.closest('[role=dialog]'),b=p.getBoundingClientRect(),h=p.querySelector('.modal-header').getBoundingClientRect(),visibleColor=v=>v&&!/\\btransparent\\b/.test(v)&&!/rgba\\([^)]*,\\s*0(?:\\.0+)?\\s*\\)/.test(v)&&!/\\/\\s*0(?:\\.0+)?\\s*\\)/.test(v),outline=s.outlineStyle!=='none'&&parseFloat(s.outlineWidth)>=1&&visibleColor(s.outlineColor),shadow=s.boxShadow!=='none'&&visibleColor(s.boxShadow),tolerance=2;return {target:e.id||e.textContent,focusVisible:e.matches(':focus-visible'),outline,shadow,outlineStyle:s.outlineStyle,outlineWidth:s.outlineWidth,outlineColor:s.outlineColor,boxShadow:s.boxShadow,inside:!!p,visible:e.checkVisibility(),fits:r.left>=b.left-tolerance&&r.right<=b.right+tolerance&&r.top>=b.top-tolerance&&r.bottom<=b.bottom+tolerance&&r.top>=-tolerance&&r.bottom<=innerHeight+tolerance&&(!!e.closest('.modal-header')||r.top>=h.bottom-tolerance)};})()`);
    assert.equal(r.focusVisible,true,JSON.stringify(r));assert.equal(r.outline||r.shadow,true,JSON.stringify(r));assert.equal(r.visible&&r.inside&&r.fits,true,JSON.stringify(r));
  }
  function cycle(selectors,inspectFocus=true){
    run('focus','[role=dialog]');
    for(let i=0;i<selectors.length;i++){run('press','Tab');active(selectors[i]);contained();if(inspectFocus)visibleFocus();}
    run('press','Tab');active(selectors[0]);contained();if(inspectFocus)visibleFocus();
    run('press','Shift+Tab');active(selectors.at(-1));contained();if(inspectFocus)visibleFocus();
    for(let i=selectors.length-2;i>=0;i--){run('press','Shift+Tab');active(selectors[i]);contained();if(inspectFocus)visibleFocus();}
  }
  function keyboardFocus(selector){
    run('focus','[role=dialog]');
    for(let i=0;i<40;i++){run('press','Tab');if(evaluate(`document.activeElement.matches(${JSON.stringify(selector)})`)){contained();visibleFocus();return;}}
    assert.fail(`Keyboard Tab did not reach ${selector}`);
  }
  try{
    run('open',base);run('wait','--fn','!!window.mountFixture && document.fonts.status === "loaded"');
    for(const width of [390,900,1440])for(const locale of ['en','vi'])for(const theme of ['light','dark']){
      const name=`${width}-${locale}-${theme}`;run('set','viewport',String(width),width===390?'844':'1000');
      evaluate(`document.documentElement.lang=${JSON.stringify(locale)};document.documentElement.dataset.theme=${JSON.stringify(theme)};true`);
      check(`font fidelity ${name}`,()=>{assert.equal(evaluate(`getComputedStyle(document.body).fontFamily.includes('Manrope') && [...document.fonts].some(f=>f.family==='Manrope'&&f.status==='loaded')`),true);});
      for(const [kind,options] of [['send',{}],['review',{reviewing:true}],['unavailable',{reviewing:true,fee:{status:'unavailable'}}],['awaiting',{reviewing:true,stage:'awaiting'}],['confirming',{reviewing:true,stage:'confirming'}],['receive',{}]]){
        mount(kind,options);
        check(`${kind} layout ${name}`,layout);
        check(`${kind} axe ${name}`,()=>{const audit=run('a11y','--selector','[role=dialog]');assert.equal(audit.counts.violations,0,JSON.stringify(audit.violations));});
        if(['send','review','unavailable','receive'].includes(kind))run('screenshot',path.join(output,`${kind}-${name}.png`));
        if(kind==='awaiting'||kind==='confirming')check(`${kind} Back/close ${name}`,()=>{
          assert.equal(evaluate(`document.querySelector('.secondary-action').disabled && document.querySelector('.modal-header button').disabled`),true);
          evaluate(`document.querySelector('.secondary-action').click();true`);run('press','Escape');
          assert.equal(evaluate(`!!document.querySelector('.compact-transaction-review') && !window.fixtureClosed`),true);
        });
        if(kind==='send')check(`input/focus ${name}`,()=>{
          cycle(['.modal-header button','#send-asset','#send-amount','.wallet-field-with-action.amount button','#send-recipient','.wallet-field-with-action:not(.amount) button','#send-note','.modal-actions .secondary-action','.modal-actions .primary-action']);
          keyboardFocus('#send-recipient');run('screenshot',path.join(output,`focus-${name}.png`));
          run('fill','#send-recipient','bad');assert.equal(evaluate('document.querySelector("#send-recipient").getAttribute("aria-invalid")'),'true');
          visibleFocus();
          assert.equal(evaluate(`(()=>{const feedback=document.querySelector('#send-recipient-context');return feedback?.checkVisibility()&&feedback.textContent.trim().length>0;})()`),true,'Invalid recipient keeps visible descriptive feedback while keyboard focus remains visible');
        });
        if(kind==='review')check(`review keyboard ${name}`,()=>{cycle(['.modal-header button','.compact-review-details summary','.modal-actions .secondary-action','.modal-actions .primary-action']);});
        if(kind==='review')check(`editable Back ${name}`,()=>{run('click','.secondary-action');assert.equal(evaluate('document.querySelector("#send-amount").value'),'1.234567');});
        if(kind==='receive')check(`copy/request ${name}`,()=>{
          run('click','.receive-address button');assert.equal(evaluate('window.copiedText'),account);
          assert.equal(evaluate('document.querySelector(".receive-address button").textContent'),locale==='en'?'Address copied':'Đã sao chép');
          run('focus','.receive-request summary');run('press','Enter');assert.equal(evaluate('document.querySelector(".receive-request").open'),true);
          run('fill','#receive-amount','1.234567');run('click','.receive-details summary');
          // Native keyboard activation also proves an off-screen action is reachable.
          run('focus','.receive-actions button:first-child');run('press','Enter');assert.equal(evaluate('window.copiedText'),`ethereum:0x3600000000000000000000000000000000000000@5042002/transfer?address=${account}&uint256=1234567`);
          layout();
        });
      }
      mount('receive');
      const closed=['.modal-header button','#receive-asset','.receive-address button','.receive-request summary','.receive-details summary'];
      check(`keyboard closed Details ${name}`,()=>{cycle(closed);keyboardFocus('.receive-details summary');});
      check(`keyboard disclosure Enter/Space ${name}`,()=>{
        keyboardFocus('.receive-details summary');run('press','Enter');assert.equal(evaluate(`document.querySelector('.receive-details').open`),true);
        run('press','Space');assert.equal(evaluate(`document.querySelector('.receive-details').open`),false);
        run('press','Space');assert.equal(evaluate(`document.querySelector('.receive-details').open`),true);
      });
      check(`keyboard open Details ${name}`,()=>{cycle([...closed,'.receive-details a']);});
      check(`keyboard open request ${name}`,()=>{
        keyboardFocus('.receive-request summary');run('press','Enter');run('fill','#receive-amount','1.234567');
        cycle([...closed.slice(0,4),'#receive-amount','.receive-add-note',closed[4],'.receive-details a','.receive-actions button:first-child','.receive-actions button:last-child']);
      });
      check(`receive expanded axe ${name}`,()=>{const audit=run('a11y','--selector','[role=dialog]');assert.equal(audit.counts.violations,0,JSON.stringify(audit.violations));});
      check(`keyboard close/restoration ${name}`,()=>{
        run('press','Escape');run('wait','--fn',`!document.querySelector('[role=dialog]')`);
        run('focus','#fixture-trigger');mount('receive');run('press','Escape');run('wait','--fn',`!document.querySelector('[role=dialog]')`);active('#fixture-trigger');
      });
      mount('focus-edge');
      check(`keyboard excludes hidden/disabled targets ${name}`,()=>{
        assert.deepEqual(evaluate('window.fixtureTabStops()'),['BUTTON','edge-visible','edge-summary']);
        // Deliberately unstyled synthetic controls test reachability, not product appearance.
        cycle(['.modal-header button','#edge-visible','#edge-summary'],false);run('press','Tab');run('press','Tab');active('#edge-summary');run('press','Enter');
        assert.deepEqual(evaluate('window.fixtureTabStops()'),['BUTTON','edge-visible','edge-summary','edge-content']);
        cycle(['.modal-header button','#edge-visible','#edge-summary','#edge-content'],false);
      });
      mount('focus-edge',{empty:true});
      check(`keyboard empty modal ${name}`,()=>{run('press','Tab');active('[role=dialog]');run('press','Shift+Tab');active('[role=dialog]');run('press','Escape');assert.equal(evaluate('window.fixtureClosed'),false);});
    }
  }finally{writeFileSync(path.join(output,'results.json'),JSON.stringify(checks,null,2));run('close');}
  console.log(`Browser QA ${checks.filter(x=>x.pass).length}/${checks.length}; ${output}`);if(checks.some(x=>!x.pass))process.exitCode=1;
} else {console.log('Use --serve or --qa');}
