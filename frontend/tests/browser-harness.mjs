import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'vite'

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function chromePath() {
  if (process.env.MAKOTO_CHROME_PATH) return process.env.MAKOTO_CHROME_PATH
  const candidates = process.platform === 'win32' ? [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  ] : process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ] : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  const found = candidates.find((candidate) => existsSync(candidate))
  if (found) return found
  for (const name of ['google-chrome', 'chromium', 'chromium-browser']) {
    const result = spawnSync('which', [name], { encoding: 'utf8' })
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim()
  }
  throw new Error('Chrome/Chromium is required for browser regressions. Set MAKOTO_CHROME_PATH to an existing executable.')
}

async function connectCdp(url) {
  const socket = new WebSocket(url)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let nextId = 0
  const pending = new Map()
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (!message.id) return
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    clearTimeout(request.timer)
    if (message.error) request.reject(new Error(JSON.stringify(message.error)))
    else request.resolve(message.result)
  })
  return {
    send(method, params = {}, sessionId) {
      const id = ++nextId
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timed out`)) }, 15_000)
        pending.set(id, { resolve, reject, timer })
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
      })
    },
    close() { socket.close() },
  }
}

// An isolated, extension-free browser and loopback-only fixture server. Fixtures
// supply explicit mocks; this helper never connects a user's wallet or browser.
export function createBrowserHarness({ frontendRoot, name, plugins, ready }) {
  let server, chrome, profile, cdp, origin
  return {
    async start() {
      const executable = chromePath()
      profile = await mkdtemp(path.join(os.tmpdir(), `makoto-${name}-mocked-`))
      server = await createServer({
        root: frontendRoot, configFile: false, appType: 'custom',
        cacheDir: path.join(profile, 'vite-cache'),
        optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-dev-runtime', 'lucide-react', 'viem', 'viem/chains', '@circle-fin/provider-cctp-v2', '@circle-fin/adapter-viem-v2/next'] },
        esbuild: { jsx: 'automatic' }, server: { host: '127.0.0.1', port: 0, hmr: false },
        plugins,
      })
      // Bind an OS-assigned port; never collide with the app or another fixture.
      await new Promise((resolve, reject) => {
        server.httpServer.once('error', reject)
        server.httpServer.listen(0, '127.0.0.1', resolve)
      })
      origin = `http://127.0.0.1:${server.httpServer.address().port}`
      chrome = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
      const websocket = await new Promise((resolve, reject) => {
        let output = ''
        const timer = setTimeout(() => reject(new Error(`Isolated Chrome did not start: ${output.slice(-1000)}`)), 15_000)
        chrome.once('error', (error) => { clearTimeout(timer); reject(error) })
        chrome.stderr.on('data', (data) => {
          output += data.toString()
          const match = output.match(/DevTools listening on (ws:\/\/\S+)/)
          if (match) { clearTimeout(timer); resolve(match[1]) }
        })
      })
      cdp = await connectCdp(websocket)
    },
    async close() {
      if (cdp) { await cdp.send('Browser.close').catch(() => {}); cdp.close() }
      chrome?.kill()
      await server?.close()
      if (profile) {
        assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()), 'Cleanup must remain in the test temporary directory')
        assert.ok(path.basename(profile).startsWith(`makoto-${name}-mocked-`))
        await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
      }
    },
    async fixture(route, params, run) {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
      const evaluate = async (expression) => {
        const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails))
        return result.result.value
      }
      const wait = async (expression, message) => {
        const expires = Date.now() + 10_000
        while (Date.now() < expires) {
          if (await evaluate(`Boolean(${expression})`)) return
          await delay(30)
        }
        throw new Error(`${message}: ${await evaluate('document.body.innerText')}`)
      }
      const click = (name) => evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(name)}); if (!b || b.disabled) throw new Error('Button missing or disabled: ' + ${JSON.stringify(name)}); b.click(); })()`)
      const fill = (index, value) => evaluate(`(() => { const input = [...document.querySelectorAll('input')].filter((i) => i.type !== 'checkbox')[${index}]; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', {bubbles: true})); })()`)
      try {
        await cdp.send('Page.enable', {}, sessionId)
        await cdp.send('Page.navigate', { url: `${origin}/${route}?${new URLSearchParams(params)}` }, sessionId)
        await wait(ready, 'Actual production component must mount')
        await run({ evaluate, wait, click, fill })
      } finally { await cdp.send('Target.closeTarget', { targetId }) }
    },
  }
}
