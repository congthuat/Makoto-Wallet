import {
  type EVMChainDefinition,
  type PreparedEVMTransaction,
  type createViemAdapterFromProvider,
} from '@circle-fin/adapter-viem-v2/next'
import type { CCTPV2BridgingProvider } from '@circle-fin/provider-cctp-v2'
import {
  decodeFunctionData,
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  isAddress,
  isHash,
  keccak256,
  pad,
  stringToHex,
  zeroAddress,
  zeroHash,
  type Address,
  type EIP1193Provider,
  type Hex,
} from 'viem'
import { ARC, TOKENS } from '../../lib/wallet.ts'
import type { SendProvider } from '../../lib/sendExecution.ts'
import {
  BASE_SEPOLIA_USDC,
  ARC_CCTP_DOMAIN,
  BASE_SEPOLIA_CCTP_DOMAIN,
  CCTP_KIT_BRIDGE_TESTNET,
  CCTP_MESSAGE_TRANSMITTER_V2,
  CCTP_TOKEN_MESSENGER_V2,
  CCTP_FORWARDING_HOOK_DATA,
} from '../../migrated/cctp.ts'
import type {
  BridgeToolQuote,
  CctpIntentSemantics,
  CctpTransferSpeed,
  PreparedGasEstimate,
  PreparedToolAction,
} from '../../migrated/toolLayer.ts'

const BASE_SEPOLIA_CHAIN_ID = 84532
const CCTP_QUOTE_MAX_AGE_MS = 45_000
const PREPARED_ACTION_TTL_MS = 60_000
const toHex = (value: bigint): Hex => `0x${value.toString(16)}`
type CircleProvider = InstanceType<typeof CCTPV2BridgingProvider>
type CircleViemAdapter = ReturnType<typeof createViemAdapterFromProvider>
type OfficialCctpChain = EVMChainDefinition & {
  cctp: { domain: number; contracts: { v2: { type: 'split'; tokenMessenger: string; messageTransmitter: string } } }
  usdcAddress: string
  kitContracts?: { bridge?: string }
}

type OfficialRoute = Readonly<{
  provider: CircleProvider
  adapter: CircleViemAdapter
  source: OfficialCctpChain
  destination: OfficialCctpChain
  spender: Address
  usdc: Address
}>

/** Dependency injection is used by no product call site; it lets tests supply an EIP-1193 mock. */
export type CctpAdapterDependencies = Readonly<{ createProvider?: () => CircleProvider }>

type CirclePrepared = Readonly<{
  transaction: PreparedEVMTransaction
  fingerprint: Hex
  consumed: { value: boolean }
}>

const preparedCapabilities = new WeakMap<PreparedToolAction, CirclePrepared>()

/** Minimal ABI copied from Circle's published adapter-viem-v2 1.18.0 custom-bridge action. */
export const CIRCLE_CUSTOM_BURN_WITH_HOOK_ABI = [{
  type: 'function',
  name: 'bridgeWithPreapprovalAndHook',
  stateMutability: 'nonpayable',
  inputs: [
    {
      name: 'bridgeParams', type: 'tuple',
      components: [
        { name: 'amount', type: 'uint256' },
        { name: 'maxFee', type: 'uint256' },
        { name: 'fee', type: 'uint256' },
        { name: 'mintRecipient', type: 'bytes32' },
        { name: 'destinationCaller', type: 'bytes32' },
        { name: 'burnToken', type: 'address' },
        { name: 'feeRecipient', type: 'address' },
        { name: 'destinationDomain', type: 'uint32' },
        { name: 'minFinalityThreshold', type: 'uint32' },
      ],
    },
    { name: 'hookData', type: 'bytes' },
  ],
  outputs: [],
}] as const

