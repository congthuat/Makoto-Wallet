import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeFunctionData } from 'viem'
import { MAKOTO_PAY_REQUESTS_ABI } from '../contracts/makotoPayRequests.ts'
import { createData, payData, requestIdFromHash, validateCreate, PAY_TOKENS } from './payRequests.ts'

test('create form validation: exact units, payer rules, memo size', () => {
  const ok = validateCreate({ amount: '12.5', decimals: 6, payers: '3', allowedPayer: '', memo: 'Taxi', account: '0x1111111111111111111111111111111111111111' })
  assert.deepEqual(ok, { ok: true, amount: 12_500000n, maxPayments: 3, allowedPayer: null, memo: 'Taxi' })
  assert.deepEqual(validateCreate({ amount: '1.1234567', decimals: 6, payers: '1', allowedPayer: '', memo: '' }), { ok: false, error: 'amount' })
  assert.deepEqual(validateCreate({ amount: '0', decimals: 6, payers: '1', allowedPayer: '', memo: '' }), { ok: false, error: 'amount' })
  assert.deepEqual(validateCreate({ amount: '1', decimals: 6, payers: '101', allowedPayer: '', memo: '' }), { ok: false, error: 'payers' })
  assert.deepEqual(validateCreate({ amount: '1', decimals: 6, payers: '2', allowedPayer: '0x2222222222222222222222222222222222222222', memo: '' }), { ok: false, error: 'payer' })
  assert.deepEqual(validateCreate({ amount: '1', decimals: 6, payers: '1', allowedPayer: '0x1111111111111111111111111111111111111111', memo: '', account: '0x1111111111111111111111111111111111111111' }), { ok: false, error: 'payer' })
  assert.deepEqual(validateCreate({ amount: '1', decimals: 6, payers: '1', allowedPayer: '', memo: 'ầ'.repeat(50) }), { ok: false, error: 'memo' })
})

test('calldata round-trips through the contract ABI; share links parse strictly', () => {
  const data = createData({ token: 'EURC', amount: 5_000000n, maxPayments: 2, allowedPayer: null, expiresAt: 1_900_000_000, memo: 'Dinner' })
  const decoded = decodeFunctionData({ abi: MAKOTO_PAY_REQUESTS_ABI, data })
  assert.equal(decoded.functionName, 'createRequest')
  assert.deepEqual(decoded.args, [PAY_TOKENS.EURC.address, 5_000000n, 2, '0x0000000000000000000000000000000000000000', 1_900_000_000n, 'Dinner'])
  assert.deepEqual(decodeFunctionData({ abi: MAKOTO_PAY_REQUESTS_ABI, data: payData(7n) }).args, [7n])
  assert.equal(requestIdFromHash('#pay-42'), 42n)
  assert.equal(requestIdFromHash('#pay-abc'), null)
  assert.equal(requestIdFromHash('#pay-1;alert(1)'), null)
})
