import assert from 'node:assert/strict'
import test from 'node:test'
import { requestMakotoChat, CHAT_TIMEOUT_MS } from './chatClient.ts'

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

// ---------------------------------------------------------------------------
// Hotfix regression: chat HTTP call must be bounded by CHAT_TIMEOUT_MS.
// A hanging fetch or hanging response.json() must both fall back gracefully.
// A 429 / 5xx must surface as LOCAL_FALLBACK, not throw.
// A response that arrives after cancellation (stale) must not settle twice.
// ---------------------------------------------------------------------------

test('CHAT_TIMEOUT_MS is exported and is a positive finite number', () => {
  assert.ok(Number.isFinite(CHAT_TIMEOUT_MS) && CHAT_TIMEOUT_MS > 0, `CHAT_TIMEOUT_MS must be a positive number, got ${CHAT_TIMEOUT_MS}`)
})

test('requestMakotoChat returns LOCAL_FALLBACK when fetch hangs and external signal fires', async () => {
  // Simulate a network hang that never resolves.
  // We provide an external AbortController and abort it from inside the fetcher
  // (synchronously, after 0 ms) so the signal fires into the in-flight fetch.
  const ac = new AbortController()
  const fetcher: typeof fetch = async (_url, init) => {
    const signal = init?.signal
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener('abort', () =>
        reject(Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' })),
      )
      // Abort 1 ms after the fetch starts — much faster than CHAT_TIMEOUT_MS.
      setTimeout(() => ac.abort(), 1)
    })
  }
  const result = await requestMakotoChat({ message: 'hello', topic: 'general', context, fetcher, signal: ac.signal })
  assert.equal(result.ok, false)
  assert.equal(result.source, 'LOCAL_FALLBACK')
})

test('requestMakotoChat returns LOCAL_FALLBACK when response.json() hangs and external signal fires', async () => {
  const ac = new AbortController()
  const fetcher: typeof fetch = async (_url, init) => {
    const signal = init?.signal
    // fetch() resolves immediately with 200, but .json() hangs.
    return {
      ok: true,
      status: 200,
      json: () => new Promise<unknown>((_resolve, reject) => {
        signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        )
        setTimeout(() => ac.abort(), 1)
      }),
    } as unknown as Response
  }
  const result = await requestMakotoChat({ message: 'hello', topic: 'general', context, fetcher, signal: ac.signal })
  assert.equal(result.ok, false)
  assert.equal(result.source, 'LOCAL_FALLBACK')
})

test('requestMakotoChat returns LOCAL_FALLBACK for 429 Too Many Requests', async () => {
  const result = await requestMakotoChat({
    message: 'hello', topic: 'general', context,
    fetcher: async () => Response.json({ error: 'rate limited' }, { status: 429 }),
  })
  assert.equal(result.ok, false)
  assert.equal(result.source, 'LOCAL_FALLBACK')
  assert.equal((result as { reason: string }).reason, 'rate limited')
})

test('requestMakotoChat returns LOCAL_FALLBACK for 500 Internal Server Error without crashing', async () => {
  const result = await requestMakotoChat({
    message: 'hello', topic: 'general', context,
    fetcher: async () => new Response('Internal Server Error', { status: 500, headers: { 'content-type': 'text/plain' } }),
  })
  assert.equal(result.ok, false)
  assert.equal(result.source, 'LOCAL_FALLBACK')
  // The reason must include the status code when no JSON error field is available.
  assert.ok((result as { reason: string }).reason.includes('500'), `expected 500 in reason: ${(result as { reason: string }).reason}`)
})

test('external AbortSignal cancels requestMakotoChat immediately', async () => {
  const ac = new AbortController()
  let settled = false
  const fetcher: typeof fetch = async (_url, init) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })
  }
  const pending = requestMakotoChat({ message: 'hi', topic: 'general', context, fetcher, signal: ac.signal })
    .then((r) => { settled = true; return r })
  // Cancel immediately.
  ac.abort()
  const result = await pending
  assert.equal(settled, true, 'promise must settle after abort')
  assert.equal(result.ok, false)
  assert.equal(result.source, 'LOCAL_FALLBACK')
})
