const path = require('node:path')
const os = require('node:os')

// This fixture runs the production singleton in a separate process. Refuse to
// import it until an explicit isolated database and shared secret are supplied.
const dbPath = process.env.TASK_AUTH_DB_PATH
const secret = process.env.TASK_SESSION_SECRET
if (!process.send || !dbPath || !path.isAbsolute(dbPath) ||
    path.dirname(path.dirname(dbPath)) !== path.resolve(os.tmpdir()) ||
    !path.basename(path.dirname(dbPath)).startsWith('makoto-auth-process-') ||
    !secret || Buffer.byteLength(secret) < 32 ||
    process.env.PUBLIC_APP_ORIGIN !== 'http://localhost:5173') {
  throw new Error('Auth worker requires an isolated temporary database and explicit auth configuration')
}
delete process.env.NODE_TEST_CONTEXT

const express = require('express')
const { getTaskAuth } = require('../lib/taskAuth')
const { createAuthRouter } = require('../routes/auth')
const auth = getTaskAuth()
let server
let stopping

function stop() {
  if (stopping) return stopping
  stopping = (async () => {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await auth.close()
    if (process.connected) process.disconnect()
  })()
  return stopping
}

function fail(error) {
  console.error(error)
  process.exitCode = 1
  stop().catch((closeError) => {
    console.error(closeError)
    process.exitCode = 1
    if (process.connected) process.disconnect()
  })
}

process.on('message', (message) => {
  if (message?.type === 'stop') stop().catch(fail)
})
process.on('disconnect', () => stop().catch(fail))
process.on('SIGTERM', () => stop().catch(fail))

;(async () => {
  await auth.ready
  const app = express()
  app.use(express.json())
  app.use('/api/auth', createAuthRouter(auth))
  server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
    listening.once('error', reject)
  })
  process.send({ type: 'ready', pid: process.pid, dbPath, url: `http://127.0.0.1:${server.address().port}/api/auth` })
})().catch(fail)
