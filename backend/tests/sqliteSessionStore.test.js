const test = require('node:test')
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')
const { SQLiteSessionStore } = require('../lib/sqliteSessionStore')

function fixture(t) {
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE sessions (sid PRIMARY KEY, expired, sess)')
  const store = new SQLiteSessionStore(db)
  t.after(() => { store.close(); db.close() })
  const call = (method, ...args) => new Promise((resolve, reject) => {
    store[method](...args, (error, value) => error ? reject(error) : resolve(value))
  })
  return { db, store, call }
}

test('session touch preserves fields and cannot resurrect expired or destroyed sessions', async (t) => {
  const { db, call } = fixture(t)
  const original = { cookie: { expires: new Date(Date.now() + 60_000) }, address: 'verified-wallet', challengeNonce: 'one-time' }
  await call('set', 'live', original)
  const serialized = db.prepare('SELECT sess FROM sessions WHERE sid = ?').get('live').sess
  const extended = new Date(Date.now() + 120_000)
  await call('touch', 'live', { cookie: { expires: extended }, address: 'untrusted-change' })
  assert.equal(db.prepare('SELECT expired FROM sessions WHERE sid = ?').get('live').expired, extended.getTime())
  assert.equal(db.prepare('SELECT sess FROM sessions WHERE sid = ?').get('live').sess, serialized)
  assert.equal((await call('get', 'live')).address, original.address)

  db.prepare('UPDATE sessions SET expired = ? WHERE sid = ?').run(Date.now() - 1, 'live')
  await call('touch', 'live', { cookie: { expires: extended } })
  assert.equal(await call('get', 'live'), null)
  await call('destroy', 'live')
  await call('touch', 'live', { cookie: { expires: extended } })
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0)
})

test('session store reports malformed JSON and SQLite failures asynchronously once', async (t) => {
  const { db, store } = fixture(t)
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run('invalid', Date.now() + 60_000, '{broken')
  async function expectError(method, ...args) {
    let calls = 0
    let returned = false
    await new Promise((resolve, reject) => {
      store[method](...args, (error) => {
        calls += 1
        try { assert.ok(returned); assert.ok(error); resolve() } catch (caught) { reject(caught) }
      })
      returned = true
    })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls, 1)
  }
  await expectError('get', 'invalid')
  db.exec('DROP TABLE sessions')
  await expectError('get', 'missing')
  await expectError('set', 'missing', { cookie: { expires: new Date(Date.now() + 60_000) } })
  await expectError('touch', 'missing', { cookie: { expires: new Date(Date.now() + 60_000) } })
  await expectError('destroy', 'missing')
})
