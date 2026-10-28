const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const { generateAgentResponse, SYSTEM_INSTRUCTION, MAX_TOOL_ROUNDS, safeMemory } = require('../lib/llm')
const { toolDefinitions, runTool, validateProposal, seriesSummary, downsample } = require('../lib/agentTools')

const env = { LLM_API_KEY: 'test-key', LLM_MODEL: 'test-model', LLM_BASE_URL: 'https://llm.test/v1' }
const ADDRESS = '0x1111111111111111111111111111111111111111'
const call = (name, args, id = `call_${name}`) => ({ type: 'function_call', id: `fc_${id}`, call_id: id, name, arguments: JSON.stringify(args) })

test('tool definitions are strict read-only functions plus a non-executing proposal', () => {
  const tools = toolDefinitions()
  const names = tools.map((tool) => tool.name)
  assert.deepEqual(names.sort(), ['get_arc_network', 'get_bridge_fees', 'get_crypto_news', 'get_technical_analysis', 'get_derivatives_data', 'get_defi_data', 'get_wallet_pnl', 'get_daily_briefing', 'propose_task', 'get_market_overview', 'get_project_info', 'get_token_market_data', 'get_token_prices', 'get_wallet_overview', 'propose_action', 'propose_plan', 'remember_note', 'save_contact', 'explain_transaction', 'inspect_address'].sort())
  for (const tool of tools) {
    assert.equal(tool.type, 'function')
    assert.equal(tool.strict, true)
    assert.equal(tool.parameters.additionalProperties, false)
    assert.deepEqual([...tool.parameters.required].sort(), Object.keys(tool.parameters.properties).sort(), `${tool.name} must require every property for strict mode`)
  }
  assert.doesNotMatch(names.join(','), /sign|execute|submit|send_transaction/i)
  assert.match(SYSTEM_INSTRUCTION, /never claim to sign/i)
  assert.match(SYSTEM_INSTRUCTION, /Policy\/Risk authority/i)
})

test('proposal validation enforces exact amounts, full recipients and supported routes', () => {
  assert.deepEqual(validateProposal({ kind: 'send', asset: 'USDC', amount: '5', recipient: ADDRESS, output_asset: null }), { ok: true, value: { kind: 'send', asset: 'USDC', amount: '5', recipient: ADDRESS } })
  assert.deepEqual(validateProposal({ kind: 'send', asset: 'USDC', amount: '5', recipient: null, recipient_contact: ' Lan ' }), { ok: true, value: { kind: 'send', asset: 'USDC', amount: '5', recipientContact: 'Lan' } })
  assert.deepEqual(validateProposal({ kind: 'swap', asset: 'USDC', amount: '7.5', recipient: null, output_asset: 'EURC' }), { ok: true, value: { kind: 'swap', asset: 'USDC', amount: '7.5', outputAsset: 'EURC' } })
  assert.deepEqual(validateProposal({ kind: 'bridge', asset: 'USDC', amount: '25', recipient: null, output_asset: null }), { ok: true, value: { kind: 'bridge', asset: 'USDC', amount: '25', destination: 'Base Sepolia' } })
  for (const bad of [
    { kind: 'send', asset: 'USDC', amount: 'MAX', recipient: ADDRESS },
    { kind: 'send', asset: 'USDC', amount: '0', recipient: ADDRESS },
    { kind: 'send', asset: 'USDC', amount: '-1', recipient: ADDRESS },
    { kind: 'send', asset: 'USDC', amount: '5', recipient: '0x1234' },
    { kind: 'send', asset: 'DOGE', amount: '5', recipient: ADDRESS },
    { kind: 'swap', asset: 'cirBTC', amount: '1', output_asset: 'USDC' },
    { kind: 'swap', asset: 'USDC', amount: '1', output_asset: 'USDC' },
    { kind: 'bridge', asset: 'EURC', amount: '1' },
    { kind: 'approve', asset: 'USDC', amount: '1' },
  ]) assert.equal(validateProposal(bad).ok, false, JSON.stringify(bad))
})

test('tool runner rejects unknown tools and malformed arguments without throwing', async () => {
  const unknown = await runTool('sign_transaction', '{}', {})
  assert.equal(unknown.ok, false)
  assert.match(unknown.output, /Unknown tool/)
  const malformed = await runTool('get_token_market_data', '{not json', {})
  assert.equal(malformed.ok, false)
  assert.match(malformed.output, /Invalid tool arguments/)
  const invalidSymbol = await runTool('get_token_market_data', JSON.stringify({ symbol: 'BTC; DROP', time_range: '7d' }), {})
  assert.equal(invalidSymbol.ok, false)
  assert.match(invalidSymbol.output, /Invalid symbol/)
  const noWallet = await runTool('get_wallet_overview', JSON.stringify({ address: null }), {})
  assert.match(noWallet.output, /No wallet address/)
})

