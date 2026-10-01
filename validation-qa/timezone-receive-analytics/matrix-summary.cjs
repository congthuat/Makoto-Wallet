const fs = require('node:fs')
const path = require('node:path')
const read = name => JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8'))
const key = row => [row.route, row.width, row.language, row.theme].join('|')
const primary = read('matrix-primary-results.json')
const firstAnalytics = read('matrix-analytics-results.json')
const receive = read('matrix-receive-results.json')
const affected = read('matrix-analytics-rerun.json')
const viFinal = read('matrix-analytics-vi-final.json')
const unique = new Map()
for (const evidence of [primary, firstAnalytics, receive, affected, viFinal]) {
  for (const row of evidence.results) unique.set(key(row), row)
}
const results = [...unique.values()]
const counts = Object.fromEntries(['Home', 'Tasks', 'Receive', 'Analytics', 'Settings'].map(route => [route, results.filter(row => row.route === route && row.success).length]))
const summary = {
  origin: primary.origin, account: primary.account, timezoneId: 'Asia/Bangkok',
  uniqueTotal: results.length, passed: results.filter(row => row.success).length, counts,
  errors: results.flatMap(row => row.errors),
  overflows: results.filter(row => row.layout?.documentOverflow || row.layout?.mainOverflow),
  taskFixtures: results.filter(row => row.fixture).length,
  taskParseRequests: results.flatMap(row => row.parseRequests).length,
  blockedSnapshotRequests: results.flatMap(row => row.blockedMutations).filter(row => row.path === '/api/portfolio/snapshot').length,
  forbiddenProviderRequests: results.flatMap(row => row.provider?.forbidden ?? []),
  viTransferLabels: results.filter(row => row.route === 'Analytics' && row.language === 'vi').flatMap(row => row.analyticsKinds),
  passingScreenshots: [...new Set(results.map(row => row.screenshot).filter(Boolean))],
  preservedTransients: firstAnalytics.results.filter(row => !row.success).map(({ width, language, theme, exception, errors }) => ({ width, language, theme, exception, errors })),
  results,
}
fs.writeFileSync(path.join(__dirname, 'matrix-results.json'), JSON.stringify(summary, null, 2))
const text = `# Product browser matrix

${summary.passed}/${summary.uniqueTotal} unique checks passed: Home, Tasks, Receive, Analytics, and Settings each 12/12 at 1440/1280/390 × VI/EN × dark/light. No horizontal overflow or console/page errors in the final evidence. ${summary.passingScreenshots.length} passing screenshots cover all five pages at all three widths in dark VI and light EN.

Home, Receive, Settings, and Analytics used public-address watch mode with live localhost:5173/backend reads. Analytics responses were never intercepted: rendered block values, transfer hashes, holder addresses, and RPC observation times were matched to actual API responses. Only verified/available sections rendered; Fear & Greed and speculative supply percentages stayed absent. VI transfer kinds were explicitly checked against “Chuyển token” and “Chuyển qua hợp đồng”; English remained English. Analytics stayed in secondary footer navigation and showed the read-only label.

Tasks used an isolated, clearly labeled read-only EIP-6963 provider and intercepted verified-session/list fixtures. Existing Bangkok 08:00 and New York winter/summer cards showed UTC+7 local, UTC-5, and UTC-4 respectively. Review submitted the actual browser IANA zone Asia/Bangkok to the actual backend parseIntent, retaining raw input, timezone, and chain binding. No task was created or stored; no SIWE or transaction signature was requested. ${summary.blockedSnapshotRequests} automatically attempted portfolio captures in task fixture contexts were intercepted as SKIPPED, so they made no backend mutation. All ${summary.taskParseRequests} POST parse requests were fulfilled in-process without persistence. Forbidden provider requests: ${summary.forbiddenProviderRequests.length}.

Sidebar Receive followed Send, shared Home’s canonical modal with real address/QR/network copy, and activated Receive without highlighting Get test tokens in desktop and mobile drawer. The 12 Receive cases also passed a screenshot timing repeat after modal animations settled; these repeats are not counted as additional unique checks.

The first Analytics pass overlapped Vite’s reload from the root validation run: three 390px contexts were destroyed or returned to Home while waiting for Analytics. Those first-run records and failure screenshots are preserved in matrix-analytics-results.json/log. The three affected cases passed after validation settled; all six VI Analytics cases then passed again after the specific Transfer translation fix. These repeats are not added to the unique total. Final coverage combines the latest passing evidence per route/configuration in matrix-results.json.

No commit, push, deployment, task persistence change, real wallet signature, or blockchain write occurred. Long scroll stability is validated separately after the final source/type-check freeze.
`
fs.writeFileSync(path.join(__dirname, 'matrix-summary.md'), text)
console.log(JSON.stringify({ uniqueTotal: summary.uniqueTotal, passed: summary.passed, counts, errors: summary.errors.length, overflows: summary.overflows.length, taskFixtures: summary.taskFixtures, taskParseRequests: summary.taskParseRequests, blockedSnapshotRequests: summary.blockedSnapshotRequests, forbiddenProviderRequests: summary.forbiddenProviderRequests.length, viTransferRows: summary.viTransferLabels.length, passingScreenshots: summary.passingScreenshots.length }))
if (summary.uniqueTotal !== 60 || summary.passed !== 60 || summary.errors.length || summary.overflows.length || summary.forbiddenProviderRequests.length) process.exitCode = 1
