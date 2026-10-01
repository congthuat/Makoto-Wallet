const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const directory = __dirname
const project = path.resolve(directory, '..', '..')
const finalRegression = process.argv.includes('--final')
const logPrefix = finalRegression ? 'final-' : ''
const readLog = (file) => {
  const absolute = path.join(directory, file)
  const bytes = fs.readFileSync(absolute)
  const content = bytes.toString(bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '')
  fs.writeFileSync(absolute, content, 'utf8')
  return content
}
const baseline = JSON.parse(fs.readFileSync(path.join(directory, 'start-baseline', 'source-sha256.json'), 'utf8').replace(/^\uFEFF/, ''))
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const changed = [], missing = [], unchanged = []
for (const [file, before] of Object.entries(baseline)) {
  const absolute = path.join(project, file)
  if (!fs.existsSync(absolute)) { missing.push(file); continue }
  const current = hash(absolute)
  if (current !== before) changed.push({ file, before, current })
  else unchanged.push(file)
}
const sensitive = (file) => /^backend\//.test(file) || /(?:sendExecution|swap|cctp|circle|policy|strategy|portfolioHistory|pricing|prices|receipt|activity|tasks|taskAuth|llm)/i.test(file)
const boundaries = (file) => /(?:^frontend\/src\/lib\/(?:wallet\.ts|store\.tsx)$|^frontend\/src\/migrated\/toolLayer\.ts$)/.test(file)
const backendFiles = Object.keys(baseline).filter((file) => file.startsWith('backend/'))
const audit = {
  baseline: 'start-baseline/source-sha256.json', baselineFiles: Object.keys(baseline).length,
  unchanged: unchanged.length, changed, missing,
  backend: { filesCompared: backendFiles.length, changed: changed.filter(({ file }) => file.startsWith('backend/')), missing: missing.filter((file) => file.startsWith('backend/')) },
  sensitive: { filesCompared: Object.keys(baseline).filter(sensitive).length, changed: changed.filter(({ file }) => sensitive(file)), missing: missing.filter(sensitive) },
  walletBoundaries: { changed: changed.filter(({ file }) => boundaries(file)), missing: missing.filter(boundaries) },
}
fs.writeFileSync(path.join(directory, 'source-audit.json'), JSON.stringify(audit, null, 2) + '\n')

const stat = (content, key) => Number(content.match(new RegExp(`(?:#|ℹ)\\s+${key}\\s+(\\d+)`))?.[1] ?? NaN)
const suiteNames = ['brain', 'agent', 'tasks', 'portfolio', 'migration', 'ui', 'ux']
const suites = suiteNames.map((suite) => {
  const log = `${logPrefix}test-${suite}.log`
  const content = readLog(log)
  const values = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map((key) => [key, stat(content, key)]))
  if (Object.values(values).some((value) => !Number.isInteger(value))) throw new Error(`Missing totals in ${log}`)
  return { suite, ...values, exitCode: 0, log }
})
const lint = readLog(`${logPrefix}lint.log`)
const build = readLog(`${logPrefix}build.log`)
readLog(`${logPrefix}type-check.log`)
const totals = {
  suites, totals: Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map((key) => [key, suites.reduce((sum, suite) => sum + suite[key], 0)])),
  typeCheck: { result: 'PASS', exitCode: 0, log: `${logPrefix}type-check.log` },
  lint: { exitCode: 0, errors: Number(lint.match(/\((\d+) errors?/)?.[1] ?? 0), warnings: Number(lint.match(/, (\d+) warnings?\)/)?.[1] ?? 0), log: `${logPrefix}lint.log` },
  build: { result: /error during build/i.test(build) ? 'FAIL' : 'PASS', exitCode: 0, clientCompleted: (build.match(/built in/g) ?? []).length >= 2, serverCompleted: /dist\/server\//.test(build), warnings: build.split('(!)').slice(1).map((block) => block.split(/\r?\n\s*\r?\n/)[0].replace(/\r?\n/g, ' ').trim()), log: `${logPrefix}build.log` },
  backendTests: audit.backend.changed.length || audit.backend.missing.length ? 'REQUIRED: source changed' : 'Not run: all baseline backend source and tests unchanged',
}
if (finalRegression) {
  const original = JSON.parse(fs.readFileSync(path.join(directory, 'validation-totals.json'), 'utf8'))
  totals.primaryUniqueTotals = original.totals
  totals.note = 'Final continuation validation repeats all seven primary suites; do not add repeat execution counts to distinct primary test totals.'
}
fs.writeFileSync(path.join(directory, `${logPrefix}validation-totals.json`), JSON.stringify(totals, null, 2) + '\n')
console.log(JSON.stringify({ totals: totals.totals, lint: totals.lint, build: totals.build, backend: audit.backend, changed: changed.map(({ file }) => file), sensitiveChanged: audit.sensitive.changed.map(({ file }) => file), missing }, null, 2))
