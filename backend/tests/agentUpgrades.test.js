const test = require('node:test')
const assert = require('node:assert/strict')
const { validateTaskDraft, runTool } = require('../lib/agentTools')
const { parseIntent } = require('../lib/taskDefinitions')
const { walletPnl, dailyBriefing, concentration } = require('../lib/walletInsights')
const { TaskEngine } = require('../lib/taskEngine')
const { AgentEval, grade, CASES } = require('../lib/agentEval')
const { safeImage, generateAgentResponse } = require('../lib/llm')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ACCOUNT = '0x1111111111111111111111111111111111111111'
const CONTEXT = { account: ACCOUNT, chainId: 5042002, timezone: 'Asia/Ho_Chi_Minh', locale: 'vi' }

test('chat phrasing becomes a notify-only price alert or morning briefing task', () => {
  const alert = parseIntent({ ...CONTEXT, mode: 'monitor', text: 'báo mình khi BTC dưới 75k' }).candidate
  assert.deepEqual(alert.condition, { metric: 'TOKEN_PRICE', asset: 'BTC', operator: 'LT', threshold: '75000', checkIntervalMinutes: 5 })
  assert.equal(alert.authority, 'NOTIFY_ONLY')
  assert.equal(parseIntent({ ...CONTEXT, mode: 'monitor', text: 'nhắc mình khi ETH vượt 3,000' }).candidate.condition.operator, 'GT')
  const briefing = parseIntent({ ...CONTEXT, mode: 'automation', text: 'mỗi sáng 7h gửi bản tin thị trường' }).candidate
  assert.deepEqual(briefing.schedule, { kind: 'DAILY', time: '07:00', action: 'DAILY_BRIEFING' })
  // "bản tin" is not "bán" (sell), but selling is still blocked.
  assert.equal(parseIntent({ ...CONTEXT, mode: 'automation', text: 'bán BTC mỗi ngày 7h' }).blocked.code, 'TASK_WRITE_REQUIRES_USER')
})

test('propose_task validates drafts and shows at most one card', async () => {
  assert.equal(validateTaskDraft({ kind: 'price_alert', asset: 'DOGE', operator: 'LT', threshold: '1' }).ok, false)
  assert.equal(validateTaskDraft({ kind: 'price_alert', asset: 'BTC', operator: null, threshold: '1' }).ok, false)
  assert.equal(validateTaskDraft({ kind: 'balance_alert', asset: 'BTC', operator: 'LT', threshold: '1' }).ok, false)
  assert.equal(validateTaskDraft({ kind: 'daily_report', time: '25:00', action: 'DAILY_BRIEFING' }).ok, false)
  assert.deepEqual(validateTaskDraft({ kind: 'daily_report', time: '7:05', action: 'DAILY_BRIEFING' }).value.schedule, { kind: 'DAILY', time: '07:05', action: 'DAILY_BRIEFING' })
  const ctx = { memory: [], charts: [] }
  const args = { kind: 'price_alert', asset: 'BTC', operator: 'LT', threshold: '75,000', time: null, action: null }
  const first = await runTool('propose_task', JSON.stringify(args), ctx)
  assert.equal(JSON.parse(first.output).status, 'TASK_CARD_SHOWN_FOR_USER_CONFIRMATION')
  assert.equal(ctx.task.condition.threshold, '75000')
  assert.equal(JSON.parse((await runTool('propose_task', JSON.stringify(args), ctx)).output).status, 'REJECTED')
})

test('wallet PnL separates price effect from deposits and flags concentration', async () => {
  const now = Date.parse('2026-10-28T00:00:00Z')
  const result = await walletPnl(ACCOUNT, '7d', {
    now,
    readBalances: async () => ({ balances: { USDC: { amount: '100' }, cirBTC: { amount: '0.01' } } }),
    readActivity: async () => ({ hasMore: false, items: [{ asset: 'USDC', direction: 'in', amount: '50' }, { asset: 'cirBTC', direction: 'out', amount: '0.005' }] }),
    latestPrice: async (symbol) => ({ usd: symbol === 'BTC' ? 80000 : 1 }),
    priceAt: async (symbol) => ({ usd: symbol === 'BTC' ? 100000 : 1 }),
  })
  // Then: 50 USDC + 0.015 BTC @100k = 1,550. Now: 100 + 0.01 @80k = 900.
  assert.equal(result.status, 'OK')
  assert.equal(result.value_then_usd, 1550)
  assert.equal(result.value_now_usd, 900)
  assert.equal(result.price_effect_usd, -300) // 0.015 × −20,000
  assert.equal(result.net_deposits_usd, -350) // +50 USDC, −0.005 BTC × 80,000
  assert.equal(result.value_change_usd, result.price_effect_usd + result.net_deposits_usd)
  assert.equal(result.allocation[0].asset, 'cirBTC')
  assert.ok(result.concentration_warnings.some((item) => item.code === 'SINGLE_ASSET' && item.asset === 'cirBTC'))
  assert.deepEqual(concentration([{ asset: 'USDC', weight_pct: 100 }]).map((item) => item.code), ['MOSTLY_STABLECOINS'])
  const partial = await walletPnl(ACCOUNT, '1d', { now, readBalances: async () => ({ balances: { USDC: { amount: '1' } } }), readActivity: async () => { throw new Error('down') }, latestPrice: async () => ({ usd: 1 }), priceAt: async () => ({ usd: 1 }) })
  assert.equal(partial.status, 'APPROXIMATE')
})

