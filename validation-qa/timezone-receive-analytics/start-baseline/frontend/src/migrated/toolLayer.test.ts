import assert from 'node:assert/strict'
import test from 'node:test'
import { encodeFunctionResult, erc20Abi } from 'viem'
import { TOKENS } from '../lib/wallet.ts'
import type { SendProvider } from '../lib/sendExecution.ts'
import { readAllowance, readBalance, readReceipt, readWallet, quoteSwap, prepareApproval, prepareSwap } from './toolLayer.ts'
import { createReview, evaluateToolPolicy, revalidateReview } from './policy.ts'
import { xyloRouterAbi, XYLO_ROUTER } from './swap.ts'

const account = '0x1111111111111111111111111111111111111111'
const hash = `0x${'a'.repeat(64)}`
function fixture(options: { chain?: string; account?: string; unavailable?: boolean; output?: bigint; allowance?: bigint; balance?: bigint } = {}) {
  let writes = 0
  const p: SendProvider = { request: async ({ method, params = [] }) => {
    if (options.unavailable) throw new Error('RPC offline')
    if (method === 'eth_accounts') return [options.account ?? account]
    if (method === 'eth_chainId') return options.chain ?? '0x4cef52'
    if (method === 'eth_getCode') return '0x6000'
    if (method === 'eth_call') {
      const { to, data } = params[0] as { to: string; data: string }
      if (data === '0x313ce567') return '0x6'
      if (data === '0x95d89b41') return encodeFunctionResult({ abi: erc20Abi, functionName: 'symbol', result: to.toLowerCase() === TOKENS[1].address.toLowerCase() ? 'EURC' : 'USDC' })
      if (to.toLowerCase() === XYLO_ROUTER.toLowerCase()) return encodeFunctionResult({ abi: xyloRouterAbi, functionName: 'getAmountOut', result: options.output ?? 990_000n })
      if (data.startsWith('0x70a08231')) return encodeFunctionResult({ abi: erc20Abi, functionName: 'balanceOf', result: options.balance ?? 10_000_000n })
      if (data.startsWith('0xdd62ed3e')) return encodeFunctionResult({ abi: erc20Abi, functionName: 'allowance', result: options.allowance ?? 2_000_000n })
      return '0x'
    }
    if (method === 'eth_getBalance') return '0x1000000000000000'
    if (method === 'eth_estimateGas') return '0x186a0'
    if (method === 'eth_gasPrice') return '0x3b9aca00'
    if (method === 'eth_getTransactionReceipt') return null
    if (method === 'eth_sendTransaction') { writes++; return hash }
    throw new Error(method)
  } }
  return { p, writes: () => writes }
}

test('READ tools return typed live evidence and unavailable is not zero', async () => {
  const { p, writes } = fixture()
  assert.equal((await readWallet(p)).data?.account.toLowerCase(), account)
  assert.equal((await readBalance(p, 'USDC', account)).data?.units, 10_000_000n)
  assert.equal((await readAllowance(p, 'USDC', XYLO_ROUTER, account)).data?.units, 2_000_000n)
  assert.equal((await readReceipt(p, hash)).data?.status, 'pending')
  assert.equal((await readBalance(fixture({ unavailable: true }).p, 'USDC', account)).status, 'UNAVAILABLE')
  assert.equal((await readBalance(p, 'UNSUPPORTED', account)).status, 'UNAVAILABLE')
  assert.equal(writes(), 0)
})

test('Swap quote and bounded prepare never call wallet writer', async () => {
  const { p, writes } = fixture()
  const result = await quoteSwap(p, { account, from: 'USDC', to: 'EURC', amount: '1', slippage: 0.005 }, 1000)
  assert.equal(result.status, 'OK')
  const quote = result.data!
  assert.equal(quote.minimumReceive, 985_050n)
  const prepared = await prepareSwap(p, quote, 1200)
  assert.equal(prepared.request.to.toLowerCase(), XYLO_ROUTER.toLowerCase())
  assert.equal(prepared.executionEnabled, false)
  assert.equal(writes(), 0)
  const policy = evaluateToolPolicy({ action: prepared, quote, account, chainId: 5042002, simulation: 'passed', now: 1200, balance: 10_000_000n, allowance: 2_000_000n })
  assert.equal(policy.decision, 'REQUIRE_REVIEW')
  const review = createReview(prepared, quote, policy, 1200)
  assert.equal(revalidateReview(review, { action: prepared, quote, account, chainId: 5042002, simulation: 'passed', now: 1300, balance: 10_000_000n, allowance: 2_000_000n }).status, 'OK')
  assert.equal(revalidateReview(review, { action: prepared, quote, account: TOKENS[0].address, chainId: 5042002, simulation: 'passed', now: 1300, balance: 10_000_000n, allowance: 2_000_000n }).status, 'STALE')
  assert.equal(revalidateReview(review, { action: prepared, quote: { ...quote, quote: { ...quote.quote, amountOut: 1n } }, account, chainId: 5042002, simulation: 'passed', now: 1300, balance: 10_000_000n, allowance: 2_000_000n }).status, 'STALE')
})

test('Quote expiry, insufficient allowance, simulation failure and approval constraints stop writes', async () => {
  const { p, writes } = fixture({ allowance: 0n })
  const quote = (await quoteSwap(p, { account, from: 'USDC', to: 'EURC', amount: '1', slippage: 0.005 }, 1000)).data!
  await assert.rejects(prepareSwap(p, quote, 1200), /approval required/)
  const approval = await prepareApproval(p, { account, symbol: 'USDC', spender: XYLO_ROUTER, amount: 1_000_000n }, 1200)
  assert.equal(approval.kind, 'approval')
  await assert.rejects(prepareApproval(p, { account, symbol: 'USDC', spender: XYLO_ROUTER, amount: (1n << 256n) - 1n }), /finite/)
  await assert.rejects(prepareApproval(p, { account, symbol: 'USDC', spender: TOKENS[2].address, amount: 1n }), /Untrusted/)
  assert.equal((await quoteSwap(fixture({ chain: '0x1' }).p, { account, from: 'USDC', to: 'EURC', amount: '1', slippage: 0.005 })).status, 'UNAVAILABLE')
  assert.equal(writes(), 0)
})
