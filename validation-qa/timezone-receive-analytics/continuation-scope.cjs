const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const root = path.resolve(__dirname, '../..')
const phase = process.argv[2] || 'start'
if (!/^[a-z0-9-]+$/.test(phase)) throw new Error('Use a simple evidence phase name')
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const baseline = readJson(path.join(__dirname, 'start-baseline/source-sha256.json'))
const historical = readJson(path.join(__dirname, 'scope-audit.json'))
const recorded = Object.entries(baseline).map(([file, before]) => {
  const target = path.join(root, file)
  const after = fs.existsSync(target) ? digest(target) : null
  const old = historical.details.find(row => row.file === file)
  return { file, before, after, unchanged: before === after, unchangedSinceHistoricalAudit: old?.after === after }
})
const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(directory, entry.name)
  return entry.isDirectory() ? walk(file) : [file]
})
const covered = ['frontend/src', 'frontend/tests', 'backend/lib', 'backend/routes', 'backend/tests', 'shared']
const added = covered.flatMap(directory => walk(path.join(root, directory)))
  .map(file => path.relative(root, file).replaceAll('\\', '/'))
  .filter(file => !Object.hasOwn(baseline, file) && !path.basename(file).startsWith('.'))
  .sort()
  .map(file => ({ file, sha256: digest(path.join(root, file)) }))
const originalEvidence = fs.readdirSync(__dirname, { withFileTypes: true })
  .filter(entry => entry.isFile() && !entry.name.startsWith('continuation-'))
  .map(entry => ({ file: entry.name, sha256: digest(path.join(__dirname, entry.name)) }))
const packageBefore = readJson(path.join(__dirname, 'start-baseline/frontend/package.json'))
const packageAfter = readJson(path.join(root, 'frontend/package.json'))
const appBefore = fs.readFileSync(path.join(__dirname, 'start-baseline/frontend/src/App.tsx'), 'utf8')
const appAfter = fs.readFileSync(path.join(root, 'frontend/src/App.tsx'), 'utf8')
const scrollEffect = source => source.match(/useEffect\(\(\) => \{\s*window\.scrollTo\(\{ top: 0 \}\)\s*\}, \[w\.page\]\)/)?.[0]
const protectedRows = recorded.filter(row => row.file.startsWith('backend/') ||
  /frontend\/src\/(?:brain|migrated|protocols)\//.test(row.file) ||
  /frontend\/src\/lib\/(?:tasks|taskAuth|sendExecution|activity|protocolActivity|wallet|walletProviders|portfolioHistory|store)\./.test(row.file) ||
  /frontend\/src\/pages\/(?:Send|SwapBridge|Dashboard|AssetsActivity|Faucet|Home|Settings)\./.test(row.file))
const summary = {
  observedAt: new Date().toISOString(), phase, comparison: 'Recorded start-baseline SHA-256, no Git metadata assumed',
  baselineFiles: recorded.length,
  modified: recorded.filter(row => !row.unchanged && row.after !== null).map(row => row.file),
  missing: recorded.filter(row => row.after === null).map(row => row.file),
  unchanged: recorded.filter(row => row.unchanged).length,
  changedSinceHistoricalAudit: recorded.filter(row => !row.unchangedSinceHistoricalAudit).map(row => row.file),
  addedWithinCoveredSourceRoots: added,
  unbaselinedDocumentation: ['docs/ANALYTICS_PRODUCT_SCOPE.md'].filter(file => !Object.hasOwn(baseline, file)).map(file => ({ file, sha256: digest(path.join(root, file)), note: 'Not included in original hash manifest; preserved checkpoint documentation' })),
  protectedFiles: protectedRows.length,
  protectedChanged: protectedRows.filter(row => !row.unchanged).map(row => row.file),
  backendFilesUnchanged: recorded.filter(row => row.file.startsWith('backend/') && row.unchanged).length,
  dependenciesUnchanged: JSON.stringify(packageBefore.dependencies) === JSON.stringify(packageAfter.dependencies) && JSON.stringify(packageBefore.devDependencies) === JSON.stringify(packageAfter.devDependencies),
  existingScriptsUnchanged: Object.entries(packageBefore.scripts).every(([key, value]) => packageAfter.scripts[key] === value),
  scrollEffectUnchanged: !!scrollEffect(appBefore) && scrollEffect(appBefore) === scrollEffect(appAfter),
  details: recorded, originalEvidence,
}
const initialFile = path.join(__dirname, 'continuation-scope-start.json')
if (phase !== 'start' && fs.existsSync(initialFile)) {
  const initial = readJson(initialFile)
  summary.originalEvidenceChanged = initial.originalEvidence.filter(row => {
    const target = path.join(__dirname, row.file)
    return !fs.existsSync(target) || digest(target) !== row.sha256
  }).map(row => row.file)
}
fs.writeFileSync(path.join(__dirname, `continuation-scope-${phase}.json`), JSON.stringify(summary, null, 2))
console.log(JSON.stringify({ ...summary, details: undefined, originalEvidence: undefined }))
if (summary.missing.length || summary.protectedChanged.length || summary.dependenciesUnchanged === false || summary.existingScriptsUnchanged === false || summary.scrollEffectUnchanged === false || summary.originalEvidenceChanged?.length) process.exitCode = 1
