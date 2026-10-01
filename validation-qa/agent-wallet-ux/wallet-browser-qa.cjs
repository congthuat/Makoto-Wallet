/* Isolated wallet discovery/connection QA. Providers block every signature/write. */
const { chromium } = require('C:/Users/Admin/AppData/Local/OpenAI/Codex/runtimes/cua_node/b63ee7ee40c23b77/bin/node_modules/playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const origin = process.env.MAKOTO_QA_URL || 'http://localhost:5173'
const output = __dirname
const account = '0x1111111111111111111111111111111111111111'
const otherAddress = '0x2222222222222222222222222222222222222222'
const assets = Object.fromEntries(['metamask', 'rabby'].map((kind) => [kind, `data:image/svg+xml;base64,${fs.readFileSync(path.join(__dirname, '../../frontend/public/wallets', `${kind}.svg`)).toString('base64')}`]))
const results = []

function initFixture({ language, theme, scenario, assets }) {
  if (!localStorage.getItem('walletQa.initialized')) {
    localStorage.clear()
    localStorage.setItem('walletQa.initialized', '1')
    localStorage.setItem('mk.lang', language)
    localStorage.setItem('mk.theme', theme)
    localStorage.setItem('mk.mode', JSON.stringify('demo'))
    localStorage.setItem('mk.address', JSON.stringify(''))
  }
  const account = '0x1111111111111111111111111111111111111111'
  const calls = []
  const forbidden = []
  const providers = {}
  let release
  const state = { scenario, calls, forbidden, providers, release: () => release?.(), setScenario: (value) => { state.scenario = value } }
  window.__walletQa = state
  const identities = {
    okx: { name: 'OKX Wallet', rdns: 'com.okex.wallet', icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"%3E%3Crect width="40" height="40" rx="10"/%3E%3Ctext x="5" y="25" fill="white" font-family="sans-serif" font-size="13" font-weight="900"%3EOKX%3C/text%3E%3C/svg%3E' },
    metamask: { name: 'MetaMask', rdns: 'io.metamask', icon: assets.metamask },
    rabby: { name: 'Rabby', rdns: 'io.rabby', icon: assets.rabby },
    other: { name: 'Example Browser Wallet', rdns: 'com.example.wallet', icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"%3E%3Crect width="40" height="40" rx="10" fill="%238b5cf6"/%3E%3Cpath d="M10 13h20v16H10z" fill="none" stroke="white" stroke-width="2"/%3E%3C/svg%3E' },
  }
  const installed = scenario === 'none' ? [] : scenario === 'one' || scenario === 'legacy' || scenario === 'watch-legacy' ? ['metamask'] : ['okx', 'metamask', 'rabby', 'other']
  installed.forEach((kind) => {
    const handlers = new Map()
    const provider = {
      isMetaMask: kind === 'metamask' || kind === 'rabby', isRabby: kind === 'rabby', isOkxWallet: kind === 'okx',
      on: (event, handler) => { if (!handlers.has(event)) handlers.set(event, new Set()); handlers.get(event).add(handler) },
      removeListener: (event, handler) => handlers.get(event)?.delete(handler),
      request: async ({ method }) => {
        calls.push({ kind, method })
        if (!['eth_requestAccounts', 'eth_accounts', 'eth_chainId', 'wallet_switchEthereumChain', 'wallet_addEthereumChain', 'eth_getTransactionReceipt', 'eth_getTransactionByHash'].includes(method)) {
          forbidden.push({ kind, method })
          throw new Error('QA blocks signatures and transaction requests')
        }
        if (method === 'eth_requestAccounts') {
          if (kind === 'rabby' && state.scenario === 'pending') await new Promise((resolve) => { release = resolve })
          if (kind === 'rabby' && state.scenario === 'reject') throw Object.assign(new Error('User rejected request'), { code: 4001 })
          if (kind === 'rabby' && state.scenario === 'no-account') return []
          return [account]
        }
        if (method === 'eth_accounts') return [account]
        if (method === 'eth_chainId') return kind === 'rabby' && state.scenario === 'wrong-chain' ? '0x1' : '0x4cef52'
        return null
      },
    }
    providers[kind] = provider
  })
  if (scenario === 'legacy' || scenario === 'watch-legacy') { window.ethereum = providers.metamask; return }
  if (providers.okx) window.okxwallet = providers.okx
  if (providers.metamask && scenario !== 'one') window.ethereum = providers.metamask
  const announce = () => installed.forEach((kind, index) => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: {
    provider: providers[kind], info: { uuid: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, ...identities[kind] },
  } })))
  window.addEventListener('eip6963:requestProvider', announce)
  announce()
}

