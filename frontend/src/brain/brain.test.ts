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

test('Vietnamese Send demo preserves its full recipient and validation', () => {
  const recipient = '0x836504101e1afa38ff8fa8dd6f75b2ba428039ca'
  const intent = parseBrainRequest(`Gửi 1 USDC tới ${recipient}`, 'vi')
  assert.equal(intent.kind, 'prepare-action')
  assert.equal(intent.preparation?.kind, 'send')
  assert.equal(intent.preparation?.asset, 'USDC')
  assert.equal(intent.preparation?.amount, '1')
  assert.equal(intent.preparation?.recipient, recipient)
  assert.equal(intent.preparation?.invalidRecipient, false)
  assert.equal(routeBrainIntent(intent).draftAllowed, true)
})

test('explicit and natural Vietnamese chain transfers prepare Bridge', () => {
  for (const text of ['Chuyển chuỗi 10 USDC sang Base Sepolia', 'Chuyển 10 USDC sang Base Sepolia']) {
    const intent = parseBrainRequest(text, 'vi')
    assert.equal(intent.kind, 'prepare-action', text)
    assert.equal(intent.preparation?.kind, 'bridge', text)
    assert.equal(intent.preparation?.asset, 'USDC', text)
    assert.equal(intent.preparation?.amount, '10', text)
    assert.equal(intent.preparation?.sourceChain, 'Arc Testnet', text)
    assert.equal(intent.preparation?.destinationChain, 'Base Sepolia', text)
    assert.equal(intent.preparation?.recipient, undefined, text)
    assert.equal(routeBrainIntent(intent).draftAllowed, true, text)
  }
})

test('natural Vietnamese chain wording never rewrites unsupported assets to USDC', () => {
  for (const asset of ['EURC', 'cirBTC']) {
    const intent = parseBrainRequest(`Chuyển 1 ${asset} sang Base Sepolia`, 'vi')
    assert.equal(intent.preparation?.kind, 'send', 'Preserve the previous transfer classification')
    assert.equal(intent.preparation?.asset, asset)
    assert.equal(routeBrainIntent(intent).draftAllowed, false)
    assert.ok(routeBrainIntent(intent).missingFields.includes('recipient'))
  }
})

test('generic Vietnamese address transfers remain Send even with a destination chain', () => {
  for (const text of [`Chuyển 1 USDC tới ${RECIPIENT}`, `Chuyển 1 USDC tới ${RECIPIENT} sang Base Sepolia`]) {
    const intent = parseBrainRequest(text, 'vi')
    assert.equal(intent.preparation?.kind, 'send', text)
    assert.equal(intent.preparation?.recipient, RECIPIENT, text)
    assert.equal(intent.preparation?.invalidRecipient, false, text)
  }
  const malformed = parseBrainRequest('Chuyển 1 USDC tới 0x1234…7890 sang Base Sepolia', 'vi')
  assert.equal(malformed.preparation?.kind, 'send')
  assert.equal(malformed.preparation?.invalidRecipient, true)
  assert.equal(routeBrainIntent(malformed).draftAllowed, false)
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
