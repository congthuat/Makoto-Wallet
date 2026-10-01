import assert from 'node:assert/strict'
import test from 'node:test'
import { stringToHex } from 'viem'
import { taskAuthApi } from './taskAuth.ts'

const address = '0x1111111111111111111111111111111111111111'
const other = '0x2222222222222222222222222222222222222222'

test('explicit SIWE verification signs the exact server message and sends no transaction', async () => {
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  const message = 'makotowallet.xyz wants you to sign in with your Ethereum account:\n' + address + '\n\nURI: http://localhost:5173\nVersion: 1\nChain ID: 5042002\nNonce: Example123\nIssued At: 2026-09-30T00:00:00.000Z'
  const calls: string[] = []
  globalThis.window = { ethereum: { request: async ({ method, params }: { method: string; params?: unknown[] }) => {
    calls.push(method)
    if (method === 'eth_accounts') return [address]
    if (method === 'personal_sign') { assert.deepEqual(params, [stringToHex(message), address]); return '0xfixture' }
    throw new Error('Unexpected wallet method')
  } } } as unknown as Window & typeof globalThis
  globalThis.fetch = async (url, init) => {
    const path = String(url)
    calls.push(path.endsWith('/nonce') ? 'nonce' : 'verify')
    assert.equal(init?.credentials, 'same-origin')
    assert.equal(new Headers(init?.headers).get('X-Makoto-Request'), '1')
    if (path.endsWith('/nonce')) {
      assert.deepEqual(JSON.parse(String(init?.body)), { address, chainId: 5042002 })
      return Response.json({ message })
    }
    assert.deepEqual(JSON.parse(String(init?.body)), { message, signature: '0xfixture' })
    return Response.json({ authenticated: true, address })
  }
  try {
    assert.deepEqual(await taskAuthApi.verifyWallet(address), { authenticated: true, address })
    assert.deepEqual(calls, ['eth_accounts', 'nonce', 'personal_sign', 'eth_accounts', 'verify'])
  } finally { globalThis.fetch = originalFetch; globalThis.window = originalWindow }
})

test('a wallet change during signing aborts before signature submission', async () => {
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  let reads = 0, verifyCalls = 0
  globalThis.window = { ethereum: { request: async ({ method }: { method: string }) => {
    if (method === 'eth_accounts') return [++reads === 1 ? address : other]
    if (method === 'personal_sign') return '0xfixture'
    throw new Error('Unexpected wallet method')
  } } } as unknown as Window & typeof globalThis
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/verify')) verifyCalls++
    return Response.json({ message: 'server challenge' })
  }
  try {
    await assert.rejects(taskAuthApi.verifyWallet(address), /AUTH_WALLET_MISMATCH/)
    assert.equal(verifyCalls, 0)
  } finally { globalThis.fetch = originalFetch; globalThis.window = originalWindow }
})