async function exactRoute(p: SendProvider, account: string, dependencies: CctpAdapterDependencies = {}): Promise<OfficialRoute> {
  if (!isAddress(account)) throw new Error('A connected wallet account is required')
  const provider = dependencies.createProvider?.() ?? new (await import('@circle-fin/provider-cctp-v2')).CCTPV2BridgingProvider()
  const sourceEntry = provider.supportedChains.find((chain) => chain.type === 'evm' && chain.chainId === ARC.chainId)
  const destinationEntry = provider.supportedChains.find((chain) => chain.type === 'evm' && chain.chainId === BASE_SEPOLIA_CHAIN_ID)
  if (!sourceEntry || !destinationEntry || sourceEntry.type !== 'evm' || destinationEntry.type !== 'evm') throw new Error('Circle CCTP v2 Arc Testnet to Base Sepolia configuration is unavailable')
  const source = sourceEntry as OfficialCctpChain
  const destination = destinationEntry as OfficialCctpChain
  if (!source.cctp?.contracts?.v2 || !destination.cctp?.contracts?.v2 || !source.usdcAddress || !destination.usdcAddress) throw new Error('Official Circle USDC CCTP v2 route metadata is incomplete')

  const usdcRegistry = TOKENS.find((token) => token.sym === 'USDC')
  if (!usdcRegistry || getAddress(source.usdcAddress) !== getAddress(usdcRegistry.address)) throw new Error('Official Circle Arc USDC conflicts with Makoto token registry; CCTP is stopped')
  if (source.cctp.contracts.v2.type !== 'split') throw new Error('Official Arc CCTP v2 token messenger configuration is unsupported')
  const tokenMessenger = getAddress(source.cctp.contracts.v2.tokenMessenger)
  if (tokenMessenger !== getAddress(CCTP_TOKEN_MESSENGER_V2) || getAddress(destination.cctp.contracts.v2.tokenMessenger) !== getAddress(CCTP_TOKEN_MESSENGER_V2)) throw new Error('Official Circle Arc/Base TokenMessenger conflicts with Makoto CCTP registry; CCTP is stopped')
  if (getAddress(source.cctp.contracts.v2.messageTransmitter) !== getAddress(CCTP_MESSAGE_TRANSMITTER_V2) || getAddress(destination.cctp.contracts.v2.messageTransmitter) !== getAddress(CCTP_MESSAGE_TRANSMITTER_V2)) throw new Error('Official Circle CCTP v2 MessageTransmitter conflicts with the verified Arc/Base route; CCTP is stopped')
  if (source.cctp.domain !== ARC_CCTP_DOMAIN || destination.cctp.domain !== BASE_SEPOLIA_CCTP_DOMAIN) throw new Error('Official Circle Arc/Base CCTP domains conflict with the verified route; CCTP is stopped')
  if (getAddress(destination.usdcAddress) !== getAddress(BASE_SEPOLIA_USDC)) throw new Error('Official Circle Base Sepolia USDC conflicts with the verified route; CCTP is stopped')
  if (!source.kitContracts?.bridge) throw new Error('Circle custom bridge contract is unavailable for Arc Testnet')
  const spender = getAddress(source.kitContracts.bridge)
  if (spender !== getAddress(CCTP_KIT_BRIDGE_TESTNET)) throw new Error('Official Circle Arc custom bridge conflicts with the verified route; CCTP is stopped')
  if (!provider.supportsRoute(source, destination, 'USDC', true)) throw new Error('Circle does not currently support the Arc Testnet to Base Sepolia USDC forwarding route')

  // The SDK stays bound to the connected EIP-1193 wallet. Developer-controlled
  // address context means the already-observed eth_accounts value is supplied
  // per operation; it avoids requestAddresses()/eth_requestAccounts() during
  // quote or prepare. Chain mismatch is rejected, never switched by the SDK.
  const { createViemAdapterFromProvider } = await import('@circle-fin/adapter-viem-v2/next')
  const adapter = createViemAdapterFromProvider({
    provider: p as unknown as EIP1193Provider,
    capabilities: { addressContext: 'developer-controlled' },
    chainSwitch: { onMismatch: 'throw' },
  })
  return { provider, adapter, source, destination, spender, usdc: getAddress(source.usdcAddress) }
}

function sourceContext(route: OfficialRoute, account: Address) {
  return { adapter: route.adapter, chain: route.source, address: account }
}

