const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const express = require('express')
const { Wallet } = require('ethers')
const { TaskEngine } = require('../lib/taskEngine')
const { createTaskAuth } = require('../lib/taskAuth')
const { createAuthRouter } = require('../routes/auth')
const { createTaskRouter } = require('../routes/tasks')

// Public, deterministic fixture keys only. No wallet extension or blockchain write is used.
const walletA = new Wallet(`0x${'0'.repeat(63)}1`)
const walletB = new Wallet(`0x${'0'.repeat(63)}2`)
const chainId = 5042002
const taskInput = (asset) => ({
  type: 'CONDITION_MONITOR',
  chainId,
  timezone: 'UTC',
  locale: 'en',
  createdBy: 'USER',
  condition: { metric: 'TOKEN_BALANCE', asset, operator: 'LT', threshold: '500', checkIntervalMinutes: 2 },
})

async function harness() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'makoto-ownership-'))
  const app = express()
  app.use(express.json())
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener))
  })
  const origin = `http://127.0.0.1:${server.address().port}`
  const auth = createTaskAuth({
    dbPath: path.join(directory, 'sessions.sqlite'),
    publicOrigin: origin,
    sessionSecret: 'test-only-makoto-ownership-session-secret-2026',
  })
  await auth.ready
  const engine = new TaskEngine({
    dbPath: ':memory:',
    generateSummary: async () => ({ ok: false }),
    reads: {
      verifyChain: async () => {},
      readBalance: async (_account, asset) => ({ asset, amount: '100', units: '100000000', source: 'fixture', observedAt: new Date().toISOString() }),
    },
  })
  app.use('/api/auth', createAuthRouter(auth))
  app.use('/api/tasks', createTaskRouter(engine, auth))

  async function request(pathname, { method = 'GET', body, cookie, originHeader = origin, customHeader = '1' } = {}) {
    const headers = {}
    if (cookie) headers.cookie = cookie
    if (method !== 'GET') {
      if (originHeader !== null) headers.origin = originHeader
      if (customHeader !== null) headers['X-Makoto-Request'] = customHeader
    }
    if (body !== undefined) headers['content-type'] = 'application/json'
    const response = await fetch(`${origin}${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = response.status === 204 ? null : await response.json()
    const setCookie = response.headers.get('set-cookie')
    return { status: response.status, data, cookie: setCookie ? setCookie.split(';')[0] : null }
  }

  async function signIn(wallet) {
    const challenge = await request('/api/auth/nonce', { method: 'POST', body: { address: wallet.address, chainId } })
    assert.equal(challenge.status, 200)
    assert.equal(typeof challenge.data.message, 'string')
    assert.ok(challenge.cookie)
    const signature = await wallet.signMessage(challenge.data.message)
    const verified = await request('/api/auth/verify', {
      method: 'POST', cookie: challenge.cookie, body: { message: challenge.data.message, signature },
    })
    assert.equal(verified.status, 200)
    assert.equal(verified.data.authenticated, true)
    assert.equal(verified.data.address, wallet.address.toLowerCase())
    assert.ok(verified.cookie)
    assert.notEqual(verified.cookie, challenge.cookie)
    return verified.cookie
  }

  async function close() {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await engine.close()
    await auth.close()
    const absoluteDirectory = path.resolve(directory)
    const absoluteTemp = path.resolve(os.tmpdir())
    if (path.dirname(absoluteDirectory) !== absoluteTemp || !path.basename(absoluteDirectory).startsWith('makoto-ownership-')) {
      throw new Error('Unexpected ownership test directory')
    }
    fs.rmSync(absoluteDirectory, { recursive: true, force: true })
  }
  return { request, signIn, close }
}

test('SIWE wallet sessions strictly scope every task API and block IDOR', async () => {
  const { request, signIn, close } = await harness()
  try {
    const cookieA = await signIn(walletA)
    const cookieB = await signIn(walletB)
    for (const [pathname, method] of [
      ['/api/tasks', 'GET'], ['/api/tasks/parse', 'POST'], ['/api/tasks/notifications', 'GET'],
      ['/api/tasks/missing', 'GET'], ['/api/tasks/missing/runs', 'GET'],
      ['/api/tasks/missing', 'PATCH'], ['/api/tasks/missing', 'DELETE'], ['/api/tasks/missing/run', 'POST'],
    ]) {
      const response = await request(pathname, { method, body: method === 'POST' ? {} : undefined })
      assert.equal(response.status, 401, `${method} ${pathname} needs a session`)
    }

    assert.equal((await request('/api/tasks', { cookie: cookieA })).data.tasks.length, 0)
    const createdA = await request('/api/tasks', { method: 'POST', cookie: cookieA, body: taskInput('USDC') })
    const createdB = await request('/api/tasks', { method: 'POST', cookie: cookieB, body: taskInput('EURC') })
    assert.equal(createdA.status, 201)
    assert.equal(createdB.status, 201)
    const taskA = createdA.data.task
    const taskB = createdB.data.task
    assert.equal(taskA.account, walletA.address.toLowerCase())
    assert.equal(taskA.ownerAddress, walletA.address.toLowerCase())
    assert.equal(taskB.account, walletB.address.toLowerCase())
    assert.equal(taskB.ownerAddress, walletB.address.toLowerCase())

    for (const [cookie, own, foreign] of [[cookieA, taskA, taskB], [cookieB, taskB, taskA]]) {
      const listing = await request('/api/tasks', { cookie })
      assert.equal(listing.status, 200)
      assert.deepEqual(listing.data.tasks.map((task) => task.id), [own.id])
      assert.equal((await request(`/api/tasks/${own.id}`, { cookie })).status, 200)
      for (const [method, suffix, body] of [
        ['GET', '', undefined],
        ['GET', '/runs', undefined],
        ['PATCH', '', { condition: { threshold: '600' } }],
        ['PATCH', '', { status: 'PAUSED' }],
        ['PATCH', '', { status: 'ACTIVE' }],
        ['POST', '/run', undefined],
        ['DELETE', '', undefined],
      ]) {
        const response = await request(`/api/tasks/${foreign.id}${suffix}`, { method, cookie, body })
        assert.equal(response.status, 404, `${method} ${suffix || '/'} must not expose a foreign task`)
        assert.equal(response.data.code, 'TASK_NOT_FOUND')
      }
    }

    const mismatchCreate = await request('/api/tasks', { method: 'POST', cookie: cookieA, body: { ...taskInput('cirBTC'), account: walletB.address } })
    assert.equal(mismatchCreate.status, 403)
    assert.equal(mismatchCreate.data.code, 'TASK_FORBIDDEN')
    const mismatchOwnerField = await request('/api/tasks', { method: 'POST', cookie: cookieA, body: { ...taskInput('cirBTC'), ownerAddress: walletB.address } })
    assert.equal(mismatchOwnerField.status, 403)
    assert.equal(mismatchOwnerField.data.code, 'TASK_FORBIDDEN')
    const mismatchWalletField = await request('/api/tasks', { method: 'POST', cookie: cookieA, body: { ...taskInput('cirBTC'), walletAddress: walletB.address } })
    assert.equal(mismatchWalletField.status, 403)
    assert.equal(mismatchWalletField.data.code, 'TASK_FORBIDDEN')
    for (const field of ['account', 'ownerAddress', 'walletAddress']) {
      const response = await request(`/api/tasks/${taskA.id}`, { method: 'PATCH', cookie: cookieA, body: { [field]: walletB.address } })
      assert.equal(response.status, 400, `${field} cannot change task ownership`)
      assert.equal(response.data.code, 'TASK_INVALID')
    }
    assert.equal((await request(`/api/tasks/${taskA.id}`, { cookie: cookieA })).data.task.ownerAddress, walletA.address.toLowerCase())
    const mismatchParse = await request('/api/tasks/parse', {
      method: 'POST', cookie: cookieA,
      body: { text: 'Alert me when USDC below 500', mode: 'monitor', chainId, timezone: 'UTC', locale: 'en', walletAddress: walletB.address },
    })
    assert.equal(mismatchParse.status, 403)
    assert.equal(mismatchParse.data.code, 'TASK_FORBIDDEN')
    const parsed = await request('/api/tasks/parse', {
      method: 'POST', cookie: cookieA,
      body: { text: 'Alert me when USDC below 500', mode: 'monitor', chainId, timezone: 'UTC', locale: 'en' },
    })
    assert.equal(parsed.status, 200)
    assert.equal(parsed.data.candidate.account, walletA.address.toLowerCase())

    const missingHeader = await request('/api/tasks/parse', { method: 'POST', cookie: cookieA, body: {}, customHeader: null })
    assert.equal(missingHeader.status, 403)
    const foreignOrigin = await request('/api/tasks/parse', { method: 'POST', cookie: cookieA, body: {}, originHeader: 'https://example.invalid' })
    assert.equal(foreignOrigin.status, 403)

    assert.equal((await request(`/api/tasks/${taskA.id}`, { method: 'PATCH', cookie: cookieA, body: { status: 'PAUSED' } })).data.task.status, 'PAUSED')
    assert.equal((await request(`/api/tasks/${taskA.id}`, { method: 'PATCH', cookie: cookieA, body: { status: 'ACTIVE' } })).data.task.status, 'ACTIVE')
    assert.equal((await request(`/api/tasks/${taskA.id}`, { method: 'PATCH', cookie: cookieA, body: { condition: { threshold: '600' } } })).data.task.condition.threshold, '600')
    const runA = await request(`/api/tasks/${taskA.id}/run`, { method: 'POST', cookie: cookieA })
    assert.equal(runA.status, 200)
    assert.equal(runA.data.run.status, 'SUCCESS')
    assert.equal((await request(`/api/tasks/${taskA.id}/runs`, { cookie: cookieA })).data.runs.length, 1)
    assert.equal((await request('/api/tasks/notifications', { cookie: cookieA })).data.notifications.length, 1)
    assert.equal((await request('/api/tasks/notifications', { cookie: cookieB })).data.notifications.length, 0)
    assert.equal((await request('/api/auth/session', { cookie: cookieA })).data.address, walletA.address.toLowerCase())

    const logoutA = await request('/api/auth/logout', { method: 'POST', cookie: cookieA })
    assert.equal(logoutA.status, 200)
    assert.equal((await request('/api/tasks', { cookie: cookieA })).status, 401)
    assert.deepEqual((await request('/api/tasks', { cookie: cookieB })).data.tasks.map((task) => task.id), [taskB.id])
    assert.equal((await request(`/api/tasks/${taskB.id}`, { method: 'DELETE', cookie: cookieB })).status, 204)
    assert.equal((await request('/api/tasks', { cookie: cookieB })).data.tasks.length, 0)
  } finally { await close() }
})

test('task create and run-now share the bounded mutation rate limit', async () => {
  const { request, signIn, close } = await harness()
  try {
    const cookie = await signIn(walletA)
    for (let attempt = 0; attempt < 119; attempt++) {
      const response = await request('/api/tasks/missing/run', { method: 'POST', cookie })
      assert.equal(response.status, 404)
    }
    const created = await request('/api/tasks', { method: 'POST', cookie, body: taskInput('USDC') })
    assert.equal(created.status, 201)
    const throttled = await request(`/api/tasks/${created.data.task.id}/run`, { method: 'POST', cookie })
    assert.equal(throttled.status, 429)
    assert.equal(throttled.data.code, 'TASK_RATE_LIMITED')
    assert.equal((await request(`/api/tasks/${created.data.task.id}/runs`, { cookie })).data.runs.length, 0)
  } finally { await close() }
})
