import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

// Optional live browser regression. Start the normal app/API services first.
// The test uses public-address watch mode and never verifies/signs a wallet.
const require = createRequire(import.meta.url)
let playwright
if (process.env.MAKOTO_PLAYWRIGHT_PATH) playwright = require(process.env.MAKOTO_PLAYWRIGHT_PATH)
const origin = process.env.MAKOTO_QA_URL ?? 'http://localhost:5173'

test('Agent task reply and link follow current locale while historical user input stays exact', { skip: !playwright, timeout: 45_000 }, async () => {
  const browser = await playwright.chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const errors = []
  try {
    await context.addInitScript(() => {
      localStorage.setItem('mk.mode', JSON.stringify('watch'))
      localStorage.setItem('mk.address', JSON.stringify('0x16299b74c616994eaecb9b20e37d369d5d62586b'))
      localStorage.setItem('mk.lang', 'vi')
      localStorage.setItem('mk.theme', 'dark')
    })
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    await page.goto(origin, { waitUntil: 'domcontentloaded' })
    await page.locator('aside').first().getByRole('button', { name: 'Trợ lý', exact: true }).click()
    const question = 'Báo tôi khi số dư USDC xuống dưới 100'
    const main = page.locator('#mk-main')
    await main.getByRole('textbox', { name: 'Nhắn cho Makoto', exact: true }).fill(question)
    await main.getByRole('textbox', { name: 'Nhắn cho Makoto', exact: true }).press('Enter')
    const viReply = 'Xác minh ví để quản lý nhiệm vụ'
    await main.getByRole('button', { name: viReply, exact: true }).waitFor()
    assert.equal(await main.getByText(question, { exact: true }).count(), 1)
    await page.getByRole('button', { name: 'Ngôn ngữ', exact: true }).click()
    await page.getByRole('option', { name: /English$/ }).click()
    const enReply = 'Verify wallet to manage tasks'
    await main.getByRole('button', { name: enReply, exact: true }).waitFor()
    assert.equal(await main.getByText(enReply, { exact: true }).count(), 2, 'both system reply and workflow link must follow EN')
    assert.equal(await main.getByText(viReply, { exact: true }).count(), 0)
    assert.equal(await main.getByText(question, { exact: true }).count(), 1)
    await page.getByRole('button', { name: 'Language', exact: true }).click()
    await page.getByRole('option', { name: /Tiếng Việt$/ }).click()
    await main.getByRole('button', { name: viReply, exact: true }).waitFor()
    assert.equal(await main.getByText(viReply, { exact: true }).count(), 2, 'both system reply and workflow link must follow VI')
    assert.equal(await main.getByText(question, { exact: true }).count(), 1)
    assert.deepEqual(errors, [])
  } finally { await context.close(); await browser.close() }
})

test('retained Agent clarification and action copy follows VI–EN–VI without rewriting user requests', { skip: !playwright, timeout: 45_000 }, async () => {
  const browser = await playwright.chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const errors = []
  const nonReadRequests = []
  try {
    await context.addInitScript(() => {
      localStorage.setItem('mk.mode', JSON.stringify('watch'))
      localStorage.setItem('mk.address', JSON.stringify('0x16299b74c616994eaecb9b20e37d369d5d62586b'))
      localStorage.setItem('mk.lang', 'vi')
      localStorage.setItem('mk.theme', 'dark')
    })
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    page.on('request', (request) => { if (request.method() !== 'GET') nonReadRequests.push({ method: request.method(), url: request.url() }) })
    await page.goto(origin, { waitUntil: 'domcontentloaded' })
    await page.locator('aside').first().getByRole('button', { name: 'Trợ lý', exact: true }).click()
    const main = page.locator('#mk-main')
    const incomplete = 'Gửi 10 USDC'
    const action = 'Gửi 10 USDC tới 0x2222222222222222222222222222222222222222'
    const sequence = `${action} rồi swap 5 USDC sang EURC`
    const viClarification = 'Tôi cần thêm một ít thông tin trước khi chuẩn bị an toàn.'
    const enClarification = 'I need a little more information before I can prepare this safely.'
    const viAction = 'Tôi đã phân tích lệnh chuyển cục bộ. Hãy xem lại thông số trước khi yêu cầu ví.'
    const enAction = 'I parsed the transfer locally. Review the parameters before anything reaches your wallet.'
    const input = main.getByRole('textbox', { name: 'Nhắn cho Makoto', exact: true })
    await input.fill(incomplete)
    await input.press('Enter')
    await main.getByText(viClarification, { exact: true }).waitFor()
    assert.equal(await main.locator('dt').getByText('Thiếu', { exact: true }).count(), 1)
    assert.equal(await main.locator('dd').getByText('Người nhận', { exact: true }).count(), 1)
    await input.fill(action)
    await input.press('Enter')
    await main.getByText(viAction, { exact: true }).waitFor()
    await input.fill(sequence)
    await input.press('Enter')
    await main.locator('dt').getByText('2. Hoán đổi', { exact: true }).waitFor()
    await main.locator('dd').getByText('Sau khi bước 1 được xác nhận và kiểm tra lại.', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Ngôn ngữ', exact: true }).click()
    await page.getByRole('option', { name: /English$/ }).click()
    await main.getByText(enClarification, { exact: true }).waitFor()
    await main.getByText(enAction, { exact: true }).waitFor()
    assert.equal(await main.locator('dt').getByText('Missing', { exact: true }).count(), 1)
    assert.equal(await main.locator('dd').getByText('Recipient', { exact: true }).count(), 1)
    assert.equal(await main.getByText(viClarification, { exact: true }).count(), 0)
    assert.equal(await main.getByText(viAction, { exact: true }).count(), 0)
    assert.equal(await main.locator('dt').getByText('2. Swap', { exact: true }).count(), 1)
    assert.equal(await main.locator('dd').getByText('After step 1 is confirmed and checked again.', { exact: true }).count(), 1)
    for (const question of [incomplete, action, sequence]) assert.equal(await main.getByText(question, { exact: true }).count(), 1)
    await page.getByRole('button', { name: 'Language', exact: true }).click()
    await page.getByRole('option', { name: /Tiếng Việt$/ }).click()
    await main.getByText(viClarification, { exact: true }).waitFor()
    await main.getByText(viAction, { exact: true }).waitFor()
    assert.equal(await main.locator('dt').getByText('Thiếu', { exact: true }).count(), 1)
    assert.equal(await main.locator('dd').getByText('Người nhận', { exact: true }).count(), 1)
    assert.equal(await main.locator('dt').getByText('2. Hoán đổi', { exact: true }).count(), 1)
    assert.equal(await main.locator('dd').getByText('Sau khi bước 1 được xác nhận và kiểm tra lại.', { exact: true }).count(), 1)
    for (const question of [incomplete, action, sequence]) assert.equal(await main.getByText(question, { exact: true }).count(), 1)
    assert.deepEqual(nonReadRequests, [], 'planning and locale switching must not call an execution/signature endpoint')
    assert.deepEqual(errors, [])
  } finally { await context.close(); await browser.close() }
})
