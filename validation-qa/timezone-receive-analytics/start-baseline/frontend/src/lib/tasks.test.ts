import assert from 'node:assert/strict'
import test from 'node:test'
import { taskApi, taskBinding, taskDisplayTitle, taskIntentMode, taskItemsForAccount, taskLanguageSummary, taskPriceObservations, taskResultSummary } from './tasks.ts'

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
  assert.match(taskResultSummary(task, { kind: 'TOKEN_BALANCE', asset: 'USDC', balance: '490', conditionMet: true }, 'vi'), /490.*đã đạt/)
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
