/* Product matrix. Live wallet/network/analytics reads; isolated task context only.
 * Every task/auth mutation and signature/write RPC is blocked. Parsing calls the
 * actual backend parser in-process; no task is created or stored. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('C:/Users/Admin/AppData/Local/OpenAI/Codex/runtimes/cua_node/b63ee7ee40c23b77/bin/node_modules/playwright')
const { parseIntent } = require('../../backend/lib/taskDefinitions.js')
const origin = 'http://localhost:5173'
const account = '0x16299b74c616994eaecb9b20e37d369d5d62586b'
const analyticsOnly = process.argv.includes('--analytics')
const receiveOnly = process.argv.includes('--receive')
const rerunAffected = process.argv.includes('--rerun-affected')
const viFinal = process.argv.includes('--vi-final')
const routes = analyticsOnly ? ['Analytics'] : receiveOnly ? ['Receive'] : ['Home', 'Tasks', 'Receive', 'Settings']
const configurations = [1440, 1280, 390].flatMap(width => ['vi', 'en'].flatMap(language => ['dark', 'light'].map(theme => ({ width, language, theme }))))
let cases = configurations.flatMap(config => routes.map(route => ({ ...config, route })))
if (rerunAffected) {
  const first = JSON.parse(fs.readFileSync(path.join(__dirname, 'matrix-analytics-results.json'), 'utf8')).results
  cases = cases.filter(config => first.some(row => !row.success && row.route === config.route && row.width === config.width && row.language === config.language && row.theme === config.theme))
}
if (viFinal) cases = cases.filter(config => config.language === 'vi')
const filename = viFinal ? 'matrix-analytics-vi-final.json' : rerunAffected ? 'matrix-analytics-rerun.json' : analyticsOnly ? 'matrix-analytics-results.json' : receiveOnly ? 'matrix-receive-results.json' : 'matrix-primary-results.json'
const results = []
const fixtureTasks = [
  ['Bangkok', 'Asia/Bangkok', '2026-10-02T01:00:00.000Z'],
  ['NY winter', 'America/New_York', '2026-01-15T13:00:00.000Z'],
  ['NY summer', 'America/New_York', '2026-07-15T12:00:00.000Z'],
].map(([id, timezone, nextRunAt]) => ({
  id, type: 'SCHEDULED_AUTOMATION', title: 'Daily portfolio summary', description: '', account,
  chainId: 5042002, timezone, sourceIntent: 'Summarize my portfolio every day at 08:00', locale: 'en',
  condition: null, schedule: { kind: 'DAILY', time: '08:00', action: 'PORTFOLIO_SUMMARY' },
  authority: 'READ_ONLY', createdBy: 'USER', status: 'ACTIVE', nextRunAt, lastRunAt: null,
  lastResult: null, lastError: null, triggerCount: 0, previousConditionState: null,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
}))
function save() { fs.writeFileSync(path.join(__dirname, filename), JSON.stringify({ origin, timezoneId: 'Asia/Bangkok', account, fixtureBoundary: 'Only Tasks uses mocked verified session/list and read-only EIP-6963; POST parse runs real backend parseIntent. Other pages use watch account; Analytics API responses are entirely live.', results }, null, 2)) }

function initialize({ config, account }) {
  localStorage.setItem('mk.mode', JSON.stringify(config.route === 'Tasks' ? 'connected' : 'watch'))
  localStorage.setItem('mk.address', JSON.stringify(account))
  localStorage.setItem('mk.lang', config.language)
  localStorage.setItem('mk.theme', config.theme)
  if (config.route !== 'Tasks') return
  localStorage.setItem('mk.wallet.provider.v1', JSON.stringify({ source: 'eip6963', rdns: 'com.makoto.qa', name: 'Read-only QA Wallet' }))
  const calls = [], forbidden = [], listeners = new Map()
  window.__matrixWallet = { calls, forbidden }
  const provider = {
    on(event, listener) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(listener) },
    removeListener(event, listener) { listeners.get(event)?.delete(listener) },
    async request({ method }) {
      calls.push(method)
      if (method === 'eth_accounts') return [account]
      if (method === 'eth_chainId') return '0x4cef52'
      if (method === 'eth_getTransactionReceipt' || method === 'eth_getTransactionByHash') return null
      forbidden.push(method)
      throw new Error('Read-only matrix fixture blocks signatures, writes, and all non-read methods')
    },
  }
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { provider,
    info: { uuid: '70000000-0000-4000-8000-000000000001', name: 'Read-only QA Wallet', rdns: 'com.makoto.qa' },
  } }))
  window.addEventListener('eip6963:requestProvider', announce)
  announce()
}

async function sidebar(page, config) {
  if (config.width === 390) {
    await page.locator('header').getByRole('button', { name: config.language === 'vi' ? 'Mở menu' : 'Open menu', exact: true }).click()
    return page.locator('#mk-mobile-sidebar')
  }
  return page.locator('aside').first()
}
async function go(page, config, id) {
  const nav = await sidebar(page, config)
  await nav.locator(`[data-nav-id="${id}"]`).click()
  if (id !== 'receive') await page.waitForTimeout(350)
}
async function layout(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')
    const bounds = dialog?.getBoundingClientRect()
    return {
      viewport: innerWidth, documentOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      mainOverflow: Math.max(0, document.getElementById('mk-main').scrollWidth - document.getElementById('mk-main').clientWidth),
      dialog: dialog ? { scrollWidth: dialog.scrollWidth, clientWidth: dialog.clientWidth, left: bounds.left, right: bounds.right } : null,
      language: localStorage.getItem('mk.lang'), theme: document.documentElement.dataset.theme,
      browserTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      mode: JSON.parse(localStorage.getItem('mk.mode')), address: JSON.parse(localStorage.getItem('mk.address')),
    }
  })
}

async function runCase(browser, config) {
  const context = await browser.newContext({ viewport: { width: config.width, height: config.width === 390 ? 844 : 900 }, locale: config.language === 'vi' ? 'vi-VN' : 'en-US', colorScheme: config.theme, timezoneId: 'Asia/Bangkok' })
  await context.addInitScript(initialize, { config, account })
  const page = await context.newPage()
  const errors = [], warnings = [], requests = [], responses = [], intercepted = [], blockedMutations = [], parseRequests = []
  page.on('pageerror', error => errors.push({ type: 'page', message: error.message }))
  page.on('console', message => { if (message.type() === 'error') errors.push({ type: 'console', message: message.text() }); if (message.type() === 'warning') warnings.push(message.text()) })
  page.on('request', request => { if (request.url().includes('/api/')) requests.push({ method: request.method(), url: request.url() }) })
  page.on('response', async response => {
    if (!response.url().includes('/api/')) return
    let data = null
    try { data = await response.json() } catch {}
    responses.push({ status: response.status(), url: response.url(), data })
  })
  if (config.route === 'Tasks') await context.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), pathname = url.pathname
    const send = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
    if (request.method() === 'GET' && pathname === '/api/auth/session') { intercepted.push(pathname); return send({ authenticated: true, address: account }) }
    if (request.method() === 'GET' && pathname === '/api/tasks') { intercepted.push(pathname); return send({ tasks: fixtureTasks }) }
    if (request.method() === 'GET' && pathname === '/api/tasks/notifications') { intercepted.push(pathname); return send({ notifications: [] }) }
    if (request.method() === 'POST' && pathname === '/api/tasks/parse') {
      const body = request.postDataJSON(); parseRequests.push(body); intercepted.push(pathname)
      return send(parseIntent(body))
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      blockedMutations.push({ method: request.method(), path: pathname })
      if (pathname === '/api/portfolio/snapshot') return send({ status: 'SKIPPED', reason: 'QA_READ_ONLY', snapshot: null, nextCaptureAt: null })
      return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: 'QA_WRITE_BLOCKED' }) })
    }
    return route.continue()
  })
  const result = { ...config, success: false, fixture: config.route === 'Tasks', errors, warnings, requests, responses, intercepted, blockedMutations, parseRequests }
  try {
    await page.goto(origin, { waitUntil: 'domcontentloaded' })
    await page.locator('#mk-main').waitFor()
    await page.waitForTimeout(1800)
    if (config.route === 'Home') {
      await page.locator('[data-agent-suggestions="ask"]').waitFor()
      assert.equal(await page.locator('[data-agent-suggestions="ask"] button').count(), 5)
      result.askSuggestions = await page.locator('[data-agent-suggestions="ask"] button').allTextContents()
    } else if (config.route === 'Tasks') {
      await go(page, config, 'tasks')
      await page.locator('[data-task-timezone]').first().waitFor()
      const saved = await page.locator('[data-task-timezone]').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, timezone: node.dataset.taskTimezone, title: node.title })))
      assert.equal(saved.length, 3)
      assert.ok(saved.some(row => row.text === `UTC+7 · ${config.language === 'vi' ? 'Giờ địa phương' : 'Local time'}` && row.timezone === 'Asia/Bangkok'))
      assert.ok(saved.some(row => row.text === 'UTC-5 · America/New_York'))
      assert.ok(saved.some(row => row.text === 'UTC-4 · America/New_York'))
      result.savedTimezoneRows = saved
      await page.getByRole('tab', { name: config.language === 'vi' ? 'Tự động' : 'Automation', exact: true }).click()
      const text = config.language === 'vi' ? 'Tóm tắt danh mục của tôi hằng ngày lúc 08:00' : 'Summarize my portfolio every day at 08:00'
      const field = page.getByRole('textbox', { name: config.language === 'vi' ? 'Mô tả nhiệm vụ' : 'Describe a task', exact: true })
      await field.fill(text); await field.press('Enter')
      await page.waitForFunction(() => document.querySelectorAll('[data-task-timezone]').length === 4)
      assert.equal(parseRequests.length, 1)
      assert.equal(parseRequests[0].timezone, 'Asia/Bangkok')
      assert.equal(parseRequests[0].text, text)
      assert.equal(parseRequests[0].chainId, 5042002)
      result.reviewTimezone = await page.locator('[data-task-timezone]').first().innerText()
      assert.equal(result.reviewTimezone, `UTC+7 · ${config.language === 'vi' ? 'Giờ địa phương' : 'Local time'}`)
      result.reviewText = await page.locator('#mk-main').innerText()
      assert.ok(result.reviewText.includes(config.language === 'vi' ? 'Hằng ngày 08:00 giờ địa phương' : 'Daily 08:00 local time'))
      result.provider = await page.evaluate(() => window.__matrixWallet)
      assert.deepEqual(result.provider.forbidden, [])
      assert.ok(result.provider.calls.includes('eth_accounts') && result.provider.calls.includes('eth_chainId'))
      assert.ok(!blockedMutations.some(item => item.path.startsWith('/api/tasks') || item.path.startsWith('/api/auth')))
    } else if (config.route === 'Receive') {
      const nav = await sidebar(page, config)
      const ids = await nav.locator('[data-nav-id]').evaluateAll(nodes => nodes.map(node => node.dataset.navId))
      assert.deepEqual(ids.slice(ids.indexOf('send'), ids.indexOf('faucet') + 1), ['send', 'receive', 'swap', 'bridge', 'faucet'])
      result.navIds = ids
      await nav.locator('[data-nav-id="receive"]').click()
      const dialog = page.getByRole('dialog'); await dialog.waitFor()
      assert.ok((await dialog.innerText()).includes(account))
      assert.equal(await dialog.locator('svg[height="188"]').count(), 1)
      result.receiveText = await dialog.innerText()
      result.receivePressed = await page.locator('aside [data-nav-id="receive"]').getAttribute('aria-pressed')
      result.faucetCurrent = await page.locator('aside [data-nav-id="faucet"]').getAttribute('aria-current')
      assert.equal(result.receivePressed, 'true'); assert.equal(result.faucetCurrent, null)
      // The same modal is the Home action's destination. No duplicate route.
      await dialog.getByRole('button', { name: config.language === 'vi' ? 'Đóng' : 'Close', exact: true }).click()
      await page.locator('#mk-main').getByRole('button', { name: config.language === 'vi' ? 'Nhận' : 'Receive', exact: true }).click()
      await dialog.waitFor()
      assert.equal(await dialog.innerText(), result.receiveText)
      result.canonicalHomeModalSame = true
    } else if (config.route === 'Settings') {
      await go(page, config, 'settings')
      await page.getByRole('heading', { name: config.language === 'vi' ? 'Cài đặt' : 'Settings', exact: true }).waitFor()
      result.settingsText = await page.locator('#mk-main').innerText()
    } else {
      const source = await page.evaluate(async language => (await import('/src/lib/i18n.ts')).translate('Insights', language), config.language)
      await page.locator('footer').getByRole('button', { name: source, exact: true }).click()
      await page.locator('[data-analytics-page]').waitFor()
      await page.waitForTimeout(2800)
      await page.waitForFunction(() => ![...document.querySelectorAll('[data-analytics-unavailable]')].some(node => /Loading|Đang tải/.test(node.textContent)), null, { timeout: 30000 })
      result.analyticsText = await page.locator('#mk-main').innerText()
      assert.doesNotMatch(result.analyticsText, /Fear & Greed|Sợ hãi|Tham lam|prototype|preview|thử nghiệm/i)
      if (config.language === 'vi') assert.doesNotMatch(result.analyticsText, /Transactions today|Total addresses|Utilization|Latest block|Large Transfers|Recent Transfers/)
      else assert.doesNotMatch(result.analyticsText, /Giao dịch hôm nay|Tổng số địa chỉ|Mức sử dụng mạng|Khối mới nhất|Cập nhật|Nguồn:/)
      result.analyticsCards = await page.locator('#mk-main h2').allTextContents()
      result.analyticsLinks = await page.locator('#mk-main a[href]').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, href: node.href })))
      result.analyticsMetrics = await page.locator('[data-analytics-metric]').evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.analyticsMetric, source: node.dataset.analyticsSource, value: node.lastElementChild.textContent, label: node.firstElementChild.textContent })))
      result.analyticsSources = await page.locator('[data-analytics-source]').evaluateAll(nodes => nodes.map(node => ({ source: node.dataset.analyticsSource, text: node.textContent })))
      result.analyticsObserved = await page.locator('[data-analytics-observed]').evaluateAll(nodes => nodes.map(node => ({ observedAt: node.dataset.analyticsObserved, text: node.textContent })))
      result.analyticsTransferHashes = await page.locator('[data-analytics-transfer]').evaluateAll(nodes => nodes.map(node => node.dataset.analyticsTransfer))
      result.analyticsHolderAddresses = await page.locator('[data-analytics-holder]').evaluateAll(nodes => nodes.map(node => node.dataset.analyticsHolder))
      result.analyticsKinds = await page.locator('[data-analytics-kind]').evaluateAll(nodes => nodes.map(node => ({ kind: node.dataset.analyticsKind, text: node.textContent })))
      const expectedKinds = config.language === 'vi' ? { Transfer: 'Chuyển token', 'Contract transfer': 'Chuyển qua hợp đồng' } : { Transfer: 'Transfer', 'Contract transfer': 'Contract transfer' }
      for (const row of result.analyticsKinds) assert.equal(row.text, expectedKinds[row.kind])
      assert.ok(await page.locator('[data-analytics-read-only]').isVisible())
      assert.equal(await page.locator('aside [data-nav-id="insights"]').count(), 0)
      const numberLocale = config.language === 'vi' ? 'vi-VN' : 'en-US'
      const observedNetworks = responses.filter(item => /\/api\/arc\/network(?:$|\?)/.test(item.url) && item.status === 200).map(item => item.data)
      const observedFeeds = responses.filter(item => /\/api\/arc\/feed(?:$|\?)/.test(item.url) && item.status === 200).map(item => item.data)
      const observedHolders = responses.filter(item => /\/api\/arc\/holders(?:$|\?)/.test(item.url) && item.status === 200).map(item => item.data)
      for (const metric of result.analyticsMetrics) {
        assert.ok(['Arc RPC', 'Arc Explorer'].includes(metric.source))
        if (metric.id === 'block') assert.ok(observedNetworks.some(row => metric.value === `#${row.blockNumber.toLocaleString(numberLocale)}`))
      }
      const hashes = new Set(observedFeeds.flatMap(row => [...(row.live ?? []), ...(row.whales ?? [])].map(row => row.hash)))
      assert.ok(result.analyticsTransferHashes.every(hash => /^0x[0-9a-f]{64}$/i.test(hash) && hashes.has(hash)))
      const holders = new Set(observedHolders.flatMap(row => (row.items ?? []).map(row => row.address)))
      assert.ok(result.analyticsHolderAddresses.every(address => /^0x[0-9a-f]{40}$/i.test(address) && holders.has(address)))
      assert.ok(result.analyticsObserved.every(row => observedNetworks.some(network => String(network.updatedAt) === row.observedAt)))
      result.uninterceptedSourceMatches = true
      assert.equal(intercepted.length, 0)
      assert.ok(requests.some(item => item.url.includes('/api/arc/network')))
      assert.ok(!requests.some(item => item.method !== 'GET'))
    }
    result.layout = await layout(page)
    assert.equal(result.layout.documentOverflow, 0)
    assert.equal(result.layout.mainOverflow, 0)
    assert.equal(result.layout.language, config.language)
    assert.equal(result.layout.theme, config.theme)
    assert.equal(result.layout.browserTimezone, 'Asia/Bangkok')
    if (result.layout.dialog) { assert.ok(result.layout.dialog.left >= -1 && result.layout.dialog.right <= config.width + 1); assert.ok(result.layout.dialog.scrollWidth <= result.layout.dialog.clientWidth + 1) }
    assert.deepEqual(errors, [])
    if ((config.language === 'vi' && config.theme === 'dark') || (config.language === 'en' && config.theme === 'light')) {
      await page.waitForTimeout(400)
      result.screenshot = `matrix-${config.width}-${config.language}-${config.theme}-${config.route.toLowerCase()}.png`
      await page.screenshot({ path: path.join(__dirname, result.screenshot), fullPage: config.route !== 'Receive', animations: 'disabled' })
    }
    result.success = true
  } catch (error) {
    result.exception = String(error)
    result.failedText = await page.locator('body').innerText().catch(() => '')
    result.screenshot = `matrix-failure-${config.width}-${config.language}-${config.theme}-${config.route.toLowerCase()}.png`
    await page.screenshot({ path: path.join(__dirname, result.screenshot), fullPage: false }).catch(() => {})
  } finally {
    results.push(result); save()
    console.log(JSON.stringify({ ...config, success: result.success, exception: result.exception, errors, overflow: result.layout?.documentOverflow, fixture: result.fixture }))
    await context.close()
  }
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  let next = 0
  try { await Promise.all(Array.from({ length: 4 }, async () => { while (next < cases.length) await runCase(browser, cases[next++]) })) }
  finally { await browser.close(); save() }
  const failed = results.filter(result => !result.success)
  console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.map(({ route, width, language, theme, exception }) => ({ route, width, language, theme, exception })) }))
  if (results.length !== cases.length || failed.length) process.exitCode = 1
}
main().catch(error => { console.error(error); save(); process.exitCode = 1 })
