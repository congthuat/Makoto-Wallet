import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

// Optional live-browser regression: start the normal app/API servers first.
// Run: node --test tests/scroll-stability.test.mjs
// MAKOTO_PLAYWRIGHT_PATH can point to an existing Playwright package or entry.
// MAKOTO_QA_URL defaults to http://localhost:5173. No dependencies are installed,
// requests intercepted, polling changed, or wallet signing controls exercised.
const require = createRequire(import.meta.url)

function loadPlaywright() {
  if (process.env.MAKOTO_PLAYWRIGHT_PATH) return require(process.env.MAKOTO_PLAYWRIGHT_PATH)
  for (const name of ['playwright', 'playwright-core']) {
    let entry
    try { entry = require.resolve(name) } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error
      continue
    }
    return require(entry)
  }
  return null
}

const playwright = loadPlaywright()
const origin = process.env.MAKOTO_QA_URL ?? 'http://localhost:5173'
const durationMs = 16_000 // Exceeds the unchanged 12-second Arc network poll.
const tolerancePx = 3

test('background reads preserve scroll on long product pages', {
  concurrency: 2,
  timeout: 75_000,
  skip: playwright ? false : 'Set MAKOTO_PLAYWRIGHT_PATH or provide an existing Playwright package to run live browser coverage.',
}, async (t) => {
  const browser = await playwright.chromium.launch({ channel: 'chrome', headless: true })
  try {
    await Promise.all(['Home', 'Settings'].map((route) => t.test(route, async (routeTest) => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 600 }, locale: 'en-US', colorScheme: 'dark' })
      try {
        await context.addInitScript(() => {
          localStorage.setItem('mk.lang', 'en')
          localStorage.setItem('mk.theme', 'dark')
          localStorage.setItem('mk.mode', JSON.stringify('demo'))
          localStorage.setItem('mk.address', JSON.stringify(''))
        })
        const page = await context.newPage()
        const errors = []
        const backgroundReads = []
        let observing = false
        page.on('pageerror', (error) => errors.push(error.message))
        page.on('request', (request) => {
          if (observing && request.method() === 'GET' && /\/api\/arc\/network$/.test(new URL(request.url()).pathname)) {
            backgroundReads.push({ url: request.url(), method: request.method() })
          }
        })
        await page.goto(origin, { waitUntil: 'domcontentloaded' })
        await page.locator('#mk-main').waitFor({ state: 'visible' })
        await page.locator('aside').getByRole('button', { name: route, exact: true }).click()
        if (route === 'Settings') await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor({ state: 'visible' })
        else await page.locator('#mk-main').getByText(/^Total balance(?:\s|$)/).waitFor({ state: 'visible' })
        await page.waitForFunction(() => window.scrollY <= 3)
        await page.waitForTimeout(1800) // Let initial loading and route animations finish.
        await page.locator('#mk-main').locator('input, textarea').first().focus()

        const start = await page.evaluate(async () => {
          const maximumY = document.documentElement.scrollHeight - window.innerHeight
          const targetY = Math.min(650, maximumY - 50)
          window.scrollTo({ top: targetY, behavior: 'instant' })
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

          const probe = {
            main: document.getElementById('mk-main'),
            focus: document.activeElement,
            url: location.href,
            startY: window.scrollY,
            minimumY: window.scrollY,
            maximumY: window.scrollY,
            calls: [],
            restorers: [],
          }
          const wrap = (owner, name) => {
            const original = owner[name]
            if (typeof original !== 'function') return
            owner[name] = function (...args) {
              probe.calls.push(name)
              return original.apply(this, args)
            }
            probe.restorers.push(() => { owner[name] = original })
          }
          for (const name of ['scroll', 'scrollTo', 'scrollBy']) wrap(window, name)
          for (const name of ['scroll', 'scrollTo', 'scrollBy', 'scrollIntoView']) wrap(Element.prototype, name)
          wrap(HTMLElement.prototype, 'focus')
          probe.timer = setInterval(() => {
            probe.minimumY = Math.min(probe.minimumY, window.scrollY)
            probe.maximumY = Math.max(probe.maximumY, window.scrollY)
          }, 100)
          window.__makotoScrollRegression = probe
          return { targetY, actualY: window.scrollY, maximumY }
        })
        assert.ok(start.actualY >= 300, `${route} must have enough content for a significant scroll: ${JSON.stringify(start)}`)
        assert.ok(Math.abs(start.actualY - start.targetY) <= tolerancePx, `${route} must reach its known scroll position`)
        observing = true
        await page.waitForTimeout(durationMs)
        observing = false
        const result = await page.evaluate(() => {
          const probe = window.__makotoScrollRegression
          if (!probe) return { reloaded: true, endY: window.scrollY, url: location.href }
          clearInterval(probe.timer)
          probe.restorers.forEach((restore) => restore())
          const result = {
            startY: probe.startY,
            endY: window.scrollY,
            minimumY: Math.min(probe.minimumY, window.scrollY),
            maximumY: Math.max(probe.maximumY, window.scrollY),
            sameMain: probe.main === document.getElementById('mk-main'),
            sameFocus: probe.focus === document.activeElement,
            sameUrl: probe.url === location.href,
            scriptedCalls: probe.calls,
          }
          delete window.__makotoScrollRegression
          return result
        })
        routeTest.diagnostic(JSON.stringify({ route, durationMs, ...result, backgroundReadCount: backgroundReads.length, pageErrors: errors }))
        assert.notEqual(result.reloaded, true, `${route} document reloaded during observation; finish live source edits before running this regression`)
        assert.ok(Math.abs(result.minimumY - result.startY) <= tolerancePx && Math.abs(result.maximumY - result.startY) <= tolerancePx,
          `${route} scroll moved during background refresh: ${JSON.stringify(result)}`)
        assert.equal(result.sameMain, true, `${route} must keep its mounted main element`)
        assert.equal(result.sameFocus, true, `${route} refresh must not move focus`)
        assert.equal(result.sameUrl, true, `${route} refresh must not navigate`)
        assert.deepEqual(result.scriptedCalls, [], `${route} refresh must not attempt scripted scrolling or focus`)
        assert.ok(backgroundReads.length > 0, `${route} must retain normal Arc network polling during the observation`)
        assert.deepEqual(errors, [], `${route} must have no JavaScript page errors`)
      } finally { await context.close() }
    })))
  } finally { await browser.close() }
})
