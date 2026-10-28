// Run the Agent quality check now: `npm run eval:agent` (uses the configured LLM key).
const fs = require('node:fs')
const path = require('node:path')
const envPath = path.join(__dirname, '..', '.env')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const eq = line.indexOf('=')
    if (eq > 0 && !line.trim().startsWith('#') && !process.env[line.slice(0, eq).trim()]) process.env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
}
require('../lib/agentEval').getAgentEval().run().then((run) => {
  for (const item of run.cases) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.label.padEnd(24)} ${String(item.ms).padStart(6)} ms  ${item.reason || ''}`)
  console.log(`\nScore ${run.score}% (${run.passed}/${run.total}) · ${run.status}`)
  process.exit(run.status === 'FAIL' ? 1 : 0)
}).catch((error) => { console.error(error?.message || error); process.exit(1) })
