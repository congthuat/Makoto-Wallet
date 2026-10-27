import test from 'node:test'
import assert from 'node:assert/strict'
import { verifyMessage } from 'viem'
import { encryptPhrase } from './embeddedVault.ts'
import { answerApproval, currentApproval, embeddedSession, lockEmbedded, subscribeApprovals, unlockEmbedded } from './embeddedWallet.ts'

const PHRASE = 'test test test test test test test test test test test junk'
const ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

async function unlocked() {
  const vault = await encryptPhrase(PHRASE, 'Makoto-2026!', 'sub-1', 1000)
  return unlockEmbedded({ sub: 'sub-1', email: 'a@gmail.com', address: ADDRESS, vault, password: 'Makoto-2026!' })
}
const nextApproval = () => new Promise<NonNullable<ReturnType<typeof currentApproval>>>((resolve) => {
  const check = () => { const r = currentApproval(); if (r) { stop(); resolve(r) } }
  const stop = subscribeApprovals(check); check()
})

test('locked wallet refuses everything; wrong password or mismatched address never unlocks', async () => {
  lockEmbedded()
  const wallet = await unlocked(); lockEmbedded()
  await assert.rejects(wallet.provider.request({ method: 'eth_accounts' }), /locked/)
  const vault = await encryptPhrase(PHRASE, 'Makoto-2026!', 'sub-1', 1000)
  await assert.rejects(unlockEmbedded({ sub: 'sub-1', email: 'a', address: ADDRESS, vault, password: 'nope-nope-1' }), /Wrong wallet password/)
  await assert.rejects(unlockEmbedded({ sub: 'sub-1', email: 'a', address: '0x0000000000000000000000000000000000000001', vault, password: 'Makoto-2026!' }), /does not match/)
  assert.equal(embeddedSession(), null)
})

test('every signature waits for an explicit Approve; Reject returns 4001 and signs nothing', async () => {
  const wallet = await unlocked()
  assert.deepEqual(await wallet.provider.request({ method: 'eth_accounts' }), [ADDRESS])
  assert.equal(await wallet.provider.request({ method: 'eth_chainId' }), '0x4cef52')
  assert.equal(await wallet.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x4cef52' }] }), null)
  await assert.rejects(wallet.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] }), (e: any) => e.code === 4902)

  const signing = wallet.provider.request({ method: 'personal_sign', params: ['0x48656c6c6f204d616b6f746f', ADDRESS] })
  const ask = await nextApproval()
  assert.equal(ask.kind, 'message'); assert.equal(ask.kind === 'message' && ask.message, 'Hello Makoto')
  answerApproval(ask.id, true)
  const signature = await signing
  assert.ok(await verifyMessage({ address: ADDRESS, message: { raw: '0x48656c6c6f204d616b6f746f' }, signature }))

  const send = wallet.provider.request({ method: 'eth_sendTransaction', params: [{ from: ADDRESS, to: ADDRESS, value: '0x1' }] })
  const txAsk = await nextApproval()
  assert.equal(txAsk.kind, 'transaction')
  answerApproval(txAsk.id, false)
  await assert.rejects(send, (e: any) => e.code === 4001)

  await assert.rejects(wallet.provider.request({ method: 'personal_sign', params: ['0x00', '0x0000000000000000000000000000000000000001'] }), /Unknown signer/)
  await assert.rejects(wallet.provider.request({ method: 'eth_sign', params: [ADDRESS, '0x00'] }), (e: any) => e.code === 4200, 'blind eth_sign is never supported')

  const pending = wallet.provider.request({ method: 'personal_sign', params: ['0x01', ADDRESS] })
  await nextApproval(); lockEmbedded()
  await assert.rejects(pending, (e: any) => e.code === 4001, 'locking cancels pending approvals')
})
