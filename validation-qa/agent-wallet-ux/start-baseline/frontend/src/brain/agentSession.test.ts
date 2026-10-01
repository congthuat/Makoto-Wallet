import assert from 'node:assert/strict'
import test from 'node:test'
import { createAgentSession, recoverLatestAgentSession, rememberAgentSession, restoreAgentSession, storeAgentSession, transitionAgentSession } from './agentSession.ts'

const account = '0x1111111111111111111111111111111111111111'
test('Agent transitions require plan, fresh review and matching one-time handoff', () => {
  const requested = createAgentSession('session-1', 1000)
  assert.equal(transitionAgentSession(requested, { type: 'handed-off', account, now: 1001 }).accepted, false)
  const planned = transitionAgentSession(requested, { type: 'plan-ready', planId: 'plan-1', now: 1001 })
  assert.equal(planned.accepted, true)
  if (!planned.accepted) return
  const review = transitionAgentSession(planned.state, { type: 'review-ready', account, expiresAt: 2000, now: 1002 })
  assert.equal(review.accepted, true)
  if (!review.accepted) return
  assert.equal(transitionAgentSession(review.state, { type: 'handed-off', account: '0x2222222222222222222222222222222222222222', now: 1003 }).accepted, false)
  assert.equal(transitionAgentSession(review.state, { type: 'handed-off', account, now: 2001 }).accepted, false)
  const handed = transitionAgentSession(review.state, { type: 'handed-off', account, now: 1500 })
  assert.equal(handed.accepted, true)
  if (handed.accepted) assert.equal(transitionAgentSession(handed.state, { type: 'handed-off', account, now: 1501 }).accepted, false)
})

test('restored Agent session is historical and cannot revive a review', () => {
  const data = new Map<string, string>()
  const store = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
  const requested = createAgentSession('session-2', 1000)
  const planned = transitionAgentSession(requested, { type: 'plan-ready', planId: 'plan-2', now: 1001 })
  assert.equal(planned.accepted, true)
  if (!planned.accepted) return
  assert.equal(storeAgentSession(store, planned.state, account), true)
  assert.equal(restoreAgentSession(store, 'session-2', account).status, 'HISTORICAL')
  assert.equal(restoreAgentSession(store, 'session-2', '0x2222222222222222222222222222222222222222').status, 'ABSENT')
  assert.equal(rememberAgentSession(store, planned.state, account), true)
  const recovered = recoverLatestAgentSession(store, account)
  assert.equal(recovered.status, 'HISTORICAL')
  if (recovered.status === 'HISTORICAL') assert.equal(transitionAgentSession(recovered.state, { type: 'handed-off', account, now: 1002 }).accepted, false)
})
