const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const { generateAgentResponse, SYSTEM_INSTRUCTION, MAX_TOOL_ROUNDS } = require('../lib/llm')
const { toolDefinitions, runTool, validateProposal, seriesSummary } = require('../lib/agentTools')

const env = { LLM_API_KEY: 'test-key', LLM_MODEL: 'test-model', LLM_BASE_URL: 'https://llm.test/v1' }
const ADDRESS = '0x1111111111111111111111111111111111111111'
const call = (name, args, id = `call_${name}`) => ({ type: 'function_call', id: `fc_${id}`, call_id: id, name, arguments: JSON.stringify(args) })

test('tool definitions are strict read-only functions plus a non-executing proposal', () => {
  const tools = toolDefinitions()
  const names = tools.map((tool) => tool.name)
  assert.deepEqual(names.sort(), ['get_arc_network', 'get_bridge_fees', 'get_crypto_news', 'get_market_overview', 'get_project_info', 'get_token_market_data', 'get_token_prices', 'get_wallet_overview', 'propose_action'].sort())
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
  const result = await generateAgentResponse({ message: 'bridge 25 usdc to base', locale: 'ja', address: ADDRESS, mode: 'connected' }, {
    env,
    fetcher: async (_url, options) => {
      const body = JSON.parse(options.body)
      bodies.push(body)
      if (bodies.length === 1) return Response.json({ output: [call('get_bridge_fees', {}), call('propose_action', { kind: 'bridge', asset: 'USDC', amount: '25', recipient: null, output_asset: null })] })
      return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'レビューカードを用意しました。' }] }] })
    },
    runTool: async (name, args, ctx) => {
      toolCtx = ctx
      if (name === 'propose_action') return runTool(name, args, ctx)
      return { ok: true, source: 'Circle CCTP v2', output: JSON.stringify({ status: 'OK', fast: { minimumFeeBps: 1 } }) }
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.text, 'レビューカードを用意しました。')
  assert.deepEqual(result.proposal, { kind: 'bridge', asset: 'USDC', amount: '25', destination: 'Base Sepolia' })
  assert.deepEqual(result.sources.map((item) => item.source).sort(), ['Circle CCTP v2', 'Makoto planner'])
  assert.equal(toolCtx.address, ADDRESS)
  assert.equal(bodies.length, 2)
  assert.ok(Array.isArray(bodies[0].tools) && bodies[0].tools.length > 0)
  assert.match(bodies[0].input.at(-1).content, /Respond in Japanese/)
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
    return Response.json({ output_text: '已准备好审核卡片。' })
  }
  try {
    const post = (payload) => previous(`${base}/api/agent/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    for (const locale of ['ja', 'ko']) assert.notEqual((await post({ message: 'hi', locale })).status, 400)
    assert.equal((await post({ message: 'hi', locale: 'de' })).status, 400)
    assert.equal((await post({ message: 'hi', address: '0xnot-an-address' })).status, 400)
    const response = await post({ message: '把 3 USDC 换成 EURC', locale: 'zh', address: ADDRESS, context: { mode: 'connected' } })
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.text, '已准备好审核卡片。')
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