test('price series summaries are computed server-side from real points only', () => {
  assert.equal(seriesSummary([]), null)
  const summary = seriesSummary([{ timestamp: 2, value: 110 }, { timestamp: 1, value: 100 }, { timestamp: 3, value: 90 }])
  assert.equal(summary.first, 100)
  assert.equal(summary.last, 90)
  assert.equal(summary.change_pct, -10)
  assert.equal(summary.high, 110)
  assert.equal(summary.low, 90)
})

test('the model can call tools; outputs are fed back and sources/proposal are returned', async () => {
  const bodies = []
  let toolCtx
  const result = await generateAgentResponse({ message: 'bridge 25 usdc to base', locale: 'vi', address: ADDRESS, mode: 'connected' }, {
    env,
    fetcher: async (_url, options) => {
      const body = JSON.parse(options.body)
      bodies.push(body)
      if (bodies.length === 1) return Response.json({ output: [call('get_bridge_fees', {}), call('propose_action', { kind: 'bridge', asset: 'USDC', amount: '25', recipient: null, output_asset: null })] })
      return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Thẻ xem lại đã sẵn sàng.' }] }] })
    },
    runTool: async (name, args, ctx) => {
      toolCtx = ctx
      if (name === 'propose_action') return runTool(name, args, ctx)
      return { ok: true, source: 'Circle CCTP v2', output: JSON.stringify({ status: 'OK', fast: { minimumFeeBps: 1 } }) }
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.text, 'Thẻ xem lại đã sẵn sàng.')
  assert.deepEqual(result.proposal, { kind: 'bridge', asset: 'USDC', amount: '25', destination: 'Base Sepolia' })
  assert.deepEqual(result.sources.map((item) => item.source).sort(), ['Circle CCTP v2', 'Makoto planner'])
  assert.equal(toolCtx.address, ADDRESS)
  assert.equal(bodies.length, 2)
  assert.ok(Array.isArray(bodies[0].tools) && bodies[0].tools.length > 0)
  assert.match(bodies[0].input.at(-1).content, /Respond in Vietnamese/)
  // Wallet address is only given to tools, never to the model input.
  assert.doesNotMatch(JSON.stringify(bodies), new RegExp(ADDRESS, 'i'))
  const outputs = bodies[1].input.filter((item) => item.type === 'function_call_output')
  assert.deepEqual(outputs.map((item) => item.call_id).sort(), ['call_get_bridge_fees', 'call_propose_action'])
  assert.ok(bodies[1].input.some((item) => item.type === 'function_call' && item.name === 'propose_action'))
})

test('tool rounds are bounded and the last round forbids further tool calls', async () => {
  const bodies = []
  const result = await generateAgentResponse({ message: 'loop forever' }, {
    env,
    fetcher: async (_url, options) => {
      const body = JSON.parse(options.body)
      bodies.push(body)
      if (body.tool_choice === 'none') return Response.json({ output_text: 'Final answer without more tools.' })
      return Response.json({ output: [call('get_token_prices', {}, `c${bodies.length}`)] })
    },
    runTool: async () => ({ ok: true, source: 'CoinGecko', output: '{"status":"OK"}' }),
  })
  assert.equal(result.ok, true)
  assert.equal(result.text, 'Final answer without more tools.')
  assert.equal(bodies.length, MAX_TOOL_ROUNDS + 1)
  assert.equal(bodies.at(-1).tool_choice, 'none')
})

test('a rejected proposal is reported to the model and not returned to the UI', async () => {
  let second
  const result = await generateAgentResponse({ message: 'send everything' }, {
    env,
    fetcher: async (_url, options) => {
      const body = JSON.parse(options.body)
      if (!second && body.input.some((item) => item.type === 'function_call_output')) second = body
      return second ? Response.json({ output_text: 'Please give an exact amount.' }) : Response.json({ output: [call('propose_action', { kind: 'send', asset: 'USDC', amount: 'MAX', recipient: ADDRESS, output_asset: null })] })
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.proposal, undefined)
  assert.match(second.input.find((item) => item.type === 'function_call_output').output, /REJECTED/)
})

test('agent route accepts all UI languages, validates address and returns proposal + sources', async () => {
  const previous = global.fetch
  const app = express()
  app.use(express.json())
  app.use('/api/agent', require('../routes/agent'))
  const server = await new Promise((resolve) => { const value = app.listen(0, '127.0.0.1', () => resolve(value)) })
  const base = `http://127.0.0.1:${server.address().port}`
  const saved = { ...process.env }
  Object.assign(process.env, env)
  let calls = 0
  global.fetch = async (url, options) => {
    if (!String(url).startsWith('https://llm.test')) return previous(url, options)
    calls += 1
    const body = JSON.parse(options.body)
    if (!body.input.some((item) => item.type === 'function_call_output')) return Response.json({ output: [call('propose_action', { kind: 'swap', asset: 'USDC', amount: '3', recipient: null, output_asset: 'EURC' })] })
    return Response.json({ output_text: 'Đã chuẩn bị thẻ xem lại.' })
  }
  try {
    const post = (payload) => previous(`${base}/api/agent/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    for (const locale of ['ja', 'ko', 'zh', 'de']) assert.equal((await post({ message: 'hi', locale })).status, 400, locale)
    assert.equal((await post({ message: 'hi', memory: [] })).status, 400)
    assert.equal((await post({ message: 'hi', address: '0xnot-an-address' })).status, 400)
    const response = await post({ message: 'đổi 3 USDC sang EURC', locale: 'vi', address: ADDRESS, context: { mode: 'connected' } })
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.text, 'Đã chuẩn bị thẻ xem lại.')
    assert.equal(payload.source, 'REAL_PROVIDER')
    assert.deepEqual(payload.proposal, { kind: 'swap', asset: 'USDC', amount: '3', outputAsset: 'EURC' })
    assert.deepEqual(payload.sources.map((item) => item.source), ['Makoto planner'])
    assert.ok(calls >= 2)
  } finally {
    global.fetch = previous
    for (const key of Object.keys(env)) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key] }
    await new Promise((resolve) => server.close(resolve))
  }
})


test('plans, memory notes and contact offers are validated tool outputs', async () => {
  const ctx = { memory: [], charts: [] }
  const plan = JSON.parse((await runTool('propose_plan', JSON.stringify({ steps: [
    { kind: 'swap', asset: 'USDC', amount: '10', recipient: null, recipient_contact: null, output_asset: 'EURC' },
    { kind: 'send', asset: 'EURC', amount: '5', recipient: null, recipient_contact: 'Nam', output_asset: null },
  ] }), ctx)).output)
  assert.equal(plan.status, 'PLAN_PROPOSED_FOR_USER_REVIEW')
  assert.deepEqual(ctx.plan, [{ kind: 'swap', asset: 'USDC', amount: '10', outputAsset: 'EURC' }, { kind: 'send', asset: 'EURC', amount: '5', recipientContact: 'Nam' }])
  const single = JSON.parse((await runTool('propose_action', JSON.stringify({ kind: 'bridge', asset: 'USDC', amount: '1', recipient: null, recipient_contact: null, output_asset: null }), ctx)).output)
  assert.equal(single.status, 'REJECTED', 'one reply carries either a plan or a single action')
  const tooLong = { memory: [], charts: [] }
  assert.match((await runTool('propose_plan', JSON.stringify({ steps: [1, 2, 3, 4].map(() => ({ kind: 'bridge', asset: 'USDC', amount: '1', recipient: null, recipient_contact: null, output_asset: null })) }), tooLong)).output, /2 or 3 steps/)
  assert.match((await runTool('propose_plan', JSON.stringify({ steps: [{ kind: 'bridge', asset: 'USDC', amount: 'MAX', recipient: null, recipient_contact: null, output_asset: null }, { kind: 'bridge', asset: 'USDC', amount: '1', recipient: null, recipient_contact: null, output_asset: null }] }), tooLong)).output, /Step 1/)

  const mem = { memory: [], charts: [] }
  assert.match((await runTool('remember_note', JSON.stringify({ note: 'I prefer standard bridge speed' }), mem)).output, /SAVED_ON_DEVICE/)
  assert.match((await runTool('remember_note', JSON.stringify({ note: `my wallet is ${ADDRESS}` }), mem)).output, /REJECTED/)
  assert.match((await runTool('remember_note', JSON.stringify({ note: 'my seed phrase is apple' }), mem)).output, /REJECTED/)
  assert.match((await runTool('save_contact', JSON.stringify({ name: 'Minh', address: ADDRESS }), mem)).output, /AWAITING_USER_CONFIRMATION/)
  assert.match((await runTool('save_contact', JSON.stringify({ name: 'Bad', address: '0x12' }), mem)).output, /REJECTED/)
  assert.deepEqual(mem.memory, [{ type: 'note', note: 'I prefer standard bridge speed' }, { type: 'contact', name: 'Minh', address: ADDRESS }])
})

test('memory sent to the model never contains addresses; charts are downsampled server-side', () => {
  assert.deepEqual(safeMemory({ notes: ['short answers', `send to ${ADDRESS}`], contacts: ['Nam', 'Nam', '0x1111111111'], preferences: { bridgeSpeed: 'SLOW', other: 1 } }), { notes: ['short answers'], contacts: ['Nam'], preferences: { bridgeSpeed: 'SLOW' } })
  assert.equal(safeMemory({ notes: [], contacts: [] }), undefined)
  const series = Array.from({ length: 200 }, (_, i) => ({ timestamp: 1000 + i, value: i }))
  const points = downsample(series, 60)
  assert.equal(points.length, 60)
  assert.deepEqual(points[0], [1000, 0])
  assert.deepEqual(points.at(-1), [1199, 199])
})

test('streaming endpoint emits status, deltas and an authoritative done event', async () => {
  const previous = global.fetch
  const app = express()
  app.use(express.json())
  app.use('/api/agent', require('../routes/agent'))
  const server = await new Promise((resolve) => { const value = app.listen(0, '127.0.0.1', () => resolve(value)) })
  const base = `http://127.0.0.1:${server.address().port}`
  const saved = { ...process.env }
  Object.assign(process.env, env)
  const sse = (events) => new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
  let round = 0
  global.fetch = async (url, options) => {
    if (!String(url).startsWith('https://llm.test')) return previous(url, options)
    const body = JSON.parse(options.body)
    assert.equal(body.stream, true)
    round += 1
    if (round === 1) return sse([{ type: 'response.completed', response: { output: [call('remember_note', { note: 'short answers please' })] } }])
    return sse([
      { type: 'response.output_text.delta', delta: 'Xin ' },
      { type: 'response.output_text.delta', delta: 'chào!' },
      { type: 'response.completed', response: { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Xin chào!' }] }] } },
    ])
  }
  try {
    const response = await previous(`${base}/api/agent/chat/stream`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'nhớ là mình thích trả lời ngắn', locale: 'vi', memory: { notes: ['x'], contacts: ['Nam'] } }) })
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /text\/event-stream/)
    const text = await response.text()
    const events = text.split('\n\n').filter((block) => block.startsWith('event:')).map((block) => ({ event: block.split('\n')[0].slice(7), data: JSON.parse(block.split('\n')[1].slice(6)) }))
    assert.deepEqual(events.map((item) => item.event), ['status', 'delta', 'delta', 'done'])
    assert.deepEqual(events[0].data, { tool: 'remember_note', source: 'Makoto memory' })
    assert.equal(events.filter((item) => item.event === 'delta').map((item) => item.data.text).join(''), 'Xin chào!')
    assert.equal(events.at(-1).data.text, 'Xin chào!')
    assert.deepEqual(events.at(-1).data.memory, [{ type: 'note', note: 'short answers please' }])
    const invalid = await previous(`${base}/api/agent/chat/stream`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'hi', locale: 'ko' }) })
    assert.equal(invalid.status, 400)
  } finally {
    global.fetch = previous
    for (const key of Object.keys(env)) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key] }
    await new Promise((resolve) => server.close(resolve))
  }
})

