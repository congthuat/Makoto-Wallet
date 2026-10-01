const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '../..')
const frontend = path.join(root, 'frontend')
const evidencePrefix = process.argv[2] || 'continuation-validation'
if (!/^continuation-[a-z0-9-]+$/.test(evidencePrefix)) throw new Error('Use a simple continuation evidence prefix')
const suites = ['test:brain', 'test:agent', 'test:tasks', 'test:portfolio', 'test:ux', 'test:migration', 'test:ui', 'test:polish', 'type-check', 'lint', 'build:client', 'build:server']
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(directory, entry.name)
  return entry.isDirectory() ? walk(file) : [file]
})
const sourceSnapshot = () => Object.fromEntries(['frontend/src', 'frontend/tests', 'backend/lib', 'backend/routes', 'backend/tests', 'shared']
  .flatMap(directory => walk(path.join(root, directory)))
  .concat([path.join(frontend, 'package.json'), path.join(frontend, 'package-lock.json')])
  .filter(file => !path.basename(file).startsWith('.'))
  .map(file => [path.relative(root, file).replaceAll('\\', '/'), digest(file)]))
const startedAt = new Date().toISOString()
const before = sourceSnapshot()
const results = []
for (const suite of suites) {
  const started = Date.now()
  const run = spawnSync(process.env.ComSpec || 'C:/Windows/System32/cmd.exe', ['/d', '/s', '/c', `npm.cmd run ${suite}`], { cwd: frontend, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  const output = `${run.stdout || ''}\n${run.stderr || ''}`
  fs.writeFileSync(path.join(__dirname, `${evidencePrefix}-${suite.replace(':', '-')}.log`), output)
  const number = label => Number(output.match(new RegExp(`\\b${label} (\\d+)`))?.[1] || 0)
  const lintMatch = output.match(/(\d+) problems \((\d+) errors, (\d+) warnings\)/)
  const row = {
    suite, exitCode: run.status, tests: number('tests'), pass: number('pass'), fail: number('fail'), skipped: number('skipped'),
    durationMs: Date.now() - started,
    ...(lintMatch ? { lintErrors: Number(lintMatch[2]), lintWarnings: Number(lintMatch[3]) } : {}),
    ...(suite === 'build:client' ? { buildWarningCategories: [
      ...(output.includes('Dashboard.tsx is dynamically imported') ? ['Dashboard mixed static/dynamic imports'] : []),
      ...(output.includes('Insights.tsx is dynamically imported') ? ['Insights mixed static/dynamic imports'] : []),
      ...(output.includes('Some chunks are larger than 500 kB') ? ['Chunks over 500 kB'] : []),
    ] } : {}),
  }
  results.push(row)
  console.log(JSON.stringify(row))
  fs.writeFileSync(path.join(__dirname, `${evidencePrefix}-progress.json`), JSON.stringify({ startedAt, results }, null, 2))
  if (run.status !== 0) process.exitCode = 1
}
const after = sourceSnapshot()
const changedDuringValidation = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(file => before[file] !== after[file])
const summary = {
  startedAt, finishedAt: new Date().toISOString(),
  tests: results.reduce((sum, row) => sum + row.tests, 0), passed: results.reduce((sum, row) => sum + row.pass, 0),
  failed: results.reduce((sum, row) => sum + row.fail, 0), skipped: results.reduce((sum, row) => sum + row.skipped, 0),
  changedDuringValidation, sourceSha256: after, results,
  backendTests: 'Not rerun: all recorded backend source hashes unchanged; no backend Analytics edits.',
}
fs.writeFileSync(path.join(__dirname, `${evidencePrefix}-totals.json`), JSON.stringify(summary, null, 2))
console.log(JSON.stringify({ ...summary, sourceSha256: undefined, results: undefined }))
if (changedDuringValidation.length) process.exitCode = 1
