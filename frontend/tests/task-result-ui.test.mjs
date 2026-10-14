import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

// Render the production Tasks page with read-only context fixtures. No wallet,
// task execution, authentication, scheduler, or persistence handler may run.
const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtureKey = '__makotoTaskResultUiFixture'
const previousFixture = globalThis[fixtureKey]
const previousTimezone = process.env.TZ
const account = '0x1111111111111111111111111111111111111111'
const nextRunAt = '2026-10-15T01:00:00.000Z'
const lastRunAt = '2026-10-14T01:00:00.000Z'
const rawLanguageSummary = '**RAW_PROVIDER_PROSE_SENTINEL**\n## PORTFOLIO_SUMMARY\n- ACTIVITY_SUMMARY BALANCE_CHECK NOT_REQUESTED PARTIAL UNAVAILABLE AVAILABLE REAL_PROVIDER DETERMINISTIC_FALLBACK\n`code` 999999 USDC'
const balances = { USDC: '171.038201', EURC: '225.697706', cirBTC: '0.001' }
let server, TasksPage

before(async () => {
  process.env.TZ = 'Asia/Bangkok'
  server = await createServer({
    root: frontendRoot, configFile: false, appType: 'custom',
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    esbuild: { jsx: 'automatic' },
    plugins: [{
      name: 'task-result-context-fixtures', enforce: 'pre',
      resolveId(source) {
        if (source.endsWith('/lib/store')) return '\0task-result-ui-wallet'
        if (source.endsWith('/lib/i18n')) return '\0task-result-ui-language'
      },
      load(id) {
        if (id === '\0task-result-ui-wallet') return `export const useWallet = () => globalThis.${fixtureKey}.wallet;`
        if (id === '\0task-result-ui-language') return `
          export * from '/src/lib/i18n.ts';
          import { translate } from '/src/lib/i18n.ts';
          export const useT = () => {
            const language = globalThis.${fixtureKey}.language;
            return [(value) => typeof value === 'string' ? translate(value, language) : value, language];
          };
        `
      },
    }],
  })
  TasksPage = (await server.ssrLoadModule('/src/pages/Tasks.tsx')).default
})

after(async () => {
  await server?.close()
  if (previousTimezone === undefined) delete process.env.TZ
  else process.env.TZ = previousTimezone
  if (previousFixture === undefined) delete globalThis[fixtureKey]
  else globalThis[fixtureKey] = previousFixture
})

function savedTask(action, result, overrides = {}) {
  return {
    id: 'observed-task', type: 'SCHEDULED_AUTOMATION', title: 'Saved task', description: '', account,
    chainId: 5042002, timezone: 'Asia/Bangkok', sourceIntent: '', locale: 'en',
    condition: null, schedule: { kind: 'DAILY', time: '08:00', action },
    authority: 'READ_ONLY', createdBy: 'USER', status: 'ACTIVE',
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-14T00:00:00.000Z',
    nextRunAt, lastRunAt, lastResult: result, lastError: null,
    triggerCount: 0, previousConditionState: null, ...overrides,
  }
}

function observedResult(kind, overrides = {}) {
  return {
    kind, observedAt: lastRunAt, languageSummary: rawLanguageSummary, languageSource: 'REAL_PROVIDER',
    ...overrides,
  }
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}

function render(language, task, walletOverrides = {}) {
  const tasks = freeze([task])
  const before = JSON.stringify(tasks)
  const calls = []
  const forbid = (name) => () => { calls.push(name); throw new Error(`SSR must never call ${name}`) }
  globalThis[fixtureKey] = {
    language,
    wallet: {
      mode: 'connected', address: account, walletChainId: 5042002, taskAuthenticated: true,
      taskWalletReady: true, taskAuthLoading: false, tasks, tasksLoading: false, tasksError: false,
      taskNotifications: [], taskNotificationsError: false,
      ...Object.fromEntries(['verifyTaskWallet', 'logoutTaskWallet', 'createTask', 'updateTask', 'runTask', 'deleteTask', 'refreshTasks', 'notify']
        .map((name) => [name, forbid(name)])),
      ...walletOverrides,
    },
  }
  const html = renderToStaticMarkup(createElement(TasksPage))
  assert.equal(JSON.stringify(tasks), before, 'Rendering preserves the stored task, schedule, and raw audit summary')
  assert.deepEqual(calls, [], 'Rendering never executes task or wallet handlers')
  return html
}

function visibleText(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}

function rows(html) {
  return new Map([...html.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/g)]
    .map((match) => [visibleText(match[1]), visibleText(match[2])]))
}