function destinationContext(route: OfficialRoute, account: Address) {
  return { adapter: route.adapter, chain: route.destination, address: account, recipientAddress: account, useForwarder: true as const }
}

function routeParams(route: OfficialRoute, account: Address, amount: bigint, transferSpeed: CctpTransferSpeed) {
  return {
    source: sourceContext(route, account),
    destination: destinationContext(route, account),
    amount: amount.toString(),
    token: 'USDC' as const,
    config: { transferSpeed, batchTransactions: false },
  }
}

function quoteFingerprint(quote: BridgeToolQuote): Hex {
  const fields = [
    quote.account.toLowerCase(), quote.sourceChainId, quote.destinationChainId,
    quote.destinationDomain, quote.recipient.toLowerCase(), quote.spender.toLowerCase(),
    quote.asset, quote.amount, quote.totalDebit, quote.expectedReceive,
    quote.providerFee, quote.forwarderFee, quote.maxFee, quote.transferSpeed,
  ]
  return keccak256(stringToHex(fields.join(':')))
}

function semanticsFingerprint(kind: PreparedToolAction['kind'], semantics: CctpIntentSemantics): Hex {
  const fields = [
    kind, semantics.asset, semantics.amount, semantics.expectedReceive,
    semantics.destinationChainId, semantics.destinationDomain,
    semantics.recipient.toLowerCase(), semantics.spender.toLowerCase(),
    semantics.providerFee, semantics.forwarderFee, semantics.maxFee,
    semantics.transferSpeed, semantics.approvalAmount ?? '', semantics.finalityThreshold ?? '',
  ]
  return keccak256(stringToHex(fields.join(':')))
}

function assertFreshQuote(quote: BridgeToolQuote, now: number) {
  if (quote.asset !== 'USDC' || quote.sourceChainId !== ARC.chainId || quote.destinationChainId !== BASE_SEPOLIA_CHAIN_ID) throw new Error('Unsupported CCTP asset or route')
  if (now < quote.quotedAt || now > quote.expiresAt) throw new Error('Circle CCTP fee observation expired; refresh the quote')
  if (quote.totalDebit !== quote.amount || quote.amount <= 0n || quote.maxFee !== quote.providerFee + quote.forwarderFee || quote.maxFee < 0n || quote.expectedReceive !== quote.amount - quote.maxFee || quote.expectedReceive <= 0n) throw new Error('Circle CCTP fee semantics are invalid')
}

export async function getOfficialCctpQuote(
  p: SendProvider,
  input: { account: Address; amount: bigint; transferSpeed: CctpTransferSpeed; now?: number },
  dependencies: CctpAdapterDependencies = {},
): Promise<BridgeToolQuote> {
  const now = input.now ?? Date.now()
  if (input.amount <= 0n) throw new Error('Enter a positive USDC amount')
  if (input.transferSpeed !== 'FAST' && input.transferSpeed !== 'SLOW') throw new Error('Unsupported Circle CCTP transfer speed')
  const route = await exactRoute(p, input.account, dependencies)
  const params = routeParams(route, input.account, input.amount, input.transferSpeed)
  const fee = await route.provider.getMaxFee(params)
  if (fee.providerFee < 0n || fee.forwarderFee < 0n) throw new Error('Circle returned a negative CCTP fee')
  const maxFee = fee.providerFee + fee.forwarderFee
  if (maxFee >= input.amount) throw new Error('CCTP fee cap is greater than or equal to the USDC amount')
  const quote: BridgeToolQuote = Object.freeze({
    account: getAddress(input.account),
    sourceChainId: ARC.chainId,
    destinationChainId: BASE_SEPOLIA_CHAIN_ID,
    destinationDomain: route.destination.cctp.domain,
    recipient: getAddress(input.account),
    spender: route.spender,
    asset: 'USDC',
    amount: input.amount,
    totalDebit: input.amount,
    expectedReceive: input.amount - maxFee,
    providerFee: fee.providerFee,
    forwarderFee: fee.forwarderFee,
    maxFee,
    transferSpeed: input.transferSpeed,
    quotedAt: now,
    expiresAt: now + CCTP_QUOTE_MAX_AGE_MS,
    provider: 'Circle CCTP v2 official',
  })
  assertFreshQuote(quote, now)
  return quote
}

