import assert from 'node:assert/strict'
import test from 'node:test'
import { requestMakotoChat } from './chatClient.ts'

const context = { locale: 'en' as const, mode: 'connected' as const, chain: 'Arc Testnet' as const, intent: 'CHAT' as const }

test('chat client uses the backend boundary and bounds history', async () => {
  let request: { url: string; init: RequestInit } | undefined
  const result = await requestMakotoChat({
    message: 'hello', topic: 'greeting', context,
    history: Array.from({ length: 8 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const, content: `item-${index}` })),
    fetcher: async (url, init) => { request = { url: String(url), init: init || {} }; return Response.json({ text: 'Hi there.' }) },
  })
  assert.deepEqual(result, { ok: true, text: 'Hi there.', source: 'REAL_PROVIDER' })
  assert.equal(request?.url, '/api/agent/chat')
  const body = JSON.parse(String(request?.init.body))
  assert.equal(body.history.length, 8)
  assert.equal(body.context.intent, 'CHAT')
  assert.equal((request?.init.headers as Record<string, string>)['authorization'], undefined)
})

test('chat client keeps at most twelve turns and a bounded character budget', async () => {
  let request: RequestInit | undefined
  const history = Array.from({ length: 20 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const, content: `${index}-`.padEnd(1000, 'x') }))
  await requestMakotoChat({ message: 'follow up', topic: 'general', context, history, fetcher: async (_url, init) => { request = init; return Response.json({ text: 'ok' }) } })
  const body = JSON.parse(String(request?.body))
  assert.ok(body.history.length <= 12)
  assert.ok(body.history.every((item: { content: string }) => item.content.length <= 600))
  assert.ok(body.history.reduce((sum: number, item: { content: string }) => sum + item.content.length, 0) <= 6000)
})

test('chat client turns backend and network failures into a local fallback signal', async () => {
  const unavailable = await requestMakotoChat({ message: 'hello', topic: 'general', context, fetcher: async () => Response.json({ error: 'down' }, { status: 503 }) })
  assert.deepEqual(unavailable, { ok: false, reason: 'down', source: 'LOCAL_FALLBACK' })
  const failed = await requestMakotoChat({ message: 'hello', topic: 'general', context, fetcher: async () => { throw new Error('offline') } })
  assert.deepEqual(failed, { ok: false, reason: 'Chat service unavailable', source: 'LOCAL_FALLBACK' })
})