test('followup marker is stripped from answers; tx/address tools validate input', async () => {
  const { splitFollowups } = require('../lib/llm')
  assert.deepEqual(splitFollowups('Answer.\n[[followups: A one? | B two? | C three?]]'), { text: 'Answer.\n', followups: ['A one?', 'B two?', 'C three?'] })
  assert.deepEqual(splitFollowups('Plain answer').followups, [])
  assert.match((await runTool('explain_transaction', JSON.stringify({ hash: '0x123' }), {})).output, /Invalid transaction hash/)
  assert.match((await runTool('inspect_address', JSON.stringify({ address: '0x12' }), {})).output, /Invalid address/)
})

test('price alerts parse VI/EN thresholds and stay notify-only', () => {
  const { parseIntent } = require('../lib/taskDefinitions')
  const base = { mode: 'monitor', account: ADDRESS, chainId: 5042002, timezone: 'Asia/Ho_Chi_Minh', locale: 'vi' }
  const cond = (text) => parseIntent({ ...base, text }).candidate?.condition
  assert.deepEqual(cond('báo khi giá BTC dưới 75.000'), { metric: 'TOKEN_PRICE', asset: 'BTC', operator: 'LT', threshold: '75000', checkIntervalMinutes: 5 })
  assert.equal(cond('alert me when ETH price goes above $3,000').threshold, '3000')
  assert.equal(cond('báo khi giá USDC dưới 0.995').threshold, '0.995')
  assert.equal(cond('báo khi giá EURC trên 1.005').threshold, '1.005')
  assert.equal(cond('báo khi giá SOL vượt 200k').threshold, '200000')
  assert.equal(cond('Báo tôi khi số dư USDC dưới 10').metric, 'TOKEN_BALANCE')
  assert.deepEqual(parseIntent({ ...base, text: 'báo khi giá BTC' }).missingFields, ['operator', 'threshold'])
  assert.equal(parseIntent({ ...base, text: 'báo khi giá BTC dưới 75000' }).candidate.authority, 'NOTIFY_ONLY')
})
