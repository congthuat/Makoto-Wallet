const { Router } = require('express')
const { ARC_CHAIN_ID, AuthError, getTaskAuth } = require('../lib/taskAuth')

function saveSession(req) {
  return new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()))
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()))
}

function destroySession(req) {
  return new Promise((resolve, reject) => req.session.destroy((error) => error ? reject(error) : resolve()))
}

function sendError(res, error) {
  if (error instanceof AuthError) return res.status(error.status).json({ code: error.code, error: 'Wallet verification failed' })
  console.error('task auth:', error?.code || error?.name || 'unknown error')
  return res.status(500).json({ code: 'TASK_AUTH_UNAVAILABLE', error: 'Wallet authentication unavailable' })
}

function sessionShape(req) {
  const address = req.session?.address
  return typeof address === 'string' && /^0x[0-9a-f]{40}$/.test(address) && req.session.chainId === ARC_CHAIN_ID
    ? { authenticated: true, address }
    : { authenticated: false, address: null }
}

function createAuthRouter(auth = getTaskAuth()) {
  const router = Router()
  router.use(auth.taskSession)
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })

  router.get('/session', (req, res) => res.json(sessionShape(req)))

  router.post('/nonce', auth.mutationOrigin, auth.nonceRateLimit, async (req, res) => {
    try {
      const { message, nonce } = auth.issueChallenge(req.body?.address, req.body?.chainId, req.sessionID)
      req.session.challengeNonce = nonce
      await saveSession(req)
      res.json({ message })
    } catch (error) { sendError(res, error) }
  })

  router.post('/verify', auth.mutationOrigin, auth.verifyRateLimit, async (req, res) => {
    try {
      const address = await auth.verifyChallenge(req.body?.message, req.body?.signature, req.sessionID, req.session?.challengeNonce)
      await regenerateSession(req)
      req.session.address = address
      req.session.chainId = ARC_CHAIN_ID
      await saveSession(req)
      res.json(sessionShape(req))
    } catch (error) { sendError(res, error) }
  })

  router.post('/logout', auth.mutationOrigin, async (req, res) => {
    try {
      await destroySession(req)
      res.clearCookie(auth.cookieName, { path: '/', secure: auth.cookieOptions.secure, sameSite: auth.cookieOptions.sameSite, httpOnly: true })
      res.json({ authenticated: false, address: null })
    } catch (error) { sendError(res, error) }
  })

  return router
}

let defaultRouter
function authRoute(req, res, next) {
  if (!defaultRouter) defaultRouter = createAuthRouter()
  return defaultRouter(req, res, next)
}

module.exports = authRoute
module.exports.createAuthRouter = createAuthRouter
