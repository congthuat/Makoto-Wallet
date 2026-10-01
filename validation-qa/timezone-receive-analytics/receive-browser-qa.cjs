/* Read-only navigation QA: watch address, no injected provider, no external click. */
const { chromium } = require('C:/Users/Admin/AppData/Local/OpenAI/Codex/runtimes/cua_node/b63ee7ee40c23b77/bin/node_modules/playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const origin = process.env.MAKOTO_QA_URL || 'http://localhost:5173'
const account = '0x16299b74c616994eaecb9b20e37d369d5d62586b'
const results = []

function initialize({ language, theme, account }) {
  localStorage.clear()
  localStorage.setItem('mk.lang', language)
  localStorage.setItem('mk.theme', theme)
  localStorage.setItem('mk.mode', JSON.stringify('watch'))
  localStorage.setItem('mk.address', JSON.stringify(account))
  delete window.ethereum
  delete window.okxwallet
}
async function sidebar(page, width, language) {
  if (width === 390) {
    await page.locator('header').getByRole('button', { name: language === 'vi' ? 'Mở menu' : 'Open menu', exact: true }).click()
    await page.locator('#mk-mobile-sidebar').waitFor({ state: 'visible' })
    return page.locator('#mk-mobile-sidebar')
  }
  return page.locator('aside')
}
async function layout(page, dialog = false) {
  return page.evaluate((dialog) => {
    const element = dialog ? document.querySelector('[role="dialog"]') : document.querySelector('#mk-main')
    const bounds = element.getBoundingClientRect()
    return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, width: element.clientWidth, scrollWidth: element.scrollWidth, left: bounds.left, right: bounds.right }
  }, dialog)
}
async function screenshot(page, name) { await page.screenshot({ path: path.join(__dirname, name), fullPage: false }) }