async function prepareCapturedCall(
  p: SendProvider,
  input: {
    route: OfficialRoute
    account: Address
    kind: 'approval' | 'cctp-burn'
    to: Address
    data: Hex
    value: bigint
    semantics: CctpIntentSemantics
    quote: BridgeToolQuote
    now: number
  },
): Promise<PreparedToolAction> {
  const preparation = await input.route.adapter.prepare(
    { type: 'raw', raw: { to: input.to, from: input.account, data: input.data, value: input.value } },
    { chain: input.route.source, address: input.account },
  )
  const transaction = preparation.single()
  const estimate = await transaction.estimate()
  if (estimate.units <= 0n || estimate.unitPrice <= 0n) throw new Error('Circle adapter returned an invalid gas estimate')
  const gasEstimate: PreparedGasEstimate = Object.freeze({ gasLimit: estimate.units, unitPrice: estimate.unitPrice, maximumFee: estimate.units * estimate.unitPrice })
  const request = Object.freeze({
    from: input.account,
    to: input.to,
    data: input.data,
    value: '0x0' as const,
    gas: toHex(gasEstimate.gasLimit),
    gasPrice: toHex(gasEstimate.unitPrice),
  })
  const action: PreparedToolAction = Object.freeze({
    kind: input.kind,
    account: input.account,
    chainId: ARC.chainId,
    request,
    preparedAt: input.now,
    expiresAt: Math.min(input.quote.expiresAt, input.now + PREPARED_ACTION_TTL_MS),
    quoteId: semanticsFingerprint(input.kind, input.semantics),
    executionEnabled: false,
    cctp: input.semantics,
    gasEstimate,
  })
  const fingerprint = keccak256(stringToHex(`${action.chainId}:${action.account.toLowerCase()}:${request.from.toLowerCase()}:${request.to.toLowerCase()}:${request.data.toLowerCase()}:${request.value}`))
  preparedCapabilities.set(action, { transaction, fingerprint, consumed: { value: false } })
  return action
}

export async function prepareExactCctpApproval(
  p: SendProvider,
  quote: BridgeToolQuote,
  currentAllowance: bigint,
  now = Date.now(),
  dependencies: CctpAdapterDependencies = {},
): Promise<PreparedToolAction> {
  assertFreshQuote(quote, now)
  if (currentAllowance >= quote.totalDebit) throw new Error('CCTP allowance is already sufficient')
  const route = await exactRoute(p, quote.account, dependencies)
  if (route.spender !== quote.spender) throw new Error('CCTP spender changed; request a new review')
  const data = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [route.spender, quote.totalDebit] })
  let decoded: ReturnType<typeof decodeFunctionData>
  try { decoded = decodeFunctionData({ abi: erc20Abi, data }) } catch { throw new Error('Makoto could not verify the bounded USDC approval') }
  const [approvedSpender, approvedAmount] = decoded.args as readonly [Address, bigint]
  if (decoded.functionName !== 'approve' || getAddress(approvedSpender) !== route.spender || approvedAmount !== quote.totalDebit) throw new Error('Makoto approval is not exact and bounded')
  const semantics: CctpIntentSemantics = Object.freeze({
    asset: 'USDC', amount: quote.totalDebit, expectedReceive: quote.expectedReceive,
    destinationChainId: quote.destinationChainId, destinationDomain: quote.destinationDomain,
    recipient: quote.recipient, spender: route.spender, providerFee: quote.providerFee,
    forwarderFee: quote.forwarderFee, maxFee: quote.maxFee,
    transferSpeed: quote.transferSpeed, approvalAmount: quote.totalDebit,
  })
  return prepareCapturedCall(p, { route, account: quote.account, kind: 'approval', to: route.usdc, data, value: 0n, semantics, quote, now })
}