const copy = {
  en: {
    result: 'Latest result', summary: 'Makoto summary', source: 'Summary from verified task data',
    actions: ['Pause', 'Run now', 'Edit', 'Delete'],
    account: 'Account', network: 'Network', timezone: 'Timezone', next: 'Next run/check', last: 'Last run/check',
    portfolio: 'Your portfolio currently holds 171.038201 USDC, 225.697706 EURC and 0.001 cirBTC.',
    partialActivity: 'may not reflect all wallet activity', unavailableActivity: 'Activity data from Arc Explorer is unavailable right now.',
    monitor: 'The USDC balance is 214.7715', balance: 'Observed balances',
  },
  vi: {
    result: 'Kết quả gần nhất', summary: 'Makoto tóm tắt', source: 'Tóm tắt từ dữ liệu đã xác minh',
    actions: ['Tạm dừng', 'Chạy ngay', 'Sửa', 'Xóa'],
    account: 'Ví', network: 'Mạng', timezone: 'Múi giờ', next: 'Lần chạy/kiểm tra tiếp theo', last: 'Lần chạy/kiểm tra cuối',
    portfolio: 'Danh mục hiện có 171.038201 USDC, 225.697706 EURC và 0.001 cirBTC.',
    partialActivity: 'có thể chưa phản ánh toàn bộ hoạt động của ví', unavailableActivity: 'Chưa thể lấy dữ liệu hoạt động từ Arc Explorer',
    monitor: 'Số dư USDC hiện là 214.7715', balance: 'Dữ liệu quan sát được',
  },
}

