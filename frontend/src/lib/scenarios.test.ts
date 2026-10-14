import assert from 'node:assert/strict'
import test from 'node:test'
import { parseBrainRequest } from '../brain/parser.ts'
import { routeBrainIntent } from '../brain/orchestration.ts'
import { pickScenario, SAMPLE_PROMPTS, SAMPLE_RECIPIENT } from './scenarios.ts'

test('canonical Send sample parses a complete valid USDC transfer', () => {
  assert.equal(SAMPLE_RECIPIENT, '0x836504101e1afa38ff8fa8dd6f75b2ba428039ca')
  assert.equal(SAMPLE_PROMPTS.send, `Send 1 USDC to ${SAMPLE_RECIPIENT}`)
  const intent = parseBrainRequest(SAMPLE_PROMPTS.send, 'en')
  assert.equal(intent.preparation?.kind, 'send')
  assert.equal(intent.preparation?.asset, 'USDC')
  assert.equal(intent.preparation?.amount, '1')
  assert.equal(intent.preparation?.recipient, SAMPLE_RECIPIENT)
  assert.equal(intent.preparation?.invalidRecipient, false)
  assert.equal(routeBrainIntent(intent).draftAllowed, true)
})

test('legacy Send fallback uses the same canonical sample parameters', () => {
  assert.deepEqual(pickScenario('send'), { kind: 'send', asset: 'USDC', amount: '1', recipient: SAMPLE_RECIPIENT })
})
