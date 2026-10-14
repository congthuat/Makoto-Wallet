import assert from 'node:assert/strict'
import test from 'node:test'
import { taskApi, taskBinding, taskDisplaySummary, taskDisplayTitle, taskIntentMode, taskItemsForAccount, taskLanguageSummary, taskPriceObservations, taskResultSummary } from './tasks.ts'

const address = '0x1111111111111111111111111111111111111111'

test('task intent cues route recurring and conditional writes to task safety parsing', () => {
  assert.equal(taskIntentMode('Alert me when USDC balance is below 500'), 'monitor')
  assert.equal(taskIntentMode('Báo tôi khi số dư EURC trên 200'), 'monitor')
  assert.equal(taskIntentMode('Send me a daily portfolio summary at 08:00'), 'automation')
  assert.equal(taskIntentMode('Mỗi tối 20h tóm tắt giao dịch hôm nay'), 'automation')
  assert.equal(taskIntentMode('Every day swap 10 USDC to EURC'), 'automation')
  assert.equal(taskIntentMode('When USDC is below 500 buy more'), 'monitor')
  assert.equal(taskIntentMode('Khi USDC dưới 500 thì swap 10 USDC sang EURC'), 'monitor')
  assert.equal(taskIntentMode('Khi số dư EURC trên 200 thì báo tôi'), 'monitor')
  assert.equal(taskIntentMode('Swap 10 USDC to EURC'), null)
})

test('Vietnamese daily portfolio requests route to automation at 07:00', () => {
  for (const text of [
    'Gửi tôi tóm tắt danh mục lúc 07:00 mỗi ngày',
    'Tóm tắt danh mục hằng ngày lúc 07:00',
    'Lập lịch tóm tắt portfolio lúc 07:00 mỗi ngày',
    'Mỗi ngày lúc 07:00 tóm tắt danh mục cho tôi',
    'Mỗi sáng lúc 07:00 tóm tắt danh mục cho tôi',
  ]) assert.equal(taskIntentMode(text), 'automation', text)
})

test('recurring Send, Swap, and Bridge requests route to task safety parsing', () => {
  for (const text of [
    'Gửi 10 USDC mỗi ngày lúc 08:00',
    'Send 10 USDC every day at 08:00',
    'Swap 10 USDC every day',
    'Bridge USDC every morning',
  ]) assert.equal(taskIntentMode(text), 'automation', text)
})

test('task binding requires a real public address and the supported Arc chain', () => {
  assert.deepEqual(taskBinding({ mode: 'demo', address, timezone: 'Asia/Bangkok' }), { ok: false, reason: 'ACCOUNT_REQUIRED' })
  assert.deepEqual(taskBinding({ mode: 'connected', address, walletChainId: 1, timezone: 'Asia/Bangkok' }), { ok: false, reason: 'CHAIN_REQUIRED' })
  assert.deepEqual(taskBinding({ mode: 'connected', address, walletChainId: 5042002, timezone: 'Asia/Bangkok' }), { ok: true, account: address, chainId: 5042002, timezone: 'Asia/Bangkok' })
})

