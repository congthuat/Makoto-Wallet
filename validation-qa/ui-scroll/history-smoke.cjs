const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { chromium } = require(process.env.MAKOTO_PLAYWRIGHT_PATH || 'C:/Users/Admin/AppData/Local/OpenAI/Codex/runtimes/cua_node/b63ee7ee40c23b77/bin/node_modules/playwright')
const account = '0x16299b74c616994eaecb9b20e37d369d5d62586b'
async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 600 } })
  const report = { account, startedAt: new Date().toISOString(), snapshots: [], history: [], prices: [], wallet: [], errors: [] }
  try {
    await context.addInitScript({ path: path.resolve(__dirname, '../../frontend/scripts/qa-mock-wallet.js') })
    await context.addInitScript(({ account }) => {
      localStorage.setItem('mk.lang', 'en')
      localStorage.setItem('mk.theme', 'dark')
      localStorage.setItem('mk.mode', JSON.stringify('connected'))
      localStorage.setItem('mk.address', JSON.stringify(account))
      const request = window.ethereum.request
      window.__walletMethods = []
      window.ethereum.request = async args => {
        window.__walletMethods.push(args.method)
        if (args.method === 'eth_accounts' || args.method === 'eth_requestAccounts') return [account]
        if (/sign|sendTransaction|sendRawTransaction/i.test(args.method)) throw new Error('QA forbids blockchain writes')
        return request(args)
      }
    }, { account })
    const page = await context.newPage()
    page.on('pageerror', e => report.errors.push(e.message))
    page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()) })
    page.on('response', async response => {
      const url = response.url()
      if (!url.includes('/api/')) return
      try {
        if (url.includes('/portfolio/snapshot')) report.snapshots.push({ status: response.status(), body: await response.json() })
        if (url.includes('/portfolio/history')) report.history.push({ status: response.status(), body: await response.json() })
        if (url.endsWith('/api/prices')) report.prices.push({ status: response.status(), body: await response.json() })
        if (url.includes('/arc/wallet')) report.wallet.push({ status: response.status(), body: await response.json() })
      } catch (error) { report.errors.push(String(error)) }
    })
    await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' })
    await page.locator('#mk-main').waitFor()
    await page.locator('aside').getByRole('button', { name: 'Portfolio', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[data-history-state]')?.dataset.historyState === 'starting', null, { timeout: 25000 })
    const start = await page.evaluate(() => {
      window.scrollTo({ top: 500, behavior: 'instant' })
      window.__historyMain = document.getElementById('mk-main')
      return { y: scrollY, height: document.documentElement.scrollHeight }
    })
    report.start = start
    for (let i = 0; i < 14; i++) {
      await page.waitForTimeout(5000)
      const sample = await page.evaluate(() => ({ y: scrollY, height: document.documentElement.scrollHeight, sameMain: document.getElementById('mk-main') === window.__historyMain, historyState: document.querySelector('[data-history-state]')?.dataset.historyState }))
      report.samples ??= []
      report.samples.push(sample)
      assert.ok(Math.abs(sample.y - start.y) <= 3 && sample.sameMain)
    }
    console.log(JSON.stringify({ intervalSeconds: 70, from: start.y, to: report.samples.at(-1).y, historyReads: report.history.length, snapshots: report.snapshots.map(x => ({ httpStatus: x.status, status: x.body.status, totalUsd: x.body.snapshot?.totalUsd, nextCaptureAt: x.body.nextCaptureAt })) }))
    report.ranges = []
    for (const range of ['1D', '1W', '1M', '1Y', 'ALL']) {
      const response = page.waitForResponse(res => res.url().includes(`/portfolio/history?`) && res.url().includes(`range=${range.toLowerCase()}`))
      await page.getByRole('button', { name: range, exact: true }).click()
      // 1D may use its still-fresh cache; capture the actual rendered selection.
      const body = await Promise.race([response.then(res => res.json()), page.waitForTimeout(1500).then(() => null)])
      report.ranges.push({ range, selected: await page.getByRole('button', { name: range, exact: true }).getAttribute('aria-pressed'), totalSnapshots: body?.totalSnapshots ?? null })
    }
    const saved = report.snapshots.find(x => x.body.status === 'SAVED')
    assert.ok(saved, 'Normal UI must capture a fresh real-source portfolio observation')
    assert.equal(saved.body.snapshot.walletAddress, account)
    assert.equal(saved.body.snapshot.chainId, 5042002)
    assert.equal(saved.body.snapshot.priceProvider, 'COINGECKO')
    report.captureCadenceMs = Date.parse(saved.body.nextCaptureAt) - Date.parse(saved.body.snapshot.capturedAt)
    assert.equal(report.captureCadenceMs, 300000)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.querySelector('[data-history-state]')?.dataset.historyState === 'starting', null, { timeout: 25000 })
    await page.waitForTimeout(1200)
    report.persistedAfterReload = report.history.at(-1).body.snapshots.some(s => s.id === saved.body.snapshot.id)
    assert.equal(report.persistedAfterReload, true)
    report.walletMethods = await page.evaluate(() => window.__walletMethods)
    assert.ok(report.walletMethods.every(method => !/sign|sendTransaction|sendRawTransaction/i.test(method)))
    assert.ok(report.history.length >= 5)
    assert.deepEqual(report.errors, [])
    report.passed = true
    await page.screenshot({ path: path.join(__dirname, 'history-smoke-after-reload.png'), fullPage: true })
  } finally {
    fs.writeFileSync(path.join(__dirname, 'history-smoke.json'), JSON.stringify(report, null, 2))
    await context.close()
    await browser.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
