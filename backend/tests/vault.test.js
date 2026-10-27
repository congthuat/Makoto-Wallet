const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const { createVaultRouter } = require('../routes/vault')
const { VaultStore, validateVault } = require('../lib/vaultStore')
const { verifyGoogleIdToken, _cache } = require('../lib/googleAuth')

const b64 = (n) => Buffer.alloc(n, 7).toString('base64')
const vault = (over = {}) => ({ v: 1, kdf: 'pbkdf2-sha256', iterations: 600000, salt: b64(16), iv: b64(12), ciphertext: b64(120), words: 12, ...over })
const A = '0x1111111111111111111111111111111111111111'
const B = '0x2222222222222222222222222222222222222222'

async function withServer(deps, run) {
  const app = express()
  app.use('/api/vault', createVaultRouter({ rateLimit: 1000, clientId: 'cid.apps.googleusercontent.com', ...deps }))
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const base = `http://127.0.0.1:${server.address().port}/api/vault`
  const post = (p, body) => fetch(`${base}/${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }))
  try { return await run(post, base) } finally { await new Promise((r) => server.close(r)) }
}

const verify = async (credential) => {
  if (credential === 'alice') return { sub: '1000001', email: 'alice@gmail.com' }
  if (credential === 'bob') return { sub: '2000002', email: 'bob@gmail.com' }
  throw Object.assign(new Error('Google sign-in expired. Sign in again.'), { status: 401 })
}

test('vault: create, look up and re-encrypt the same wallet; never replace with another address', async () => {
  const store = new VaultStore({ dbPath: ':memory:' })
  await withServer({ verify, store }, async (post) => {
    assert.deepEqual((await post('lookup', { credential: 'alice' })).body, { exists: false, email: 'alice@gmail.com' })
    assert.equal((await post('save', { credential: 'alice', address: A, vault: vault() })).body.created, true)
    const found = await post('lookup', { credential: 'alice' })
    assert.equal(found.body.exists, true); assert.equal(found.body.address, A); assert.equal(found.body.vault.ciphertext, b64(120))
    assert.equal((await post('save', { credential: 'alice', address: A, vault: vault({ salt: b64(32) }) })).body.created, false, 'password change keeps the wallet')
    const clash = await post('save', { credential: 'alice', address: B, vault: vault() })
    assert.equal(clash.status, 409, 'a different wallet can never overwrite the backup')
    assert.equal((await post('lookup', { credential: 'bob' })).body.exists, false, 'accounts are isolated')
    assert.equal((await post('delete', { credential: 'alice', address: B })).status, 409)
    assert.equal((await post('delete', { credential: 'alice', address: A })).body.removed, true)
  })
})

test('vault: rejects missing/invalid Google credentials and malformed backups', async () => {
  const store = new VaultStore({ dbPath: ':memory:' })
  await withServer({ verify, store }, async (post) => {
    assert.equal((await post('lookup', {})).status, 401)
    assert.equal((await post('save', { credential: 'alice', address: A, vault: vault({ iterations: 1000 }) })).status, 400)
    assert.equal((await post('save', { credential: 'alice', address: A, vault: { ...vault(), mnemonic: 'leak' } })).status, 400, 'plaintext fields are refused')
    assert.equal((await post('save', { credential: 'alice', address: 'nope', vault: vault() })).status, 400)
  })
})

test('vault config exposes only the public Google client id', async () => {
  await withServer({ verify, store: new VaultStore({ dbPath: ':memory:' }) }, async (_post, base) => {
    assert.deepEqual(await (await fetch(`${base}/config`)).json(), { enabled: true, clientId: 'cid.apps.googleusercontent.com' })
  })
})

test('validateVault accepts 12 and 24 word backups only', () => {
  assert.equal(validateVault(vault()), null)
  assert.equal(validateVault(vault({ words: 24 })), null)
  assert.notEqual(validateVault(vault({ words: 18 })), null)
  assert.notEqual(validateVault(vault({ iv: b64(16) })), null)
})

test('Google ID token verification enforces audience, issuer, expiry and verified email', async () => {
  _cache.clear()
  const token = `${'a'.repeat(60)}.${'b'.repeat(60)}.${'c'.repeat(60)}`
  const now = 1_800_000_000_000
  const reply = (info, ok = true) => async () => ({ ok, json: async () => info })
  const good = { aud: 'cid', iss: 'https://accounts.google.com', exp: String(now / 1000 + 600), email_verified: 'true', sub: '123456789', email: 'A@Gmail.com' }
  assert.deepEqual(await verifyGoogleIdToken(token, { clientId: 'cid', fetch: reply(good), now }), { sub: '123456789', email: 'a@gmail.com' })
  _cache.clear()
  await assert.rejects(verifyGoogleIdToken(token, { clientId: 'cid', fetch: reply({ ...good, aud: 'other' }), now }), /expired/)
  await assert.rejects(verifyGoogleIdToken(token, { clientId: 'cid', fetch: reply({ ...good, email_verified: 'false' }), now }), /not verified/)
  await assert.rejects(verifyGoogleIdToken(token, { clientId: 'cid', fetch: reply({ ...good, exp: String(now / 1000 - 1) }), now }), /expired/)
  await assert.rejects(verifyGoogleIdToken(token, { clientId: 'cid', fetch: reply({}, false), now }), /expired/)
  await assert.rejects(verifyGoogleIdToken('short', { clientId: 'cid', fetch: reply(good), now }), /Invalid/)
  await assert.rejects(verifyGoogleIdToken(token, { clientId: '', fetch: reply(good), now }), /not configured/)
})
