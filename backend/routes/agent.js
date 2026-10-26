const { Router } = require('express')
const { rateLimit } = require('express-rate-limit')
const { generateAgentResponse, validLocale } = require('../lib/llm')

const router = Router()
const isAddress = (value) => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
const perMinute = Number(process.env.AGENT_RATE_LIMIT_PER_MIN)

// Each chat can trigger several paid LLM calls; bound abuse per client.
// Behind a proxy, set TASK_TRUST_PROXY_HOPS so req.ip is the real client.
const chatLimiter = rateLimit({
  windowMs: 60_000,
  limit: Number.isSafeInteger(perMinute) && perMinute > 0 ? perMinute : 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, trustProxy: false },
  handler: (_req, res) => res.status(429).json({ error: 'Too many Agent requests. Please wait a minute.', code: 'AGENT_RATE_LIMITED' }),
})

function parseRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.message !== 'string' || !body.message.trim() || body.message.length > 2000) return { error: 'Invalid chat request' }
  if (body.locale !== undefined && !validLocale(body.locale)) return { error: 'Invalid locale' }
  if (body.history !== undefined && (!Array.isArray(body.history) || body.history.length > 12)) return { error: 'Invalid chat history' }
  if (body.address !== undefined && body.address !== null && !isAddress(body.address)) return { error: 'Invalid address' }
  if (body.memory !== undefined && (body.memory === null || typeof body.memory !== 'object' || Array.isArray(body.memory) || JSON.stringify(body.memory).length > 8000)) return { error: 'Invalid memory' }
  const mode = body.context && typeof body.context === 'object' ? body.context.mode : undefined
  return { value: { message: body.message.trim(), locale: body.locale || 'en', context: body.context, history: body.history, address: body.address || undefined, mode, memory: body.memory } }
}

const statusFor = (code) => code === 'LLM_NOT_CONFIGURED' ? 503 : code === 'LLM_RATE_LIMITED' ? 429 : code === 'LLM_TIMEOUT' ? 504 : 502

function replyPayload(result) {
  return {
    text: result.text,
    source: 'REAL_PROVIDER',
    ...(result.sources ? { sources: result.sources } : {}),
    ...(result.proposal ? { proposal: result.proposal } : {}),
    ...(result.plan ? { plan: result.plan } : {}),
    ...(result.memory ? { memory: result.memory } : {}),
    ...(result.charts ? { charts: result.charts } : {}),
  }
}

router.post('/chat', chatLimiter, async (req, res) => {
  const parsed = parseRequest(req.body)
  if (parsed.error) return res.status(400).json({ error: parsed.error })
  let result
  try { result = await generateAgentResponse(parsed.value) }
  catch { return res.status(502).json({ error: 'Chat service failed before a provider response.', code: 'LLM_BACKEND_ERROR' }) }
  if (!result.ok) return res.status(statusFor(result.code)).json({ error: result.message, code: result.code })
  res.set('Cache-Control', 'no-store').json(replyPayload(result))
})

/**
 * Server-Sent Events variant. Events:
 *   status {tool, source}  — a read-only tool is being called
 *   delta  {text}          — streamed answer text
 *   done   {...payload}    — same body as POST /chat (authoritative final text)
 *   error  {code, error, status}
 */
router.post('/chat/stream', chatLimiter, async (req, res) => {
  const parsed = parseRequest(req.body)
  if (parsed.error) return res.status(400).json({ error: parsed.error })
  const controller = new AbortController()
  res.on('close', () => { if (!res.writableEnded) controller.abort() })
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  res.flushHeaders?.()
  const send = (event, data) => { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) }
  // Keep proxies from closing an idle connection while tools run.
  const keepAlive = setInterval(() => { if (!res.writableEnded) res.write(': keep-alive\n\n') }, 15_000)
  try {
    const result = await generateAgentResponse(parsed.value, {
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === 'delta') send('delta', { text: event.text })
        else if (event.type === 'status') send('status', { tool: event.tool, source: event.source })
      },
    })
    if (!result.ok) send('error', { error: result.message, code: result.code, status: statusFor(result.code) })
    else send('done', replyPayload(result))
  } catch {
    send('error', { error: 'Chat service failed before a provider response.', code: 'LLM_BACKEND_ERROR', status: 502 })
  } finally {
    clearInterval(keepAlive)
    res.end()
  }
})

module.exports = router