export async function prepareOfficialCctpBurn(p: SendProvider, quote: BridgeToolQuote, now = Date.now(), dependencies: CctpAdapterDependencies = {}): Promise<PreparedToolAction> {
  assertFreshQuote(quote, now)
  const route = await exactRoute(p, quote.account, dependencies)
  if (route.spender !== quote.spender || quote.destinationDomain !== route.destination.cctp.domain) throw new Error('Official CCTP route or spender changed; request a new review')
  const params = {
    ...routeParams(route, quote.account, quote.amount, quote.transferSpeed),
    config: { transferSpeed: quote.transferSpeed, maxFee: quote.maxFee.toString(), batchTransactions: false },
  }
  const providerPrepared = await route.provider.burn(params)
  if (providerPrepared.type !== 'evm' || typeof providerPrepared.getCallData !== 'function') throw new Error('Circle provider did not return one reviewable EVM burn call')
  const call = providerPrepared.getCallData()
  const to = getAddress(call.to)
  const value = call.value ?? 0n
  if (to !== route.spender || value !== 0n) throw new Error(`Circle burn target or native value differs from the verified route (target ${to}, spender ${route.spender}, value ${value})`)
  let decoded: ReturnType<typeof decodeFunctionData>
  try { decoded = decodeFunctionData({ abi: CIRCLE_CUSTOM_BURN_WITH_HOOK_ABI, data: call.data as Hex }) } catch { throw new Error('Circle burn calldata does not match the published custom CCTP v2 call shape') }
  if (decoded.functionName !== 'bridgeWithPreapprovalAndHook') throw new Error('Circle provider returned an unsupported burn operation')
  const [bridgeParams, hookData] = decoded.args as readonly [{ amount: bigint; maxFee: bigint; fee: bigint; mintRecipient: Hex; destinationCaller: Hex; burnToken: Address; feeRecipient: Address; destinationDomain: number; minFinalityThreshold: number }, Hex]
  const { amount: burnAmount, maxFee, mintRecipient, burnToken, destinationCaller, fee, feeRecipient, destinationDomain, minFinalityThreshold: finalityThreshold } = bridgeParams
  const requiredFinality = quote.transferSpeed === 'FAST' ? 1000 : 2000
  if (
    burnAmount !== quote.amount || Number(destinationDomain) !== quote.destinationDomain ||
    mintRecipient.toLowerCase() !== pad(quote.recipient, { size: 32 }).toLowerCase() ||
    getAddress(burnToken) !== route.usdc || getAddress(feeRecipient) !== route.spender || fee !== 0n || destinationCaller.toLowerCase() !== zeroHash ||
    hookData.toLowerCase() !== CCTP_FORWARDING_HOOK_DATA.toLowerCase() || maxFee !== quote.maxFee ||
    Number(finalityThreshold) !== requiredFinality
  ) throw new Error('Circle burn fields differ from the reviewed USDC amount, recipient, fee cap, or route')

  const semantics: CctpIntentSemantics = Object.freeze({
    asset: 'USDC', amount: burnAmount, expectedReceive: quote.expectedReceive,
    destinationChainId: quote.destinationChainId, destinationDomain: quote.destinationDomain,
    recipient: quote.recipient, spender: route.spender, providerFee: quote.providerFee,
    forwarderFee: quote.forwarderFee, maxFee: quote.maxFee, transferSpeed: quote.transferSpeed,
    finalityThreshold: BigInt(finalityThreshold),
  })
  return prepareCapturedCall(p, {
    route, account: quote.account, kind: 'cctp-burn', to, data: call.data as Hex,
    value, semantics, quote, now,
  })
}

export async function simulatePreparedCctpCall(action: PreparedToolAction): Promise<Readonly<{ success: boolean; error?: string }>> {
  const prepared = preparedCapabilities.get(action)
  if (!prepared || !['approval', 'cctp-burn'].includes(action.kind)) return { success: false, error: 'Prepared Circle wallet capability is unavailable' }
  const result = await prepared.transaction.simulate()
  return result.success ? { success: true } : { success: false, error: result.error || 'Circle adapter simulation failed' }
}

