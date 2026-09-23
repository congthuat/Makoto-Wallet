// Local, disconnected browser regression. Requires the already installed agent-browser CLI.
// Run after npm run build and npm run start -- --hostname 127.0.0.1 --port 3177.
// No wallet/provider mocking, balances, signing or authentication on application routes.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync, openSync, closeSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const base = process.env.PHASE7B_URL ?? "http://127.0.0.1:3177";
assert.ok(new URL(base).hostname === "127.0.0.1" || new URL(base).hostname === "localhost", "Local test server only");
const binary = process.env.AGENT_BROWSER_BINARY ?? (process.platform === "win32"
  ? path.join(process.env.APPDATA, "npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe") : "agent-browser");
const output = path.resolve(process.env.PHASE7B_OUTPUT ?? "coverage/phase7b");
mkdirSync(output, { recursive: true });
const session = process.env.PHASE7B_SESSION ?? "makoto-phase7b-regression";
const cases = [], checks = [], failures = [];
function execute(args, input) {
  // On Windows the browser daemon can inherit a stdout pipe after the CLI exits.
  // A file descriptor avoids waiting for that daemon to close the command's pipe.
  const commandOutput = path.join(output, "command.json");
  const descriptor = openSync(commandOutput, "w");
  try {
    execFileSync(binary, ["--session", session, "--json", ...args], {
      timeout: 45000, windowsHide: true, input, stdio: [input === undefined ? "ignore" : "pipe", descriptor, "inherit"]
    });
  } catch (error) {
    const response = readFileSync(commandOutput, "utf8");
    throw new Error(`${args[0]} failed: ${response || error.message}`);
  } finally { closeSync(descriptor); }
  const result = JSON.parse(readFileSync(commandOutput, "utf8"));
  assert.equal(result.success, true, result.error);
  return result.data;
}
function run(...args) { return execute(args); }
function evaluate(source) { return execute(["eval", "--stdin"], source).result; }
function check(name, fn) {
  try { fn(); checks.push({ name, passed: true }); console.log("PASS " + name); }
  catch (error) { checks.push({ name, passed: false }); failures.push({ name, error: error.stack }); console.log("FAIL " + name + ": " + error.stack); }
}
const settled = () => run("wait", "--fn", '!!document.querySelector("main h1") && !document.querySelector(".release-state, main [aria-busy=true]") && document.fonts.status === "loaded" && (location.pathname !== "/agent" || !!document.querySelector("#agent-question"))');
const metrics = () => evaluate(`(() => {
  const main = document.querySelector("main"), header = document.querySelector("header");
  const visible = e => { const r=e.getBoundingClientRect();return r.width>0 && r.height>0 && getComputedStyle(e).visibility !== "hidden"; };
  const links = [...(header?.querySelectorAll("nav > a") ?? [])].map(e => {
    const r=e.getBoundingClientRect();
    return { name:e.getAttribute("aria-label") || e.innerText.trim(), visible:visible(e), left:r.left, right:r.right, width:r.width, height:r.height, href:e.getAttribute("href"), current:e.getAttribute("aria-current") };
  });
  const s=getComputedStyle(main), h=header?.getBoundingClientRect(), title=main.querySelector("h1").getBoundingClientRect();
  return { width:innerWidth, scrollWidth:document.documentElement.scrollWidth, links, h1:main.querySelectorAll("h1").length,
    text:s.color, canvas:getComputedStyle(main.parentElement).backgroundColor, surface:s.getPropertyValue("--mw-surface").trim(),
    themeText:s.getPropertyValue("--mw-text").trim(), navLabel:header?.querySelector("nav")?.getAttribute("aria-label"),
    headerBottom:h?.bottom ?? 0, titleTop:title.top, titleLeft:title.left,
    controls:[...(header?.querySelectorAll("button") ?? [])].filter(visible).map(e=>{const r=e.getBoundingClientRect();return {name:e.getAttribute("aria-label") || e.innerText.trim(),left:r.left,right:r.right,height:r.height};}) };
})()`);

