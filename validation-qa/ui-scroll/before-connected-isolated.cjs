const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { pathToFileURL } = require('node:url')
const { chromium } = require(process.env.MAKOTO_PLAYWRIGHT_PATH)

// Reproduce the original lifecycle with ONLY the saved App module served from
// memory. Current production files are never restored or rewritten. Cache and
// port are isolated from the normal server, and the wallet fixture blocks writes.
const root = path.resolve(__dirname, '../..')
const frontendRoot = path.join(root, 'frontend')
const frontendRequire = createRequire(path.join(frontendRoot, 'package.json'))
const appPath = path.join(frontendRoot, 'src/App.tsx').replaceAll('\\', '/')
const baselineApp = fs.readFileSync(path.join(__dirname, 'resume-baseline/frontend/src/App.tsx'), 'utf8')
const walletFixture = fs.readFileSync(path.join(frontendRoot, 'scripts/qa-mock-wallet.js'), 'utf8')
const routes = ['Home', 'Portfolio', 'Assets', 'Activity', 'Settings']
const forbiddenMethods = /^(?:eth_sendTransaction|eth_sendRawTransaction|eth_sign|eth_signTypedData.*|personal_sign|wallet_sendCalls)$/

async function main() {
  process.env.BACKEND_PORT = process.env.BACKEND_PORT || '3001'
  const { createServer } = await import(pathToFileURL(frontendRequire.resolve('vite')).href)
  const server = await createServer({
    root: frontendRoot,
    configFile: path.join(frontendRoot, 'vite.config.ts'),
    cacheDir: path.join(__dirname, 'isolated-vite-cache'),
    server: { port: 5174, strictPort: true, host: '127.0.0.1', hmr: false },
    plugins: [{
      name: 'saved-app-only-before-scroll-fix',
      enforce: 'pre',
      load(id) { if (id.split('?')[0].replaceAll('\\', '/') === appPath) return baselineApp },
    }],
  })
  await server.listen()
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const results = []
  try {
    await Promise.all(routes.map(async (route) => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 600 }, locale: 'en-US', colorScheme: 'dark' })
      try {
        await context.addInitScript({ content: walletFixture + `
          localStorage.setItem('mk.lang', 'en');
          localStorage.setItem('mk.theme', 'dark');
          localStorage.setItem('mk.mode', JSON.stringify('connected'));
          localStorage.setItem('mk.address', JSON.stringify('0x1111111111111111111111111111111111111111'));
          window.__walletMethods = [];
          const request = window.ethereum.request.bind(window.ethereum);
          window.ethereum.request = (payload) => { window.__walletMethods.push(payload.method); return request(payload); };
          const original = window.scrollTo.bind(window);
          window.__scrollCalls = [];
          window.scrollTo = (...args) => { window.__scrollCalls.push({ at: performance.now(), args, stack: new Error().stack }); return original(...args); };
        ` })
        const page = await context.newPage()
        const errors = []
        const httpFailures = []
        page.on('pageerror', (error) => errors.push(error.message))
        page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
        page.on('response', async (response) => {
          if (response.status() < 400) return
          const body = await response.json().catch(() => null)
          httpFailures.push({ url: response.url(), status: response.status(), code: body?.code ?? null })
        })
        await page.goto('http://127.0.0.1:5174', { waitUntil: 'domcontentloaded' })
        await page.locator('#mk-main').waitFor({ state: 'visible' })
        await page.getByRole('button', { name: 'Account menu', exact: true }).waitFor({ state: 'visible' })
        if (route !== 'Home') await page.locator('aside').getByRole('button', { name: route, exact: true }).click()
        await page.waitForTimeout(1800)
        const initial = await page.evaluate(() => {
          window.scrollTo({ top: Math.min(650, document.documentElement.scrollHeight - innerHeight), behavior: 'instant' })
          window.__mainAtStart = document.getElementById('mk-main')
          window.__scrollCalls.length = 0
          return { y: scrollY, height: document.documentElement.scrollHeight, title: document.title, storedMode: JSON.parse(localStorage.getItem('mk.mode')) }
        })
        assert.equal(initial.storedMode, 'connected')
        assert.ok(initial.y > 200, `${route} must be vertically scrollable`)
        const startAt = Date.now()
        const samples = []
        for (let index = 0; index < 46; index++) {
          await page.waitForTimeout(250)
          samples.push(await page.evaluate(() => ({ y: scrollY, sameMain: window.__mainAtStart === document.getElementById('mk-main'), height: document.documentElement.scrollHeight })))
        }
        const evidence = await page.evaluate(() => ({ calls: window.__scrollCalls, walletMethods: window.__walletMethods }))
        const firstJump = samples.findIndex((sample) => Math.abs(sample.y - initial.y) > 3)
        const result = { phase: 'before', mode: 'connected', wallet: 'isolated read-only provider fixture', baseline: 'Only saved App.tsx served from memory', route, durationMs: Date.now() - startAt, initial, samples, firstJumpMs: firstJump < 0 ? null : (firstJump + 1) * 250, ...evidence, errors, httpFailures }
        results.push(result)
        console.log(JSON.stringify({ route, mode: initial.storedMode, initialY: initial.y, finalY: samples.at(-1).y, firstJumpMs: result.firstJumpMs, scriptedScrollCalls: evidence.calls.length, sameMain: samples.every((sample) => sample.sameMain), forbiddenWalletCalls: evidence.walletMethods.filter((method) => forbiddenMethods.test(method)), errors, httpFailures }))
        assert.ok(firstJump >= 0 && samples.at(-1).y === 0, `${route} must reproduce the original jump to top`)
        assert.ok(evidence.calls.some((call) => call.stack.includes('App.tsx')), `${route} must record the App scroll call`)
        assert.deepEqual(evidence.walletMethods.filter((method) => forbiddenMethods.test(method)), [])
      } finally { await context.close() }
    }))
  } finally {
    fs.writeFileSync(path.join(__dirname, 'before-connected-browser.json'), JSON.stringify(results, null, 2))
    await browser.close()
    await server.close()
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