async function connectModal(page, language) {
  const label = language === 'vi' ? /^(Kết nối ví|Kết nối)$/ : /^(Connect wallet|Connect)$/
  await page.locator('header').getByRole('button', { name: label }).click()
  const modal = page.getByRole('dialog')
  await modal.waitFor({ state: 'visible' })
  await page.waitForTimeout(450)
  return modal
}
async function fixturePage(browser, options) {
  const context = await browser.newContext({ viewport: { width: options.width, height: options.width === 390 ? 844 : 900 }, locale: options.language === 'vi' ? 'vi-VN' : 'en-US', colorScheme: options.theme })
  await context.addInitScript(initFixture, { ...options, assets })
  const page = await context.newPage()
  const consoleErrors = [], pageErrors = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  await page.locator('#mk-main').waitFor({ state: 'visible' })
  return { context, page, consoleErrors, pageErrors }
}
async function evidence(page, filename) {
  await page.screenshot({ path: path.join(output, filename), fullPage: false })
}
async function state(page) { return page.evaluate(() => ({ mode: JSON.parse(localStorage.getItem('mk.mode')), address: JSON.parse(localStorage.getItem('mk.address')), preference: JSON.parse(localStorage.getItem('mk.wallet.provider.v1') || 'null'), calls: window.__walletQa.calls, forbidden: window.__walletQa.forbidden })) }
async function waitConnected(page) { await page.waitForFunction(() => JSON.parse(localStorage.getItem('mk.mode')) === 'connected') }
async function layout(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')
    const bounds = dialog.getBoundingClientRect()
    return { viewport: innerWidth, pageWidth: document.documentElement.scrollWidth, modalWidth: dialog.scrollWidth, modalClientWidth: dialog.clientWidth, left: bounds.left, right: bounds.right, theme: document.documentElement.dataset.theme, lang: document.documentElement.lang }
  })
}