try {
  if (!process.argv.includes("--guide-only")) {
  if (!process.argv.includes("--interaction-only")) {
  run("open", base); settled();
  for (const width of [390, 900, 1440]) for (const locale of ["en", "vi"]) for (const theme of ["light", "dark"]) {
    run("set", "viewport", String(width), "1000");
    if (width === 390) run("set", "viewport", "390", "844");
    // Exact cookie names are obtained from the production preference module below.
    const prefs = readFileSync("lib/preferences.ts", "utf8");
    const localeKey = prefs.match(/MAKOTO_LOCALE_COOKIE\s*=\s*"([^"]+)"/)[1];
    const themeKey = prefs.match(/MAKOTO_THEME_COOKIE\s*=\s*"([^"]+)"/)[1];
    evaluate(`document.cookie=${JSON.stringify(localeKey + "=" + locale + "; Path=/")};document.cookie=${JSON.stringify(themeKey + "=" + theme + "; Path=/")};true`);
    for (const route of ["/", "/agent", "/settings", "/savings", "/pay", "/unified-balance"]) {
      const foundation = ["/", "/agent", "/settings"].includes(route);
      const name = (route === "/" ? "overview" : route.slice(1)) + "-" + width + "-" + locale + "-" + theme;
      run("open", base + route); settled();
      const m = metrics();
      check(name + " layout", () => {
        assert.equal(m.scrollWidth, width);
        assert.equal(m.h1, 1);
        assert.equal(m.links.length, route === "/unified-balance" ? 0 : 5);
        assert.ok(m.links.every(l => l.name && l.visible && l.left >= 0 && l.right <= width + 1), JSON.stringify(m.links));
        assert.ok(m.links.every(l => l.height >= (width === 390 ? 44 : 40)), "navigation target size");
        assert.ok(m.surface && m.themeText, "Agent compatibility tokens must inherit");
        assert.notEqual(m.text, "rgb(0, 0, 0)", "Token text must resolve");
        assert.ok(m.titleTop >= m.headerBottom);
        assert.ok(m.controls.every(c => c.name && c.left >= 0 && c.right <= width + 1), JSON.stringify(m.controls));
        assert.ok(m.controls.every(c => c.height >= (width === 390 ? 44 : 40)), "header button target size");
        if (foundation && route !== "/") {
          const overview = cases.find(c => c.name === "overview-" + width + "-" + locale + "-" + theme);
          assert.equal(m.headerBottom, overview.headerBottom, "shared header height");
          assert.equal(m.titleTop, overview.titleTop, "shared page heading start");
          assert.equal(m.titleLeft, overview.titleLeft, "shared page heading alignment");
          assert.equal(m.canvas, overview.canvas, "shared canvas");
          assert.equal(m.text, overview.text, "shared text tokens");
        }
        assert.equal(evaluate("document.documentElement.lang"), locale);
        assert.equal(evaluate("document.documentElement.dataset.theme"), theme);
        if (m.links.length) assert.equal(m.navLabel, locale === "vi" ? "Điều hướng chính" : "Primary navigation");
        assert.equal(m.links.filter(l => l.current === "page").length, foundation ? 1 : 0);
      });
      const axe = run("a11y");
      if (foundation) check(name + " axe", () => assert.equal(axe.counts.violations, 0, JSON.stringify(axe.violations)));
      else {
        // Legacy feature redesign is deferred. Audit its content for comparison,
        // while enforcing zero violations in the shared header changed by 7B.
        if (m.links.length) check(name + " header axe", () => {
          const headerAxe = run("a11y", "--selector", "header");
          assert.equal(headerAxe.counts.violations, 0, JSON.stringify(headerAxe.violations));
        });
        console.log("LEGACY " + name + " page axe: " + axe.counts.violations + " violations (see results.json)");
      }
      run("screenshot", "--full", path.join(output, name + ".png"));
      cases.push({ name, scope: foundation ? "foundation" : "legacy compatibility", ...m, axe });
    }
  }
  } else {
    cases.push(...JSON.parse(readFileSync(path.join(output, "results.json"), "utf8")).cases);
    run("open", base); settled(); run("set", "viewport", "1440", "1000");
  }
  check("client navigation and fragment compatibility", () => {
    run("open", base + "/settings"); settled();
    run("click", 'header nav a[href="/agent"]'); run("wait", "--url", base + "/agent"); settled();
    const before = metrics();
    run("open", base + "/agent"); settled();
    assert.deepEqual(metrics(), before);
    run("click", 'header nav a[href="/settings#security"]'); settled();
    assert.equal(evaluate("location.hash"), "#security");
    run("open", base + "/#assets"); settled();
    assert.equal(evaluate('document.querySelector("header nav a[aria-current=page]").getAttribute("href")'), "/");
  });
  check("preferences preserve the Agent input and persist across navigation", () => {
    run("open", base + "/agent"); settled();
    run("fill", "#agent-question", "Phase 7B unsent input");
    run("click", 'header button[aria-controls]');
    run("click", 'header button[aria-pressed=false]');
    assert.equal(evaluate('document.querySelector("#agent-question").value'), "Phase 7B unsent input");
    assert.equal(evaluate('document.activeElement.hasAttribute("aria-controls")'), true, "locale selection restores trigger focus");
    const locale = evaluate("document.documentElement.lang");
    run("click", 'header button[title][aria-label]');
    const theme = evaluate("document.documentElement.dataset.theme");
    assert.equal(evaluate('document.querySelector("#agent-question").value'), "Phase 7B unsent input");
    run("click", 'header button[aria-controls]'); run("press", "Tab"); run("press", "Escape");
    assert.equal(evaluate('document.activeElement.hasAttribute("aria-controls")'), true);
    run("click", 'header nav a[href="/settings#security"]'); settled();
    assert.equal(evaluate("document.documentElement.lang"), locale);
    assert.equal(evaluate("document.documentElement.dataset.theme"), theme);
    run("open", base + "/settings"); settled();
    assert.equal(evaluate("document.documentElement.lang"), locale);
    assert.equal(evaluate("document.documentElement.dataset.theme"), theme);
  });
  check("keyboard skip link, menu dismissal and unobscured phone composer", () => {
    run("set", "viewport", "390", "844");
    run("open", base + "/agent"); settled();
    run("focus", 'a[href="#main-content"]');
    assert.equal(evaluate('getComputedStyle(document.activeElement).transform'), "none");
    assert.equal(evaluate('getComputedStyle(document.activeElement).outlineStyle'), "solid");
    run("press", "Enter");
    assert.equal(evaluate("document.activeElement.id"), "main-content");
    // Return to the header with the keyboard; the skip target scrolls smoothly,
    // so a pointer click here can race the header's changing viewport position.
    for (let index = 0; index < 12 && !evaluate('document.activeElement.hasAttribute("aria-controls")'); index++) run("press", "Shift+Tab");
    assert.equal(evaluate('document.activeElement.hasAttribute("aria-controls")'), true, "reverse Tab reaches the language trigger");
    run("press", "Enter");
    run("wait", "--fn", 'document.querySelector("header button[aria-controls]").getAttribute("aria-expanded") === "true" && !!document.querySelector("header button[aria-pressed]")');
    run("press", "Tab");
    assert.equal(evaluate('document.activeElement.hasAttribute("aria-pressed")'), true, "Tab reaches a native language choice");
    assert.equal(evaluate('getComputedStyle(document.activeElement).outlineStyle'), "solid", "language choice focus visible");
    run("press", "Escape");
    assert.equal(evaluate('document.activeElement.getAttribute("aria-expanded")'), "false");
    // Actual Tab traversal verifies keyboard-driven focus and scrolling together.
    for (let index = 0; index < 24 && evaluate("document.activeElement.id") !== "agent-question"; index++) run("press", "Tab");
    assert.equal(evaluate("document.activeElement.id"), "agent-question", "keyboard reaches the composer");
    run("wait", "--fn", '(() => {const r=document.querySelector("#agent-question").getBoundingClientRect();return r.top >= 0 && r.bottom <= innerHeight;})()');
    assert.equal(evaluate('getComputedStyle(document.activeElement).outlineStyle'), "solid", "composer focus visible");
    assert.equal(evaluate(`(() => {
      const form=document.querySelector("#agent-question").closest("form"), previous=form.previousElementSibling;
      const field=document.querySelector("#agent-question").getBoundingClientRect();
      return previous.getBoundingClientRect().bottom <= form.getBoundingClientRect().top + 1 && field.top >= 0 && field.bottom <= innerHeight;
    })()`), true, "composer and prompts do not overlap and focused field is visible after scrolling");
    run("screenshot", path.join(output, "agent-phone-composer-focus.png"));
    run("set", "viewport", "1440", "1000");
  });
  check("system uses the explicit light/dark palettes", () => {
    const prefs=readFileSync("lib/preferences.ts","utf8"), key=prefs.match(/MAKOTO_THEME_COOKIE\s*=\s*"([^"]+)"/)[1];
    evaluate(`document.cookie=${JSON.stringify(key + "=system; Path=/")};true`);
    run("open", base + "/agent"); settled();
    run("fill", "#agent-question", "OS theme change");
    for (const scheme of ["light", "dark"]) {
      run("set", "media", scheme);
      const match=cases.find(c => c.name === "agent-1440-en-" + scheme);
      assert.equal(metrics().canvas, match.canvas);
      assert.equal(metrics().text, match.text);
      assert.equal(evaluate('document.querySelector("#agent-question").value'), "OS theme change");
    }
  });
  check("isolated header fixture contains a long wallet address and Vietnamese network label", () => {
    run("open", base + "/agent"); settled();
    const fixture = evaluate(`(() => ({
      header:document.querySelector("header").outerHTML,
      css:[...document.styleSheets].map(s=>[...s.cssRules].map(r=>r.cssText).join("\\n")).join("\\n")
    }))()`);
    run("open", "about:blank");
    evaluate(`(() => {
      document.title="Test-only header layout fixture";
      const style=document.createElement("style");style.textContent=${JSON.stringify(fixture.css)};document.head.append(style);
      document.body.innerHTML=${JSON.stringify(fixture.header)};
      document.querySelector(".wallet-control").innerHTML='<button class="wallet-summary wrong-chain"><span class="wallet-status-dot"></span><span><strong>0x1111111111111111111111111111111111111111</strong><small>Mạng không được hỗ trợ</small></span></button>';
    })()`);
    for (const width of [390,900,1440]) {
      run("set","viewport",String(width),"844");
      const value=evaluate(`(() => {
        const button=document.querySelector(".wallet-summary"), text=button.querySelector("strong"), r=button.getBoundingClientRect();
        return {width:document.documentElement.scrollWidth,left:r.left,right:r.right,height:r.height,ellipsis:getComputedStyle(text).textOverflow,clipped:text.scrollWidth>text.clientWidth,text:text.textContent};
      })()`);
      assert.equal(value.width,width);
      assert.ok(value.left>=0 && value.right<=width && value.height>=44,JSON.stringify(value));
      assert.equal(value.ellipsis,"ellipsis"); assert.equal(value.clipped,true);
      assert.equal(value.text.length,42,"truncation never changes the underlying address text");
    }
  });
  check("legacy action aliases preserve text contrast at rest and on hover", () => {
    const css=readFileSync("app/ledger-calm.css","utf8")+"\n"+readFileSync("app/globals.css","utf8").replace('@import "./ledger-calm.css";','')+"\n"+readFileSync("components/MakotoAgentPage.module.css","utf8");
    run("open","about:blank");
    evaluate(`(() => {
      document.title="Test-only legacy action contrast fixture";
      const style=document.createElement("style");style.textContent=${JSON.stringify(css)};document.head.append(style);
      document.body.innerHTML='<div class="create-modal deposit-modal"><div class="modal-actions"><button class="primary-action">Approve exact</button></div><button class="switch-review">Review network</button><button class="switch-button">Switch network</button></div><section class="chat"><button class="prepareButton">Test-only review control</button></section>';
    })()`);
    for(const theme of ["light","dark"]) for(const selector of [".primary-action",".switch-review",".switch-button",".prepareButton"]) {
      evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      for(const state of ["rest","hover"]) {
        if(state==="hover") run("hover",selector); else run("hover","body");
        const contrastSource=`(() => {
          const s=getComputedStyle(document.querySelector(${JSON.stringify(selector)}));
          const luminance=color=>color.match(/[\\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
          const a=luminance(s.color),b=luminance(s.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
        })()`;
        // Background transitions are allowed to finish before testing the solid pair.
        run("wait","--fn",`document.getAnimations().every(a=>a.playState!=="running")`);
        assert.ok(evaluate(contrastSource)>=4.5,theme+" "+selector+" "+state+" contrast");
      }
    }
  });
  }
  // Isolated test-only fixture with the installed React/ReactDOM development runtime.
  // Real commits, autofocus and Strict Mode effects; no wallet APIs or new dependencies.
  check("CreateWalletGuide focus containment, Escape, restoration and inert background", () => {
    const localRequire = createRequire(import.meta.url);
    const runtime = Object.fromEntries([
      ["react", "react", "react.development.js"],
      ["react/jsx-runtime", "react", "react-jsx-runtime.development.js"],
      ["react-dom", "react-dom", "react-dom.development.js"],
      ["react-dom/client", "react-dom", "react-dom-client.development.js"],
      ["scheduler", "scheduler", "scheduler.development.js"],
    ].map(([id, pkg, file]) => [id, readFileSync(path.join(path.dirname(localRequire.resolve(pkg + "/package.json")), "cjs", file), "utf8")]));
    const compiled = ts.transpileModule(readFileSync("components/CreateWalletGuide.tsx", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    const dashboard = ts.createSourceFile("WalletDashboard.tsx", readFileSync("components/WalletDashboard.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let guideChildren, createHandler;
    function visit(node) {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(dashboard) === "CreateWalletGuide") guideChildren = node.children.find(ts.isJsxExpression).expression.getText(dashboard);
      if (ts.isFunctionDeclaration(node) && node.name?.text === "beginCreateWallet") createHandler = node.getText(dashboard);
      ts.forEachChild(node, visit);
    }
    visit(dashboard);
    assert.ok(guideChildren && createHandler, "fixture uses the actual guide children and creation handler");
    const compile = source => ts.transpileModule(source, { fileName: "fixture.tsx", compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
    const dictionaries = Object.fromEntries(["en", "vi"].map(locale => {
      const dictionaryExports = {};
      new Function("exports", compile(readFileSync("i18n/" + locale + ".ts", "utf8")))(dictionaryExports);
      return [locale, dictionaryExports[locale]];
    }));
    run("open", base); settled();
    const fontContext = evaluate(`(() => ({htmlClass:document.documentElement.className,bodyClass:document.body.className,pageClass:document.querySelector("main").parentElement.className,mainClass:document.querySelector("main").className,header:document.querySelector("header").outerHTML,
      css:[...document.styleSheets].map(s=>[...s.cssRules].map(r=>r.cssText.replace(/url\\(["']?([^"')]+)["']?\\)/g,(_,url)=>'url("'+new URL(url,s.href || location.href).href+'")')).join("\\n")).join("\\n")}))()`);
    run("open", "about:blank");
    evaluate(`(() => {
      document.title="Test-only React create guide";document.documentElement.lang="en";
      document.documentElement.className=${JSON.stringify(fontContext.htmlClass)};document.body.className=${JSON.stringify(fontContext.bodyClass)};
      const sources=${JSON.stringify(runtime)},cache={};
      const require=id=>{
        if(id.endsWith(".module.css"))return {default:{guide:"guide"}};
        if(id==="@/hooks/usePreferences")return {usePreferences:()=>({t:key=>key==="common.close"?"Close":key})};
        if(cache[id])return cache[id].exports;
        const module={exports:{}};cache[id]=module;
        new Function("require","module","exports","process",sources[id])(require,module,module.exports,{env:{NODE_ENV:"development"}});
        return module.exports;
      };
      const exports={};
      ${compiled}
      const React=require("react"), {createRoot}=require("react-dom/client"), {flushSync}=require("react-dom"), jsx=require("react/jsx-runtime").jsx;
      const dictionaries=${JSON.stringify(dictionaries)},foundation={choices:"choices"};
      window.fixtureLocale="en";
      const t=key=>dictionaries[window.fixtureLocale][key],beginCreateWallet=method=>window.fixtureCreateMethod?.(method);
      (()=>{${compile("exports.guideChildren = " + guideChildren)}})();
      const style=document.createElement("style");style.textContent=${JSON.stringify(fontContext.css+"\n"+readFileSync("components/OverviewFoundation.module.css","utf8"))};document.head.append(style);
      const trigger=document.createElement("button");trigger.id="fixture-trigger";trigger.textContent="Open test guide";document.body.append(trigger);
      const container=document.createElement("main");document.body.append(container);const root=createRoot(container);
      const close=()=>flushSync(()=>root.render(null));
      window.fixtureUnmount=close;
      window.fixtureMount=(strict=false)=>{
        trigger.focus();
        const guide=jsx(exports.CreateWalletGuide,{onClose:close,children:exports.guideChildren});
        flushSync(()=>root.render(strict?jsx(React.StrictMode,{children:guide}):guide));
        document.querySelector("dialog header button").id="fixture-close";
        const choices=document.querySelectorAll("dialog .choices button");choices[0].id="fixture-email";choices[1].id="fixture-google";
      };window.fixtureMount();
      const onboarding={};new Function("exports",${JSON.stringify(compile(readFileSync("lib/onboarding.ts", "utf8")))})(onboarding);
      const stored={};window.fixtureHandoff={calls:[],stored,intent:null};
      const appKit={open:async options=>{
        window.fixtureHandoff.calls.push(options);
        const auth=document.createElement("dialog"),field=document.createElement("input");auth.id="fixture-appkit";field.id="fixture-appkit-focus";auth.append(field);document.body.append(auth);auth.showModal();field.focus();
      }};
      window.fixtureCreateMethod=new Function("getAppKit","window","setOnboardingIntent","setCreateGuideOpen","appKitViewForCreateMethod","ONBOARDING_INTENT_KEY",${JSON.stringify(compile(createHandler)+"\nreturn beginCreateWallet;")})(
        ()=>appKit,{sessionStorage:{setItem:(key,value)=>stored[key]=value}},value=>window.fixtureHandoff.intent=value,
        value=>{if(!value)queueMicrotask(close);},onboarding.appKitViewForCreateMethod,onboarding.ONBOARDING_INTENT_KEY);
      const panelModule={};new Function("exports","require",${JSON.stringify(compile(readFileSync("components/WalletPanel.tsx","utf8")))})(panelModule,require);
      window.fixtureMountPanel=()=>{
        close();
        const page=document.createElement("div");page.className=${JSON.stringify(fontContext.pageClass)};
        page.innerHTML=${JSON.stringify(fontContext.header)};document.body.append(page);
        container.className=${JSON.stringify(fontContext.mainClass)};page.append(trigger,container);trigger.focus();
        flushSync(()=>root.render(jsx(panelModule.WalletPanel,{title:"Test-only transaction panel",onClose:close,children:jsx("button",{id:"fixture-panel-last",children:"Test-only final control"})})));
      };
      return true;
    })()`);
    assert.equal(evaluate("document.activeElement.id"), "fixture-email");
    run("focus", "#fixture-google"); run("press", "Tab");
    assert.equal(evaluate("document.activeElement.id"), "fixture-close");
    run("press", "Shift+Tab");
    assert.equal(evaluate("document.activeElement.id"), "fixture-google");
    evaluate('document.querySelector("#fixture-trigger").focus()');
    assert.ok(evaluate('document.querySelector("dialog").contains(document.activeElement)'), "background is inert");
    run("press", "Escape");
    assert.equal(evaluate("document.activeElement.id"), "fixture-trigger");
    assert.equal(evaluate("document.body.style.overflow"), "");
    assert.equal(evaluate("!!document.querySelector('dialog')"), false);
    evaluate("window.fixtureMount(true)");
    assert.equal(evaluate("document.activeElement.id"), "fixture-email", "Strict Mode replay reopens with initial focus");
    run("click", "#fixture-close");
    assert.equal(evaluate("document.activeElement.id"), "fixture-trigger", "close button restores focus");
    evaluate("window.fixtureMount()");
    evaluate(`(() => {
      const dialog=document.querySelector("dialog"), rect=dialog.getBoundingClientRect();
      dialog.dispatchEvent(new MouseEvent("click",{bubbles:true,clientX:rect.left-1,clientY:rect.top-1}));
    })()`);
    assert.equal(evaluate("document.activeElement.id"), "fixture-trigger", "backdrop dismissal restores focus");
    evaluate(`(() => {
      window.fixtureMount();
      const auth=document.createElement("dialog"), field=document.createElement("input");
      auth.id="fixture-external-modal";field.id="fixture-external-focus";auth.append(field);document.body.append(auth);
      auth.showModal();field.focus();window.fixtureUnmount();
    })()`);
    assert.equal(evaluate("document.activeElement.id"), "fixture-external-focus", "unmount must not steal the next modal's focus");
    evaluate('document.querySelector("#fixture-external-modal").close()');
    for (const method of ["email", "google"]) {
      evaluate("window.fixtureMount()");
      run("click", "#fixture-" + method);
      run("wait", "--fn", '!document.querySelector("dialog.guide") && document.activeElement.id === "fixture-appkit-focus"');
      const handoff = evaluate("window.fixtureHandoff");
      assert.deepEqual(handoff.calls.at(-1), { view: "Connect" });
      assert.equal(handoff.intent, "create");
      assert.equal(handoff.stored.makoto_wallet_onboarding_intent, "create");
      assert.equal(evaluate("document.body.style.overflow"), "");
      evaluate('document.querySelector("#fixture-appkit").close();document.querySelector("#fixture-appkit").remove()');
    }
    for (const width of [390,900,1440]) for (const locale of ["en","vi"]) for (const theme of ["light","dark"]) {
      const name = "create-guide-" + width + "-" + locale + "-" + theme;
      run("set", "viewport", String(width), width === 390 ? "844" : "1000");
      evaluate(`window.fixtureLocale=${JSON.stringify(locale)};document.documentElement.lang=${JSON.stringify(locale)};document.documentElement.dataset.theme=${JSON.stringify(theme)};window.fixtureMount()`);
      run("wait", "--fn", 'document.fonts.status === "loaded"');
      const bounds=evaluate(`(() => {const d=document.querySelector("dialog.guide"),r=d.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,overflow:d.scrollWidth>d.clientWidth,focus:d.contains(document.activeElement)};})()`);
      assert.ok(bounds.left>=0 && bounds.right<=width && bounds.top>=0 && bounds.bottom<=(width===390?844:1000) && !bounds.overflow && bounds.focus,JSON.stringify(bounds));
      const axe=run("a11y", "--selector", "dialog.guide");
      assert.equal(axe.counts.violations,0,JSON.stringify(axe.violations));
      assert.equal(axe.counts.incomplete,0,JSON.stringify(axe.incomplete));
      run("screenshot", path.join(output,name+".png"));
      checks.push({name,passed:true,axe:axe.counts});
      run("press","Escape");
      assert.equal(evaluate("document.activeElement.id"),"fixture-trigger");
    }
    for (const width of [390,900,1440]) for (const theme of ["light","dark"]) {
      run("set","viewport",String(width),"844");
      evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)};window.fixtureMountPanel()`);
      const bounds=evaluate(`(() => {const b=document.querySelector(".modal-backdrop"),r=b.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,inside:document.querySelector(".wallet-action-modal").contains(document.activeElement),stack:document.elementFromPoint(innerWidth/2,innerHeight/2)?.closest(".modal-backdrop")===b};})()`);
      assert.deepEqual(bounds,{left:0,top:0,right:width,bottom:844,inside:true,stack:true});
      run("press","Shift+Tab");assert.equal(evaluate("document.activeElement.id"),"fixture-panel-last");
      run("press","Tab");assert.equal(evaluate('document.activeElement.getAttribute("aria-label")'),"Close");
      run("press","Escape");assert.equal(evaluate("document.activeElement.id"),"fixture-trigger");
      assert.equal(evaluate("document.body.style.overflow"),"");
      checks.push({name:"wallet-panel-shell-"+width+"-"+theme,passed:true});
    }
  });
} catch (error) {
  failures.push({ name: "browser runner", error: error.message });
  throw error;
} finally {
  writeFileSync(path.join(output, process.argv.includes("--guide-only") ? "guide-results.json" : process.argv.includes("--interaction-only") ? "interaction-results.json" : "results.json"), JSON.stringify({ cases, checks, failures }, null, 2));
  run("close");
}
assert.equal(failures.length, 0, JSON.stringify(failures, null, 2));
console.log("Phase 7B browser regression passed: " + cases.length + " route/theme/locale/width cases plus interaction checks.");
