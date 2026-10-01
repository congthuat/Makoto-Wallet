const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('C:/Users/Admin/AppData/Local/OpenAI/Codex/runtimes/cua_node/b63ee7ee40c23b77/bin/node_modules/playwright')

const origin = 'http://localhost:5173'
const account = '0x16299b74c616994eaecb9b20e37d369d5d62586b'
const durationMs = 16_200
const agentOnly = process.argv.includes('--agent-only')
const routes = agentOnly ? ['Agent'] : ['Home', 'Agent', 'Settings']
const results = []
const configurations = [1440, 390].flatMap((width) => ['vi', 'en'].flatMap((language) => ['dark', 'light'].map((theme) => ({ width, language, theme }))))
const resultPath = path.join(__dirname, agentOnly ? 'final-agent-scroll.json' : 'scroll-results.json')
function save() { fs.writeFileSync(resultPath, JSON.stringify({ origin, durationMs, account, results }, null, 2)) }

async function navigate(page, route, config, labels) {
  if (route === 'Home') return
  if (config.width === 390) {
    await page.getByRole('button', { name: labels.menu, exact: true }).click()
    await page.locator('#mk-mobile-sidebar').getByRole('button', { name: labels[route], exact: true }).click()
  } else await page.locator('aside').first().getByRole('button', { name: labels[route], exact: true }).click()
  if (route === 'Settings') await page.getByRole('heading', { name: labels.Settings, exact: true }).waitFor()
  if (route === 'Agent') await page.locator('#mk-main').getByRole('textbox', { name: labels.message, exact: true }).waitFor()
  await page.waitForFunction(() => window.scrollY < 3)
  await page.waitForTimeout(1200)
}

async function addAgentContent(page, config, labels) {
  const input = page.locator('#mk-main').getByRole('textbox', { name: labels.message, exact: true })
  const question = config.language === 'vi' ? 'Danh mục của tôi trị giá bao nhiêu?' : 'What is my portfolio worth right now?'
  for (let index = 0; index < 6; index++) {
    await input.fill(question)
    await input.press('Enter')
    await page.locator('#mk-main').getByText(labels.preparing, { exact: true }).waitFor({ state: 'visible', timeout: 5000 })
    await page.locator('#mk-main').getByText(labels.preparing, { exact: true }).waitFor({ state: 'hidden', timeout: 15_000 })
  }
  await page.waitForTimeout(1200)
}

async function observe(page, route, config, errors, requests, responses) {
  const start = await page.evaluate(async () => {
    const windowMaximum = document.documentElement.scrollHeight - innerHeight
    const candidates = [...document.querySelectorAll('#mk-main *')].filter((element) => element instanceof HTMLElement && element.scrollHeight - element.clientHeight > 80 && ['auto', 'scroll'].includes(getComputedStyle(element).overflowY))
    const nested = candidates.sort((left, right) => (right.scrollHeight - right.clientHeight) - (left.scrollHeight - left.clientHeight))[0]
    const surface = windowMaximum > 100 ? null : nested
    const maximum = surface ? surface.scrollHeight - surface.clientHeight : windowMaximum
    const target = Math.min(650, Math.max(0, maximum - 40))
    if (surface) surface.scrollTo({ top: target, behavior: 'instant' })
    else window.scrollTo({ top: target, behavior: 'instant' })
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const position = () => surface ? surface.scrollTop : window.scrollY
    const probe = { surface, main: document.getElementById('mk-main'), focus: document.activeElement, initial: position(), min: position(), max: position(), samples: [], calls: [], startedAt: Date.now(), url: location.href, restorers: [] }
    for (const [owner, key] of [[window, 'scrollTo'], [window, 'scroll'], [window, 'scrollBy'], [Element.prototype, 'scrollIntoView'], [Element.prototype, 'scrollTo'], [HTMLElement.prototype, 'focus']]) {
      const original = owner[key]
      if (typeof original !== 'function') continue
      owner[key] = function(...args) { probe.calls.push({ kind: key, at: Date.now() }); return original.apply(this, args) }
      probe.restorers.push(() => { owner[key] = original })
    }
    probe.timer = setInterval(() => { const y = position(); probe.min = Math.min(probe.min, y); probe.max = Math.max(probe.max, y); probe.samples.push({ elapsed: Date.now() - probe.startedAt, y }) }, 200)
    window.__makotoAgentScrollProbe = probe
    return { initial: probe.initial, maximum, scrollSurface: surface ? `${surface.tagName}.${surface.className}` : 'window', documentHeight: document.documentElement.scrollHeight, viewportHeight: innerHeight, url: location.href }
  })
  const stem = `${agentOnly ? 'final-agent-scroll' : 'scroll'}-${config.width}-${config.language}-${config.theme}-${route.toLowerCase()}`
  await page.screenshot({ path: path.join(__dirname, `${stem}-before.png`) })
  const began = Date.now()
  await page.waitForTimeout(durationMs)
  const evidence = await page.evaluate(() => {
    const probe = window.__makotoAgentScrollProbe
    if (!probe) return { reloaded: true }
    clearInterval(probe.timer)
    probe.restorers.forEach((restore) => restore())
    const end = probe.surface ? probe.surface.scrollTop : window.scrollY
    const result = { end, min: Math.min(probe.min, end), max: Math.max(probe.max, end), elapsed: Date.now() - probe.startedAt, sameMain: probe.main === document.getElementById('mk-main'), sameFocus: probe.focus === document.activeElement, sameUrl: probe.url === location.href, calls: probe.calls, samples: probe.samples, overflow: document.documentElement.scrollWidth > innerWidth, mode: JSON.parse(localStorage.getItem('mk.mode')), theme: document.documentElement.dataset.theme, language: localStorage.getItem('mk.lang') }
    delete window.__makotoAgentScrollProbe
    return result
  })
  const polling = requests.filter((request) => request.at >= began && request.method === 'GET' && /\/api\/arc\/(?:network|wallet(?:\/|\?))/.test(request.url))
  const networkPolling = polling.filter((request) => /\/api\/arc\/network(?:$|\?)/.test(request.url))
  const walletPolling = polling.filter((request) => /\/api\/arc\/wallet(?:\/|\?)/.test(request.url))
  const success = start.initial > 50 && !evidence.reloaded && Math.abs(evidence.min - start.initial) <= 3 && Math.abs(evidence.max - start.initial) <= 3 && evidence.sameMain && evidence.sameFocus && evidence.sameUrl && !evidence.calls.length && !evidence.overflow && errors.length === 0 && networkPolling.length > 0
  await page.screenshot({ path: path.join(__dirname, `${stem}-after.png`) })
  const result = { ...config, route, start, evidence, success, networkPolls: networkPolling.length, walletPolls: walletPolling.length, errors: [...errors], backgroundRequests: polling, responses: responses.filter((response) => response.at >= began), screenshots: [`${stem}-before.png`, `${stem}-after.png`] }
  results.push(result)
  save()
  console.log(JSON.stringify({ ...config, route, success, from: start.initial, to: evidence.end, min: evidence.min, max: evidence.max, networkPolls: networkPolling.length, walletPolls: walletPolling.length, errors, calls: evidence.calls }))
}

