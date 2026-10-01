const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require(process.env.MAKOTO_PLAYWRIGHT_PATH || 'C:/Users/Admin/AppData/Local/OpenAI/Codex/runtimes/cua_node/b63ee7ee40c23b77/bin/node_modules/playwright')
const root = path.resolve(__dirname, '../..')
const phase = process.argv[2] || 'before'
const routes = ['Home', 'Portfolio', 'Assets', 'Activity', 'Settings', 'Tasks']

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const results = []
  try {
    for (const mode of ['demo', 'connected']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 600 } })
      if (mode === 'connected') await context.addInitScript({ path: path.join(root, 'frontend/scripts/qa-mock-wallet.js') })
      await context.addInitScript(({ mode }) => {
        localStorage.setItem('mk.lang', 'en')
        localStorage.setItem('mk.theme', 'dark')
        localStorage.setItem('mk.mode', JSON.stringify(mode))
        if (mode === 'connected') localStorage.setItem('mk.address', JSON.stringify('0x1111111111111111111111111111111111111111'))
        const original = window.scrollTo.bind(window)
        window.__scrollCalls = []
        window.scrollTo = (...args) => {
          window.__scrollCalls.push({ at: performance.now(), args, stack: new Error().stack })
          return original(...args)
        }
      }, { mode })
      for (const route of routes) {
        const page = await context.newPage()
        const errors = []
        page.on('pageerror', error => errors.push(error.message))
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' })
        await page.locator('#mk-main').waitFor()
        if (route !== 'Home') await page.locator('aside').getByRole('button', { name: route, exact: true }).click()
        await page.waitForTimeout(1800)
        const initial = await page.evaluate(() => {
          window.scrollTo({ top: Math.min(650, document.documentElement.scrollHeight - innerHeight), behavior: 'instant' })
          const main = document.getElementById('mk-main')
          window.__mainAtStart = main
          window.__scrollCalls.length = 0
          return { y: scrollY, height: document.documentElement.scrollHeight, title: document.title, focus: document.activeElement?.outerHTML.slice(0, 180) }
        })
        const start = Date.now()
        const samples = []
        for (let i = 0; i < (phase === 'before' ? 44 : 64); i++) {
          await page.waitForTimeout(250)
          samples.push(await page.evaluate(() => ({ y: scrollY, height: document.documentElement.scrollHeight, sameMain: window.__mainAtStart === document.getElementById('mk-main'), focus: document.activeElement?.tagName })))
        }
        const calls = await page.evaluate(() => window.__scrollCalls)
        const item = { phase, mode, route, durationMs: Date.now() - start, initial, samples, calls, errors }
        results.push(item)
        console.log(JSON.stringify({ phase, mode, route, initialY: initial.y, finalY: samples.at(-1).y, firstJumpMs: samples.findIndex(s => Math.abs(s.y - initial.y) > 3) < 0 ? null : (samples.findIndex(s => Math.abs(s.y - initial.y) > 3) + 1) * 250, scrollCalls: calls.length, mainPreserved: samples.every(s => s.sameMain), errors }))
        if (route === 'Settings' || route === 'Home') await page.screenshot({ path: path.join(__dirname, `${phase}-${mode}-${route.toLowerCase()}-1440.png`), fullPage: true })
        await page.close()
      }
      await context.close()
    }
  } finally {
    fs.writeFileSync(path.join(__dirname, `${phase}-browser.json`), JSON.stringify(results, null, 2))
    await browser.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
