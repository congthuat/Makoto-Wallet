import test from 'node:test'
import assert from 'node:assert/strict'
import { CCTPV2BridgingProvider } from '@circle-fin/provider-cctp-v2'
import { encodeAbiParameters, encodeEventTopics, pad, type Address } from 'viem'
import { TOKENS } from './wallet.ts'
import { CCTP_KIT_BRIDGE_TESTNET } from '../migrated/cctp.ts'
import { checkBridgeRecord, checkSwapRecord, hasSavedProtocolCompletion, mergeBridgeRecord, type BridgeRecord, type SwapRecord } from './protocolActivity.ts'
import { CCTP_MESSAGE_SENT_ABI } from '../protocols/circle/cctpAdapter.ts'

const hash = `0x${'a'.repeat(64)}`
const account = `0x${'1'.repeat(40)}`
const target = `0x${'2'.repeat(40)}`
const official = new CCTPV2BridgingProvider()
const source = official.supportedChains.find((chain) => chain.type === 'evm' && chain.chainId === 5042002)!
const destination = official.supportedChains.find((chain) => chain.type === 'evm' && chain.chainId === 84532)!
const sourceMessenger = source.cctp!.contracts.v2!.type === 'split' ? source.cctp!.contracts.v2!.tokenMessenger : ''
const destinationMessenger = destination.cctp!.contracts.v2!.type === 'split' ? destination.cctp!.contracts.v2!.tokenMessenger : ''
const base: BridgeRecord = { hash, account, target, calldata: '0x1234', amount: '1', expectedReceiveUnits: '1000000', destinationDomain: 6, maxFeeUnits: '0', finalityThreshold: '1000', timestamp: 1, status: 'source-pending' }
const success = { transactionHash: hash, blockHash: hash, blockNumber: '0x1', status: '0x1' }
const messageLog = { address: (source.cctp!.contracts.v2!.type === 'split' ? source.cctp!.contracts.v2!.messageTransmitter : ''), topics: encodeEventTopics({ abi: CCTP_MESSAGE_SENT_ABI, eventName: 'MessageSent' }), data: encodeAbiParameters([{ type: 'bytes' }], ['0x01']) }
const sourceSuccess = { ...success, logs: [messageLog] }

// After Rev 6, checkBridgeRecord/checkSwapRecord call rpcRead() → arcRpc() → fetch() for
// eth_getTransactionReceipt and eth_getTransactionByHash.  The provider() helper below
// only handles eth_chainId; receipt/tx data is served by the Arc RPC mock via globalThis.fetch.
function withArcReceiptMock<T>(receipt: unknown, transaction: unknown, fn: () => Promise<T>): Promise<T> {
  const prev = globalThis.fetch
  const tx = transaction ?? { hash, from: account, to: target, input: '0x1234' }
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body ?? '{}')) as { id?: number; method?: string }
    const id = payload.id ?? 1
    if (payload.method === 'eth_getTransactionReceipt') return Response.json({ jsonrpc: '2.0', id, result: receipt })
    if (payload.method === 'eth_getTransactionByHash') return Response.json({ jsonrpc: '2.0', id, result: tx })
    if (payload.method === 'eth_chainId') return Response.json({ jsonrpc: '2.0', id, result: '0x4cef52' })
    return Response.json({ jsonrpc: '2.0', id, result: '0x' })
  }) as typeof fetch
  return fn().finally(() => { globalThis.fetch = prev })
}

// provider only handles wallet-identity methods; all read-only RPC goes through arcRpc() mock above.
const provider = (chainId = '0x4cef52') => ({ request: async ({ method }: { method: string }) => method === 'eth_chainId' ? chainId : undefined })

