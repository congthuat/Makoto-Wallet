const { Router } = require('express')
const { randomBytes, createHash } = require('node:crypto')
const { getTaskAuth } = require('../lib/taskAuth')
const { PortfolioError, getPortfolioHistory, normalizeWallet, CHAIN_ID, RETENTION_MS } = require('../lib/portfolioHistory')

function loopbackHost(host) { return ['localhost', '127.0.0.1', '[::1]'].includes(host) }
function loopbackPeer(peer) { return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer) }
function refererOrigin(value) {
  try { return new URL(value).origin } catch { return null }
}
function cookieValue(req, name) {
  const entry = String(req.headers.cookie || '').split(';').map((value) => value.trim()).find((value) => value.startsWith(`${name}=`))
  return entry?.slice(name.length + 1)
}

function createPortfolioRouter(history = getPortfolioHistory(), auth = getTaskAuth(), options = {}) {
  const router = Router()
  const production = options.production ?? process.env.NODE_ENV === 'production'
  const origin = options.publicOrigin || auth.publicOrigin
  const parsedOrigin = new URL(origin)
  const localOrigin = !production && loopbackHost(parsedOrigin.hostname)
  const cookieName = parsedOrigin.protocol === 'https:' ? '__Host-mk.portfolio.sid' : 'mk.portfolio.sid'
  router.use(auth.taskSession)
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store')
    const requestOrigin = req.get('Origin') || (req.method === 'GET' ? refererOrigin(req.get('Referer')) : null)
    if (req.get('X-Makoto-Request') !== '1' || requestOrigin !== origin) return res.status(403).json({ code: 'PORTFOLIO_ORIGIN_DENIED', error: 'Request origin was not accepted' })
    if (localOrigin && loopbackPeer(req.socket.remoteAddress)) {
      // Device-local browser capability; independent of Tasks login/logout and server secrets.
      let capability = cookieValue(req, cookieName)
      if (!/^[a-f0-9]{64}$/.test(capability || '')) {
        capability = randomBytes(32).toString('hex')
        res.cookie(cookieName, capability, { path: '/', httpOnly: true, sameSite: 'strict', secure: parsedOrigin.protocol === 'https:', maxAge: RETENTION_MS })
      }
      req.portfolioOwner = createHash('sha256').update(capability).digest('hex')
      return next()
    }
    // Public/nonlocal use remains behind the existing verified-wallet session.
    if (typeof req.session?.address !== 'string' || !/^0x[a-f0-9]{40}$/.test(req.session.address) || req.session.chainId !== CHAIN_ID) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Wallet verification required' })
    req.portfolioOwner = `wallet:${req.session.address}`
    next()
  })

  function scope(req, input) {
    const walletAddress = normalizeWallet(input?.walletAddress)
    const chainId = input?.chainId
    if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new PortfolioError('PORTFOLIO_INVALID_CHAIN')
    if (req.portfolioOwner.startsWith('wallet:') && walletAddress !== req.session.address) throw new PortfolioError('PORTFOLIO_ACCESS_DENIED', 403)
    return { walletAddress, chainId }
  }
  function sendError(res, error) {
    if (error instanceof PortfolioError) return res.status(error.status).json({ code: error.code, error: 'Portfolio history unavailable' })
    console.error('portfolio history:', error?.code || error?.name || 'unknown')
    return res.status(500).json({ code: 'PORTFOLIO_HISTORY_UNAVAILABLE', error: 'Portfolio history unavailable' })
  }
  router.get('/history', (req, res) => {
    try {
      if (Object.keys(req.query).some((key) => !['walletAddress', 'chainId', 'range'].includes(key)) || typeof req.query.chainId !== 'string' || !/^\d+$/.test(req.query.chainId)) throw new PortfolioError('PORTFOLIO_INVALID_REQUEST')
      const { walletAddress, chainId } = scope(req, { walletAddress: req.query.walletAddress, chainId: Number(req.query.chainId) })
      res.json(history.history(req.portfolioOwner, walletAddress, chainId, req.query.range || '1d'))
    } catch (error) { sendError(res, error) }
  })
  router.post('/snapshot', async (req, res) => {
    try {
      const input = req.body
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !['walletAddress', 'chainId'].includes(key))) throw new PortfolioError('PORTFOLIO_INVALID_REQUEST')
      const { walletAddress, chainId } = scope(req, input)
      res.json(await history.capture(req.portfolioOwner, walletAddress, chainId))
    } catch (error) { sendError(res, error) }
  })
  return router
}

let defaultRouter
function portfolioRoute(req, res, next) {
  if (!defaultRouter) defaultRouter = createPortfolioRouter()
  return defaultRouter(req, res, next)
}
module.exports = portfolioRoute
module.exports.createPortfolioRouter = createPortfolioRouter
