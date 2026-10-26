// Runs INSIDE the Railway backend container (piped over `railway ssh -- node -`).
// Makes a consistent, read-only snapshot of each Makoto SQLite database with
// VACUUM INTO, verifies it, and prints it as one base64 line on stdout:
//   MAKOTO_EXPORT {"name":...,"sha256":...,"data":"<base64>"}
// Nothing in the live databases is modified; temporary files are removed.
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')

const DATABASES = {
  'task-auth': 'TASK_AUTH_DB_PATH',
  tasks: 'TASK_DB_PATH',
  'portfolio-history': 'PORTFOLIO_HISTORY_DB_PATH',
}

function candidates(name, envKey) {
  const file = `${name}.sqlite`
  return [...new Set([
    process.env[envKey],
    path.join('/data', file),
    path.join('/data', 'data', file),
    path.join('/app', 'data', file),
    path.join('/app', 'backend', 'data', file),
    path.join(process.cwd(), 'data', file),
  ].filter(Boolean).map((value) => path.resolve(value)))]
}

const emit = (record) => process.stdout.write(`MAKOTO_EXPORT ${JSON.stringify(record)}\n`)

for (const [name, envKey] of Object.entries(DATABASES)) {
  const searched = candidates(name, envKey)
  const source = searched.find((file) => fs.existsSync(file) && fs.statSync(file).isFile())
  if (!source) { emit({ name, missing: true, searched }); continue }
  const tmp = path.join(os.tmpdir(), `makoto-export-${name}-${process.pid}-${crypto.randomUUID()}.sqlite`)
  let db
  try {
    db = new DatabaseSync(source, { readOnly: true })
    db.exec('PRAGMA busy_timeout = 15000')
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`)
    db.close(); db = undefined
    const check = new DatabaseSync(tmp, { readOnly: true })
    const integrity = check.prepare('PRAGMA integrity_check').get()
    check.close()
    const data = fs.readFileSync(tmp)
    emit({ name, source, bytes: data.length, integrity: integrity && Object.values(integrity)[0], sha256: crypto.createHash('sha256').update(data).digest('hex'), data: data.toString('base64') })
  } catch (error) {
    emit({ name, source, error: error && error.message ? error.message : String(error) })
  } finally {
    if (db) { try { db.close() } catch { /* already closed */ } }
    fs.rmSync(tmp, { force: true })
  }
}
process.stdout.write('MAKOTO_EXPORT_DONE\n')
