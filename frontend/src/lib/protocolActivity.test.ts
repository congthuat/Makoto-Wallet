import test from 'node:test'
import assert from 'node:assert/strict'
import { CCTPV2BridgingProvider } from '@circle-fin/provider-cctp-v2'
import { encodeAbiParameters, encodeEventTopics, pad, type Address } from 'viem'
import { TOKENS } from './wallet.ts'
import { CCTP_KIT_BRIDGE_TESTNET } from '../migrated/cctp.ts'
import { checkBridgeRecord, checkSwapRecord, mergeBridgeRecord, type BridgeRecord, type SwapRecord } from './protocolActivity.ts'
import { CCTP_MESSAGE_SENT_ABI } from '../protocols/circle/cctpAdapter.ts'

const hash = `0x${'a'.repeat(64)}`
const account = `0x${'1'.repeat(40)}`
const target = `0x${'2'.repeat(40)}`
const official = new CCTPV2BridgingProvider()
const source = official.supportedChains.find((chain) => chain.type === 'evm' && chain.chainId === 5042002)!
const destination = official.supportedChains.find((chain) => chain.type === 'evm' && chain.chainId === 84532)!
const sourceMessenger = source.cctp!.contracts.v2!.type === 'split' ? source.cctp!.contracts.v2!.tokenMessenger : ''
const destinationTransmitter = destination.cctp!.contracts.v2!.type === 'split' ? destination.cctp!.contracts.v2!.messageTransmitter : ''
const base: BridgeRecord = { hash, account, target, calldata: '0x1234', amount: '1', expectedReceiveUnits: '1000000', destinationDomain: 6, maxFeeUnits: '0', finalityThreshold: '1000', timestamp: 1, status: 'source-pending' }
const provider = (receipt: unknown, transaction: unknown = { hash, from: account, to: target, input: '0x1234' }) => ({ request: async ({ method }: { method: string }) => method === 'eth_chainId' ? '0x4cef52' : method === 'eth_getTransactionReceipt' ? receipt : method === 'eth_getTransactionByHash' ? transaction : undefined })
const success = { transactionHash: hash, blockHash: hash, blockNumber: '0x1', status: '0x1' }
const messageLog = { address: (source.cctp!.contracts.v2!.type === 'split' ? source.cctp!.contracts.v2!.messageTransmitter : ''), topics: encodeEventTopics({ abi: CCTP_MESSAGE_SENT_ABI, eventName: 'MessageSent' }), data: encodeAbiParameters([{ type: 'bytes' }], ['0x01']) }
const sourceSuccess = { ...success, logs: [messageLog] }

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
        recipient: pad(destinationTransmitter as Address, { size: 32 }), destinationCaller: `0x${'0'.repeat(64)}`,
        messageBody: '0x01', minFinalityThreshold: '1000', finalityThresholdExecuted: '1000',
        decodedMessageBody: { burnToken: TOKENS[0]!.address, mintRecipient: pad(account as Address, { size: 32 }), amount: '1000000', messageSender: CCTP_KIT_BRIDGE_TESTNET, maxFee: '0', feeExecuted: '0' },
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
  assert.equal((await checkBridgeRecord(provider(null), base, noDestination([], visited))).status, 'source-pending')
  assert.equal((await checkBridgeRecord(provider({ ...success, status: '0x0' }), base)).status, 'failed')
  assert.equal((await checkBridgeRecord(provider(success, { hash, from: account, to: target, input: '0x9999' }), base)).status, 'source-unknown')
  const wrongChain = { request: async ({ method }: { method: string }) => method === 'eth_chainId' ? '0x1' : null }
  assert.equal((await checkBridgeRecord(wrongChain, base)).status, 'source-unknown')
  assert.equal(visited.length, 0)
})

test('official Circle attestation and forwarding states remain pending until Base proof', async () => {
  const visited: string[] = []
  const dependencies = cctp('pending')
  const pending = await checkBridgeRecord(provider(sourceSuccess), base, noDestination([], visited), dependencies)
  assert.equal(pending.status, 'attesting')
  assert.equal(visited.length, 0)

  const forwarding = await checkBridgeRecord(provider(sourceSuccess), base, noDestination([], visited), cctp('forwarding-pending'))
  assert.equal(forwarding.status, 'attesting')
  assert.equal(visited.length, 0)

  const confirmed = await checkBridgeRecord(provider(sourceSuccess), base, noDestination([{ status: 'confirmed' }], visited), cctp('forwarded'))
  assert.equal(confirmed.status, 'destination-confirmed')
  assert.equal(confirmed.destinationHash, hash)
  assert.match(visited.at(-1)!, /cctp\/destination/)
  const missingProof = await checkBridgeRecord(provider(sourceSuccess), base, noDestination([{ status: 'unknown' }], visited), cctp('forwarded'))
  assert.equal(missingProof.status, 'destination-pending')
  const failedForward = await checkBridgeRecord(provider(sourceSuccess), base, noDestination([], visited), cctp('forwarding-failed'))
  assert.equal(failedForward.status, 'forwarding-failed')
  assert.equal(mergeBridgeRecord(failedForward, { ...base, status: 'source-pending' }).status, 'forwarding-failed')
})

test('missing source receipts cannot downgrade UNKNOWN or later bridge evidence to PENDING', async () => {
  const unknown = { ...base, status: 'source-unknown' as const }
  assert.equal((await checkBridgeRecord(provider(null), unknown)).status, 'source-unknown')
  assert.equal(mergeBridgeRecord(unknown, base).status, 'source-unknown')
  const destinationPending = { ...base, status: 'destination-pending' as const, destinationHash: hash }
  assert.equal((await checkBridgeRecord(provider(null), destinationPending)).status, 'destination-pending')
  const destinationFailed = { ...base, status: 'destination-failed' as const, destinationHash: hash }
  assert.equal(mergeBridgeRecord(destinationFailed, { ...base, status: 'source-unknown' }).status, 'destination-failed')
  const swap: SwapRecord = { hash, account, target, calldata: '0x1234', fromSymbol: 'USDC', toSymbol: 'EURC', amount: '1', minimumOutputUnits: '1', timestamp: 1, status: 'unknown' }
  assert.equal(await checkSwapRecord(provider(null), swap), 'unknown')
})
