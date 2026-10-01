import assert from 'node:assert/strict'
import test from 'node:test'
import { readHomeAnswer, renderHomeAnswer, routeHomeRequest, type QuickReadContext, type HomeRequest } from './homeRequest.ts'
import { ARC, TOKENS, type Tx } from '../lib/wallet.ts'
import { readAgentNetworkSnapshot, readAgentWalletSnapshot, type WalletObservation, type ToolResult } from '../migrated/toolLayer.ts'

const account = '0x1111111111111111111111111111111111111111'
const recipient = '0x2222222222222222222222222222222222222222'
const now = 1_790_000_000_000
const fixture = (overrides: Partial<QuickReadContext> = {}): QuickReadContext => ({
  mode: 'connected', address: account, walletChainId: ARC.chainId,
  holdings: TOKENS.map((token, index) => ({ ...token, symbol: token.sym, balance: [100, 50, 0.001][index], verified: true })),
  activity: [], total: 275.75, pricesReady: true, loading: false, walletError: null, balanceError: null,
  network: { chainId: ARC.chainId, blockNumber: 123456, gasPriceGwei: 1, transferFeeUsdc: 0.001, tokenTransferFeeUsdc: 0.001, rpcLatencyMs: 25, updatedAt: now }, networkError: false,
  ...overrides,
})
const identity = async (): Promise<ToolResult<WalletObservation>> => ({ status: 'OK', source: 'eip-1193', observedAt: now, data: { account, chainId: ARC.chainId } })
const dependencies = { now: () => now, readWalletIdentity: identity }
function inline(text: string, locale: 'en' | 'vi' = 'en'): Extract<HomeRequest, { route: 'INLINE' }> {
  const request = routeHomeRequest(text, locale)
  assert.equal(request.route, 'INLINE')
  if (request.route !== 'INLINE') throw new Error('Expected inline read')
  return request
}

test('Vietnamese portfolio question stays on Home and preserves exact original text', async () => {
  const text = 'Danh mục của tôi trị giá bao nhiêu?'
  const request = inline(text, 'vi')
  assert.equal(request.originalText, text)
  assert.equal(request.plannerText, text)
  assert.notEqual(request.originalText, 'Check my portfolio')
  assert.equal(request.normalizedIntent, 'wallet-overview')
  const answer = renderHomeAnswer(await readHomeAnswer(request, fixture(), dependencies), 'vi')
  assert.equal(answer.text, 'Tổng danh mục hiện tại của bạn là $275.75.')
  assert.equal(answer.rows.length, 3)
})

test('leading whitespace, punctuation and Vietnamese original wording remain unchanged', () => {
  const text = '  Danh mục của tôi trị giá bao nhiêu?!  '
  const request = inline(text, 'vi')
  assert.equal(request.originalText, text)
  assert.equal(request.plannerText, text)
})

test('simple USDC balance query stays inline and reads only requested output', async () => {
  const request = inline('Tôi còn bao nhiêu USDC?', 'vi')
  assert.equal(request.query, 'balances')
  const answer = renderHomeAnswer(await readHomeAnswer(request, fixture(), dependencies), 'vi')
  assert.equal(answer.text, 'Số dư hiện tại đã xác minh của bạn:')
  assert.deepEqual(answer.rows, [['USDC', '100']])
})

test('holdings question uses existing deterministic Brain capability', async () => {
  const request = inline('What assets am I currently holding?')
  assert.equal(request.query, 'holdings')
  const evidence = await readHomeAnswer(request, fixture({ holdings: fixture().holdings.map((holding) => ({ ...holding, balance: holding.symbol === 'USDC' ? 100 : 0 })) }), dependencies)
  assert.deepEqual(renderHomeAnswer(evidence, 'en').rows, [['USDC', '100']])
})

test('recent activity stays inline, preserves observed status and is compact', async () => {
  const activity: Tx[] = ['pending', 'failed', 'unknown', 'completed'].map((status, index) => ({ id: String(index), timestamp: now - index, direction: 'out', counterparty: recipient, symbol: 'USDC', amount: index + 1, verified: true, kind: 'send', status: status as Tx['status'] }))
  const request = inline('Xem giao dịch gần đây', 'vi')
  assert.equal(request.query, 'activity')
  const answer = renderHomeAnswer(await readHomeAnswer(request, fixture({ activity }), dependencies), 'vi')
  assert.equal(answer.rows.length, 3)
  assert.deepEqual(answer.rows.map((row) => row[1]), ['1 · Đang chờ', '2 · Thất bại', '3 · Chưa rõ trạng thái'])
  assert.equal(activity[0].status, 'pending')
})