/** Execute only the exact single prepared Circle request held in the module-private WeakMap. */
export async function executePreparedCctpCall(action: PreparedToolAction): Promise<Hex> {
  const prepared = preparedCapabilities.get(action)
  if (!prepared || prepared.consumed.value) throw new Error('This reviewed Circle request has already been used or expired')
  if (Date.now() < action.preparedAt || Date.now() >= action.expiresAt) throw new Error('Prepared Circle request expired; prepare and review again')
  const currentFingerprint = keccak256(stringToHex(`${action.chainId}:${action.account.toLowerCase()}:${action.request.from.toLowerCase()}:${action.request.to.toLowerCase()}:${action.request.data.toLowerCase()}:${action.request.value}`))
  if (currentFingerprint !== prepared.fingerprint || action.executionEnabled !== false) throw new Error('Circle request changed after review')
  if (!action.gasEstimate || action.gasEstimate.gasLimit <= 0n || action.gasEstimate.unitPrice <= 0n) throw new Error('Fresh gas estimate is required before wallet execution')
  prepared.consumed.value = true
  const result = await prepared.transaction.execute({ gas: action.gasEstimate.gasLimit, gasPrice: action.gasEstimate.unitPrice })
  if (!isHash(result.txId)) throw new Error('Connected wallet returned no transaction hash')
  return result.txId
}

export type CircleCctpStatus = Readonly<{
  state: 'attestation-pending' | 'attestation-available' | 'forwarding-pending' | 'forwarding-failed' | 'unavailable'
  forwardTxHash?: Hex
  eventNonce?: string
  messageHash?: Hex
  actualReceive?: bigint
  reason?: string
}>

export const CCTP_MESSAGE_SENT_ABI = [{
  type: 'event', name: 'MessageSent', anonymous: false,
  inputs: [{ name: 'message', type: 'bytes', indexed: false }],
}] as const

/** A successful Arc receipt is source-confirmed only when Circle's official v2 transmitter emitted MessageSent. */
export function hasOfficialCctpMessageEvent(
  account: Address,
  logs: readonly { address?: string; topics?: readonly Hex[]; data?: Hex }[],
): boolean {
  try {
    if (!isAddress(account) || getAddress(account) === zeroAddress) return false
    const transmitter = getAddress(CCTP_MESSAGE_TRANSMITTER_V2).toLowerCase()
    return logs.some((log) => {
      if (log.address?.toLowerCase() !== transmitter || !log.topics?.length || !log.data) return false
      try {
        const event = decodeEventLog({ abi: CCTP_MESSAGE_SENT_ABI, eventName: 'MessageSent', topics: log.topics as [Hex, ...Hex[]], data: log.data })
        return typeof event.args.message === 'string' && /^0x[0-9a-f]+$/i.test(event.args.message)
      } catch { return false }
    })
  } catch { return false }
}

