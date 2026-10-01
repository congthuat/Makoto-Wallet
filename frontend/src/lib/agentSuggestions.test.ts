import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { parseBrainRequest } from '../brain/parser.ts'
import { routeBrainIntent } from '../brain/orchestration.ts'
import { routeHomeRequest } from '../agent/homeRequest.ts'
import { getAgentSuggestions, type AgentSuggestionMode } from './agentSuggestions.ts'
import { taskApi, taskIntentMode, type TaskCandidate, type TaskParseResult } from './tasks.ts'

// Exercise the current production task grammar and execution engine, never a parallel parser.
const require = createRequire(import.meta.url)
const { parseIntent } = require('../../../backend/lib/taskDefinitions.js')
const { TaskEngine } = require('../../../backend/lib/taskEngine.js')
const ACCOUNT = '0x1111111111111111111111111111111111111111'
const NOW = Date.parse('2026-10-01T00:00:00.000Z')
const locales = ['vi', 'en'] as const
const modes: readonly AgentSuggestionMode[] = ['ask', 'monitor', 'automation']
const expectedReads = ['wallet-overview', 'wallet-overview', 'recent-activity', 'wallet-overview', 'network-status']
const expectedQueries = ['portfolio', 'holdings', 'activity', 'balances', 'network']
const expectedConditions = [
  { asset: 'USDC', operator: 'LT', threshold: '100' },
  { asset: 'EURC', operator: 'LT', threshold: '50' },
  { asset: 'cirBTC', operator: 'LT', threshold: '0.01' },
  { asset: 'USDC', operator: 'GT', threshold: '1000' },
  { asset: 'EURC', operator: 'GT', threshold: '200' },
]
const expectedSchedules = [
  { kind: 'DAILY', action: 'PORTFOLIO_SUMMARY', time: '08:00' },
  { kind: 'DAILY', action: 'ACTIVITY_SUMMARY', time: '20:00' },
  { kind: 'DAILY', action: 'BALANCE_CHECK', time: '08:00' },
  { kind: 'DAILY', action: 'PORTFOLIO_SUMMARY', time: '20:00' },
  { kind: 'DAILY', action: 'ACTIVITY_SUMMARY', time: '21:00' },
]

