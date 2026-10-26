import assert from 'node:assert/strict'
import test from 'node:test'
import { parseProposal, proposalCommand, requestMakotoChat } from './chatClient.ts'
import { parseBrainRequest } from '../brain/parser.ts'
import { routeBrainIntent } from '../brain/orchestration.ts'

/** Same composition as brain/adapter.ts planBrainRequest(text, 'en'), which the Agent page uses. */
function planBrainRequest(text: string, _lang: 'en') {
  const intent = parseBrainRequest(text, 'en')
  return { intent, decision: routeBrainIntent(intent), action: intent.preparation }
}

const ADDRESS = '0x1111111111111111111111111111111111111111'

test('model proposals are shape-checked; anything unexpected is dropped', () => {
  assert.deepEqual(parseProposal({ kind: 'send', asset: 'EURC', amount: '2.5', recipient: ADDRESS }), { kind: 'send', asset: 'EURC', amount: '2.5', recipient: ADDRESS })
  assert.deepEqual(parseProposal({ kind: 'bridge', asset: 'USDC', amount: '25', destination: 'Base Sepolia', extra: 'ignored' }), { kind: 'bridge', asset: 'USDC', amount: '25' })
  assert.deepEqual(parseProposal({ kind: 'send', asset: 'USDC', amount: '2', recipientContact: '  Lan  ' }), { kind: 'send', asset: 'USDC', amount: '2', recipientContact: 'Lan' })
  for (const bad of [
    undefined, null, 'send', {},
    { kind: 'send', asset: 'USDC', amount: 'MAX', recipient: ADDRESS },
    { kind: 'send', asset: 'USDC', amount: '1', recipient: '0x12' },
    { kind: 'swap', asset: 'USDC', amount: '1', outputAsset: 'USDC' },
    { kind: 'bridge', asset: 'EURC', amount: '1' },
    { kind: 'approve', asset: 'USDC', amount: '1' },
    { kind: 'send', asset: 'USDC', amount: '0', recipient: ADDRESS },
  ]) assert.equal(parseProposal(bad), undefined, JSON.stringify(bad))
})

test('proposals become canonical commands that the deterministic planner parses identically', () => {
  const send = planBrainRequest(proposalCommand({ kind: 'send', asset: 'EURC', amount: '2.5', recipient: ADDRESS }), 'en')
  assert.equal(send.action?.kind, 'send')
  assert.equal(send.action?.asset, 'EURC')
  assert.equal(send.action?.amount, '2.5')
  assert.equal(send.action?.recipient, ADDRESS)
  assert.deepEqual([...send.decision.blockers, ...send.decision.missingFields], [])

  const swap = planBrainRequest(proposalCommand({ kind: 'swap', asset: 'EURC', amount: '4', outputAsset: 'USDC' }), 'en')
  assert.equal(swap.action?.kind, 'swap')
  assert.equal(swap.action?.asset, 'EURC')
  assert.equal(swap.action?.outputAsset, 'USDC')
  assert.equal(swap.action?.amount, '4')

  const bridge = planBrainRequest(proposalCommand({ kind: 'bridge', asset: 'USDC', amount: '25' }), 'en')
  assert.equal(bridge.action?.kind, 'bridge')
  assert.equal(bridge.action?.amount, '25')
  assert.equal(bridge.action?.sourceChain, 'Arc Testnet')
  assert.equal(bridge.action?.destinationChain, 'Base Sepolia')
  assert.deepEqual([...bridge.decision.blockers, ...bridge.decision.missingFields], [])
})

test('chat client sends locale and public address, and returns validated proposal and sources', async () => {
  let body: Record<string, unknown> = {}
  const result = await requestMakotoChat({
    message: 'xin chào', topic: 'general', address: ADDRESS,
    context: { locale: 'vi', mode: 'connected', chain: 'Arc Testnet', intent: 'CHAT' },
    fetcher: async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return Response.json({ text: 'OK', sources: [{ source: 'Surf news', ok: true, observedAt: '2026-10-25T00:00:00.000Z' }, { bad: 1 }], proposal: { kind: 'send', asset: 'USDC', amount: 'MAX', recipient: ADDRESS } })
    },
  })
  assert.equal(body.locale, 'vi')
  assert.equal(body.address, ADDRESS)
  assert.deepEqual(result, { ok: true, text: 'OK', source: 'REAL_PROVIDER', sources: [{ source: 'Surf news', ok: true, observedAt: '2026-10-25T00:00:00.000Z' }] })
  await requestMakotoChat({ message: 'hi', topic: 'general', address: 'not-an-address', context: { locale: 'en', mode: 'demo', intent: 'CHAT' }, fetcher: async (_url, init) => { body = JSON.parse(String(init?.body)); return Response.json({ text: 'ok' }) } })
  assert.equal(body.address, undefined)
})
