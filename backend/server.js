const fs = require('node:fs')
const path = require('node:path')

// Keep direct `node server.js` starts on the same server-only configuration as npm run dev.
const envPath = path.join(__dirname, '.env')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq)
    if (!process.env[key]) process.env[key] = trimmed.slice(eq + 1)
  }
}

const { createServer } = require('@surf-ai/sdk/server')
const { getTaskEngine } = require('./lib/taskEngine')
const { getTaskAuth } = require('./lib/taskAuth')

async function main() {
  const auth = getTaskAuth()
  await auth.ready
  const server = createServer()
  if (process.env.TASK_TRUST_PROXY_HOPS) {
    const hops = Number(process.env.TASK_TRUST_PROXY_HOPS)
    if (!Number.isSafeInteger(hops) || hops < 0 || hops > 3) throw new Error('TASK_TRUST_PROXY_HOPS must be an integer from 0 to 3')
    server.app.set('trust proxy', hops)
  }
  await server.start()
  await getTaskEngine().start()
}

main().catch((error) => {
  console.error('Backend startup failed:', error?.message || 'unknown error')
  process.exit(1)
})
