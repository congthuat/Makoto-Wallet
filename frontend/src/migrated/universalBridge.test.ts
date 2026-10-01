import test from 'node:test'
import assert from 'node:assert/strict'
import { universalBridgeAvailability } from './universalBridge.ts'

test('Universal Bridge reports SDK authority blocker without preparing or submitting a write', () => {
  const result = universalBridgeAvailability()
  assert.equal(result.status, 'UNAVAILABLE')
  assert.match(result.reason ?? '', /separately freeze, review and revalidate/)
  assert.equal('data' in result, false)
})
