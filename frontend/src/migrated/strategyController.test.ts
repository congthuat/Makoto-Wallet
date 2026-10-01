import test from 'node:test'
import assert from 'node:assert/strict'
import { createStrategyRun, recoverStrategyRun, restoreStrategyRun, saveStrategyRun, transitionStrategy } from './strategyController.ts'

const account = '0x1111111111111111111111111111111111111111'
const target = '0x2222222222222222222222222222222222222222'
const hash = `0x${'a'.repeat(64)}`
const review = (step: 'approval' | 'swap' | 'cctp-burn', now: number) => ({ type: 'review' as const, step, account, chainId: 5042002, expiresAt: now + 60_000, quoteFresh: true, policyPassed: true, simulationPassed: true, now })
const binding = { from: account, to: target, data: '0x1234', symbol: 'USDC' as const, spender: target, requiredUnits: '1000000' }

test('strategy controller gates approval, receipt, allowance reread and fresh action review', () => {
  const initial = createStrategyRun('swap', account, 1)
  assert.equal(transitionStrategy(initial, review('swap', 2)).accepted, true)
  const approval = transitionStrategy(initial, review('approval', 2))
  assert.equal(approval.accepted, true)
  if (!approval.accepted) return
  assert.equal(transitionStrategy(approval.state, review('swap', 3)).accepted, false)
  const wallet = transitionStrategy(approval.state, { type: 'wallet-request', binding, now: 3 })
  assert.equal(wallet.accepted, true)
  if (!wallet.accepted) return
  assert.equal(transitionStrategy(wallet.state, { type: 'confirmed', now: 4 }).accepted, false)
  const submitted = transitionStrategy(wallet.state, { type: 'hash', hash, now: 4 })
  assert.equal(submitted.accepted, true)
  if (!submitted.accepted) return
  const confirmed = transitionStrategy(submitted.state, { type: 'confirmed', now: 5 })
  assert.equal(confirmed.accepted, true)
  if (!confirmed.accepted) return
  assert.equal(confirmed.state.phase, 'REVALIDATING')
  assert.equal(transitionStrategy(confirmed.state, review('swap', 6)).accepted, false)
  const reread = transitionStrategy(confirmed.state, { type: 'allowance-reread', sufficient: true, account, chainId: 5042002, now: 6 })
  assert.equal(reread.accepted, true)
  if (!reread.accepted) return
  assert.equal(reread.state.phase, 'REQUOTING')
  const nextReview = transitionStrategy(reread.state, review('swap', 7))
  assert.equal(nextReview.accepted, true)
  if (nextReview.accepted) assert.equal(nextReview.state.phase, 'REVIEW_ACTION')
  assert.equal(transitionStrategy(reread.state, { ...review('swap', 7), quoteFresh: false }).accepted, false)
  const insufficient = transitionStrategy(confirmed.state, { type: 'allowance-reread', sufficient: false, account, chainId: 5042002, now: 6 })
  if (insufficient.accepted) assert.equal(insufficient.state.phase, 'BLOCKED')
})

test('reload restores only receipt recovery, never wallet or review authority', async () => {
  const values = new Map<string, string>()
  const storage = { setItem: (key: string, value: string) => { values.set(key, value) }, getItem: (key: string) => values.get(key) ?? null }
  const initial = createStrategyRun('swap', account, 1)
  const reviewState = transitionStrategy(initial, review('swap', 2))
  assert.equal(reviewState.accepted, true)
  if (!reviewState.accepted) return
  saveStrategyRun(storage, reviewState.state)
  assert.equal(restoreStrategyRun(storage, 'swap', account, 10)?.phase, 'EXPIRED')
  const waiting = transitionStrategy(reviewState.state, { type: 'wallet-request', binding: { ...binding, outputSymbol: 'EURC', minimumOutputUnits: '1' }, now: 3 })
  if (!waiting.accepted) return
  saveStrategyRun(storage, waiting.state)
  assert.equal(restoreStrategyRun(storage, 'swap', account, 10)?.phase, 'UNKNOWN')
  const submitted = transitionStrategy(waiting.state, { type: 'hash', hash, now: 4 })
  if (!submitted.accepted) return
  saveStrategyRun(storage, submitted.state)
  const restored = restoreStrategyRun(storage, 'swap', account, 10)!
  assert.equal(restored.phase, 'RECOVERING')
  assert.equal(transitionStrategy(restored, review('swap', 11)).accepted, false)
  const provider = { request: async ({ method }: { method: string }) => method === 'eth_accounts' ? [account] : method === 'eth_chainId' ? '0x4cef52' : method === 'eth_getTransactionReceipt' ? null : undefined }
  assert.equal((await recoverStrategyRun(provider, restored, 11)).phase, 'PENDING')
  assert.equal(restoreStrategyRun(storage, 'swap', target, 10), undefined)
})

