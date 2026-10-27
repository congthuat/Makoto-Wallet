const express = require('express')
const { rateLimit } = require('express-rate-limit')
const { verifyGoogleIdToken, googleClientId } = require('../lib/googleAuth')
const { getVaultStore } = require('../lib/vaultStore')

/**
 * /api/vault — encrypted backups for "Sign in with Google" wallets.
 * Every call proves the Google account with a fresh ID token. The stored blob is
 * ciphertext only; keys and passwords never reach this server.
 */
function createVaultRouter(deps = {}) {
  const router = express.Router()
  const verify = deps.verify ?? verifyGoogleIdToken
  const store = () => (deps.store ?? getVaultStore())
  router.use(express.json({ limit: '16kb' }))
  router.use(rateLimit({ windowMs: 60_000, limit: deps.rateLimit ?? 30, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many requests. Try again in a minute.' } }))

  const identity = async (req, res) => {
    try { return await verify(req.body?.credential) }
    catch (error) { res.status(error.status || 401).json({ error: error.message || 'Sign in again.' }); return null }
  }

  router.get('/config', (_req, res) => {
    const clientId = deps.clientId ?? googleClientId()
    res.json({ enabled: !!clientId, clientId: clientId || null })
  })

  router.post('/lookup', async (req, res) => {
    const who = await identity(req, res); if (!who) return
    const record = store().get(who.sub)
    res.json(record ? { exists: true, email: who.email, address: record.address, vault: record.vault } : { exists: false, email: who.email })
  })

  router.post('/save', async (req, res) => {
    const who = await identity(req, res); if (!who) return
    const result = store().save(who.sub, who.email, req.body?.address, req.body?.vault)
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.json({ ok: true, created: result.created })
  })

  router.post('/delete', async (req, res) => {
    const who = await identity(req, res); if (!who) return
    const result = store().remove(who.sub, req.body?.address)
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.json({ ok: true, removed: result.removed })
  })

  return router
}

module.exports = createVaultRouter()
module.exports.createVaultRouter = createVaultRouter