async function runConfiguration(browser, config) {
  const context = await browser.newContext({ viewport: { width: config.width, height: config.width === 390 ? 844 : 720 }, locale: config.language === 'vi' ? 'vi-VN' : 'en-US', colorScheme: config.theme })
  await context.addInitScript(({ config, account }) => {
    localStorage.setItem('mk.mode', JSON.stringify('watch'))
    localStorage.setItem('mk.address', JSON.stringify(account))
    localStorage.setItem('mk.lang', config.language)
    localStorage.setItem('mk.theme', config.theme)
  }, { config, account })
  const page = await context.newPage()
  const errors = [], requests = [], responses = []
  page.on('pageerror', (error) => errors.push(`Page: ${error.message}`))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`Console: ${message.text()}`) })
  page.on('request', (request) => { if (request.url().includes('/api/')) requests.push({ at: Date.now(), method: request.method(), url: request.url() }) })
  page.on('response', (response) => { if (response.url().includes('/api/')) responses.push({ at: Date.now(), status: response.status(), url: response.url() }) })
  try {
    await page.goto(origin, { waitUntil: 'domcontentloaded' })
    await page.locator('#mk-main').waitFor()
    const labels = await page.evaluate(async ({ language }) => {
      const { translate } = await import('/src/lib/i18n.ts')
      return Object.fromEntries([['Home', 'Home'], ['Agent', 'Agent'], ['Settings', 'Settings'], ['menu', 'Open menu'], ['message', 'Message Makoto'], ['preparing', 'Preparing response…']].map(([key, source]) => [key, translate(source, language)]))
    }, config)
    await page.waitForTimeout(3000)
    for (const route of routes) {
      await navigate(page, route, config, labels)
      if (route === 'Agent') await addAgentContent(page, config, labels)
      await observe(page, route, config, errors, requests, responses)
    }
  } catch (error) {
    results.push({ ...config, route: 'UNFINISHED', success: false, exception: String(error), errors, requests, responses })
    save()
    console.error(JSON.stringify({ ...config, exception: String(error), errors }))
  } finally { await context.close() }
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  let next = 0
  try {
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next < configurations.length) {
        const config = configurations[next++]
        await runConfiguration(browser, config)
      }
    }))
  } finally { await browser.close(); save() }
  const failed = results.filter((result) => !result.success)
  console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed }))
  if (results.length !== configurations.length * routes.length || failed.length) process.exitCode = 1
}
main().catch((error) => { console.error(error); save(); process.exitCode = 1 })
