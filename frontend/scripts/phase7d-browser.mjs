// Production CSS + actual SSR component markup, isolated from wallet/provider code.
// Run from frontend after build/start. Artifacts must be outside the worktree.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { renderOverview, overviewCss, record } from "./phase7d-fixture.mjs";

const base = process.env.PHASE7D_URL ?? "http://127.0.0.1:3178";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const output = path.resolve(process.env.PHASE7D_OUTPUT ?? path.join(tmpdir(), "makoto-phase7d-qa"));
assert.ok(!output.startsWith(path.resolve("..") + path.sep), "QA artifacts outside worktree");
mkdirSync(output, {recursive:true});
const binary = process.env.AGENT_BROWSER_BINARY ?? (process.platform === "win32" ? path.join(process.env.APPDATA,"npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe") : "agent-browser");
const session = "makoto-phase7d-isolated-qa";
const logo = "data:image/png;base64,"+readFileSync("public/makoto/logo-pro-v2.png").toString("base64");
function execute(args, input) {
  const file=path.join(output,"command.json"), descriptor=openSync(file,"w");
  try { execFileSync(binary,["--session",session,"--json",...args],{timeout:45000,windowsHide:true,input,stdio:[input===undefined?"ignore":"pipe",descriptor,"inherit"]}); }
  finally { closeSync(descriptor); }
  const result=JSON.parse(readFileSync(file,"utf8")); assert.equal(result.success,true,result.error); return result.data;
}
const run=(...args)=>execute(args);
const evaluate=source=>execute(["eval","--stdin"],source).result;
const checks=[], cases=[];
function check(name,fn) { try { const result=fn(); checks.push({name,passed:true}); console.log("PASS "+name); return result; } catch(error) { checks.push({name,passed:false,error:error.stack}); console.log("FAIL "+name+": "+error.message); } }
const data=[record(),record({kind:"swap",direction:"send",source:"local",logIndex:2}),record({kind:"swap",direction:"send",source:"local",logIndex:3,swapReceive:{assetId:"eurc",assetSymbol:"EURC",amount:1123456n,logIndex:4}})];
function measure() { return evaluate(`(() => {
  const visible=e=>e.checkVisibility({contentVisibilityAuto:true}) && (!e.closest('details:not([open])') || e.closest('summary')?.parentElement===e.closest('details:not([open])'));
  const rect=e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height,width:r.width};};
  return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,h1:document.querySelectorAll("main h1").length,
    order:[".holdings",".actions","#assets","#activity",".agent"].map(s=>document.querySelector(s)).filter(Boolean).map(rect),
    controls:[...document.querySelectorAll("main a,main button,main summary,main input")].filter(visible).map(e=>({name:e.getAttribute("aria-label")||e.innerText||e.labels?.[0]?.innerText,...rect(e)})),
    clipped:[...document.querySelectorAll("main *")].filter(visible).filter(e=>e.scrollWidth>e.clientWidth+1 && e.clientWidth>0).map(e=>e.tagName+"."+e.className),
    text:document.querySelector("main").innerText};
})()`); }
function layout(name) {
  const m=measure(); cases.push({name,...m});
  assert.equal(m.scrollWidth,m.width,"page overflow"); assert.equal(m.h1,1);
  assert.ok(m.controls.every(c=>c.name && c.height>=44 && c.left>=0 && c.right<=m.width+1),JSON.stringify(m.controls));
  assert.deepEqual(m.clipped,[],"content must wrap without clipping");
  if(m.order.length) { assert.equal(m.order.length,5); for(let i=1;i<5;i++) assert.ok(m.order[i].top>=m.order[i-1].bottom-1,"visual hierarchy"); assert.ok(m.order[4].height<200,"compact closed Agent"); }
}
let shell;
function mount(locale,theme,overrides={}) {
  const html=renderOverview({locale,activities:data,activityPartial:true,...overrides});
  evaluate(`(() => {
    document.title="Test-only connected Overview fixture"; document.documentElement.lang=${JSON.stringify(locale)};document.documentElement.dataset.theme=${JSON.stringify(theme)};
    document.head.innerHTML='<meta name="viewport" content="width=device-width, initial-scale=1">';
    const localBase=document.createElement("base");localBase.href=${JSON.stringify(base)};document.head.append(localBase);
    const style=document.createElement("style");style.textContent=${JSON.stringify(shell.css+"\n"+overviewCss())};document.head.append(style);
    document.body.className=${JSON.stringify(shell.bodyClass)};
    document.body.innerHTML=${JSON.stringify(shell.html)};
    document.querySelector("main").innerHTML=${JSON.stringify(html)};
    document.querySelector(".wallet-control")?.replaceChildren(document.createTextNode("Test-only wallet fixture"));
    document.querySelectorAll("header img").forEach(img=>{img.removeAttribute("srcset");img.src=${JSON.stringify(logo)};});
    window.scrollTo(0,0);return true;
  })()`);
  run("wait","--fn",'document.fonts.status === "loaded"');
}
try {
  run("open",base);
  run("wait","--fn",'!!document.querySelector("main h1") && !document.querySelector("main [aria-busy=true]") && document.fonts.status === "loaded"');
  shell=evaluate(`(() => ({bodyClass:document.body.className,html:document.querySelector("main").parentElement.outerHTML,css:[...document.styleSheets].map(s=>[...s.cssRules].map(r=>r.cssText).join("\\n")).join("\\n")}))()`);
  // Embed the build's own Manrope fonts so about:blank cannot silently fall back
  // because a CSS-relative URL or cross-origin font request fails.
  shell.css=shell.css.replace(/url\(([^)]+)\)/g,(original,url)=>{
    const file=url.replace(/["']/g,"").split("?")[0];
    if(!file.endsWith(".woff2")) return original;
    return `url(data:font/woff2;base64,${readFileSync(path.join(".next/static/media",path.basename(file))).toString("base64")})`;
  });
  for(const width of [390,900,1440]) for(const locale of ["en","vi"]) for(const theme of ["light","dark"]) {
    const name=`${width}-${locale}-${theme}`;
    run("set","viewport",String(width),width===390?"844":"1000");
    run("open",base);
    const prefs=readFileSync("lib/preferences.ts","utf8");
    const localeKey=prefs.match(/MAKOTO_LOCALE_COOKIE\s*=\s*"([^"]+)"/)[1],themeKey=prefs.match(/MAKOTO_THEME_COOKIE\s*=\s*"([^"]+)"/)[1];
    evaluate(`document.cookie=${JSON.stringify(localeKey+"="+locale+"; Path=/")};document.cookie=${JSON.stringify(themeKey+"="+theme+"; Path=/")};true`);
    run("open",base);
    run("wait","--fn",'!!document.querySelector("main h1") && !document.querySelector("main [aria-busy=true]") && document.fonts.status === "loaded"');
    check("disconnected "+name,()=>layout("disconnected "+name));
    check("disconnected axe "+name,()=>{const axe=run("a11y");cases.push({name:"disconnected axe "+name,axe});assert.equal(axe.counts.violations,0,JSON.stringify(axe.violations));});
    run("screenshot",path.join(output,"disconnected-"+name+".png"),"--full");
    shell.html=evaluate('document.querySelector("main").parentElement.outerHTML');
    // about:blank destroys the live app; fixtures cannot call wallet APIs.
    run("open","about:blank"); mount(locale,theme);
    check("connected "+name,()=>layout("connected "+name));
    check("connected axe "+name,()=>{const axe=run("a11y","--selector","main");cases.push({name:"connected axe "+name,axe});assert.equal(axe.counts.violations,0,JSON.stringify(axe.violations));});
    run("screenshot",path.join(output,"connected-"+name+".png"),"--full");
    check("keyboard and disclosures "+name,()=>{
      run("focus",".actions button");run("press","Tab");
      assert.equal(evaluate('document.activeElement === document.querySelectorAll(".actions button")[1]'),true);
      assert.equal(evaluate('getComputedStyle(document.activeElement).outlineStyle'),"solid");
      run("focus",".agent details > summary");run("press","Enter");
      assert.equal(evaluate('document.querySelector(".agent details").open'),true);
      run("press","Tab");run("press","Tab");
      assert.equal(evaluate('document.activeElement.id'),"dashboard-agent-question");
      assert.equal(evaluate('getComputedStyle(document.activeElement).outlineStyle'),"solid");
      run("wait","--fn",'(() => { const r=document.activeElement.getBoundingClientRect(); return r.top>=0 && r.bottom<=innerHeight; })()');
      assert.equal(evaluate('(() => { const r=document.activeElement.getBoundingClientRect(); return r.top>=0 && r.bottom<=innerHeight; })()'),true,"focused composer is not obscured");
      if(width===390) run("screenshot",path.join(output,"composer-focus-"+name+".png"));
      assert.equal(evaluate('document.documentElement.scrollWidth'),width);
      run("focus",".network summary");run("press","Enter");
      run("focus",".assetDetails summary");run("press","Enter");
      assert.equal(evaluate('document.documentElement.scrollWidth'),width);
    });
    for(const state of ["large","loading","unavailable","wrong-network","empty"]) {
      const overrides=state==="large"?{connectorName:"VeryLongTestWalletProviderNameWithoutAnyBreaks".repeat(2),balances:{usdc:{data:123456789012345678901234567890n},eurc:{data:1n}}}:state==="loading"?{balances:{usdc:{isPending:true},eurc:{isPending:true}},activities:[],activityLoading:true}:state==="unavailable"?{balances:{usdc:{isError:true,data:999n},eurc:{isError:true}},activityUnavailable:true}:state==="wrong-network"?{onArc:false,chainId:1}:{activities:[],activityPartial:false};
      mount(locale,theme,overrides);
      check(state+" "+name,()=>layout(state+" "+name));
      if(width===390 && locale==="vi") run("screenshot",path.join(output,state+"-"+name+".png"),"--full");
    }
  }
} finally {
  writeFileSync(path.join(output,"results.json"),JSON.stringify({checks,cases},null,2));
  run("close");
}
console.log(JSON.stringify({checks:checks.length,passed:checks.filter(c=>c.passed).length,failed:checks.filter(c=>!c.passed).length,output}));
if(checks.some(c=>!c.passed)) process.exitCode=1;