export async function getOfficialCctpStatus(
  p: SendProvider,
  input: {
    account: Address
    burnHash: Hex
    destinationDomain: number
    recipient: Address
    expectedReceive: bigint
    maxFee: bigint
    finalityThreshold?: bigint
  },
  dependencies: CctpAdapterDependencies = {},
): Promise<CircleCctpStatus> {
  try {
    const route = await exactRoute(p, input.account, dependencies)
    const result = await route.provider.fetchAttestation(
      sourceContext(route, input.account), input.burnHash,
      { timeout: 1500, maxRetries: 1, retryDelay: 0 },
    )
    if (!result.message.startsWith('0x') || !result.attestation.startsWith('0x') || result.cctpVersion !== 2 || !result.eventNonce) throw new Error('Circle returned incomplete CCTP v2 message evidence')
    const decoded = result.decodedMessage
    const body = decoded.decodedMessageBody
    const messageAmount = BigInt(body.amount)
    const feeExecuted = BigInt(body.feeExecuted ?? body.maxFee ?? input.maxFee)
    const actualReceive = messageAmount - feeExecuted
    const expectedRecipient = pad(getAddress(input.recipient), { size: 32 }).toLowerCase()
    const destinationTransmitter = route.destination.cctp.contracts.v2.messageTransmitter
    if (
      Number(decoded.sourceDomain) !== route.source.cctp.domain ||
      Number(decoded.destinationDomain) !== input.destinationDomain ||
      !sameAddressOrPadded(decoded.sender, route.source.cctp.contracts.v2.tokenMessenger) ||
      !sameAddressOrPadded(decoded.recipient, destinationTransmitter) ||
      !sameAddressOrPadded(body.burnToken, route.usdc) ||
      !sameAddressOrPadded(body.messageSender, route.spender) ||
      body.mintRecipient.toLowerCase() !== expectedRecipient ||
      !body.maxFee || BigInt(body.maxFee) !== input.maxFee || feeExecuted > input.maxFee ||
      messageAmount - BigInt(body.maxFee ?? input.maxFee) < input.expectedReceive ||
      actualReceive < input.expectedReceive ||
      (body.maxFee !== undefined && BigInt(body.maxFee) !== input.maxFee) ||
      (input.finalityThreshold !== undefined && BigInt(decoded.minFinalityThreshold) !== input.finalityThreshold)
    ) throw new Error('Circle attestation fields do not match the reviewed burn route and receive floor')
    const messageHash = keccak256(result.message as Hex)
    if (result.forwardState === 'FAILED') return { state: 'forwarding-failed', eventNonce: result.eventNonce, messageHash, actualReceive }
    if (result.forwardState === 'PENDING' || result.forwardState == null) return { state: result.status.toLowerCase() === 'pending' ? 'attestation-pending' : 'forwarding-pending', eventNonce: result.eventNonce, messageHash, actualReceive }
    if ((result.forwardState === 'CONFIRMED' || result.forwardState === 'COMPLETE') && result.forwardTxHash && isHash(result.forwardTxHash)) {
      return { state: 'attestation-available', forwardTxHash: result.forwardTxHash, eventNonce: result.eventNonce, messageHash, actualReceive }
    }
    return { state: 'attestation-available', eventNonce: result.eventNonce, messageHash, actualReceive }
  } catch (error) {
    if (error instanceof Error && /No attestation (?:found|messages found)/i.test(error.message)) return { state: 'attestation-pending' }
    return { state: 'unavailable', reason: error instanceof Error ? error.message : 'Official Circle CCTP status unavailable' }
  }
}

function sameAddressOrPadded(value: string, expected: string): boolean {
  const normalizedExpected = getAddress(expected).toLowerCase()
  const normalizedValue = value.toLowerCase()
  if (isAddress(value)) return getAddress(value).toLowerCase() === normalizedExpected
  return /^0x[0-9a-f]{64}$/i.test(value) && normalizedValue === pad(normalizedExpected as Address, { size: 32 }).toLowerCase()
}

export function sameCctpQuoteMaterial(a: BridgeToolQuote, b: BridgeToolQuote): boolean {
  return quoteFingerprint(a) === quoteFingerprint(b)
}

export function sameCctpActionMaterial(a: PreparedToolAction, b: PreparedToolAction): boolean {
  if (a.chainId !== b.chainId || a.account.toLowerCase() !== b.account.toLowerCase()) return false
  if (a.request.from.toLowerCase() !== b.request.from.toLowerCase() || a.request.to.toLowerCase() !== b.request.to.toLowerCase() || a.request.data.toLowerCase() !== b.request.data.toLowerCase() || BigInt(a.request.value) !== BigInt(b.request.value)) return false
  if (a.quoteId !== b.quoteId || a.kind !== b.kind) return false
  if (!a.cctp || !b.cctp) return false
  return semanticsFingerprint(a.kind, a.cctp) === semanticsFingerprint(b.kind, b.cctp)
}

export function cctpGasEstimateChanged(a: PreparedGasEstimate | undefined, b: PreparedGasEstimate | undefined): boolean {
  return !a || !b || a.gasLimit !== b.gasLimit || a.unitPrice !== b.unitPrice || a.maximumFee !== b.maximumFee
}
