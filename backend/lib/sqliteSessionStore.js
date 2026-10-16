const session = require('express-session')

const DAY_MS = 24 * 60 * 60 * 1000

// Use the auth DatabaseSync connection. Loading another SQLite library against
// this file breaks SQLite's in-process POSIX lock bookkeeping on Linux.
class SQLiteSessionStore extends session.Store {
  constructor(db) {
    super()
    this.db = db
    this.cleanup()
    this.cleanupTimer = setInterval(() => {
      try { this.cleanup() } catch (error) {
        console.error('task session cleanup:', error?.code || error?.name || 'unknown error')
      }
    }, DAY_MS)
    this.cleanupTimer.unref()
  }

  cleanup() {
    this.db.prepare('DELETE FROM sessions WHERE expired < ?').run(Date.now())
  }

  // Invoke callbacks asynchronously, exactly once, including SQLite/JSON errors.
  // Keep the callback outside the try so a consumer exception is not retried.
  execute(operation, callback = () => {}) {
    let result
    let error
    try { result = operation() } catch (caught) { error = caught }
    process.nextTick(callback, error, result)
  }

  get(sid, callback) {
    this.execute(() => {
      const row = this.db.prepare('SELECT sess FROM sessions WHERE sid = ? AND ? <= expired').get(sid, Date.now())
      if (!row) return null
      const value = JSON.parse(row.sess)
      if (!value || typeof value !== 'object' || !value.cookie || typeof value.cookie !== 'object') {
        throw new Error('Invalid stored session')
      }
      return value
    }, callback)
  }

  set(sid, value, callback) {
    this.execute(() => {
      const expired = value.cookie.expires
        ? new Date(value.cookie.expires).getTime()
        : Date.now() + (value.cookie.maxAge || DAY_MS)
      if (!Number.isFinite(expired)) throw new Error('Invalid session expiry')
      this.db.prepare('INSERT OR REPLACE INTO sessions (sid, expired, sess) VALUES (?, ?, ?)')
        .run(sid, expired, JSON.stringify(value))
    }, callback)
  }

  destroy(sid, callback) {
    this.execute(() => { this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid) }, callback)
  }

  touch(sid, value, callback) {
    this.execute(() => {
      if (!value.cookie?.expires) return
      const expired = new Date(value.cookie.expires).getTime()
      if (!Number.isFinite(expired)) throw new Error('Invalid session expiry')
      this.db.prepare('UPDATE sessions SET expired = ? WHERE sid = ? AND ? <= expired').run(expired, sid, Date.now())
    }, callback)
  }

  close() {
    clearInterval(this.cleanupTimer)
  }
}

module.exports = { SQLiteSessionStore }
