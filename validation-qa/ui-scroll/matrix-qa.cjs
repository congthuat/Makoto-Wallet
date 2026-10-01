const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require(process.env.MAKOTO_PLAYWRIGHT_PATH || 'C:/Users/Admin/AppData/Local/OpenAI/Codex/runtimes/cua_node/b63ee7ee40c23b77/bin/node_modules/playwright')
const root = path.resolve(__dirname, '../..')
const routes = ['Home', 'Portfolio', 'Assets', 'Activity', 'Settings', 'Tasks', 'Agent']
const retry = process.argv[2] === 'retry'
const results = retry ? JSON.parse(fs.readFileSync(path.join(__dirname, 'after-matrix.json'), 'utf8')) : []
async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    for (const mode of ['demo', 'connected']) for (const width of [1440, 390]) for (const language of ['en', 'vi']) for (const theme of ['dark', 'light']) {
      if (retry && !(mode === 'demo' && width === 1440 && language === 'en' && theme === 'dark')) continue
      await Promise.all(routes.map(async route => {
        const config = { mode, width, language, theme, route }
        if (retry) {
          const previous = results.findIndex(r => r.mode === mode && r.width === width && r.language === language && r.theme === theme && r.route === route)
          if (previous !== -1) results.splice(previous, 1)
        }
        const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 600 } })
        if (mode === 'connected') await context.addInitScript({ path: path.join(root, 'frontend/scripts/qa-mock-wallet.js') })
        await context.addInitScript(({ mode, language, theme }) => {
          localStorage.setItem('mk.lang', language)
          localStorage.setItem('mk.theme', theme)
          localStorage.setItem('mk.mode', JSON.stringify(mode))
          if (mode === 'connected') localStorage.setItem('mk.address', JSON.stringify('0x1111111111111111111111111111111111111111'))
          const scroll = window.scrollTo.bind(window)
          window.__qaScroll = []
          window.scrollTo = (...args) => { window.__qaScroll.push(args); return scroll(...args) }
          const focus = HTMLElement.prototype.focus
          window.__qaFocus = []
          HTMLElement.prototype.focus = function(...args) { window.__qaFocus.push(this.tagName); return focus.apply(this, args) }
        }, config)
        const page = await context.newPage()
        const errors = [], requests = [], responses = []
        page.on('pageerror', error => errors.push(error.message))
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        page.on('request', req => { if (req.url().includes('/api/')) requests.push({ at: Date.now(), method: req.method(), url: req.url() }) })
        page.on('response', res => { if (res.url().includes('/api/')) responses.push({ status: res.status(), url: res.url() }) })
        try {
          await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' })
          await page.locator('#mk-main').waitFor()
          const labels = await page.evaluate(async ({ language, route }) => {
            const { translate } = await import('/src/lib/i18n.ts')
            return { route: translate(route, language), menu: translate('Open menu', language) }
          }, config)
          if (route !== 'Home') {
            if (width === 390) {
              await page.getByRole('button', { name: labels.menu, exact: true }).click()
              await page.locator('#mk-mobile-sidebar').getByRole('button', { name: labels.route, exact: true }).click()
            } else await page.locator('aside').getByRole('button', { name: labels.route, exact: true }).click()
          }
          await page.waitForTimeout(2200)
          const start = await page.evaluate(() => {
            window.scrollTo({ top: Math.min(650, document.documentElement.scrollHeight - innerHeight), behavior: 'instant' })
            window.__qaScroll.length = 0
            window.__qaFocus.length = 0
            window.__qaMain = document.getElementById('mk-main')
            window.__qaActive = document.activeElement
            return { y: scrollY, height: document.documentElement.scrollHeight, url: location.href, title: document.title, language: document.documentElement.lang, theme: document.documentElement.dataset.theme }
          })
          const startedAt = Date.now(), samples = []
          for (let i = 0; i < 64; i++) {
            await page.waitForTimeout(250)
            samples.push(await page.evaluate(() => ({ y: scrollY, height: document.documentElement.scrollHeight, sameMain: window.__qaMain === document.getElementById('mk-main'), sameFocus: window.__qaActive === document.activeElement, url: location.href })))
          }
          const visible = await page.locator('#mk-main').innerText()
          const evidence = await page.evaluate(() => ({ scrollCalls: window.__qaScroll.length, focusCalls: window.__qaFocus.length, overflow: document.documentElement.scrollWidth > innerWidth, mode: localStorage.getItem('mk.mode'), attribution: [...document.querySelectorAll('#mk-main a')].filter(a => a.href.includes('coingecko')).map(a => ({ text: a.innerText, href: a.href })), emptySections: [...document.querySelectorAll('#mk-main section')].filter(s => s.children.length < 2).length }))
          const removedCopyFound = /Download source code|Get the full Makoto project as a \.zip file|Prototype 1|Tải mã nguồn|Tải toàn bộ dự án Makoto|Nguyên mẫu 1|Surf|PLAN_READY|Trạng Thái Trước|You review every step before anything happens\.|Live data|Dữ liệu thật/.test(visible)
          const stable = samples.every(s => Math.abs(s.y - start.y) <= 3 && s.sameMain && s.sameFocus && s.url === start.url) && evidence.scrollCalls === 0 && evidence.focusCalls === 0 && JSON.parse(evidence.mode) === mode
          const pollRequests = requests.filter(r => r.at >= startedAt && r.method === 'GET' && r.url.includes('/api/arc/network')).length
          const result = { ...config, start, durationMs: Date.now() - startedAt, samples, evidence, stable, pollRequests, removedCopyFound, errors, requests, responses, visible }
          results.push(result)
          console.log(JSON.stringify({ ...config, from: start.y, to: samples.at(-1).y, stable, scrollCalls: evidence.scrollCalls, focusCalls: evidence.focusCalls, pollRequests, removedCopyFound, errors }))
          if (route === 'Settings' || route === 'Home' || (route === 'Agent' && mode === 'demo')) await page.screenshot({ path: path.join(__dirname, `after-${mode}-${width}-${language}-${theme}-${route.toLowerCase()}.png`), fullPage: true })
        } catch (error) {
          results.push({ ...config, stable: false, exception: String(error), errors, requests, responses })
          console.log(JSON.stringify({ ...config, error: String(error) }))
        } finally { await context.close() }
      }))
      fs.writeFileSync(path.join(__dirname, 'after-matrix.json'), JSON.stringify(results, null, 2))
    }
  } finally {
    fs.writeFileSync(path.join(__dirname, 'after-matrix.json'), JSON.stringify(results, null, 2))
    await browser.close()
  }
  const failed = results.filter(r => !r.stable || r.removedCopyFound || r.errors.length || r.evidence?.overflow || !r.pollRequests)
  console.log(JSON.stringify({ total: results.length, failed: failed.map(r => ({ mode: r.mode, width: r.width, language: r.language, theme: r.theme, route: r.route, exception: r.exception, stable: r.stable, overflow: r.evidence?.overflow, errors: r.errors, pollRequests: r.pollRequests })) }))
  if (failed.length) process.exitCode = 1
}
main().catch(error => { console.error(error); process.exitCode = 1 })