async function run() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    for (const width of [1440, 1280, 390]) for (const language of ['vi', 'en']) for (const theme of ['dark', 'light']) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, locale: language === 'vi' ? 'vi-VN' : 'en-US', colorScheme: theme })
      await context.addInitScript(initialize, { language, theme, account })
      const page = await context.newPage()
      page.setDefaultTimeout(10_000)
      const consoleErrors = [], pageErrors = [], apiMethods = [], externalNavigations = []
      page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
      page.on('pageerror', (error) => pageErrors.push(error.message))
      page.on('request', (request) => { if (request.url().includes('/api/')) apiMethods.push({ method: request.method(), path: new URL(request.url()).pathname }) })
      page.on('popup', (popup) => externalNavigations.push(popup.url()))
      const name = `receive-${width}-${language}-${theme}`
      try {
        await page.goto(origin, { waitUntil: 'domcontentloaded' })
        await page.locator('#mk-main').waitFor({ state: 'visible' })
        let nav = await sidebar(page, width, language)
        const order = await nav.locator('[data-nav-id]').evaluateAll((elements) => elements.map((element) => element.dataset.navId).filter((id) => ['send', 'receive', 'swap', 'bridge', 'faucet'].includes(id)))
        assert.deepEqual(order, ['send', 'receive', 'swap', 'bridge', 'faucet'])
        assert.equal(await nav.locator('[data-nav-id="receive"]').innerText(), language === 'vi' ? 'Nhận' : 'Receive')
        const faucetName = await nav.locator('[data-nav-id="faucet"]').innerText()
        assert.equal(faucetName, language === 'vi' ? 'Nhận token' : 'Faucet')
        await nav.locator('[data-nav-id="faucet"]').click()
        await page.getByRole('heading', { name: language === 'vi' ? 'Nhận token testnet' : 'Testnet faucet', exact: true }).waitFor({ state: 'visible' })
        await page.waitForTimeout(200)
        const faucetTitle = await page.title()
        nav = await sidebar(page, width, language)
        assert.equal(await nav.locator('[data-nav-id="faucet"]').getAttribute('aria-current'), 'page')
        const receive = nav.locator('[data-nav-id="receive"]')
        assert.equal(await receive.getAttribute('aria-pressed'), 'false')
        assert.equal(await receive.locator('svg.lucide-arrow-down-left').getAttribute('width'), '17')
        await receive.focus()
        await page.keyboard.press('Tab')
        await page.keyboard.press('Shift+Tab')
        assert.equal(await receive.evaluate((element) => document.activeElement === element), true)
        const focus = await receive.evaluate((element) => ({ visible: element.matches(':focus-visible'), shadow: getComputedStyle(element).boxShadow }))
        assert.equal(focus.visible, true)
        assert.notEqual(focus.shadow, 'none')
        await screenshot(page, `${name}-navigation.png`)
        await receive.focus()
        await page.keyboard.press('Enter')
        const dialog = page.getByRole('dialog')
        await dialog.waitFor({ state: 'visible' })
        if (width === 390) assert.equal(await page.locator('#mk-mobile-sidebar').count(), 0)
        await dialog.getByRole('heading', { name: language === 'vi' ? 'Nhận' : 'Receive', exact: true }).waitFor()
        // Desktop Sidebar remains in the DOM at every width and receives the
        // canonical modal state even when the mobile drawer closes intentionally.
        assert.equal(await page.locator('aside [data-nav-id="receive"]').getAttribute('aria-pressed'), 'true')
        assert.equal(await page.locator('aside [data-nav-id="faucet"]').getAttribute('aria-current'), null)
        assert.equal(await page.title(), faucetTitle)
        assert.equal(await page.getByRole('heading', { name: language === 'vi' ? 'Nhận token testnet' : 'Testnet faucet', exact: true, includeHidden: true }).count(), 1)
        const text = await dialog.innerText()
        assert.ok(text.includes(account))
        assert.ok(text.includes('Arc Testnet') && text.includes('5042002'))
        const copy = dialog.getByRole('button', { name: language === 'vi' ? 'Sao chép địa chỉ' : 'Copy address', exact: true })
        assert.equal(await copy.isEnabled(), true)
        assert.equal(await dialog.locator('svg[width="188"][height="188"]').count(), 1)
        for (const symbol of ['USDC', 'EURC', 'cirBTC']) assert.equal(await dialog.getByRole('button', { name: new RegExp(`\\b${symbol}$`) }).count(), 1)
        const dimensions = await layout(page, true)
        assert.ok(dimensions.documentWidth <= width + 1 && dimensions.scrollWidth <= dimensions.width + 1 && dimensions.left >= -1 && dimensions.right <= width + 1, JSON.stringify(dimensions))
        await page.waitForTimeout(450)
        await screenshot(page, `${name}-modal.png`)
        await dialog.getByRole('button', { name: language === 'vi' ? 'Đóng' : 'Close', exact: true }).click()
        await dialog.waitFor({ state: 'hidden' })
        nav = await sidebar(page, width, language)
        assert.equal(await nav.locator('[data-nav-id="receive"]').getAttribute('aria-pressed'), 'false')
        assert.equal(await nav.locator('[data-nav-id="faucet"]').getAttribute('aria-current'), 'page')
        await nav.locator('[data-nav-id="home"]').click()
        await page.waitForFunction(() => document.querySelector('aside [data-nav-id="home"]')?.getAttribute('aria-current') === 'page')
        await page.locator('#mk-main').getByRole('button', { name: language === 'vi' ? 'Nhận' : 'Receive', exact: true }).click()
        await dialog.waitFor({ state: 'visible' })
        assert.equal(await dialog.innerText(), text)
        assert.equal(await page.locator('aside [data-nav-id="receive"]').getAttribute('aria-pressed'), 'true')
        await page.keyboard.press('Escape')
        await dialog.waitFor({ state: 'hidden' })
        assert.equal(await page.locator('aside [data-nav-id="home"]').getAttribute('aria-current'), 'page')
        if (width === 390) {
          const tabs = page.locator('nav.fixed.bottom-0 button')
          assert.equal(await tabs.count(), 5)
          await page.getByRole('button', { name: language === 'vi' ? 'Thêm thao tác' : 'More actions', exact: true }).click()
          await page.locator('#mk-mobile-actions').getByRole('button', { name: language === 'vi' ? 'Nhận' : 'Receive', exact: true }).click()
          await dialog.waitFor({ state: 'visible' })
          assert.equal(await dialog.innerText(), text)
          await page.keyboard.press('Escape')
          await dialog.waitFor({ state: 'hidden' })
        }
        const finalLayout = await layout(page)
        assert.ok(finalLayout.documentWidth <= width + 1)
        const session = await page.evaluate(() => ({ mode: JSON.parse(localStorage.getItem('mk.mode')), address: JSON.parse(localStorage.getItem('mk.address')), providerPresent: !!window.ethereum || !!window.okxwallet, language: document.documentElement.lang, theme: document.documentElement.dataset.theme }))
        assert.equal(session.mode, 'watch')
        assert.equal(session.address, account)
        assert.equal(session.providerPresent, false)
        assert.equal(session.language, language)
        assert.equal(session.theme, theme)
        assert.deepEqual(externalNavigations, [])
        assert.equal(apiMethods.some((request) => request.method !== 'GET'), false)
        assert.deepEqual(consoleErrors, [])
        assert.deepEqual(pageErrors, [])
        results.push({ name, width, language, theme, pass: true, order, faucetName, focus, dimensions, finalLayout, canonicalModalMatchesHome: true, drawerClosesAfterReceive: width === 390, mobileMoreActionsPreserved: width === 390, session, apiMethods, consoleErrors, pageErrors, externalNavigations })
        console.log(`PASS ${name}`)
      } catch (error) {
        await screenshot(page, `${name}-failure.png`).catch(() => {})
        results.push({ name, width, language, theme, pass: false, error: String(error), stack: error.stack, consoleErrors, pageErrors, apiMethods, externalNavigations })
        console.log(`FAIL ${name}: ${error.stack}`)
      } finally { await context.close() }
    }
  } finally {
    await browser.close()
    fs.writeFileSync(path.join(__dirname, 'receive-browser-results.json'), JSON.stringify({ origin, timestamp: new Date().toISOString(), total: results.length, passed: results.filter((item) => item.pass).length, failed: results.filter((item) => !item.pass).length, cases: results }, null, 2))
  }
  if (results.some((item) => !item.pass)) process.exitCode = 1
}
run().catch((error) => { console.error(error); process.exitCode = 1 })
