import assert from 'node:assert/strict'
import { test } from 'node:test'
import { activityDate, activityDay, mergeSendRecord, sendActivityStatus } from './activity.ts'
import type { SendRecord } from './sendExecution.ts'

const record: SendRecord = {
  hash: `0x${'a'.repeat(64)}`, account: `0x${'b'.repeat(40)}`, chainId: 5042002,
  recipient: `0x${'c'.repeat(40)}`, symbol: 'USDC', amount: '1', timestamp: 1,
  status: 'pending',
}

test('UNKNOWN stays distinct from pending in Activity', () => {
  assert.equal(sendActivityStatus('unknown'), 'unknown')
  assert.equal(sendActivityStatus('pending'), 'pending')
  assert.notEqual(sendActivityStatus('unknown'), sendActivityStatus('pending'))
})

test('a proven confirmation survives an unavailable or stale result', () => {
  const confirmed = { ...record, status: 'completed' as const }
  assert.equal(mergeSendRecord(confirmed, { ...record, status: 'unknown' }).status, 'completed')
  assert.equal(mergeSendRecord(confirmed, { ...record, status: 'pending' }).status, 'completed')
})

test('a proven failure survives a stale pending result', () => {
  assert.equal(mergeSendRecord({ ...record, status: 'failed' }, record).status, 'failed')
})

test('unknown changes only when reconciliation supplies a new result', () => {
  assert.equal(mergeSendRecord({ ...record, status: 'unknown' }, { ...record, status: 'completed' }).status, 'completed')
})

test('transaction date uses the selected locale', () => {
  const timestamp = Date.UTC(2026, 8, 29, 7, 52)
  const vi = activityDate(timestamp, 'vi')
  const en = activityDate(timestamp, 'en')
  assert.match(vi, /29.*9.*2026|29.*09.*2026/)
  assert.notEqual(vi, en)
  assert.notEqual(activityDay(timestamp, 'vi', Date.UTC(2026, 9, 5)), activityDay(timestamp, 'en', Date.UTC(2026, 9, 5)))
})
