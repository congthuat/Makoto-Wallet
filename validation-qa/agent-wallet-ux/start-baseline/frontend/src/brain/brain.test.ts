import assert from 'node:assert/strict'
import test from 'node:test'
import { parseBrainRequest } from './parser.ts'
import { routeBrainIntent } from './orchestration.ts'
import { prepareBrainReview, revalidateBrainReview } from './policy.ts'
import { createBrainHandoff, consumeBrainHandoff, storeBrainHandoff } from './handoff.ts'

const ACCOUNT = '0x1111111111111111111111111111111111111111'
const RECIPIENT = '0x2222222222222222222222222222222222222222'

test('parses send preparation', () => {
  const intent = parseBrainRequest(`Send 10 USDC to ${RECIPIENT}`, 'en')
  assert.equal(intent.kind, 'prepare-action')
  assert.equal(intent.preparation?.kind, 'send')
  assert.equal(intent.preparation?.amount, '10')
  assert.equal(intent.preparation?.asset, 'USDC')
  assert.equal(intent.preparation?.recipient, RECIPIENT)
  assert.equal(routeBrainIntent(intent).draftAllowed, true)
})

test('parses swap and bridge', () => {
  const swap = parseBrainRequest('Swap 20 USDC to EURC', 'en')
  assert.equal(swap.preparation?.kind, 'swap')
  assert.equal(swap.preparation?.outputAsset, 'EURC')
  const bridge = parseBrainRequest('Bridge 5 USDC to Base Sepolia', 'en')
  assert.equal(bridge.preparation?.kind, 'bridge')
  assert.equal(bridge.preparation?.sourceChain, 'Arc Testnet')
  assert.equal(bridge.preparation?.destinationChain, 'Base Sepolia')
})

test('Agent MAX is blocked', () => {
  const intent = parseBrainRequest(`Send MAX USDC to ${RECIPIENT}`, 'en')
  const decision = routeBrainIntent(intent)
  assert.equal(decision.draftAllowed, false)
  assert.ok(decision.blockers.some((v) => /MAX/.test(v)))
})

test('review expires and material changes invalidate it', () => {
  const action = parseBrainRequest(`Send 10 USDC to ${RECIPIENT}`, 'en').preparation!
  const context = { connected: true, account: ACCOUNT, chainId: 5_042_002, balances: { USDC: 100 } }
  const review = prepareBrainReview(action, { ...context, now: 1000 })
  assert.equal(revalidateBrainReview(review, action, { ...context, now: 2000 }).valid, true)
  const changed = { ...action, amount: '11' }
  assert.equal(revalidateBrainReview(review, changed, { ...context, now: 2000 }).valid, false)
  assert.equal(revalidateBrainReview(review, action, { ...context, chainId: 1, now: 2000 }).valid, false)
  assert.equal(revalidateBrainReview(review, action, { ...context, account: RECIPIENT, now: 2000 }).valid, false)
  assert.equal(revalidateBrainReview(review, action, { ...context, chainId: undefined, now: 2000 }).valid, false)
  assert.equal(revalidateBrainReview(review, action, { ...context, now: 70_000 }).valid, false)
})

test('handoff is one-time, account-bound and expires', () => {
  const data = new Map<string, string>()
  const store = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v) },
    removeItem: (k: string) => { data.delete(k) },
  }
  const action = parseBrainRequest(`Send 10 USDC to ${RECIPIENT}`, 'en').preparation!
  const handoff = createBrainHandoff(action, ACCOUNT, 1000)!
  storeBrainHandoff(store, handoff)
  assert.ok(consumeBrainHandoff(store, ACCOUNT, 2000))
  assert.equal(consumeBrainHandoff(store, ACCOUNT, 2000), undefined)
  storeBrainHandoff(store, handoff)
  assert.equal(consumeBrainHandoff(store, RECIPIENT, 2000), undefined)
  storeBrainHandoff(store, handoff)
  assert.equal(consumeBrainHandoff(store, ACCOUNT, handoff.expiresAt + 1), undefined)
})