test('task parse client sends binding and locale, preserving backend blocked authority', async () => {
  const original = globalThis.fetch
  let posted: unknown
  globalThis.fetch = async (_url, init) => {
    posted = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ candidate: null, missingFields: [], blocked: { code: 'TASK_WRITE_REQUIRES_USER', authority: 'PREPARE_ONLY' } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  try {
    const result = await taskApi.parse({ text: 'Every day swap 10 USDC', mode: 'automation', account: address, chainId: 5042002, timezone: 'Asia/Bangkok', locale: 'en' })
    assert.deepEqual(posted, { text: 'Every day swap 10 USDC', mode: 'automation', account: address, chainId: 5042002, timezone: 'Asia/Bangkok', locale: 'en' })
    assert.equal(result.blocked?.authority, 'PREPARE_ONLY')
  } finally { globalThis.fetch = original }
})

test('task display derives VI text from typed definition and observed result', () => {
  const task = { type: 'CONDITION_MONITOR' as const, title: 'USDC balance alert', condition: { metric: 'TOKEN_BALANCE' as const, asset: 'USDC' as const, operator: 'LT' as const, threshold: '500', checkIntervalMinutes: 2 }, schedule: null }
  assert.equal(taskDisplayTitle(task, 'vi'), 'Theo dõi số dư USDC')
  assert.match(taskResultSummary(task, { kind: 'TOKEN_BALANCE', asset: 'USDC', balance: '490', threshold: '500', operator: 'LT', conditionMet: true }, 'vi'), /490.*đã đạt/)
})

test('task previews and alerts are scoped to the active account', () => {
  const other = '0x2222222222222222222222222222222222222222'
  const items = [
    { id: 'current', account: address, chainId: 5042002 },
    { id: 'other', account: other, chainId: 5042002 },
    { id: 'wrong-chain', account: address, chainId: 1 },
  ]
  assert.deepEqual(taskItemsForAccount(items, 'connected', address.toUpperCase()).map((item) => item.id), ['current'])
  assert.deepEqual(taskItemsForAccount(items, 'demo', address), [])
})

test('optional language summary stays separate from the structured result', () => {
  assert.deepEqual(taskLanguageSummary({ kind: 'PORTFOLIO_SUMMARY', languageSummary: 'Observed balances are ready.', languageSource: 'REAL_PROVIDER' }), { text: 'Observed balances are ready.', source: 'REAL_PROVIDER' })
  assert.deepEqual(taskLanguageSummary({ languageSummary: 'USDC: 1', languageSource: 'DETERMINISTIC_FALLBACK' }), { text: 'USDC: 1', source: 'DETERMINISTIC_FALLBACK' })
  assert.equal(taskLanguageSummary({ kind: 'PORTFOLIO_SUMMARY', summary: 'USDC: 1' }), null)
  assert.equal(taskLanguageSummary({ languageSummary: 'Claimed value', languageSource: 'UNKNOWN' }), null)
})

test('portfolio unit prices come only from valid observed price records', () => {
  assert.deepEqual(taskPriceObservations({ kind: 'PORTFOLIO_SUMMARY', prices: {
    USDC: { usd: 1.01, observedAt: '2026-09-29T01:00:00.000Z' },
    EURC: { usd: 0, observedAt: '2026-09-29T01:00:00.000Z' },
    cirBTC: { usd: 91000, observedAt: 'invalid' },
  } }), [{ asset: 'USDC', usd: 1.01, observedAt: '2026-09-29T01:00:00.000Z' }])
  assert.deepEqual(taskPriceObservations({ kind: 'BALANCE_CHECK', prices: { USDC: { usd: 1, observedAt: '2026-09-29T01:00:00.000Z' } } }), [])
})

test('portfolio result keeps partial and unavailable inputs explicit', () => {
  const task = { type: 'SCHEDULED_AUTOMATION' as const, condition: null, schedule: { kind: 'DAILY' as const, time: '08:00', action: 'PORTFOLIO_SUMMARY' as const } }
  assert.equal(taskResultSummary(task, {
    kind: 'PORTFOLIO_SUMMARY', balances: { USDC: '1' }, unavailableBalances: ['EURC'], pricingStatus: 'PARTIAL', activityStatus: 'UNAVAILABLE',
  }, 'en'), 'Balances: USDC: 1. Some balances unavailable. Pricing partial. Activity unavailable.')
})

const portfolioResult = {
  kind: 'PORTFOLIO_SUMMARY', balances: { USDC: '171.038201', EURC: '225.697706', cirBTC: '0.001' },
  unavailableBalances: [], pricingStatus: 'UNAVAILABLE', activityStatus: 'PARTIAL',
  languageSummary: '**PORTFOLIO_SUMMARY**\n## ACTIVITY_SUMMARY\n- NOT_REQUESTED PARTIAL UNAVAILABLE AVAILABLE BALANCE_CHECK REAL_PROVIDER DETERMINISTIC_FALLBACK `code` 999999 USD',
  languageSource: 'REAL_PROVIDER',
}

test('VI portfolio interpretation uses only observed balances and natural availability copy', () => {
  const before = JSON.stringify(portfolioResult)
  assert.equal(taskDisplaySummary(portfolioResult, 'vi'), 'Danh mục hiện có 171.038201 USDC, 225.697706 EURC và 0.001 cirBTC. Giá thị trường hiện chưa khả dụng nên chưa thể tính tổng giá trị danh mục. Dữ liệu hoạt động hiện chỉ có một phần.')
  assert.equal(JSON.stringify(portfolioResult), before)
  for (const locale of ['vi', 'en'] as const) {
    const summary = taskDisplaySummary(portfolioResult, locale)!
    assert.doesNotMatch(summary, /\*\*|##|`|PORTFOLIO_SUMMARY|ACTIVITY_SUMMARY|BALANCE_CHECK|NOT_REQUESTED|PARTIAL|UNAVAILABLE|AVAILABLE|REAL_PROVIDER|DETERMINISTIC_FALLBACK|999999|\bUSD\b|\$/)
    assert.match(summary, /0\.001 cirBTC/)
    assert.doesNotMatch(summary, /0\.00100000/)
  }
})

test('EN portfolio and balance interpretations preserve precision without computing a total', () => {
  assert.equal(taskDisplaySummary(portfolioResult, 'en'), 'Your portfolio currently holds 171.038201 USDC, 225.697706 EURC and 0.001 cirBTC. Market prices are unavailable, so the total portfolio value cannot be determined. Activity data is incomplete.')
  const balanceResult = { ...portfolioResult, kind: 'BALANCE_CHECK', pricingStatus: 'NOT_REQUESTED', activityStatus: 'NOT_REQUESTED' }
  assert.equal(taskDisplaySummary(balanceResult, 'en'), 'Observed balances are 171.038201 USDC, 225.697706 EURC and 0.001 cirBTC.')
  assert.equal(taskDisplaySummary(balanceResult, 'vi'), 'Dữ liệu quan sát được: 171.038201 USDC, 225.697706 EURC và 0.001 cirBTC.')
})

test('partial prices and unavailable activity remain distinct from complete data', () => {
  const result = { ...portfolioResult, pricingStatus: 'PARTIAL', activityStatus: 'UNAVAILABLE' }
  assert.match(taskDisplaySummary(result, 'vi')!, /Một phần dữ liệu giá hiện chưa khả dụng\. Dữ liệu hoạt động hiện chưa khả dụng\./)
  assert.match(taskDisplaySummary(result, 'en')!, /Some market price data is unavailable\. Activity data is unavailable right now\./)
  const priced = { ...portfolioResult, pricingStatus: 'AVAILABLE', activityStatus: 'AVAILABLE', prices: { USDC: { usd: 1 }, EURC: { usd: 1.1 }, cirBTC: { usd: 90000 } } }
  assert.equal(taskDisplaySummary(priced, 'en'), 'Your portfolio currently holds 171.038201 USDC, 225.697706 EURC and 0.001 cirBTC.')
})

test('daily activity explicitly qualifies partial observations and accepts complete zero', () => {
  const partial = { kind: 'ACTIVITY_SUMMARY', activityCount: 15, activityStatus: 'PARTIAL' }
  assert.equal(taskDisplaySummary(partial, 'vi'), 'Hôm nay Arc Explorer ghi nhận 15 giao dịch. Dữ liệu hiện chưa đầy đủ nên con số này có thể chưa phản ánh toàn bộ hoạt động của ví.')
  assert.equal(taskDisplaySummary(partial, 'en'), 'Arc Explorer recorded 15 token transfers today. The data is incomplete, so this count may not reflect all wallet activity.')
  assert.equal(taskDisplaySummary({ ...partial, activityStatus: 'AVAILABLE' }, 'vi'), 'Hôm nay Arc Explorer ghi nhận 15 giao dịch.')
  assert.equal(taskDisplaySummary({ ...partial, activityStatus: 'AVAILABLE', activityCount: 0 }, 'en'), 'Arc Explorer recorded 0 token transfers today.')
  assert.equal(taskDisplaySummary({ ...partial, activityStatus: 'AVAILABLE', activityCount: 1 }, 'en'), 'Arc Explorer recorded 1 token transfer today.')
})

test('unavailable or invalid activity never implies a complete count', () => {
  for (const result of [
    { activityStatus: 'UNAVAILABLE', activityCount: 15 },
    { activityStatus: 'AVAILABLE', activityCount: null },
    { activityStatus: 'AVAILABLE', activityCount: -1 },
    { activityStatus: 'AVAILABLE', activityCount: '**PARTIAL**' },
    { activityStatus: 'UNKNOWN', activityCount: 15 },
  ]) {
    assert.equal(taskDisplaySummary({ kind: 'ACTIVITY_SUMMARY', ...result }, 'vi'), 'Chưa thể lấy dữ liệu hoạt động từ Arc Explorer lúc này.')
    assert.equal(taskDisplaySummary({ kind: 'ACTIVITY_SUMMARY', ...result }, 'en'), 'Activity data from Arc Explorer is unavailable right now.')
  }
})

test('monitor interprets the observed condition snapshot without using edited task fields', () => {
  const result = { kind: 'TOKEN_BALANCE', asset: 'USDC', balance: '214.7715', operator: 'LT', threshold: '500', conditionMet: true }
  assert.equal(taskDisplaySummary(result, 'vi'), 'Số dư USDC hiện là 214.7715, đang dưới ngưỡng 500 USDC.')
  assert.equal(taskDisplaySummary(result, 'en'), 'The USDC balance is 214.7715, below the threshold of 500 USDC.')
  const unmet = { ...result, balance: '514.2', conditionMet: false, previousConditionState: true }
  assert.equal(taskDisplaySummary(unmet, 'vi'), 'Số dư USDC hiện là 514.2, đang bằng hoặc cao hơn ngưỡng 500 USDC.')
  assert.equal(taskDisplaySummary(unmet, 'en'), 'The USDC balance is 514.2, not below the threshold of 500 USDC.')
  const editedTask = { type: 'CONDITION_MONITOR' as const, condition: { metric: 'TOKEN_BALANCE' as const, asset: 'USDC' as const, operator: 'GT' as const, threshold: '999', checkIntervalMinutes: 2 }, schedule: null }
  assert.equal(taskResultSummary(editedTask, result, 'en'), 'USDC balance: 214.7715. Condition USDC < 500 met.')
})

test('monitor preserves strict and inclusive operators for both condition states', () => {
  const cases = [
    { operator: 'LT', english: 'below', met: 'dưới', unmet: 'bằng hoặc cao hơn', metBalance: '499', unmetBalance: '500' },
    { operator: 'LTE', english: 'at or below', met: 'bằng hoặc thấp hơn', unmet: 'trên', metBalance: '500', unmetBalance: '501' },
    { operator: 'GT', english: 'above', met: 'trên', unmet: 'bằng hoặc thấp hơn', metBalance: '501', unmetBalance: '500' },
    { operator: 'GTE', english: 'at or above', met: 'bằng hoặc cao hơn', unmet: 'dưới', metBalance: '500', unmetBalance: '499' },
  ]
  for (const { operator, english, met, unmet, metBalance, unmetBalance } of cases) {
    for (const conditionMet of [true, false]) {
      const balance = conditionMet ? metBalance : unmetBalance
      const result = { kind: 'TOKEN_BALANCE', asset: 'EURC', balance, threshold: '500', operator, conditionMet, previousConditionState: !conditionMet }
      assert.equal(taskDisplaySummary(result, 'en'), `The EURC balance is ${balance}, ${conditionMet ? '' : 'not '}${english} the threshold of 500 EURC.`)
      assert.equal(taskDisplaySummary(result, 'vi'), `Số dư EURC hiện là ${balance}, đang ${conditionMet ? met : unmet} ngưỡng 500 EURC.`)
      for (const locale of ['en', 'vi'] as const) assert.doesNotMatch(taskDisplaySummary(result, locale)!, /still|vẫn|chưa|đã xuống|đã vượt/)
    }
  }
})

test('monitor cannot invent a missing balance, condition value, or condition state', () => {
  assert.equal(taskDisplaySummary({ kind: 'TOKEN_BALANCE', asset: 'USDC', balance: null, languageSummary: 'Balance 1000' }, 'en'), 'Balance data is unavailable right now.')
  for (const conditionMet of [undefined, 'PARTIAL']) {
    assert.equal(taskDisplaySummary({ kind: 'TOKEN_BALANCE', asset: 'USDC', balance: '0', operator: 'LT', threshold: '500', conditionMet }, 'en'), 'The USDC balance is 0. There is not enough data to describe the condition.')
  }
})

test('balance display rejects prose and missing values, preserves zero and exact long decimal strings', () => {
  const task = { type: 'SCHEDULED_AUTOMATION' as const, condition: null, schedule: { kind: 'DAILY' as const, time: '08:00', action: 'BALANCE_CHECK' as const } }
  const result = { kind: 'BALANCE_CHECK', balances: { USDC: '12345678901234567890.123456', EURC: '0', cirBTC: '**0.001**', PARTIAL: '99' }, unavailableBalances: ['cirBTC'], pricingStatus: 'NOT_REQUESTED', activityStatus: 'NOT_REQUESTED' }
  assert.equal(taskDisplaySummary(result, 'en'), 'Observed balances are 12345678901234567890.123456 USDC and 0 EURC. Some balances are unavailable right now.')
  assert.equal(taskDisplaySummary(result, 'vi'), 'Dữ liệu quan sát được: 12345678901234567890.123456 USDC và 0 EURC. Một số số dư hiện chưa khả dụng.')
  assert.doesNotMatch(taskResultSummary(task, result, 'vi'), /\*\*|PARTIAL|0\.001|cirBTC/)
  assert.equal(taskDisplaySummary({ kind: 'BALANCE_CHECK', balances: {}, languageSummary: 'USDC: 1000' }, 'en'), 'Balance data is unavailable right now.')
  assert.equal(taskDisplaySummary({ kind: 'BALANCE_CHECK', balances: { cirBTC: '0.00100000' } }, 'en'), 'Observed balances are 0.001 cirBTC. Some balances are unavailable right now.')
})

test('missing or unknown structured results do not display stored provider prose', () => {
  for (const value of [null, undefined, [], 'PORTFOLIO_SUMMARY', { languageSummary: 'Balances 1000 USD' }, { kind: 'UNKNOWN', summary: 'Balance 1000' }]) {
    assert.equal(taskDisplaySummary(value, 'vi'), null)
    assert.equal(taskDisplaySummary(value, 'en'), null)
  }
})
