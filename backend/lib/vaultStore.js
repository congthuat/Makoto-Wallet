/**
 * Encrypted embedded-wallet backups. The server stores ONLY the ciphertext produced in the
 * user's browser (PBKDF2-SHA256 + AES-256-GCM, password never sent). It cannot decrypt it,
 * so it cannot move funds. One wallet per Google account; a different address can never
 * silently replace an existing backup.
 */
const fs = require('node:fs')
const path = require('node:path')
let DatabaseSync
try { ({ DatabaseSync } = require('node:sqlite')) } catch { ({ DatabaseSync } = require('./sqlite')) }

const B64 = /^[A-Za-z0-9+/]+={0,2}$/
const ADDRESS = /^0x[0-9a-fA-F]{40}$/

function b64Bytes(value) {
  if (typeof value !== 'string' || !B64.test(value) || value.length % 4 !== 0) return -1
  return Buffer.from(value, 'base64').length
}

/** Shape check only — the server never learns or needs the plaintext. */
function validateVault(vault) {
  if (!vault || typeof vault !== 'object' || Array.isArray(vault)) return 'Invalid backup.'
  const allowed = new Set(['v', 'kdf', 'iterations', 'salt', 'iv', 'ciphertext', 'words'])
  if (Object.keys(vault).some((key) => !allowed.has(key))) return 'Invalid backup.'
  if (vault.v !== 1 || vault.kdf !== 'pbkdf2-sha256') return 'Unsupported backup format.'
  if (!Number.isSafeInteger(vault.iterations) || vault.iterations < 300_000 || vault.iterations > 5_000_000) return 'Invalid backup.'
  if (vault.words !== 12 && vault.words !== 24) return 'Invalid backup.'
  const salt = b64Bytes(vault.salt); const iv = b64Bytes(vault.iv); const ct = b64Bytes(vault.ciphertext)
  if (salt < 16 || salt > 64 || iv !== 12 || ct < 32 || ct > 2048) return 'Invalid backup.'
  return null
}

class VaultStore {
  constructor(options = {}) {
    // Live next to the existing persistent task databases (Railway volume / /var/lib/makoto) unless set explicitly.
    const persistentDir = process.env.TASK_AUTH_DB_PATH ? path.dirname(process.env.TASK_AUTH_DB_PATH) : process.env.TASK_DB_PATH ? path.dirname(process.env.TASK_DB_PATH) : path.join(__dirname, '..', 'data')
    const filename = options.dbPath || process.env.EMBEDDED_VAULT_DB_PATH || path.join(persistentDir, 'embedded-vaults.sqlite')
    if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true })
    this.db = new DatabaseSync(filename, { timeout: 5000 })
    this.db.exec(`CREATE TABLE IF NOT EXISTS embedded_vaults (
      google_sub TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      address TEXT NOT NULL,
      vault TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`)
  }

  get(sub) {
    const row = this.db.prepare('SELECT address, vault, created_at, updated_at FROM embedded_vaults WHERE google_sub = ?').get(sub)
    if (!row) return null
    return { address: row.address, vault: JSON.parse(row.vault), createdAt: row.created_at, updatedAt: row.updated_at }
  }

  /** Create, or re-encrypt (password change) for the SAME address. */
  save(sub, email, address, vault, now = Date.now()) {
    if (!ADDRESS.test(String(address))) return { ok: false, status: 400, error: 'Invalid address.' }
    const problem = validateVault(vault)
    if (problem) return { ok: false, status: 400, error: problem }
    const existing = this.get(sub)
    if (existing && existing.address.toLowerCase() !== address.toLowerCase()) return { ok: false, status: 409, error: 'This Google account already has a different Makoto wallet.' }
    const json = JSON.stringify({ v: vault.v, kdf: vault.kdf, iterations: vault.iterations, salt: vault.salt, iv: vault.iv, ciphertext: vault.ciphertext, words: vault.words })
    if (existing) this.db.prepare('UPDATE embedded_vaults SET vault = ?, email = ?, updated_at = ? WHERE google_sub = ?').run(json, email, now, sub)
    else this.db.prepare('INSERT INTO embedded_vaults (google_sub, email, address, vault, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(sub, email, address, json, now, now)
    return { ok: true, created: !existing }
  }

  remove(sub, address) {
    const existing = this.get(sub)
    if (!existing) return { ok: true, removed: false }
    if (existing.address.toLowerCase() !== String(address).toLowerCase()) return { ok: false, status: 409, error: 'Address does not match this account’s wallet.' }
    this.db.prepare('DELETE FROM embedded_vaults WHERE google_sub = ?').run(sub)
    return { ok: true, removed: true }
  }
}

let singleton = null
const getVaultStore = () => (singleton ??= new VaultStore())

module.exports = { VaultStore, getVaultStore, validateVault }