test('checkpoint cleanup requires durable completed Activity for the same account, hash and protocol', () => {
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null }
  const completedSwap = { ...base, status: 'completed' }
  const completedBridge = { ...base, status: 'destination-confirmed', destinationHash: hash }
  assert.equal(hasSavedProtocolCompletion(storage, 'swap', account, hash), false)
  values.set('mk.swap.records.v1', JSON.stringify([completedSwap]))
  assert.equal(hasSavedProtocolCompletion(storage, 'swap', account, hash), true)
  assert.equal(hasSavedProtocolCompletion(storage, 'swap', target, hash), false)
  assert.equal(hasSavedProtocolCompletion(storage, 'swap', account, `0x${'b'.repeat(64)}`), false)
  assert.equal(hasSavedProtocolCompletion(storage, 'cctp', account, hash), false)
  values.set('mk.bridge.records.v1', JSON.stringify([completedBridge]))
  assert.equal(hasSavedProtocolCompletion(storage, 'cctp', account, hash), true)
  for (const invalid of [null, {}, 'broken-json', [null], [{ ...completedBridge, status: 'destination-pending' }], [{ ...completedBridge, destinationHash: 'invalid' }], [{ ...completedBridge, destinationHash: undefined }]]) {
    values.set('mk.bridge.records.v1', typeof invalid === 'string' ? invalid : JSON.stringify(invalid))
    assert.equal(hasSavedProtocolCompletion(storage, 'cctp', account, hash), false)
  }
  values.set('mk.swap.records.v1', JSON.stringify([{ ...completedSwap, status: 'pending' }]))
  assert.equal(hasSavedProtocolCompletion(storage, 'swap', account, hash), false)
  assert.equal(hasSavedProtocolCompletion({ getItem: () => { throw new Error('unavailable') } }, 'swap', account, hash), false)
})

function cctp(state: 'pending' | 'forwarding-pending' | 'forwarding-failed' | 'forwarded') {
  const circle = new CCTPV2BridgingProvider()
  Object.defineProperty(circle, 'fetchAttestation', { value: async () => {
    if (state === 'pending') throw new Error('Failed to fetch attestation: No attestation found for the given transaction')
    return {
      message: '0x01', eventNonce: '1', attestation: '0xab', cctpVersion: 2,
      status: 'complete',
      forwardState: state === 'forwarding-pending' ? 'PENDING' : state === 'forwarding-failed' ? 'FAILED' : 'CONFIRMED',
      ...(state === 'forwarded' ? { forwardTxHash: hash } : {}),
      decodedMessage: {
        sourceDomain: '26', destinationDomain: '6', nonce: '1', sender: pad(sourceMessenger as Address, { size: 32 }),
        recipient: pad(destinationMessenger as Address, { size: 32 }), destinationCaller: `0x${'0'.repeat(64)}`,
        messageBody: '0x01', minFinalityThreshold: '1000', finalityThresholdExecuted: '1000',
        decodedMessageBody: { burnToken: TOKENS[0]!.address, mintRecipient: account, amount: '1000000', messageSender: CCTP_KIT_BRIDGE_TESTNET, maxFee: '0', feeExecuted: '0' },
      },
    }
  } })
  return { createProvider: () => circle }
}

const noDestination = (responses: unknown[], visited: string[]) => (async (input: RequestInfo | URL) => {
  const url = String(input); visited.push(url)
  return Response.json(responses.shift() ?? { status: 'unknown' })
}) as typeof fetch

test('source receipt checks the Arc network and transaction binding before status lookup', async () => {
  const visited: string[] = []
  // null receipt → source-pending (Arc RPC returns no receipt yet)
  await withArcReceiptMock(null, null, async () => {
    assert.equal((await checkBridgeRecord(provider(), base, noDestination([], visited))).status, 'source-pending')
  })
  // failed receipt (status 0x0)
  await withArcReceiptMock({ ...success, status: '0x0' }, null, async () => {
    assert.equal((await checkBridgeRecord(provider(), base)).status, 'failed')
  })
  // wrong calldata in transaction
  await withArcReceiptMock(success, { hash, from: account, to: target, input: '0x9999' }, async () => {
    assert.equal((await checkBridgeRecord(provider(), base)).status, 'source-unknown')
  })
  // wrong chain from provider
  const wrongChain = { request: async ({ method }: { method: string }) => method === 'eth_chainId' ? '0x1' : null }
  await withArcReceiptMock(null, null, async () => {
    assert.equal((await checkBridgeRecord(wrongChain, base)).status, 'source-unknown')
  })
  assert.equal(visited.length, 0)
})

