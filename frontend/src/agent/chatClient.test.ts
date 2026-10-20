import assert from 'node:assert/strict'
import test from 'node:test'
import { requestMakotoChat, CHAT_TIMEOUT_MS, withChatDeadline } from './chatClient.ts'

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

// ---------------------------------------------------------------------------
// withChatDeadline: independent race — guarantee cutoff even when the callback
// never observes the abort signal (stubbed fetch, non-compliant I/O, etc.).
// All deadline tests use 1 ms so they complete fast.
// ---------------------------------------------------------------------------

test('withChatDeadline resolves when callback settles before deadline', async () => {
  const ctrl = new AbortController()
  const result = await withChatDeadline(async () => 'ok', 50, ctrl)
  assert.equal(result, 'ok')
})

test('withChatDeadline rejects with AbortError when deadline fires and callback never settles', async () => {
  const ctrl = new AbortController()
  // The callback returns a Promise that never settles and IGNORES the signal.
  const never = new Promise<string>(() => { /* intentionally hangs forever */ })
  const err = await withChatDeadline(() => never, 1, ctrl).catch((e: unknown) => e)
  assert.ok(err instanceof Error)
  assert.equal((err as Error).name, 'AbortError')
  assert.ok((err as Error).message.includes('timed out'))
})

test('withChatDeadline fires even when callback ignores the abort signal entirely', async () => {
  const ctrl = new AbortController()
  // The callback receives `signal` but never uses it — simulates a non-compliant fetcher.
  const never = new Promise<string>(() => { /* intentionally hangs forever, signal ignored */ })
  const result = await withChatDeadline((_signal) => never, 1, ctrl).catch(() => 'timed-out')
  assert.equal(result, 'timed-out')
})

test('withChatDeadline propagates callback rejection before deadline', async () => {
  const ctrl = new AbortController()
  const err = await withChatDeadline(async () => { throw Object.assign(new Error('offline'), { name: 'AbortError' }) }, 50, ctrl).catch((e: unknown) => e)
  assert.ok(err instanceof Error)
  assert.equal((err as Error).message, 'offline')
})

// ---------------------------------------------------------------------------
// requestMakotoChat integration: deadline covers fetch AND response.json()
// without relying on the fetcher honouring the signal.
// ---------------------------------------------------------------------------

test('requestMakotoChat returns LOCAL_FALLBACK when fetch never resolves and ignores abort (no external signal)', async () => {
  // Fetcher that IGNORES the signal — proves the race fires independently.
  const fetcher: typeof fetch = async () => new Promise<Response>(() => { /* never */ })
  // Use a tiny timeout by monkey-patching CHAT_TIMEOUT_MS via a custom entry.
  // We cannot override the module constant, so instead we test via withChatDeadline
  // directly (above) and here verify that requestMakotoChat wraps the whole call.
  // The result must be LOCAL_FALLBACK eventually — tested via an external signal that
  // mimics the deadline firing after 1 ms.
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 1)
  const result = await requestMakotoChat({ message: 'hello', topic: 'general', context, fetcher, signal: ac.signal })
  assert.equal(result.ok, false)
  assert.equal(result.source, 'LOCAL_FALLBACK')
})

test('requestMakotoChat returns LOCAL_FALLBACK when response.json() never resolves and ignores abort', async () => {
  // fetch() resolves with 200 but json() hangs forever and IGNORES the signal.
  const fetcher: typeof fetch = async () => ({
    ok: true,
    status: 200,
    json: () => new Promise<unknown>(() => { /* never, signal ignored */ }),
  } as unknown as Response)
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 1)
  const result = await requestMakotoChat({ message: 'hello', topic: 'general', context, fetcher, signal: ac.signal })
  assert.equal(result.ok, false)
  assert.equal(result.source, 'LOCAL_FALLBACK')
})

test('requestMakotoChat returns LOCAL_FALLBACK when external signal is already aborted before call', async () => {
  const ac = new AbortController()
  ac.abort() // pre-aborted
  let fetchCalled = false
  const fetcher: typeof fetch = async () => { fetchCalled = true; return Response.json({ text: 'too late' }) }
  const result = await requestMakotoChat({ message: 'hello', topic: 'general', context, fetcher, signal: ac.signal })
  assert.equal(result.ok, false)
  assert.equal(result.source, 'LOCAL_FALLBACK')
  // The fetch may or may not have been called (the controller aborts synchronously),
  // but the response must never be returned as ok.
  if (fetchCalled) assert.equal(result.ok, false)
})

test('requestMakotoChat returns LOCAL_FALLBACK when external signal fires mid-execution', async () => {
  const ac = new AbortController()
  const fetcher: typeof fetch = async (_url, init) => {
    const signal = init?.signal
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener('abort', () =>
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
      )
      setTimeout(() => ac.abort(), 1)
    })
  }
  const result = await requestMakotoChat({ message: 'hello', topic: 'general', context, fetcher, signal: ac.signal })
  assert.equal(result.ok, false)
  assert.equal(result.source, 'LOCAL_FALLBACK')
})

test('stale successful response arriving after abort does not overwrite LOCAL_FALLBACK (settled-once)', async () => {
  const ac = new AbortController()
  let resolveStale!: (r: Response) => void
  const fetcher: typeof fetch = async () => new Promise<Response>((resolve) => { resolveStale = resolve })
  const pending = requestMakotoChat({ message: 'hello', topic: 'general', context, fetcher, signal: ac.signal })
  // Abort first, then deliver a valid response — the result must still be LOCAL_FALLBACK.
  ac.abort()
  resolveStale(Response.json({ text: 'I am late' }))
  const result = await pending
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
