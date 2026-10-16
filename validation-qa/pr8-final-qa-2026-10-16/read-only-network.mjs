import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { once } from 'node:events'
import { ARC, TOKENS } from '../../frontend/src/lib/wallet.ts'
import { XYLO_ROUTER } from '../../frontend/src/migrated/swap.ts'
import { CCTP_KIT_BRIDGE_TESTNET } from '../../frontend/src/migrated/cctp.ts'
import { checkBridgeRecord } from '../../frontend/src/lib/protocolActivity.ts'

// Public historical reconciliation only. No wallet connection, signer or writer.
const allowed = new Set(['eth_chainId', 'eth_blockNumber', 'eth_gasPrice', 'eth_getCode', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_call', 'eth_getBlockByNumber'])
const observed = []
async function rpc(url, method, params = []) {
  if (!allowed.has(method)) throw new Error(`Blocked non-read RPC method: ${method}`)
  observed.push({url, method, params})
  const response = await fetch(url, {method: 'POST', signal: AbortSignal.timeout(15000), headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id: observed.length, method, params})})
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`)
  const body = await response.json()
  if (body.error) throw new Error(body.error.message ?? 'RPC rejected read')
  return body.result
}
const result = {head: 'adb05b9aeaffbbbb2edf94a90efe487b38bd2ddc', observedAt: new Date().toISOString(), scope: 'PUBLIC READ-ONLY; historical repository fixture; not LIVE TESTNET QA', checks: {}, calls: observed}
const checks = [
  ['arc-chain', () => rpc(ARC.rpc, 'eth_chainId')],
  ['arc-block', () => rpc(ARC.rpc, 'eth_blockNumber')],
  ['arc-gas-price', () => rpc(ARC.rpc, 'eth_gasPrice')],
  ['base-chain', () => rpc('https://sepolia.base.org', 'eth_chainId')],
  ...TOKENS.filter(t => ['USDC', 'EURC'].includes(t.sym)).map(t => [`arc-${t.sym}-code`, async () => ({address: t.address, codeBytes: ((await rpc(ARC.rpc, 'eth_getCode', [t.address, 'latest'])).length - 2) / 2})]),
  ...[['swap-router', XYLO_ROUTER], ['cctp-bridge', CCTP_KIT_BRIDGE_TESTNET]].map(([label, address]) => [`arc-${label}-code`, async () => ({address, codeBytes: ((await rpc(ARC.rpc, 'eth_getCode', [address, 'latest'])).length - 2) / 2})]),
]
await Promise.all(checks.map(async ([name, read]) => { try { result.checks[name] = {status: 'OBSERVED', value: await read()} } catch (error) { result.checks[name] = {status: 'UNAVAILABLE', reason: error.message} } }))
const captured = JSON.parse(await readFile(new URL('../../frontend/tests/fixtures/cctp-v2-completed-arc-base-sepolia.json', import.meta.url), 'utf8'))
const body = captured.messages[0].decodedMessage.decodedMessageBody
const hash = captured.sourceTxHash
let server
try {
  const tx = await rpc(ARC.rpc, 'eth_getTransactionByHash', [hash])
  if (!tx || tx.hash.toLowerCase() !== hash.toLowerCase() || tx.from.toLowerCase() !== body.mintRecipient.toLowerCase() || tx.to.toLowerCase() !== CCTP_KIT_BRIDGE_TESTNET.toLowerCase()) throw new Error('Historical source transaction binding unavailable or mismatched')
  const requireBackend = createRequire(new URL('../../backend/package.json', import.meta.url))
  const express = requireBackend('express')
  const app = express()
  app.use('/cctp', requireBackend('./routes/cctp.js'))
  server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const fetchDestination = async (input, init) => {
    const localUrl = new URL(String(input), 'http://localhost')
    const path = localUrl.pathname.slice(localUrl.pathname.indexOf('/cctp/'))
    return fetch(`http://127.0.0.1:${server.address().port}${path}${localUrl.search}`, init)
  }
  const record = {hash, account: body.mintRecipient, target: CCTP_KIT_BRIDGE_TESTNET, calldata: tx.input, amount: '1', expectedReceiveUnits: (BigInt(body.amount) - BigInt(body.maxFee)).toString(), destinationDomain: 6, maxFeeUnits: body.maxFee, finalityThreshold: captured.messages[0].decodedMessage.minFinalityThreshold, timestamp: 0, status: 'source-pending'}
  const checked = await checkBridgeRecord({request: ({method, params}) => rpc(ARC.rpc, method, params)}, record, fetchDestination)
  result.checks['historical-cctp-reconciliation'] = {status: 'OBSERVED', sourceHash: hash, expectedDestinationHash: captured.messages[0].forwardTxHash, value: checked}
} catch (error) { result.checks['historical-cctp-reconciliation'] = {status: 'UNAVAILABLE', sourceHash: hash, reason: error.message} }
finally { if (server) await new Promise(resolve => server.close(resolve)) }
await writeFile(new URL('./read-only-network.json', import.meta.url), JSON.stringify(result, null, 2))
console.log(JSON.stringify({observedAt: result.observedAt, scope: result.scope, checks: result.checks, rpcReadCount: observed.length}, null, 2))
