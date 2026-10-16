// Diagnostic for independently linked SQLite libraries in one process.
// All databases are disposable files below the OS temporary directory.
// Optional legacy comparison: SQLITE3_MODULE=/temporary/node_modules/sqlite3
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const sqlite3 = process.env.SQLITE3_MODULE ? require(process.env.SQLITE3_MODULE) : null
const addonPackageVersion = sqlite3
  ? require(path.join(path.dirname(require.resolve(process.env.SQLITE3_MODULE)), '../package.json')).version
  : null

function native(file) {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=50')
  return { exec: async sql => db.exec(sql), get: async sql => db.prepare(sql).get(), close: async () => db.close() }
}

async function addon(file) {
  const db = await new Promise((resolve, reject) => {
    const pending = new sqlite3.Database(file, error => error ? reject(error) : resolve(pending))
  })
  const wrapper = {
    exec: sql => new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve())),
    get: sql => new Promise((resolve, reject) => db.get(sql, (error, row) => error ? reject(error) : resolve(row))),
    close: () => new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve())),
  }
  await wrapper.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=50')
  return wrapper
}

async function probe(label, makeA, makeB, { separateFiles = false, mixedLibraries = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'makoto-sqlite-lock-probe-'))
  let a, b, aHeld = false, bHeld = false
  const result = { label, separateFiles, mixedLibraries }
  try {
    a = await makeA(path.join(dir, 'a.sqlite'))
    await a.exec('CREATE TABLE evidence (writer TEXT PRIMARY KEY)')
    b = await makeB(path.join(dir, separateFiles ? 'b.sqlite' : 'a.sqlite'))
    if (separateFiles) await b.exec('CREATE TABLE evidence (writer TEXT PRIMARY KEY)')
    await a.exec("BEGIN IMMEDIATE; INSERT INTO evidence VALUES ('first')")
    aHeld = true
    try {
      await b.exec('BEGIN IMMEDIATE')
      bHeld = true
      result.secondWriterAcquired = true
    } catch (error) {
      result.secondWriterAcquired = false
      result.secondWriterError = { message: error.message, code: error.code, errcode: error.errcode }
      if (error.code !== 'SQLITE_BUSY' && error.errcode !== 5) throw error
    }
    if (bHeld && !separateFiles) {
      // Only a demonstrably bypassed writer lock reaches this branch. The two
      // successful commits must preserve both rows in this disposable file.
      await b.exec("INSERT INTO evidence VALUES ('second'); COMMIT")
      bHeld = false
      result.overlappingSecondCommit = true
    } else if (bHeld) { await b.exec('ROLLBACK'); bHeld = false }
    await a.exec('COMMIT'); aHeld = false
    result.committedRowsA = await a.get("SELECT count(*) AS rowCount, group_concat(writer, ',') AS writers FROM evidence")
    result.committedRowsB = await b.get("SELECT count(*) AS rowCount, group_concat(writer, ',') AS writers FROM evidence")
    if (result.overlappingSecondCommit) result.bothCommitsPreserved = result.committedRowsA.rowCount === 2 && result.committedRowsB.rowCount === 2
    result.integrityA = await a.get('PRAGMA integrity_check')
    result.integrityB = await b.get('PRAGMA integrity_check')
    result.safetyExpectationMet = separateFiles ? result.secondWriterAcquired : !result.secondWriterAcquired
  } catch (error) {
    result.error = { message: error.message, code: error.code }
  } finally {
    if (bHeld) { try { await b.exec('ROLLBACK') } catch {} }
    if (aHeld) { try { await a.exec('ROLLBACK') } catch {} }
    if (b) { try { await b.close() } catch (error) { result.closeBError = error.message } }
    if (a) { try { await a.close() } catch (error) { result.closeAError = error.message } }
    const resolved = path.resolve(dir)
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('makoto-sqlite-lock-probe-')) throw new Error('Unexpected probe cleanup path')
    fs.rmSync(resolved, { recursive: true, force: true })
  }
  return result
}

;(async () => {
  const scenarios = [['node:sqlite + node:sqlite / same file', native, native, {}]]
  if (sqlite3) scenarios.push(
    ['sqlite3 + sqlite3 / same file', addon, addon, {}],
    ['node:sqlite + sqlite3 / same file', native, addon, { mixedLibraries: true }],
    ['sqlite3 + node:sqlite / same file', addon, native, { mixedLibraries: true }],
    ['node:sqlite + sqlite3 / separate files', native, addon, { separateFiles: true, mixedLibraries: true }],
  )
  const results = []
  for (const [label, a, b, options] of scenarios) results.push(await probe(label, a, b, options))
  console.log(JSON.stringify({
    node: process.version,
    platform: process.platform,
    builtinSQLite: process.versions.sqlite,
    legacyDriverConfigured: Boolean(sqlite3),
    addonPackageVersion,
    addonSQLite: sqlite3?.VERSION || null,
    mixedLibraryLockViolationReproduced: results.some(result => result.mixedLibraries && !result.separateFiles && result.secondWriterAcquired),
    results,
  }, null, 2))
  if (results.some(result => result.error || result.closeAError || result.closeBError || (!result.mixedLibraries && !result.safetyExpectationMet) || (result.separateFiles && !result.safetyExpectationMet))) process.exitCode = 1
})().catch(error => { console.error(error); process.exitCode = 1 })
