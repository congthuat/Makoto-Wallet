const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const directory = __dirname
const root = path.resolve(directory, '..', '..')
const baseline = JSON.parse(fs.readFileSync(path.join(directory, 'start-baseline', 'source-sha256.json'), 'utf8').replace(/^\uFEFF/, ''))
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')
const files = (folder) => fs.readdirSync(path.join(root, folder), { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(`${folder}/${entry.name}`) : [`${folder}/${entry.name}`])
const modified = Object.entries(baseline).filter(([file, original]) => fs.existsSync(path.join(root, file)) && hash(file) !== original).map(([file]) => file)
const added = files('frontend/src').filter((file) => !Object.hasOwn(baseline, file))
const definitions = [
  ['A', 'Home quick-answer routing', 'COMPLETE', 'Current Home routes single supported reads through Brain/Planner and Tool Layer; Home browser matrix and Home request tests pass.'],
  ['B', 'Original user text preservation', 'COMPLETE', 'User messages render exact m.text; normalized intent is separate. Suggestion text is submitted unchanged.'],
  ['C', 'VI/EN locale consistency', 'PARTIAL', 'Quick answers, suggestions, task reply metadata and missing-field labels follow current locale. Agent action/safety flow copy still has pretranslated stored strings pending final bounded correction.'],
  ['D', 'Dedicated Agent handoff', 'COMPLETE', 'Supported action/workflow/task intents hand off; six VI/EN workflow browser cases preserve text.'],
  ['E', 'EIP-6963 wallet discovery', 'COMPLETE', 'Announcement/request handshake, provider identity, validated inert metadata, deduplication, late announcements and legacy injection tested.'],
  ['F', 'Multi-wallet picker UI', 'COMPLETE', 'Individual truthful named/icon/status rows; existing wallet browser QA passes 30 cases.'],
  ['G', 'OKX', 'COMPLETE', 'Announced and legacy OKX fixtures supported.'],
  ['H', 'MetaMask', 'COMPLETE', 'Announced and legacy MetaMask fixtures supported; local official fallback icon.'],
  ['I', 'Rabby', 'COMPLETE', 'Announced and legacy Rabby fixtures supported despite compatibility flags; local official fallback icon.'],
  ['J', 'Explicit selected-provider connection', 'COMPLETE', 'Only selected provider receives connection calls; readback/cancellation failures cannot commit another provider.'],
  ['K', 'Watch-only mode', 'COMPLETE', 'Watch clears selection and existing write/signing guards remain; reload fixture tested.'],
  ['L', 'Ask suggestions', 'COMPLETE', 'Exact five VI and five EN target inputs reach supported inline deterministic reads.'],
  ['M', 'Monitor suggestions', 'COMPLETE', 'Exact five per locale use supported token thresholds; production parser plus isolated current engine runs pass.'],
  ['N', 'Automate suggestions', 'COMPLETE', 'Exact five per locale use supported daily HH:MM schedules; production parser plus isolated current engine runs pass.'],
  ['O', 'Responsive QA', 'COMPLETE', 'Recorded Home 1440/1280/390 EN/VI dark/light matrix, wallet 1440/390 matrix, and 24 live scroll cases pass.'],
  ['P', 'Tests', 'PARTIAL', 'Original all-seven frontend suites passed 233 distinct tests. Final affected Agent/UI/UX/type-check/lint/build rerun pending latest locale copy correction.'],
  ['Q', 'Docs', 'PARTIAL', 'AGENT_HOME_UX and evidence report exist; latest PROJECT_STATE/final validation closeout pending.'],
]
const audit = {
  checkpoint: 'Current filesystem; recovered before final locale and validation closeout',
  modifiedExistingBaselineFiles: modified,
  addedFrontendSourceFiles: added,
  additionalUxTest: 'frontend/tests/agent-task-locale.test.mjs',
  localWalletAssets: ['frontend/public/wallets/metamask.svg', 'frontend/public/wallets/rabby.svg'],
  packageChange: 'Only test:ux npm script added; no dependency additions or lockfile change required.',
  workstreams: definitions.map(([id, workstream, status, evidence]) => ({ id, workstream, status, evidence })),
}
fs.writeFileSync(path.join(directory, 'recovery-workstreams.json'), JSON.stringify(audit, null, 2) + '\n')
console.log(JSON.stringify({ modified, added, workstreams: audit.workstreams.map(({ id, status }) => `${id}:${status}`) }, null, 2))