test('official Circle attestation and forwarding states remain pending until Base proof', async () => {
  const visited: string[] = []
  const pending = await withArcReceiptMock(sourceSuccess, { hash, from: account, to: target, input: '0x1234' }, () =>
    checkBridgeRecord(provider(), base, noDestination([], visited), cctp('pending')))
  assert.equal(pending.status, 'attesting')
  assert.equal(visited.length, 0)

  const forwarding = await withArcReceiptMock(sourceSuccess, { hash, from: account, to: target, input: '0x1234' }, () =>
    checkBridgeRecord(provider(), base, noDestination([], visited), cctp('forwarding-pending')))
  assert.equal(forwarding.status, 'attesting')
  assert.equal(visited.length, 0)

  const confirmed = await withArcReceiptMock(sourceSuccess, { hash, from: account, to: target, input: '0x1234' }, () =>
    checkBridgeRecord(provider(), base, noDestination([{ status: 'confirmed' }], visited), cctp('forwarded')))
  assert.equal(confirmed.status, 'destination-confirmed')
  assert.equal(confirmed.destinationHash, hash)
  assert.match(visited.at(-1)!, /cctp\/destination/)

  const missingProof = await withArcReceiptMock(sourceSuccess, { hash, from: account, to: target, input: '0x1234' }, () =>
    checkBridgeRecord(provider(), base, noDestination([{ status: 'unknown' }], visited), cctp('forwarded')))
  assert.equal(missingProof.status, 'destination-pending')

  const failedForward = await withArcReceiptMock(sourceSuccess, { hash, from: account, to: target, input: '0x1234' }, () =>
    checkBridgeRecord(provider(), base, noDestination([], visited), cctp('forwarding-failed')))
  assert.equal(failedForward.status, 'forwarding-failed')
  assert.equal(mergeBridgeRecord(failedForward, { ...base, status: 'source-pending' }).status, 'forwarding-failed')
})

test('missing source receipts cannot downgrade UNKNOWN or later bridge evidence to PENDING', async () => {
  const unknown = { ...base, status: 'source-unknown' as const }
  await withArcReceiptMock(null, null, async () => {
    assert.equal((await checkBridgeRecord(provider(), unknown)).status, 'source-unknown')
  })
  assert.equal(mergeBridgeRecord(unknown, base).status, 'source-unknown')
  const destinationPending = { ...base, status: 'destination-pending' as const, destinationHash: hash }
  await withArcReceiptMock(null, null, async () => {
    assert.equal((await checkBridgeRecord(provider(), destinationPending)).status, 'destination-pending')
  })
  const destinationFailed = { ...base, status: 'destination-failed' as const, destinationHash: hash }
  assert.equal(mergeBridgeRecord(destinationFailed, { ...base, status: 'source-unknown' }).status, 'destination-failed')
  const swap: SwapRecord = { hash, account, target, calldata: '0x1234', fromSymbol: 'USDC', toSymbol: 'EURC', amount: '1', minimumOutputUnits: '1', timestamp: 1, status: 'unknown' }
  await withArcReceiptMock(null, null, async () => {
    assert.equal(await checkSwapRecord(provider(), swap), 'unknown')
  })
})

test('an unavailable read can retain a new forward hash without downgrading or completing saved progress', () => {
  const destinationHash = `0x${'b'.repeat(64)}`
  for (const status of ['attesting', 'destination-pending'] as const) {
    const observed = { ...base, status }
    const merged = mergeBridgeRecord(observed, { ...base, status: 'source-confirmed', destinationHash })
    assert.deepEqual(merged, { ...observed, destinationHash })
    assert.equal(merged.status, status)
    assert.equal(mergeBridgeRecord(observed, { ...base, hash: destinationHash, status: 'source-confirmed', destinationHash }), observed)
    assert.equal(mergeBridgeRecord(observed, { ...base, status: 'source-confirmed', destinationHash: 'bad' }), observed)
    assert.equal(mergeBridgeRecord(observed, { ...base, status: 'source-confirmed' }), observed)
  }
  const completed = { ...base, status: 'destination-confirmed' as const, destinationHash: hash }
  assert.equal(mergeBridgeRecord(completed, { ...base, destinationHash, status: 'source-confirmed' }), completed)
})

test('repeated source-confirmed reads retain a verified forward hash across retry and further progress', () => {
  const destinationHash = `0x${'b'.repeat(64)}`
  const saved = { ...base, status: 'source-confirmed' as const, destinationHash }
  for (const status of ['source-confirmed', 'attesting', 'destination-pending'] as const) {
    assert.deepEqual(mergeBridgeRecord(saved, { ...base, status }), { ...base, status, destinationHash })
  }
  const unrelated = { ...base, status: 'source-confirmed' as const }
  assert.equal(mergeBridgeRecord({ ...saved, hash: destinationHash }, unrelated), unrelated)
})