test('CCTP reload checkpoints restore approvals, source receipts, attestation pending, and destination pending without review authority', () => {
  const values = new Map<string, string>()
  const storage = { setItem: (key: string, value: string) => { values.set(key, value) }, getItem: (key: string) => values.get(key) ?? null }
  const cctpBinding = { ...binding, expectedReceiveUnits: '945000', recipient: account, destinationDomain: 6, maxFeeUnits: '55000', finalityThreshold: '1000' }
  const persist = (run: ReturnType<typeof createStrategyRun>, expected: string, now: number) => {
    saveStrategyRun(storage, run)
    const restored = restoreStrategyRun(storage, 'cctp', account, now)!
    assert.equal(restored.phase, expected)
    assert.equal(transitionStrategy(restored, review('cctp-burn', now + 1)).accepted, false)
    return restored
  }

  let approval = createStrategyRun('cctp', account, 1)
  for (const event of [review('approval', 2), { type: 'wallet-request' as const, binding, now: 3 }, { type: 'hash' as const, hash, now: 4 }]) {
    const next = transitionStrategy(approval, event)
    assert.equal(next.accepted, true)
    if (next.accepted) approval = next.state
  }
  persist(approval, 'RECOVERING', 5) // Approval submitted: only receipt recovery survives.
  const confirmedApproval = transitionStrategy(approval, { type: 'confirmed', now: 6 })
  assert.equal(confirmedApproval.accepted, true)
  if (!confirmedApproval.accepted) return
  const afterApprovalReload = persist(confirmedApproval.state, 'REVALIDATING', 7) // Confirmed receipt still needs allowance reread.
  const allowance = transitionStrategy(afterApprovalReload, { type: 'allowance-reread', sufficient: true, account, chainId: 5042002, now: 8 })
  assert.equal(allowance.accepted, true)
  if (!allowance.accepted) return
  assert.equal(allowance.state.phase, 'REQUOTING')

  let burn = createStrategyRun('cctp', account, 9)
  for (const event of [review('cctp-burn', 10), { type: 'wallet-request' as const, binding: cctpBinding, now: 11 }, { type: 'hash' as const, hash, now: 12 }]) {
    const next = transitionStrategy(burn, event)
    assert.equal(next.accepted, true)
    if (next.accepted) burn = next.state
  }
  persist(burn, 'RECOVERING', 13) // Burn submitted: re-read its receipt and Circle evidence.
  const source = transitionStrategy(burn, { type: 'confirmed', now: 14 })
  assert.equal(source.accepted, true)
  if (!source.accepted) return
  const attestationPending = persist(source.state, 'SOURCE_CONFIRMED', 15) // Circle status is checked again after reload.
  const destinationPending = transitionStrategy(attestationPending, { type: 'destination-pending', now: 16 })
  assert.equal(destinationPending.accepted, true)
  if (destinationPending.accepted) persist(destinationPending.state, 'DESTINATION_PENDING', 17)
})

test('rejection, unknown, failure and CCTP destination require guarded evidence', () => {
  const initial = createStrategyRun('cctp', account, 1)
  const ready = transitionStrategy(initial, review('cctp-burn', 2))
  if (!ready.accepted) return
  const waiting = transitionStrategy(ready.state, { type: 'wallet-request', binding, now: 3 })
  if (!waiting.accepted) return
  const rejected = transitionStrategy(waiting.state, { type: 'user-rejected', now: 4 })
  if (rejected.accepted) assert.equal(rejected.state.phase, 'USER_REJECTED')
  const unknown = transitionStrategy(waiting.state, { type: 'unknown', now: 4 })
  if (unknown.accepted) { assert.equal(unknown.state.phase, 'UNKNOWN'); assert.equal(transitionStrategy(unknown.state, review('cctp-burn', 5)).accepted, false) }
  const submitted = transitionStrategy(waiting.state, { type: 'hash', hash, now: 4 })
  if (!submitted.accepted) return
  const source = transitionStrategy(submitted.state, { type: 'confirmed', now: 5 })
  if (!source.accepted) return
  assert.equal(source.state.phase, 'SOURCE_CONFIRMED')
  assert.equal(transitionStrategy(submitted.state, { type: 'destination-confirmed', now: 6 }).accepted, false)
  const destination = transitionStrategy(source.state, { type: 'destination-confirmed', now: 6 })
  if (destination.accepted) assert.equal(destination.state.phase, 'COMPLETED')
  const forwardingFailure = transitionStrategy(source.state, { type: 'forwarding-failed', now: 6 })
  if (forwardingFailure.accepted) assert.equal(forwardingFailure.state.phase, 'FORWARDING_FAILED')
  const destinationFailure = transitionStrategy(source.state, { type: 'destination-failed', now: 6 })
  if (destinationFailure.accepted) assert.equal(destinationFailure.state.phase, 'DESTINATION_FAILED')
  const failed = transitionStrategy(submitted.state, { type: 'failed', now: 5 })
  if (failed.accepted) assert.equal(failed.state.phase, 'FAILED')
})