async function run() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    for (const width of [1440, 390]) for (const language of ['vi', 'en']) for (const theme of ['dark', 'light']) for (const scenario of ['none', 'one', 'multi']) {
      const options = { width, language, theme, scenario }
      const { context, page, consoleErrors, pageErrors } = await fixturePage(browser, options)
      const name = `wallet-${scenario}-${width}-${language}-${theme}`
      try {
        const modal = await connectModal(page, language)
        const cards = modal.locator('[data-wallet-kind]')
        assert.equal(await cards.count(), scenario === 'multi' ? 4 : 3)
        assert.equal(await modal.locator('[data-wallet-kind]:not(:disabled)').count(), scenario === 'none' ? 0 : scenario === 'one' ? 1 : 4)
        for (const kind of ['okx', 'metamask', 'rabby']) assert.equal(await modal.locator(`[data-wallet-kind="${kind}"]`).count(), 1)
        const dimensions = await layout(page)
        assert.ok(dimensions.pageWidth <= width + 1 && dimensions.modalWidth <= dimensions.modalClientWidth + 1 && dimensions.left >= -1 && dimensions.right <= width + 1, JSON.stringify(dimensions))
        assert.equal(dimensions.lang, language)
        await evidence(page, `${name}.png`)
        if (scenario === 'none') {
          const watch = modal.getByRole('button', { name: language === 'vi' ? 'Chỉ xem địa chỉ' : 'Watch address', exact: true })
          await modal.locator('#wallet-watch-address').fill('0x123')
          assert.equal(await watch.isDisabled(), true)
          await modal.locator('#wallet-watch-address').fill(otherAddress)
          assert.equal(await watch.isEnabled(), true)
          await watch.click()
          await page.waitForFunction(() => JSON.parse(localStorage.getItem('mk.mode')) === 'watch')
          const observed = await state(page)
          assert.equal(observed.address, otherAddress)
          assert.deepEqual(observed.calls, [])
          await page.reload({ waitUntil: 'domcontentloaded' })
          await page.locator('#mk-main').waitFor({ state: 'visible' })
          const reloaded = await state(page)
          assert.equal(reloaded.mode, 'watch')
          assert.equal(reloaded.address, otherAddress)
          assert.deepEqual(reloaded.calls, [])
          if (width === 390) await page.locator('header').getByRole('button', { name: language === 'vi' ? 'Mở menu' : 'Open menu', exact: true }).click()
          const navigation = width === 390 ? page.locator('#mk-mobile-sidebar') : page.locator('aside')
          await navigation.getByRole('button', { name: language === 'vi' ? 'Gửi' : 'Send', exact: true }).click()
          assert.equal(await page.getByRole('button', { name: language === 'vi' ? 'TỐI ĐA' : 'MAX', exact: true }).isDisabled(), true)
          assert.equal(await page.getByRole('button', { name: language === 'vi' ? 'Xác nhận trong ví' : 'Confirm in wallet', exact: true }).count(), 0)
          results.push({ name, ...options, pass: true, dimensions, watchValidation: true, watchReload: true, signingControlsUnavailable: true, consoleErrors, pageErrors, forbidden: observed.forbidden })
        } else {
          const selected = scenario === 'one' ? 'metamask' : 'rabby'
          await modal.locator(`[data-wallet-kind="${selected}"]`).click()
          await waitConnected(page)
          await modal.waitFor({ state: 'hidden' })
          const observed = await state(page)
          assert.equal(observed.preference.rdns, selected === 'rabby' ? 'io.rabby' : 'io.metamask')
          assert.equal(observed.address, account)
          assert.ok(observed.calls.length >= 4)
          assert.ok(observed.calls.every((call) => call.kind === selected))
          assert.deepEqual(observed.forbidden, [])
          results.push({ name, ...options, pass: true, dimensions, selected, calls: observed.calls, consoleErrors, pageErrors, forbidden: observed.forbidden })
        }
        assert.deepEqual(pageErrors, [])
        assert.deepEqual(consoleErrors, [])
        console.log(`PASS ${name}`)
      } catch (error) {
        await evidence(page, `${name}-failure.png`).catch(() => {})
        results.push({ name, ...options, pass: false, error: String(error), consoleErrors, pageErrors })
        console.log(`FAIL ${name}: ${error}`)
      } finally { await context.close() }
    }

    for (const scenario of ['legacy', 'watch-legacy', 'reject', 'no-account', 'wrong-chain', 'pending']) {
      const options = { width: 390, language: 'vi', theme: 'light', scenario }
      const { context, page, consoleErrors, pageErrors } = await fixturePage(browser, options)
      const name = `wallet-behavior-${scenario}`
      try {
        let modal = await connectModal(page, 'vi')
        if (scenario === 'watch-legacy') {
          await modal.locator('#wallet-watch-address').fill(otherAddress)
          await modal.getByRole('button', { name: 'Chỉ xem địa chỉ', exact: true }).click()
          await page.waitForFunction(() => JSON.parse(localStorage.getItem('mk.mode')) === 'watch')
          await page.reload({ waitUntil: 'domcontentloaded' })
          await page.locator('#mk-main').waitFor({ state: 'visible' })
          const observed = await state(page)
          assert.equal(observed.mode, 'watch')
          assert.equal(observed.address, otherAddress)
          assert.deepEqual(observed.calls, [])
          await page.locator('header').getByRole('button', { name: 'Mở menu', exact: true }).click()
          await page.locator('#mk-mobile-sidebar').getByRole('button', { name: 'Gửi', exact: true }).click()
          assert.equal(await page.getByRole('button', { name: 'TỐI ĐA', exact: true }).isDisabled(), true)
          assert.equal(await page.getByRole('button', { name: 'Xác nhận trong ví', exact: true }).count(), 0)
          assert.deepEqual((await state(page)).calls, [])
          await evidence(page, `${name}.png`)
        } else if (scenario === 'legacy') {
          await modal.locator('[data-wallet-kind="metamask"]').click()
          await waitConnected(page)
          assert.equal((await state(page)).preference.kind, 'metamask')
        } else if (scenario === 'pending') {
          await modal.locator('[data-wallet-kind="rabby"]').click()
          await modal.getByText('Đang kết nối…').waitFor()
          await modal.getByRole('button', { name: 'Đóng', exact: true }).click()
          modal = await connectModal(page, 'vi')
          await modal.locator('[data-wallet-kind="metamask"]').click()
          await waitConnected(page)
          await page.evaluate(() => window.__walletQa.release())
          await page.waitForTimeout(150)
          const observed = await state(page)
          assert.equal(observed.preference.rdns, 'io.metamask')
          assert.deepEqual(observed.calls.filter((call) => call.kind === 'rabby').map((call) => call.method), ['eth_requestAccounts'])
        } else {
          await modal.locator('[data-wallet-kind="rabby"]').click()
          await modal.getByRole('status').waitFor({ state: 'visible' })
          assert.equal(await modal.isVisible(), true)
          assert.equal((await state(page)).mode, 'demo')
          assert.equal((await state(page)).preference, null)
          const expected = scenario === 'reject' ? 'Bạn đã từ chối kết nối ví.' : scenario === 'no-account' ? 'Ví chưa cung cấp tài khoản.' : 'Ví hiện không ở mạng Arc Testnet.'
          const body = await page.locator('body').innerText()
          assert.ok(body.includes(expected), `Missing localized error: ${expected}`)
          await evidence(page, `${name}.png`)
          await modal.locator('[data-wallet-kind="metamask"]').click()
          await waitConnected(page)
        }
        const observed = await state(page)
        assert.deepEqual(observed.forbidden, [])
        assert.deepEqual(consoleErrors, [])
        assert.deepEqual(pageErrors, [])
        results.push({ name, ...options, pass: true, observed, consoleErrors, pageErrors })
        console.log(`PASS ${name}`)
      } catch (error) {
        await evidence(page, `${name}-failure.png`).catch(() => {})
        results.push({ name, ...options, pass: false, error: String(error), consoleErrors, pageErrors })
        console.log(`FAIL ${name}: ${error}`)
      } finally { await context.close() }
    }
  } finally {
    await browser.close()
    fs.writeFileSync(path.join(output, 'wallet-browser-results.json'), JSON.stringify({ origin, timestamp: new Date().toISOString(), total: results.length, passed: results.filter((item) => item.pass).length, failed: results.filter((item) => !item.pass).length, cases: results }, null, 2))
  }
  if (results.some((item) => !item.pass)) process.exitCode = 1
}
run().catch((error) => { console.error(error); process.exitCode = 1 })
