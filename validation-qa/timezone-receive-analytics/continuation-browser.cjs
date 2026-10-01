// Uses the installed agent-browser CLI in isolated sessions. All Analytics data
// is live; only automatic portfolio capture is skipped. No wallet provider.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const cli = 'C:/Users/Admin/AppData/Roaming/npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe'
const session = `makoto-compact-${process.argv[2] || '1440'}`
const width = Number(process.argv[2] || 1440)
const feedProof = process.argv.includes('--feed-proof')
const finish = process.argv.includes('--finish') || feedProof
const priorPath = path.join(__dirname, `continuation-browser-${width}.json`)
const prior = finish ? JSON.parse(fs.readFileSync(path.join(__dirname,`continuation-browser-initial-${width}.json`),'utf8')).results : []
if(finish && !feedProof && !fs.existsSync(path.join(__dirname,`continuation-browser-before-anchor-${width}.json`))) fs.copyFileSync(priorPath,path.join(__dirname,`continuation-browser-before-anchor-${width}.json`))
const origin = 'http://localhost:5173'
const results = []
const run = (...args) => {
  // A newly launched Windows daemon inherits pipe handles. Redirect CLI JSON
  // to a task-local file so a successful launch cannot hold spawnSync open.
  const output = path.join(__dirname, `continuation-cli-${width}.tmp`)
  const fd = fs.openSync(output, 'w')
  try { execFileSync(cli, ['--session', session, '--json', ...args], { stdio:['ignore',fd,'inherit'], timeout:45000 }) }
  finally { fs.closeSync(fd) }
  const out = fs.readFileSync(output,'utf8')
  fs.unlinkSync(output)
  const parsed = JSON.parse(out)
  if (!parsed.success) throw new Error(JSON.stringify(parsed))
  return parsed.data
}
const evaluate = (code) => run('eval', '-b', Buffer.from(code).toString('base64')).result
const capture = (name) => run('screenshot', '--full', path.join(__dirname, `${name}.png`))
const inspect = `(() => {
  const main = document.querySelector('#mk-main');
  return {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    width: innerWidth, documentWidth: document.documentElement.scrollWidth,
    mainWidth: main.clientWidth, mainScrollWidth: main.scrollWidth,
    y: scrollY, maxY: document.documentElement.scrollHeight-innerHeight,
    title: main.querySelector('h1')?.textContent, text: main.innerText,
    nested: [...main.querySelectorAll('*')].filter(e=>['auto','scroll'].includes(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+1).length,
    cards: [...main.querySelectorAll('[data-analytics-card]')].map(e=>({
      card:e.dataset.analyticsCard, top:e.getBoundingClientRect().top+scrollY,height:e.getBoundingClientRect().height,
      rows:[...e.querySelectorAll('[data-analytics-transfer],[data-analytics-holder]')].map(r=>r.dataset.analyticsTransfer||r.dataset.analyticsHolder),
      button:e.querySelector('[data-analytics-disclosure]')?.textContent.trim(),
      expanded:e.querySelector('[data-analytics-disclosure]')?.getAttribute('aria-expanded'),
    })),
  };
})()`
function checkLayout(state) {
  assert.ok(state.documentWidth <= width, 'Document horizontal overflow')
  assert.ok(state.mainScrollWidth <= state.mainWidth, 'Main horizontal overflow')
  assert.equal(state.nested, 0, 'No inner scroll trap')
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function hold(target = 250, requireFeed = false) {
  const initial = evaluate(inspect)
  assert.ok(initial.maxY > 0, 'Page naturally scrollable')
  const y = Math.min(target, Math.max(1, initial.maxY - 100))
  evaluate(`window.scrollTo({top:${y},behavior:'instant'})`)
  await sleep(200)
  const before = evaluate(inspect), samples = []
  const start = Date.now()
  let observedPolls = []
  const returnedFeed = () => observedPolls.some(r=>r.path==='/api/arc/feed'&&r.status===200)
  while (Date.now() - start < 40000 && (Date.now()-start<17500 || requireFeed&&!returnedFeed())) {
    await sleep(1000)
    const state = evaluate(inspect)
    samples.push({ elapsed: Date.now()-start, y:state.y,maxY:state.maxY,cards:state.cards })
    checkLayout(state)
    assert.ok(Math.abs(state.y-before.y) <= 2, `Scroll moved ${before.y} -> ${state.y}`)
    if(requireFeed) observedPolls=run('network','requests','--filter','/api/arc/').requests.filter(r=>r.timestamp>=start).map(r=>({path:new URL(r.url).pathname,method:r.method,status:r.status,timestamp:r.timestamp}))
  }
  const polling = run('network','requests','--filter','/api/arc/').requests.filter(r=>r.timestamp>=start).map(r=>({path:new URL(r.url).pathname,method:r.method,status:r.status,timestamp:r.timestamp}))
  assert.ok(polling.some(r=>r.path==='/api/arc/network'&&r.status===200),'A real network poll must return during the hold')
  if(requireFeed) {
    assert.ok(returnedFeed(),'A successful live feed response must be observed')
    await sleep(750)
    const rendered=evaluate(inspect)
    checkLayout(rendered)
    assert.ok(Math.abs(rendered.y-before.y)<=2,'Position remains stable after the feed response renders')
    samples.push({elapsed:Date.now()-start,y:rendered.y,maxY:rendered.maxY,cards:rendered.cards})
  }
  return { before, elapsed:Date.now()-start,samples,polling }
}
async function main() {
  try {
    run('open', origin)
    run('wait','#mk-main h1')
    run('network','route','**/api/portfolio/snapshot','--body',JSON.stringify({status:'SKIPPED',reason:'READ_ONLY_BROWSER_QA',snapshot:null}))
    run('set','viewport',String(width),width === 390 ? '844' : '900')
    for (const language of ['vi','en']) for (const theme of ['dark','light']) {
      const saved = prior.find(r=>r.language===language&&r.theme===theme)
      const result = { ...saved,width,language,theme,startedAt:new Date().toISOString() }
      delete result.error
      try {
        evaluate(`localStorage.setItem('mk.lang',${JSON.stringify(language)});localStorage.setItem('mk.theme',${JSON.stringify(theme)});localStorage.setItem('mk.mode',JSON.stringify('watch'));localStorage.setItem('mk.address',JSON.stringify('0x16299b74c616994eaecb9b20e37d369d5d62586b'));`)
        run('open',origin)
        run('wait','#mk-main footer nav button')
        run('find','role','button','click','--name',language === 'vi'?'Phân tích':'Insights','--exact')
        run('wait','--fn',`document.querySelectorAll('[data-analytics-disclosure]').length===3`)
        if(!finish) {
        result.initial = evaluate(inspect)
        checkLayout(result.initial)
        assert.equal(result.initial.cards.length,4)
        assert.ok(result.initial.text.includes(language==='vi'?'Phân tích dữ liệu onchain của Arc và hoạt động mạng.':'Explore Arc onchain data and network activity.'))
        assert.doesNotMatch(result.initial.text,/Fear & Greed|Experimental|Prototype|Preview|Thử nghiệm/)
        result.disclosures = []
        for(const card of result.initial.cards.filter(c=>c.rows.length)) {
          assert.equal(card.rows.length,5)
          assert.equal(card.button,language==='vi'?'Xem thêm':'View more')
          const selector = `[data-analytics-card="${card.card}"] [data-analytics-disclosure]`
          run('focus',selector)
          const focus = evaluate(`(() => {const s=getComputedStyle(document.activeElement);return {controls:document.activeElement.getAttribute('aria-controls'),shadow:s.boxShadow};})()`)
          assert.ok(focus.controls)
          run('press','Enter')
          const expanded = evaluate(inspect).cards.find(c=>c.card===card.card)
          assert.ok(expanded.rows.length>5)
          assert.deepEqual(expanded.rows.slice(0,5),card.rows)
          assert.equal(expanded.expanded,'true')
          assert.equal(expanded.button,language==='vi'?'Thu gọn':'Show less')
          run('press','Enter')
          const collapsed = evaluate(inspect).cards.find(c=>c.card===card.card)
          assert.equal(collapsed.rows.length,5)
          assert.deepEqual(collapsed.rows,card.rows)
          result.disclosures.push({card:card.card,expanded:expanded.rows.length,focus})
        }
        evaluate('window.scrollTo({top:0,behavior:"instant"})')
        capture(`continuation-analytics-${width}-${language}-${theme}`)
        result.scroll = await hold()
        evaluate('window.scrollTo({top:document.documentElement.scrollHeight,behavior:"instant"})')
        result.footer = evaluate(`(() => {const r=document.querySelector('#mk-main footer').getBoundingClientRect();return {top:r.top,bottom:r.bottom,visible:r.top<innerHeight && r.bottom>0};})()`)
        assert.ok(result.footer.visible)
        }
        if(finish) {
          result.initialAnalyticsPassed = !!saved.scroll && !!saved.footer?.visible && saved.disclosures.length===3
          assert.ok(result.initialAnalyticsPassed)
          const selector='[data-analytics-card="recent-transfers"] [data-analytics-disclosure]'
          run('focus',selector)
          run('press','Enter')
          result.keyboardFocus=evaluate(`getComputedStyle(document.activeElement).boxShadow`)
          assert.notEqual(result.keyboardFocus,'none')
          result.expandedScroll=await hold(650,feedProof)
          assert.equal(evaluate(inspect).cards.find(c=>c.card==='recent-transfers').expanded,'true','Polls retain expansion state')
          run('click',selector)
          assert.equal(evaluate(inspect).cards.find(c=>c.card==='recent-transfers').rows.length,5)
          if(feedProof) {
            result.pass=true
            result.errors=run('errors');result.console=run('console')
            assert.equal(result.errors.errors.length,0)
            assert.equal(result.console.messages.filter(m=>m.type==='error').length,0)
            results.push(result)
            fs.writeFileSync(path.join(__dirname,`continuation-feed-scroll-${width}.json`),JSON.stringify({origin,results},null,2))
            console.log(JSON.stringify({width,language,theme,feedProof:true,pass:true}))
            continue
          }
        }
        // Check the same canonical Receive action on desktop and the shared drawer.
        if (width===390) run('find','role','button','click','--name',language==='vi'?'Mở menu':'Open menu','--exact')
        const nav = width===390?'#mk-mobile-sidebar':'aside'
        result.nav = evaluate(`(() => {const n=document.querySelector('${nav}');return [...n.querySelectorAll('[data-nav-id]')].map(e=>({id:e.dataset.navId,text:e.textContent.trim()}));})()`)
        const sendIndex=result.nav.findIndex(n=>n.id==='send')
        assert.equal(result.nav[sendIndex+1].id,'receive')
        assert.equal(result.nav.find(n=>n.id==='faucet').text,language==='vi'?'Nhận token':'Get test tokens')
        run('click',`${nav} [data-nav-id="receive"]`)
        run('wait','[role="dialog"]')
        run('wait','--text','0x16299b74c616994eaecb9b20e37d369d5d62586b')
        result.receive = evaluate(`(() => {const r=document.querySelector('[role="dialog"]');return {text:r.innerText,width:r.scrollWidth,client:r.clientWidth,receive:[...document.querySelectorAll('[data-nav-id="receive"]')].some(e=>e.getAttribute('aria-pressed')==='true'),faucet:[...document.querySelectorAll('[data-nav-id="faucet"]')].some(e=>e.getAttribute('aria-current')==='page')};})()`)
        assert.ok(result.receive.text.includes('0x16299b74c616994eaecb9b20e37d369d5d62586b'))
        assert.ok(result.receive.receive)
        assert.ok(!result.receive.faucet)
        assert.ok(result.receive.width<=result.receive.client)
        run('press','Escape')
        if (width===390) run('find','role','button','click','--name',language==='vi'?'Mở menu':'Open menu','--exact')
        run('click',`${nav} [data-nav-id="settings"]`)
        run('wait','--fn',`document.querySelector('#mk-main h1')?.textContent===${JSON.stringify(language==='vi'?'Cài đặt':'Settings')}`)
        result.settingsScroll=await hold()
        result.errors=run('errors')
        result.console=run('console')
        assert.equal(result.errors.errors.length,0)
        assert.equal(result.console.messages.filter(m=>m.type==='error').length,0)
        result.pass=true
      } catch(error) { result.pass=false;result.error=error.stack;capture(`continuation-failure-${width}-${language}-${theme}`) }
      results.push(result)
      fs.writeFileSync(path.join(__dirname,`${feedProof?'continuation-feed-scroll':'continuation-browser'}-${width}.json`),JSON.stringify({origin,results},null,2))
      console.log(JSON.stringify({width,language,theme,pass:result.pass,error:result.error}))
    }
  } finally {run('close')}
  if(results.some(r=>!r.pass)) process.exitCode=1
}
main().catch(error=>{console.error(error);process.exitCode=1})
