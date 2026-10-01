import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyReplan, planAgentRequest } from './planner.ts'

const recipient = '0x2222222222222222222222222222222222222222'

test('information, action and sequential strategy remain descriptive and validated', () => {
  assert.equal(planAgentRequest('What is my USDC balance?').status, 'INFORMATION')
  const action = planAgentRequest(`Send 1 USDC to ${recipient}`, 'en', 1000)
  assert.equal(action.status, 'ACTION')
  if (action.status === 'ACTION') { assert.equal(action.plan.goals.length, 1); assert.equal(action.executionEnabled, false) }
  const strategy = planAgentRequest(`Swap 2 USDC to EURC then send 1 EURC to ${recipient}`, 'en', 1000)
  assert.equal(strategy.status, 'STRATEGY')
  if (strategy.status === 'STRATEGY') {
    assert.deepEqual(strategy.plan.goals[1].dependsOn, ['goal-1'])
    assert.equal(strategy.strategy.steps[2].kind, 'REVALIDATE')
    assert.equal(strategy.executionEnabled, false)
  }
})

test('dynamic amount, missing recipient, unsupported route and unknown submission fail closed', () => {
  assert.equal(planAgentRequest('Swap 2 USDC to EURC then send what I receive').status, 'NEEDS_CLARIFICATION')
  assert.equal(planAgentRequest('Send 1 USDC').status, 'NEEDS_CLARIFICATION')
  assert.equal(planAgentRequest('Bridge 1 USDC to Base Sepolia').status, 'NEEDS_CLARIFICATION')
  assert.equal(classifyReplan('unknown-submission').status, 'RECOVERY_REQUIRED')
  assert.equal(classifyReplan('confirmed-step').walletAllowed, false)
})