test('daily briefing degrades per section and fails only when everything is down', async () => {
  const down = async () => { throw new Error('down') }
  const result = await dailyBriefing(null, { majorsSnapshot: async () => ({ source: 'CoinGecko', rows: [{ symbol: 'BTC', price_usd: 80000, change_24h_pct: 1 }] }), fearGreed: down, news: async () => ({ source: 'RSS', articles: [{ title: 'A', published_at: 1 }] }) })
  assert.equal(result.market[0].symbol, 'BTC')
  assert.equal(result.fear_greed, 'unavailable')
  assert.equal(result.wallet, 'no wallet connected')
  assert.equal(result.headlines[0].title, 'A')
  await assert.rejects(dailyBriefing(null, { majorsSnapshot: down, fearGreed: down, news: down }))
})

test('scheduled morning briefing runs and notifies with deterministic text', async () => {
  const engine = new TaskEngine({
    dbPath: ':memory:', generateSummary: async () => ({ ok: false }),
    briefing: async () => ({ observedAt: new Date().toISOString(), market: [{ symbol: 'BTC', price_usd: 81000, change_24h_pct: 1.5 }], fear_greed: { value: 60, classification: 'Greed', previous: 55 }, headlines: [{ title: 'Big news' }], wallet: { value_now_usd: 120, change_24h_usd: 2, change_24h_pct: 1.69, concentration_warnings: [] } }),
  })
  try {
    const task = engine.create({ ...CONTEXT, createdBy: 'USER', type: 'SCHEDULED_AUTOMATION', schedule: { kind: 'DAILY', time: '07:00', action: 'DAILY_BRIEFING' } })
    const { run } = await engine.run(task.id)
    assert.equal(run.result.kind, 'DAILY_BRIEFING')
    assert.match(run.result.languageSummary, /BTC \$81,000 \(\+1\.50%\)/)
    assert.match(run.result.languageSummary, /Tham lam/)
    const [note] = engine.notifications(ACCOUNT)
    assert.equal(note.titleVi, 'Bản tin buổi sáng')
    assert.match(note.messageEn, /Top news: Big news/)
  } finally { await engine.close() }
})

test('agent eval grades tool use, data failures and safety', async () => {
  const price = CASES.find((item) => item.id === 'price')
  assert.equal(grade(price, { ok: true, text: 'BTC is $81,000', sources: [{ tool: 'get_token_market_data', ok: true }] }, 100).ok, true)
  assert.equal(grade(price, { ok: true, text: 'Price data is unavailable', sources: [{ tool: 'get_token_market_data', ok: true }] }, 100).ok, false)
  assert.equal(grade(price, { ok: true, text: 'x', sources: [] }, 100).ok, false)
  const safety = CASES.find((item) => item.id === 'safety')
  assert.equal(grade(safety, { ok: true, text: 'I cannot sign.', proposal: { kind: 'send' } }, 100).ok, false)
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'eval-')), 'agent-eval.json')
  const evaluator = new AgentEval({ file, cases: [price], generate: async () => ({ ok: true, text: 'BTC $81,000', sources: [{ tool: 'get_token_market_data', ok: true }] }) })
  const run = await evaluator.run()
  assert.equal(run.score, 100)
  assert.equal(evaluator.latest().latest.status, 'PASS')
})

test('attached images are validated and sent as an input_image part', async () => {
  const image = 'data:image/png;base64,iVBORw0KGgo='
  assert.equal(safeImage(image), image)
  assert.equal(safeImage('data:image/svg+xml;base64,PHN2Zz4='), undefined)
  assert.equal(safeImage('https://example.com/a.png'), undefined)
  let body
  const fetcher = async (_url, init) => { body = JSON.parse(init.body); return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'A BTC chart.' }] }] }), { status: 200, headers: { 'content-type': 'application/json' } }) }
  const result = await generateAgentResponse({ message: 'What is this?', image }, { fetcher, env: { LLM_API_KEY: 'k', LLM_MODEL: 'm', LLM_BASE_URL: 'https://llm.test/v1' } })
  assert.equal(result.ok, true)
  const content = body.input.at(-1).content
  assert.equal(content[1].type, 'input_image')
  assert.equal(content[1].image_url, image)
})
