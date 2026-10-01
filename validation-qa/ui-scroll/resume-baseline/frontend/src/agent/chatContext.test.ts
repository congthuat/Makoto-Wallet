import assert from 'node:assert/strict'
import test from 'node:test'
import { appendChatHistory, boundChatHistory, isWalletContextFollowUp } from './chatContext.ts'

test('chat context is short lived, text only, and bounded', () => {
  const history = Array.from({ length: 20 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const, content: `${index}-`.padEnd(1000, 'x') }))
  const bounded = boundChatHistory(history)
  assert.ok(bounded.length <= 12)
  assert.ok(bounded.every((item) => item.content.length <= 600))
  assert.ok(bounded.reduce((sum, item) => sum + item.content.length, 0) <= 6000)
  assert.deepEqual(boundChatHistory([{ role: 'user', content: ' review ', extra: { signer: 'secret' } } as never]), [{ role: 'user', content: 'review' }])
  assert.deepEqual(appendChatHistory([], { role: 'assistant', content: 'ok' }), [{ role: 'assistant', content: 'ok' }])
})

test('asset follow ups use the preceding wallet question only', () => {
  assert.equal(isWalletContextFollowUp('còn EURC?', [{ role: 'user', content: 'mình có bao nhiêu USDC?' }], 'vi'), true)
  assert.equal(isWalletContextFollowUp('what about EURC?', [{ role: 'user', content: 'What is my USDC balance?' }], 'en'), true)
  assert.equal(isWalletContextFollowUp('còn EURC?', [{ role: 'user', content: 'USDC là gì?' }], 'vi'), false)
  assert.equal(isWalletContextFollowUp('còn EURC?', [{ role: 'user', content: 'Send 1 USDC to 0x2222222222222222222222222222222222222222' }], 'vi'), false)
})