function assertClean(html) {
  assert.doesNotMatch(visibleText(html), /\*\*|##|`|RAW_PROVIDER_PROSE_SENTINEL|999999|\b(?:PORTFOLIO_SUMMARY|ACTIVITY_SUMMARY|BALANCE_CHECK|NOT_REQUESTED|PARTIAL|UNAVAILABLE|AVAILABLE|REAL_PROVIDER|DETERMINISTIC_FALLBACK)\b/)
  assert.doesNotMatch(visibleText(html), /AI phrasing|Diễn đạt bằng AI/)
}

function summaryRow(html, language) {
  const table = rows(html)
  assert.ok(table.has(copy[language].result), 'The short factual result remains visible')
  const summary = table.get(copy[language].summary)
  assert.ok(summary, 'The deterministic interpretation is visible')
  assert.ok(summary.endsWith(copy[language].source), 'The deterministic source label is visible')
  const body = summary.slice(0, -copy[language].source.length).trim()
  assert.notEqual(body, table.get(copy[language].result), 'The interpretation differs from the factual result')
  return body
}

for (const language of ['en', 'vi']) {
  test(`${language} production portfolio card renders trusted balances and honest missing-data copy`, () => {
    const result = observedResult('PORTFOLIO_SUMMARY', {
      balances, unavailableBalances: [], prices: {}, pricingStatus: 'UNAVAILABLE', activityStatus: 'PARTIAL', activityCount: 15,
    })
    const html = render(language, savedTask('PORTFOLIO_SUMMARY', result))
    assertClean(html)
    const summary = summaryRow(html, language)
    assert.ok(summary.includes(copy[language].portfolio))
    assert.match(summary, language === 'vi' ? /Giá thị trường hiện chưa khả dụng nên chưa thể tính tổng giá trị danh mục/ : /Market prices are unavailable, so the total portfolio value cannot be determined/)
    assert.match(summary, language === 'vi' ? /Dữ liệu hoạt động hiện chỉ có một phần/ : /Activity data is incomplete/)
    assert.match(rows(html).get(copy[language].result), /171\.038201.*225\.697706.*0\.001/)
    assert.doesNotMatch(visibleText(html), /0\.00100000|\$[\d,.]+|USD\s*[:=]\s*[\d,.]+|(?:total|tổng giá trị)\s*[:=]\s*[\d,.]+/i)
  })

  test(`${language} production partial activity card warns that the count is incomplete`, () => {
    const html = render(language, savedTask('ACTIVITY_SUMMARY', observedResult('ACTIVITY_SUMMARY', {
      balances: {}, activityCount: 15, activityStatus: 'PARTIAL', pricingStatus: 'NOT_REQUESTED',
    })))
    assertClean(html)
    const summary = summaryRow(html, language)
    assert.ok(summary.includes('Arc Explorer'))
    assert.match(summary, /15/)
    assert.ok(summary.includes(copy[language].partialActivity))
  })

  test(`${language} production unavailable activity card never presents an observed count`, () => {
    const html = render(language, savedTask('ACTIVITY_SUMMARY', observedResult('ACTIVITY_SUMMARY', {
      balances: {}, activityCount: 15, activityStatus: 'UNAVAILABLE', pricingStatus: 'NOT_REQUESTED',
    })))
    assertClean(html)
    const summary = summaryRow(html, language)
    assert.ok(summary.includes(copy[language].unavailableActivity))
    assert.doesNotMatch(summary, /15|0 transactions|0 giao dịch/)
    assert.doesNotMatch(rows(html).get(copy[language].result), /15|0 transactions|0 giao dịch/)
  })

  test(`${language} production monitor card interprets the observed balance and threshold`, () => {
    const task = savedTask('BALANCE_CHECK', observedResult('TOKEN_BALANCE', {
      asset: 'USDC', balance: '214.7715', operator: 'LT', threshold: '500', conditionMet: true,
    }), {
      type: 'CONDITION_MONITOR', schedule: null,
      condition: { metric: 'TOKEN_BALANCE', asset: 'USDC', operator: 'LT', threshold: '500', checkIntervalMinutes: 2 },
    })
    const html = render(language, task)
    assertClean(html)
    const summary = summaryRow(html, language)
    assert.ok(summary.includes(copy[language].monitor))
    assert.match(summary, language === 'vi' ? /đang dưới ngưỡng 500 USDC/ : /below the threshold of 500 USDC/)
    assert.match(rows(html).get(copy[language].result), /214\.7715.*USDC < 500/)
  })

  test(`${language} production balance check preserves precision and warns about missing balances`, () => {
    const html = render(language, savedTask('BALANCE_CHECK', observedResult('BALANCE_CHECK', {
      balances: { USDC: balances.USDC, cirBTC: balances.cirBTC }, unavailableBalances: ['EURC'],
      pricingStatus: 'NOT_REQUESTED', activityStatus: 'NOT_REQUESTED',
    })))
    assertClean(html)
    const summary = summaryRow(html, language)
    assert.ok(summary.includes(copy[language].balance))
    assert.match(summary, /171\.038201 USDC/)
    assert.match(summary, /0\.001 cirBTC/)
    assert.match(summary, language === 'vi' ? /Một số số dư hiện chưa khả dụng/ : /Some balances are unavailable right now/)
    assert.doesNotMatch(summary, /225\.697706|0\.00100000/)
  })

  test(`${language} false monitor state does not claim continued unmet history after a previously met condition`, () => {
    const task = savedTask('BALANCE_CHECK', observedResult('TOKEN_BALANCE', {
      asset: 'USDC', balance: '600', operator: 'LT', threshold: '500', conditionMet: false, previousConditionState: true,
    }), {
      type: 'CONDITION_MONITOR', schedule: null,
      condition: { metric: 'TOKEN_BALANCE', asset: 'USDC', operator: 'LT', threshold: '500', checkIntervalMinutes: 2 },
    })
    const html = render(language, task)
    assertClean(html)
    const summary = summaryRow(html, language)
    assert.equal(summary, language === 'vi'
      ? 'Số dư USDC hiện là 600, đang bằng hoặc cao hơn ngưỡng 500 USDC.'
      : 'The USDC balance is 600, not below the threshold of 500 USDC.')
    assert.doesNotMatch(summary, /still|vẫn|chưa|đã xuống|đã vượt/)
    assert.match(rows(html).get(copy[language].result), language === 'vi' ? /USDC < 500 chưa đạt/ : /USDC < 500 not met/)
  })

  test(`${language} presentation retains account, network, schedule, timestamps, and task actions`, () => {
    const html = render(language, savedTask('PORTFOLIO_SUMMARY', observedResult('PORTFOLIO_SUMMARY', {
      balances, unavailableBalances: [], prices: {}, pricingStatus: 'UNAVAILABLE', activityStatus: 'UNAVAILABLE',
    })))
    const table = rows(html)
    assert.match(html, new RegExp(`title="${account}"`))
    assert.ok(table.has(copy[language].account))
    assert.equal(table.get(copy[language].network), 'Arc Testnet')
    assert.match(table.get(copy[language].timezone), /UTC\+7/)
    assert.match(html, /title="Asia\/Bangkok" data-task-timezone="Asia\/Bangkok"/)
    for (const [label, time] of [[copy[language].next, nextRunAt], [copy[language].last, lastRunAt]]) {
      const expected = new Intl.DateTimeFormat(language === 'vi' ? 'vi-VN' : 'en-US', {
        dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok',
      }).format(new Date(time))
      assert.equal(table.get(label), expected, `The ${label} timestamp stays visible in the saved timezone`)
    }
    assert.ok(visibleText(html).includes(language === 'vi' ? 'Hằng ngày 08:00' : 'Daily 08:00'))
    const actions = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
      .filter((match) => copy[language].actions.includes(visibleText(match[2])))
    assert.deepEqual(actions.map((match) => visibleText(match[2])), copy[language].actions)
    for (const action of actions) assert.doesNotMatch(action[1], /\bdisabled=/, 'Existing authorized actions remain enabled')
  })

  test(`${language} no structured result has no generated summary row`, () => {
    for (const result of [null, { languageSummary: rawLanguageSummary, languageSource: 'REAL_PROVIDER' }]) {
      const html = render(language, savedTask('PORTFOLIO_SUMMARY', result))
      assertClean(html)
      assert.ok(!rows(html).has(copy[language].summary))
      assert.ok(!visibleText(html).includes(copy[language].source))
    }
  })
}

test('production Tasks page keeps the wallet verification gate before private task cards', () => {
  const html = render('en', savedTask('PORTFOLIO_SUMMARY', observedResult('PORTFOLIO_SUMMARY', { balances })), {
    taskAuthenticated: false,
  })
  const text = visibleText(html)
  assert.ok(text.includes('Verify wallet to manage tasks'))
  assert.ok(text.includes('Sign a message to prove wallet ownership. No gas or transaction is involved.'))
  assert.ok(!rows(html).has(copy.en.result))
  assert.ok(!rows(html).has(copy.en.summary))
  assert.ok(!text.includes('171.038201'))
})