test('cancelled wallet activity has a localized cancellation state', async () => {
  const activity: Tx[] = [{ id: 'cancelled', timestamp: now, direction: 'out', counterparty: recipient, symbol: 'USDC', amount: 1, verified: true, status: 'user_rejected' }]
  const answer = renderHomeAnswer(await readHomeAnswer(inline('Show recent activity'), fixture({ activity }), dependencies), 'vi')
  assert.equal(answer.rows[0][1], '1 · Đã hủy yêu cầu ví')
})

test('Send, Swap, Bridge and sequential actions retain Agent handoff', () => {
  for (const text of [`Send 10 USDC to ${recipient}`, 'Swap 20 USDC to EURC', 'Bridge 10 USDC to Base Sepolia', 'Chuyển 10 USDC sang Base Sepolia', `Send 10 USDC to ${recipient} and then swap 5 USDC to EURC`]) {
    const request = routeHomeRequest(text, 'vi')
    assert.equal(request.route, 'AGENT')
    assert.equal(request.originalText, text)
    assert.equal(request.plannerText, text)
  }
})

test('task modes retain review workflow rather than answering as balances', () => {
  const request = routeHomeRequest('Báo tôi khi số dư USDC xuống dưới 100', 'vi', 'monitor')
  assert.equal(request.route, 'AGENT')
  if (request.route === 'AGENT') assert.equal(request.taskMode, 'monitor')
  const automation = routeHomeRequest('Send me a portfolio summary every day at 08:00', 'en', 'automation')
  assert.equal(automation.route, 'AGENT')
  if (automation.route === 'AGENT') assert.equal(automation.taskMode, 'automation')
})

test('English question and generated answer remain English', async () => {
  const request = inline('What is my portfolio worth right now?')
  const answer = renderHomeAnswer(await readHomeAnswer(request, fixture(), dependencies), 'en')
  assert.equal(request.originalText, 'What is my portfolio worth right now?')
  assert.equal(answer.text, 'Your portfolio is currently worth $275.75.')
})

test('locale switch regenerates system evidence without changing historical user input', async () => {
  const request = inline('Danh mục của tôi trị giá bao nhiêu?', 'vi')
  const evidence = await readHomeAnswer(request, fixture(), dependencies)
  const original = JSON.stringify(request)
  assert.match(renderHomeAnswer(evidence, 'vi').text, /Tổng danh mục/)
  assert.match(renderHomeAnswer(evidence, 'en').text, /Your portfolio/)
  assert.match(renderHomeAnswer(evidence, 'vi').text, /Tổng danh mục/)
  assert.equal(JSON.stringify(request), original)
})

test('portfolio uses the canonical store valuation and never recalculates prices', async () => {
  const answer = await readHomeAnswer(inline('Check my portfolio'), fixture({ total: 991.23 }), dependencies)
  assert.equal(answer.totalUsd, 991.23)
  assert.equal(renderHomeAnswer(answer, 'en').text, 'Your portfolio is currently worth $991.23.')
})

test('missing prices does not invent a total and verified balances stay useful', async () => {
  const answer = await readHomeAnswer(inline('Check my portfolio'), fixture({ pricesReady: false, balanceError: 'Pricing data is unavailable.' }), dependencies)
  assert.equal(answer.status, 'PARTIAL')
  assert.equal(answer.totalUsd, undefined)
  assert.equal(renderHomeAnswer(answer, 'vi').rows.length, 3)
  assert.match(renderHomeAnswer(answer, 'en').text, /pricing is unavailable/)
})

test('disconnected reads do not turn demo balances into wallet evidence', async () => {
  let calls = 0
  const answer = await readHomeAnswer(inline('How much USDC do I have?'), fixture({ mode: 'demo', address: '' }), { ...dependencies, readWalletIdentity: async () => { calls++; return identity() } })
  assert.equal(answer.status, 'UNAVAILABLE')
  assert.equal(calls, 0)
  assert.equal(renderHomeAnswer(answer, 'en').rows.length, 0)
  assert.match(renderHomeAnswer(answer, 'vi').text, /Kết nối ví hoặc theo dõi/)
})