for (const locale of locales) {
  for (const mode of modes) {
    test(`${locale} ${mode} exposes exactly five distinct ordinary user inputs`, () => {
      const suggestions = getAgentSuggestions(mode, locale)
      assert.equal(suggestions.length, 5)
      assert.equal(new Set(suggestions.map((suggestion) => suggestion.id)).size, 5)
      assert.equal(new Set(suggestions.map((suggestion) => suggestion.text)).size, 5)
      for (const suggestion of suggestions) {
        assert.deepEqual(Object.keys(suggestion).sort(), ['id', 'text'])
        assert.equal(suggestion.text, suggestion.text.trim())
        assert.doesNotMatch(suggestion.text, /UNSUPPORTED|NOT_IMPLEMENTED|eth_send|private key/i)
      }
    })
  }

  getAgentSuggestions('ask', locale).forEach((suggestion, index) => {
    test(`${locale} Ask ${suggestion.id} reaches an existing deterministic read`, () => {
      const homeRequest = routeHomeRequest(suggestion.text, locale, 'ask')
      assert.equal(homeRequest.route, 'INLINE')
      assert.equal(homeRequest.originalText, suggestion.text)
      assert.equal(homeRequest.plannerText, suggestion.text)
      assert.equal(homeRequest.locale, locale)
      assert.equal(homeRequest.route === 'INLINE' && homeRequest.query, expectedQueries[index])
      assert.equal(taskIntentMode(suggestion.text), null)
      const intent = parseBrainRequest(suggestion.text, locale)
      assert.equal(intent.kind, expectedReads[index], suggestion.text)
      assert.equal(intent.locale, locale)
      const decision = routeBrainIntent(intent)
      assert.equal(decision.mode, 'informational')
      assert.equal(decision.draftAllowed, false)
      assert.notEqual(decision.capabilityId, 'unknown')
      assert.deepEqual(decision.blockers, [])
    })
  })

  for (const mode of ['monitor', 'automation'] as const) {
    getAgentSuggestions(mode, locale).forEach((suggestion, index) => {
      test(`${locale} ${mode} ${suggestion.id} parses through the ordinary request and runs an existing read task`, async () => {
        const homeRequest = routeHomeRequest(suggestion.text, locale, mode)
        assert.equal(homeRequest.route, 'AGENT')
        assert.equal(homeRequest.originalText, suggestion.text)
        assert.equal(homeRequest.plannerText, suggestion.text)
        assert.equal(homeRequest.route === 'AGENT' && homeRequest.taskMode, mode)
        assert.equal(taskIntentMode(suggestion.text), mode)
        const originalFetch = globalThis.fetch
        let submittedText: unknown
        globalThis.fetch = async (_url, options) => {
          const posted = JSON.parse(String(options?.body))
          submittedText = posted.text
          return Response.json(parseIntent(posted))
        }
        let result: TaskParseResult
        try {
          result = await taskApi.parse({ text: suggestion.text, mode, account: ACCOUNT, chainId: 5042002, timezone: 'Asia/Bangkok', locale })
        } finally { globalThis.fetch = originalFetch }
        assert.equal(submittedText, suggestion.text)
        assert.equal(result.blocked, undefined)
        assert.deepEqual(result.missingFields, [])
        assert.ok(result.candidate)
        const candidate: TaskCandidate = result.candidate
        assert.equal(candidate.account, ACCOUNT)
        assert.equal(candidate.locale, locale)
        assert.equal(candidate.authority, 'NOTIFY_ONLY')
        if (mode === 'monitor') {
          assert.equal(candidate.type, 'CONDITION_MONITOR')
          assert.deepEqual(candidate.condition, { metric: 'TOKEN_BALANCE', ...expectedConditions[index], checkIntervalMinutes: 2 })
          assert.equal(candidate.schedule, null)
        } else {
          assert.equal(candidate.type, 'SCHEDULED_AUTOMATION')
          assert.deepEqual(candidate.schedule, expectedSchedules[index])
          assert.equal(candidate.condition, null)
        }

        // Isolated observed-data fixtures prove each typed task is executable by the current engine.
        const calls: string[] = []
        const engine = new TaskEngine({
          dbPath: ':memory:', now: () => NOW, generateSummary: async () => ({ ok: false }),
          reads: {
            verifyChain: async () => { calls.push('verifyChain') },
            readBalance: async (account: string, asset: string) => {
              calls.push('readBalance')
              assert.equal(account, ACCOUNT)
              assert.equal(asset, expectedConditions[index].asset)
              const amount = asset === 'cirBTC' ? '0.005' : asset === 'EURC' ? '20' : '50'
              const units = asset === 'cirBTC' ? '500000' : asset === 'EURC' ? '20000000' : '50000000'
              return { asset, amount, units, source: 'test-observation', observedAt: new Date(NOW).toISOString() }
            },
            readBalances: async () => {
              calls.push('readBalances')
              return { balances: { USDC: { amount: '50' }, EURC: { amount: '20' }, cirBTC: { amount: '0.005' } }, unavailable: [], observedAt: new Date(NOW).toISOString() }
            },
            readPrices: async () => {
              calls.push('readPrices')
              return { prices: { USDC: { usd: 1 }, EURC: { usd: 1.2 }, cirBTC: { usd: 50000 } }, unavailable: [] }
            },
            readActivity: async () => {
              calls.push('readActivity')
              return { items: [], hasMore: false, observedAt: new Date(NOW).toISOString() }
            },
          },
        })
        try {
          const task = engine.create(candidate)
          const outcome = await engine.run(task.id)
          assert.equal(outcome.run.status, 'SUCCESS')
          assert.equal(outcome.run.errorCode, null)
          assert.equal(outcome.run.result.kind, mode === 'monitor' ? 'TOKEN_BALANCE' : expectedSchedules[index].action)
          if (mode === 'monitor') assert.deepEqual(calls, ['verifyChain', 'readBalance'])
          else {
            const action = expectedSchedules[index].action
            assert.deepEqual(calls, action === 'PORTFOLIO_SUMMARY' ? ['readBalances', 'readPrices', 'readActivity'] : action === 'ACTIVITY_SUMMARY' ? ['readActivity'] : ['readBalances'])
            assert.match(task.nextRunAt, /^2026-10-01T/)
          }
        } finally { await engine.close() }
      })
    })
  }
}

test('locale and mode changes immediately provide new suggestions without altering captured original text', () => {
  const previousUserText = getAgentSuggestions('ask', 'vi')[0].text
  for (const mode of modes) {
    const vi = getAgentSuggestions(mode, 'vi')
    const en = getAgentSuggestions(mode, 'en')
    assert.deepEqual(vi.map((item) => item.id), en.map((item) => item.id))
    assert.ok(vi.every((item, index) => item.text !== en[index].text))
  }
  assert.equal(previousUserText, 'Danh mục của tôi hiện trị giá bao nhiêu?')
  assert.notDeepEqual(getAgentSuggestions('ask', 'en'), getAgentSuggestions('monitor', 'en'))
  assert.notDeepEqual(getAgentSuggestions('monitor', 'en'), getAgentSuggestions('automation', 'en'))
})

test('suggestions avoid unsupported balance changes, portfolio conditions, weekly schedules, and implicit times', () => {
  const context = { account: ACCOUNT, chainId: 5042002, timezone: 'Asia/Bangkok', locale: 'en' }
  for (const text of ['Notify me when my cirBTC balance changes', 'Notify me when my portfolio falls below $300', 'Notify me when my USDC balance changes']) {
    const result = parseIntent({ ...context, mode: 'monitor', text })
    assert.equal(result.candidate, null)
    assert.ok(result.missingFields.length > 0)
  }
  for (const text of ['Send me a portfolio summary every Monday', 'Show me my USDC, EURC and cirBTC balances every morning', "Tell me about today's new transactions every evening"]) {
    const result = parseIntent({ ...context, mode: 'automation', text })
    assert.equal(result.candidate, null)
    assert.ok(result.missingFields.length > 0)
  }
})
