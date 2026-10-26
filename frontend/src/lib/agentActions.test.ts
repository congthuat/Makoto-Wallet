import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAgentActions, hasPendingStrategy, type AgentActionInput } from './agentActions.ts'
import { AGENT_I18N } from './i18n-agent.ts'

const base: AgentActionInput = { mode: 'connected', walletChainId: 5042002, balances: { USDC: 50, EURC: 0, cirBTC: 0 }, activeTasks: 0, pendingBridge: false, pendingSwap: false, balancesReady: true }
const ids = (input: Partial<AgentActionInput>, limit = 20) => buildAgentActions({ ...base, ...input }, limit).map((action) => action.id)

test('pending protocol recovery is always ranked first', () => {
  assert.equal(ids({ pendingBridge: true })[0], 'recover-bridge')
  assert.ok(!ids({ pendingBridge: true }).includes('bridge-idle'), 'never suggest a new bridge while one is pending')
  assert.equal(ids({ pendingSwap: true })[0], 'recover-swap')
})

test('suggestions follow the observed wallet state', () => {
  assert.ok(ids({ balances: { USDC: 0.2 } }).includes('low-gas'))
  assert.ok(!ids({ balances: { USDC: 0.2 } }).includes('bridge-idle'))
  assert.ok(ids({}).includes('bridge-idle'))
  assert.ok(ids({}).includes('swap-eurc'))
  assert.ok(!ids({ balances: { USDC: 50, EURC: 10 } }).includes('swap-eurc'))
  assert.ok(ids({}).includes('balance-alert'))
  assert.ok(!ids({ activeTasks: 2 }).includes('balance-alert'))
  assert.ok(ids({ walletChainId: 1 }).includes('wrong-network'))
})

test('no balance-based suggestion is made before live balances are known', () => {
  const loading = ids({ balancesReady: false, balances: {} })
  for (const id of ['low-gas', 'bridge-idle', 'swap-eurc', 'analyze-wallet']) assert.ok(!loading.includes(id), id)
})

test('demo and watch modes never suggest wallet writes', () => {
  const demo = ids({ mode: 'demo' })
  assert.equal(demo[0], 'connect')
  for (const id of ['bridge-idle', 'swap-eurc', 'low-gas', 'balance-alert', 'recover-bridge']) assert.ok(!demo.includes(id), id)
  const watch = ids({ mode: 'watch', pendingBridge: true })
  assert.ok(watch.includes('analyze-wallet'))
  for (const id of ['bridge-idle', 'swap-eurc', 'low-gas', 'recover-bridge']) assert.ok(!watch.includes(id), id)
})

test('the list is limited and every suggestion is translated in all UI languages', () => {
  assert.equal(buildAgentActions(base).length, 4)
  const all = buildAgentActions({ ...base, pendingBridge: true, pendingSwap: true, walletChainId: 1 }, 50)
    .concat(buildAgentActions({ ...base, mode: 'demo' }, 50), buildAgentActions({ ...base, balances: { USDC: 0.1 } }, 50))
  for (const action of all) {
    const strings = [action.title, action.detail, ...(action.target.type === 'ask' ? [action.target.prompt] : [])]
    for (const value of strings) {
      const row = AGENT_I18N[value]
      assert.ok(row, `missing translations: ${value}`)
      row.forEach((translated, index) => assert.ok(translated && translated !== value, `${['vi', 'zh', 'ja', 'ko'][index]}: ${value}`))
    }
  }
})

test('pending strategy detection reads only recoverable phases and tolerates bad storage', () => {
  const account = '0xAbC0000000000000000000000000000000000001'
  const store = (value: string | null) => ({ getItem: (key: string) => key === `mk.strategy.v1:cctp:${account.toLowerCase()}` ? value : null })
  assert.equal(hasPendingStrategy(store(JSON.stringify({ phase: 'SOURCE_CONFIRMED' })), 'cctp', account), true)
  assert.equal(hasPendingStrategy(store(JSON.stringify({ phase: 'COMPLETED' })), 'cctp', account), false)
  assert.equal(hasPendingStrategy(store('{broken'), 'cctp', account), false)
  assert.equal(hasPendingStrategy({ getItem: () => { throw new Error('blocked') } }, 'cctp', account), false)
  assert.equal(hasPendingStrategy(store(null), 'cctp', undefined), false)
})
