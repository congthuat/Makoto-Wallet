const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { chromium } = require('C:/Users/Admin/AppData/Local/OpenAI/Codex/runtimes/cua_node/b63ee7ee40c23b77/bin/node_modules/playwright')
const out = __dirname
const { getAgentSuggestions } = require('../../frontend/src/lib/agentSuggestions.ts')
const account = '0x16299b74c616994eaecb9b20e37d369d5d62586b'
const labels = { en: ['Ask', 'Monitor', 'Automate'], vi: ['Hỏi', 'Theo dõi', 'Tự động'] }
const modes = ['ask', 'monitor', 'automation']
const results = []
const consoleErrors = []
async function setup(browser, config) {
  const context = await browser.newContext({ viewport: { width: config.width, height: 900 } })
  await context.addInitScript(({ lang, theme, account }) => {
    localStorage.setItem('mk.mode', JSON.stringify('watch'))
    localStorage.setItem('mk.address', JSON.stringify(account))
    localStorage.setItem('mk.lang', lang)
    localStorage.setItem('mk.theme', theme)
  }, { ...config, account })
  const page = await context.newPage()
  page.on('pageerror', e => consoleErrors.push({ config, type: 'pageerror', text: e.message }))
  page.on('console', e => { if (e.type() === 'error') consoleErrors.push({ config, type: 'console', text: e.text() }) })
  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' })
  await page.locator('[data-agent-suggestions="ask"] button').first().waitFor()
  await page.waitForFunction(() => document.body.innerText.includes('USDC') && !document.body.innerText.includes('Loading balances'))
  await page.waitForTimeout(2500)
  return { page, context }
}
async function overflow(page) {
  return page.evaluate(() => ({ document: Math.max(0, document.documentElement.scrollWidth - innerWidth), chips: [...document.querySelectorAll('[data-agent-suggestions] button')].map(b => ({ text: b.textContent, font: parseFloat(getComputedStyle(b).fontSize), left: b.getBoundingClientRect().left, right: b.getBoundingClientRect().right, width: b.clientWidth, scrollWidth: b.scrollWidth })) }))
}
async function switchLanguage(page, from, to) {
  await page.getByRole('button', { name: from === 'vi' ? 'Ngôn ngữ' : 'Language', exact: true }).click()
  await page.getByRole('option').filter({ hasText: to === 'vi' ? 'Tiếng Việt' : 'English' }).click()
}
async function matrix(browser, config) {
  const { page, context } = await setup(browser, config)
  const checks = { ...config, modes: [], answers: [] }
  try {
    for (let i = 0; i < modes.length; i++) {
      await page.getByRole('tab', { name: labels[config.lang][i], exact: true }).click()
      const visible = await page.locator('[data-agent-suggestions] button').allTextContents()
      assert.deepEqual(visible, getAgentSuggestions(modes[i], config.lang).map(x => x.text))
      const sizes = await overflow(page)
      assert.equal(sizes.document, 0)
      assert.ok(sizes.chips.every(x => x.left >= 0 && x.right <= config.width + 1 && x.font >= 12 && x.scrollWidth <= x.width + 1))
      checks.modes.push({ mode: modes[i], count: visible.length, ...sizes })
      await page.screenshot({ path: path.join(out, `home-${config.width}-${config.lang}-${config.theme}-${modes[i]}.png`), fullPage: false })
    }
    await page.getByRole('tab', { name: labels[config.lang][0], exact: true }).click()
    for (const suggestion of getAgentSuggestions('ask', config.lang)) {
      await page.locator('[data-agent-suggestions] button').filter({ hasText: suggestion.text }).click()
      await page.waitForFunction(() => {
        const a = document.querySelector('[data-home-agent-answer] [role="status"]')
        return a && a.textContent && !/Preparing response|Đang chuẩn bị/.test(a.textContent)
      })
      assert.equal(await page.locator('[data-home-user-message]').innerText(), suggestion.text)
      assert.equal(await page.locator('[data-agent-suggestions="ask"]').count(), 1)
      const answer = await page.locator('[data-home-agent-answer]').innerText()
      assert.ok(!/UNSUPPORTED|NOT_IMPLEMENTED|Check my portfolio/.test(answer))
      assert.ok(!/Connect a wallet|Kết nối ví|cannot read|Không thể đọc/i.test(answer), answer)
      assert.ok(config.lang === 'vi' ? /hiện tại|tài sản|giao dịch|mạng Arc|Danh mục/i.test(answer) : /portfolio|holding|recent|balances|Arc network/i.test(answer))
      checks.answers.push({ id: suggestion.id, text: suggestion.text, answer })
    }
    // UI state is authoritative even when input is in the other language.
    const raw = config.lang === 'vi' ? 'What is my portfolio worth right now?' : 'Danh mục của tôi trị giá bao nhiêu?'
    const field = page.locator('textarea')
    await field.fill(raw)
    await field.press('Enter')
    await page.waitForFunction(() => !/Preparing response|Đang chuẩn bị/.test(document.querySelector('[data-home-agent-answer] [role="status"]')?.textContent || 'Preparing response'))
    assert.equal(await page.locator('[data-home-user-message]').innerText(), raw)
    const before = await page.locator('[data-home-agent-answer] [role="status"]').innerText()
    assert.ok(config.lang === 'vi' ? before.toLowerCase().includes('danh mục') : before.includes('portfolio'), before)
    const other = config.lang === 'vi' ? 'en' : 'vi'
    await switchLanguage(page, config.lang, other)
    assert.equal(await page.locator('[data-home-user-message]').innerText(), raw)
    assert.deepEqual(await page.locator('[data-agent-suggestions] button').allTextContents(), getAgentSuggestions('ask', other).map(x => x.text))
    const after = await page.locator('[data-home-agent-answer] [role="status"]').innerText()
    assert.ok(other === 'vi' ? after.toLowerCase().includes('danh mục') : after.includes('portfolio'), after)
    await switchLanguage(page, other, config.lang)
    assert.equal(await page.locator('[data-home-user-message]').innerText(), raw)
    checks.localeSwitch = { raw, before, after, preserved: true }
    checks.finalOverflow = (await overflow(page)).document
    assert.equal(checks.finalOverflow, 0)
    checks.passed = true
  } catch (e) { checks.passed = false; checks.error = e.stack; await page.screenshot({ path: path.join(out, `home-failure-${config.width}-${config.lang}-${config.theme}.png`), fullPage: true }) }
  results.push(checks)
  await context.close()
}
async function handoff(browser, lang, mode, suggestion) {
  const config = { width: 1440, lang, theme: 'dark' }
  const { page, context } = await setup(browser, config)
  const check = { type: 'handoff', lang, mode, text: suggestion.text }
  try {
    if (mode === 'workflow') {
      await page.locator('textarea').fill(suggestion.text)
      await page.locator('textarea').press('Enter')
    } else {
      await page.getByRole('tab', { name: labels[lang][modes.indexOf(mode)], exact: true }).click()
      await page.locator('[data-agent-suggestions] button').filter({ hasText: suggestion.text }).click()
    }
    await page.getByRole('textbox', { name: lang === 'vi' ? 'Nhắn cho Makoto' : 'Message Makoto', exact: true }).waitFor()
    await page.waitForTimeout(500)
    const body = await page.locator('main').innerText()
    assert.ok(body.includes(suggestion.text), body)
    assert.ok(!/UNSUPPORTED|NOT_IMPLEMENTED|PLAN_READY|Previous State/.test(body))
    check.body = body
    check.passed = true
  } catch(e) { check.passed = false; check.error = e.stack }
  results.push(check)
  await context.close()
}
;(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const workflowOnly = process.argv.includes('--workflow-only')
  const configs = [1440, 1280, 390].flatMap(width => ['vi', 'en'].flatMap(lang => ['dark', 'light'].map(theme => ({ width, lang, theme }))))
  if (!workflowOnly) for (let i = 0; i < configs.length; i += 3) await Promise.all(configs.slice(i, i + 3).map(x => matrix(browser, x)))
  for (const lang of ['vi', 'en']) {
    const prompts = workflowOnly ? [] : ['monitor', 'automation'].flatMap(mode => getAgentSuggestions(mode, lang).map(suggestion => ({ mode, suggestion })))
    prompts.push({ mode: 'workflow', suggestion: { text: lang === 'vi' ? 'Gửi 10 USDC tới 0x19519eec824637087f6109996124d7700f6cbe71' : 'Send 10 USDC to 0x19519eec824637087f6109996124d7700f6cbe71' } })
    if (workflowOnly) prompts.push(
      { mode: 'workflow', suggestion: { text: lang === 'vi' ? 'Hoán đổi 10 USDC sang EURC' : 'Swap 10 USDC to EURC' } },
      { mode: 'workflow', suggestion: { text: lang === 'vi' ? 'Chuyển 10 USDC sang Base Sepolia' : 'Bridge 10 USDC to Base Sepolia' } },
    )
    for (let i = 0; i < prompts.length; i += 3) await Promise.all(prompts.slice(i, i + 3).map(({ mode, suggestion }) => handoff(browser, lang, mode, suggestion)))
  }
  await browser.close()
  fs.writeFileSync(path.join(out, workflowOnly ? 'workflow-browser-results.json' : 'home-browser-results.json'), JSON.stringify({ origin: 'http://localhost:5173', account, results, consoleErrors }, null, 2))
  console.log(JSON.stringify({ checks: results.length, passed: results.filter(x => x.passed).length, failed: results.filter(x => !x.passed).map(x => ({ lang: x.lang, width: x.width, theme: x.theme, mode: x.mode, error: x.error })), consoleErrors }, null, 2))
  if (results.some(x => !x.passed) || consoleErrors.length) process.exitCode = 1
})().catch(e => { console.error(e); process.exitCode = 1 })
