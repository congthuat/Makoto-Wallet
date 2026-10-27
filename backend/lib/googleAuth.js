/**
 * Google Sign-In ID token verification. Google itself validates the signature via the
 * tokeninfo endpoint; we then enforce audience (our client id), issuer, expiry and a
 * verified email. Results are cached briefly per token to limit outbound calls.
 */
const DEFAULT_CLIENT_ID = ''
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com'])
const cache = new Map()

function googleClientId() {
  return (process.env.GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID).trim()
}

async function verifyGoogleIdToken(idToken, options = {}) {
  const clientId = options.clientId ?? googleClientId()
  const fetchImpl = options.fetch ?? globalThis.fetch
  const now = options.now ?? Date.now()
  if (!clientId) throw Object.assign(new Error('Google sign-in is not configured.'), { status: 503 })
  if (typeof idToken !== 'string' || idToken.length < 100 || idToken.length > 4096 || idToken.split('.').length !== 3) throw Object.assign(new Error('Invalid Google credential.'), { status: 401 })
  const cached = cache.get(idToken)
  if (cached && cached.exp * 1000 > now) return cached.identity
  let response
  try {
    response = await fetchImpl(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`, { signal: AbortSignal.timeout(8000) })
  } catch {
    throw Object.assign(new Error('Google verification is unavailable. Try again.'), { status: 503 })
  }
  if (!response.ok) throw Object.assign(new Error('Google sign-in expired. Sign in again.'), { status: 401 })
  const info = await response.json().catch(() => ({}))
  const exp = Number(info.exp)
  if (info.aud !== clientId || !ISSUERS.has(info.iss) || !Number.isFinite(exp) || exp * 1000 <= now) throw Object.assign(new Error('Google sign-in expired. Sign in again.'), { status: 401 })
  if (!(info.email_verified === true || info.email_verified === 'true')) throw Object.assign(new Error('Google account email is not verified.'), { status: 401 })
  if (typeof info.sub !== 'string' || !/^\d{5,40}$/.test(info.sub)) throw Object.assign(new Error('Invalid Google credential.'), { status: 401 })
  const identity = { sub: info.sub, email: String(info.email || '').toLowerCase().slice(0, 254) }
  if (cache.size > 2000) cache.clear()
  cache.set(idToken, { exp, identity })
  return identity
}

module.exports = { verifyGoogleIdToken, googleClientId, _cache: cache }
