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

router.post('/chat', chatLimiter, async (req, res) => {
  const body = req.body
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.message !== 'string' || !body.message.trim() || body.message.length > 2000) return res.status(400).json({ error: 'Invalid chat request' })
  if (body.locale !== undefined && !validLocale(body.locale)) return res.status(400).json({ error: 'Invalid locale' })
  if (body.history !== undefined && (!Array.isArray(body.history) || body.history.length > 12)) return res.status(400).json({ error: 'Invalid chat history' })
  if (body.address !== undefined && body.address !== null && !isAddress(body.address)) return res.status(400).json({ error: 'Invalid address' })
  const mode = body.context && typeof body.context === 'object' ? body.context.mode : undefined
  let result
  try { result = await generateAgentResponse({ message: body.message.trim(), locale: body.locale || 'en', context: body.context, history: body.history, address: body.address || undefined, mode }) }
  catch { return res.status(502).json({ error: 'Chat service failed before a provider response.', code: 'LLM_BACKEND_ERROR' }) }
  if (!result.ok) {
    const status = result.code === 'LLM_NOT_CONFIGURED' ? 503 : result.code === 'LLM_RATE_LIMITED' ? 429 : result.code === 'LLM_TIMEOUT' ? 504 : 502
    return res.status(status).json({ error: result.message, code: result.code })
  }
  res.set('Cache-Control', 'no-store').json({
    text: result.text,
    source: 'REAL_PROVIDER',
    ...(result.sources ? { sources: result.sources } : {}),
    ...(result.proposal ? { proposal: result.proposal } : {}),
  })
})

module.exports = router
