const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '../..')
const baselineDir = path.join(__dirname, 'start-baseline')
const baseline = JSON.parse(fs.readFileSync(path.join(baselineDir, 'source-sha256.json'), 'utf8').replace(/^\uFEFF/, ''))
const allowed = new Set([
  'frontend/src/App.tsx', 'frontend/src/components/TaskReviewCard.tsx', 'frontend/src/pages/Tasks.tsx',
  'frontend/src/lib/taskText.ts', 'frontend/src/pages/Insights.tsx', 'frontend/src/lib/i18n-pages.ts',
  'frontend/package.json', 'docs/PROJECT_STATE.md',
])
const rows = Object.entries(baseline).map(([file, hash]) => {
  const full = path.join(root, file)
  const after = fs.existsSync(full) ? crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex') : null
  return { file, before: hash, after, unchanged: hash === after }
})
const changed = rows.filter(row => !row.unchanged)
assert.deepEqual(changed.filter(row => !allowed.has(row.file)), [], 'Unexpected modified source or removed file')
const originalPackage = JSON.parse(fs.readFileSync(path.join(baselineDir, 'frontend/package.json'), 'utf8').replace(/^\uFEFF/, ''))
const currentPackage = JSON.parse(fs.readFileSync(path.join(root, 'frontend/package.json'), 'utf8'))
assert.deepEqual(currentPackage.dependencies, originalPackage.dependencies)
assert.deepEqual(currentPackage.devDependencies, originalPackage.devDependencies)
for (const [name, value] of Object.entries(originalPackage.scripts)) assert.equal(currentPackage.scripts[name], value)
const beforeApp = fs.readFileSync(path.join(baselineDir, 'frontend/src/App.tsx'), 'utf8')
const afterApp = fs.readFileSync(path.join(root, 'frontend/src/App.tsx'), 'utf8')
const scrollEffect = /useEffect\(\(\) => \{\s*window\.scrollTo\(\{ top: 0 \}\)\s*\}, \[w\.page\]\)/
assert.equal(beforeApp.match(scrollEffect)?.[0], afterApp.match(scrollEffect)?.[0])
const backend = rows.filter(row => row.file.startsWith('backend/'))
const preservedFrontend = rows.filter(row => row.file.startsWith('frontend/src/') && !allowed.has(row.file))
assert.ok(backend.every(row => row.unchanged))
assert.ok(preservedFrontend.every(row => row.unchanged))
const report = {
  observedAt: new Date().toISOString(), baselineFiles: rows.length,
  modified: changed.map(row => row.file), unchanged: rows.filter(row => row.unchanged).length,
  backendFilesUnchanged: backend.length, otherFrontendSourceFilesUnchanged: preservedFrontend.length,
  dependenciesUnchanged: true, existingScriptsUnchanged: true, scrollEffectUnchanged: true,
  details: rows,
}
fs.writeFileSync(path.join(__dirname, 'scope-audit.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ ...report, details: undefined }, null, 2))