test('public-address watch reads do not request a wallet or signer', async () => {
  let calls = 0
  const answer = await readHomeAnswer(inline('What are my balances?'), fixture({ mode: 'watch', walletChainId: undefined }), { ...dependencies, readWalletIdentity: async () => { calls++; return identity() } })
  assert.equal(answer.status, 'OK')
  assert.equal(calls, 0)
  assert.equal(renderHomeAnswer(answer, 'en').rows.length, 3)
})

test('connected account and chain changes block stale wallet evidence', async () => {
  const request = inline('What is my balance?')
  for (const observed of [{ account: recipient, chainId: ARC.chainId }, { account, chainId: 1 }] as const) {
    const answer = await readHomeAnswer(request, fixture(), { ...dependencies, readWalletIdentity: async () => ({ status: 'OK', source: 'eip-1193', observedAt: now, data: observed }) })
    assert.equal(answer.status, 'UNAVAILABLE')
    assert.equal(answer.reason, 'identity')
    assert.equal(renderHomeAnswer(answer, 'en').rows.length, 0)
  }
})

test('live global network read works without a connected wallet', async () => {
  let calls = 0
  const answer = await readHomeAnswer(inline('What is the current Arc network status?'), fixture({ mode: 'demo', address: '' }), { ...dependencies, readWalletIdentity: async () => { calls++; return identity() } })
  assert.equal(answer.status, 'OK')
  assert.equal(calls, 0)
  assert.equal(renderHomeAnswer(answer, 'vi').text, 'Arc Testnet đang trực tuyến. Khối mới nhất: #123.456.')
})

test('network stale, failed and mismatched chain snapshots are unavailable', () => {
  const context = fixture()
  assert.equal(readAgentNetworkSnapshot(context.network, { error: true, observedAt: now }).status, 'UNAVAILABLE')
  assert.equal(readAgentNetworkSnapshot({ ...context.network!, chainId: 1 }, { error: false, observedAt: now }).status, 'UNAVAILABLE')
  assert.equal(readAgentNetworkSnapshot(context.network, { error: false, observedAt: now + 60_001 }).status, 'STALE')
})

test('wallet snapshot requires verified metadata and all canonical token balances', () => {
  const context = fixture()
  assert.equal(readAgentWalletSnapshot({ ...context, observedAt: now }).status, 'OK')
  assert.equal(readAgentWalletSnapshot({ ...context, observedAt: now, holdings: context.holdings.slice(0, 2) }).status, 'UNAVAILABLE')
  assert.equal(readAgentWalletSnapshot({ ...context, observedAt: now, holdings: context.holdings.map((holding) => ({ ...holding, verified: false })) }).status, 'UNAVAILABLE')
  assert.equal(readAgentWalletSnapshot({ ...context, observedAt: now, walletError: 'API offline' }).status, 'UNAVAILABLE')
  assert.equal(readAgentWalletSnapshot({ ...context, observedAt: now, loading: true }).status, 'STALE')
})

test('privacy masking covers total, token and activity amounts at render time', async () => {
  const evidence = await readHomeAnswer(inline('Check my portfolio'), fixture(), dependencies)
  const masked = renderHomeAnswer(evidence, 'vi', () => '••••')
  assert.equal(masked.text, 'Tổng danh mục hiện tại của bạn là ••••.')
  assert.ok(masked.rows.every((row) => row[1] === '••••'))
  assert.equal(renderHomeAnswer(evidence, 'en').text, 'Your portfolio is currently worth $275.75.')
})

test('completed wallet evidence becomes unavailable after account, mode or chain changes', async () => {
  const request = inline('Danh mục của tôi trị giá bao nhiêu?', 'vi')
  const evidence = await readHomeAnswer(request, fixture(), dependencies)
  for (const next of [fixture({ address: recipient }), fixture({ mode: 'demo', address: '' }), fixture({ walletChainId: 1 })]) {
    const rendered = renderHomeAnswer(evidence, 'vi', (value) => value, next)
    assert.equal(rendered.rows.length, 0)
    assert.match(rendered.text, /Tài khoản hoặc mạng ví đã thay đổi/)
    assert.equal(request.originalText, 'Danh mục của tôi trị giá bao nhiêu?')
  }
  assert.match(renderHomeAnswer(evidence, 'en', (value) => value, fixture()).text, /\$275.75/)
})
