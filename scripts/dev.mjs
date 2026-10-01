import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const frontendDir = path.join(root, 'frontend')
const backendDir = path.join(root, 'backend')
const services = new Map()
let stopping = false
let healthTimer

function loadLocalEnv(directory) {
  const env = { ...process.env }
  const filename = path.join(directory, '.env')
  if (!existsSync(filename)) return env
  for (const line of readFileSync(filename, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator < 1) continue
    const key = trimmed.slice(0, separator)
    if (!env[key]) env[key] = trimmed.slice(separator + 1)
  }
  return env
}

function validateEnv(frontendEnv, backendEnv) {
  const missing = []
  for (const key of ['PORT', 'BACKEND_PORT']) if (!frontendEnv[key]) missing.push(`frontend ${key}`)
  if (frontendEnv.BASE_PATH === undefined) missing.push('frontend BASE_PATH')
  for (const key of ['BACKEND_PORT', 'SURF_API_KEY']) if (!backendEnv[key]) missing.push(`backend ${key}`)
  if (missing.length) throw new Error(`Missing required configuration: ${missing.join(', ')}`)
  if (frontendEnv.PORT !== '5173') throw new Error('Frontend PORT must be 5173 for local development.')
  if (frontendEnv.BACKEND_PORT !== '3001' || backendEnv.BACKEND_PORT !== '3001') {
    throw new Error('Frontend and backend BACKEND_PORT must both be 3001 for local development.')
  }
}

function checkPort(port, name) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', (error) => {
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
        reject(new Error(`${name} requires port ${port}, but it is unavailable. Stop the process using that port and retry.`))
      } else {
        reject(new Error(`Could not check ${name} port ${port}: ${error.code || error.message}`))
      }
    })
    probe.listen(port, '0.0.0.0', () => probe.close(resolve))
  })
}

function prefixOutput(stream, name, destination, secrets) {
  stream.setEncoding('utf8')
  let pending = ''
  const print = (line) => {
    let safe = line
    for (const secret of secrets) safe = safe.replaceAll(secret, '[redacted]')
    destination.write(`[${name}] ${safe}\n`)
  }
  stream.on('data', (chunk) => {
    pending += chunk
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() || ''
    for (const line of lines) print(line)
  })
  stream.on('end', () => { if (pending) print(pending) })
}

function startService(name, directory, args, env, secrets) {
  const child = spawn(process.execPath, args, {
    cwd: directory,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  services.set(name, child)
  prefixOutput(child.stdout, name, process.stdout, secrets)
  prefixOutput(child.stderr, name, process.stderr, secrets)
  child.on('error', (error) => {
    if (!stopping) fail(`${name} failed to start: ${error.code || error.message}`)
  })
  child.on('exit', (code, signal) => {
    if (!stopping) fail(`${name} exited (${signal || `code ${code}`}). Stopping the other service.`)
  })
  console.log(`[dev] ${name} started (PID ${child.pid}).`)
}

async function stop(code) {
  if (stopping) return
  stopping = true
  clearInterval(healthTimer)
  const children = [...services.values()]
  if (children.length) console.log('[dev] Stopping frontend and backend...')
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  await Promise.race([
    Promise.all(children.map((child) => new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve()
      child.once('exit', resolve)
    }))),
    new Promise((resolve) => setTimeout(resolve, 5000).unref()),
  ])
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  if (children.length) console.log('[dev] Both services stopped.')
  process.exitCode = code
}

function fail(message) {
  console.error(`[dev] ${message}`)
  void stop(1)
}

async function isHealthy(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) })
    return response.ok
  } catch {
    return false
  }
}

async function waitForReady() {
  const deadline = Date.now() + 60000
  while (!stopping && Date.now() < deadline) {
    const [frontend, backend] = await Promise.all([
      isHealthy('http://127.0.0.1:5173/'),
      isHealthy('http://127.0.0.1:3001/api/health'),
    ])
    if (frontend && backend) {
      console.log('[dev] Frontend and backend are ready.')
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  if (!stopping) fail('Startup timed out. Check the prefixed service logs above.')
  return false
}

function watchHealth() {
  const missed = { frontend: 0, backend: 0 }
  let checking = false
  healthTimer = setInterval(async () => {
    if (stopping || checking) return
    checking = true
    try {
      for (const [name, url] of [
        ['frontend', 'http://127.0.0.1:5173/'],
        ['backend', 'http://127.0.0.1:3001/api/health'],
      ]) {
        missed[name] = await isHealthy(url) ? 0 : missed[name] + 1
        if (missed[name] >= 3) {
          fail(`${name} stopped responding on its required port. Stopping the other service.`)
          return
        }
      }
    } finally {
      checking = false
    }
  }, 3000)
}

process.on('SIGINT', () => { void stop(0) })
process.on('SIGTERM', () => { void stop(0) })

try {
  const frontendEnv = loadLocalEnv(frontendDir)
  const backendEnv = loadLocalEnv(backendDir)
  validateEnv(frontendEnv, backendEnv)
  const secrets = [backendEnv.SURF_API_KEY, backendEnv.LLM_API_KEY, backendEnv.OPENAI_API_KEY].filter(Boolean)
  if (!existsSync(path.join(frontendDir, 'node_modules', 'vite', 'bin', 'vite.js'))) {
    throw new Error('Frontend dependencies are missing. Run npm install in frontend/.')
  }
  console.log('Makotowallet.xyz local development')
  console.log('Frontend: http://localhost:5173')
  console.log('Backend:  http://localhost:3001')
  await Promise.all([checkPort(3001, 'Backend'), checkPort(5173, 'Frontend')])
  startService('backend', backendDir, ['server.js'], backendEnv, secrets)
  startService('frontend', frontendDir, ['node_modules/vite/bin/vite.js', '--host', '0.0.0.0', '--port', '5173', '--strictPort'], frontendEnv, secrets)
  if (await waitForReady()) watchHealth()
} catch (error) {
  fail(error.message)
}
