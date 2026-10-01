const { Router } = require('express')
const { generateAgentResponse } = require('../lib/llm')

const router = Router()
const validLocale = (value) => value === 'en' || value === 'vi'

router.post('/chat', async (req, res) => {
  const body = req.body
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.message !== 'string' || !body.message.trim() || body.message.length > 2000) return res.status(400).json({ error: 'Invalid chat request' })
  if (body.locale !== undefined && !validLocale(body.locale)) return res.status(400).json({ error: 'Invalid locale' })
  if (body.history !== undefined && (!Array.isArray(body.history) || body.history.length > 12)) return res.status(400).json({ error: 'Invalid chat history' })
  let result
  try { result = await generateAgentResponse({ message: body.message.trim(), locale: body.locale || 'en', context: body.context, history: body.history }) }
  catch { return res.status(502).json({ error: 'Chat service failed before a provider response.', code: 'LLM_BACKEND_ERROR' }) }
  if (!result.ok) {
    const status = result.code === 'LLM_NOT_CONFIGURED' ? 503 : result.code === 'LLM_RATE_LIMITED' ? 429 : result.code === 'LLM_TIMEOUT' ? 504 : 502
    return res.status(status).json({ error: result.message, code: result.code })
  }
  res.set('Cache-Control', 'no-store').json({ text: result.text, source: 'REAL_PROVIDER' })
})

module.exports = router
