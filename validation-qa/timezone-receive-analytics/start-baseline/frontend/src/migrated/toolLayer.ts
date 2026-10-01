import { decodeFunctionResult, encodeFunctionData, erc20Abi, getAddress, isAddress, isHash, keccak256, stringToHex, zeroAddress, type Address, type Hex } from 'viem'
import { ARC, TOKENS, getProvider, type Holding, type NetworkInfo, type TokenMeta, type Tx } from '../lib/wallet.ts'
import { parseSendAmount, prepareSend, type PreparedSend, type SendProvider } from '../lib/sendExecution.ts'
import { getAssetById, type SupportedAssetId } from './assets.ts'
import { CCTP_KIT_BRIDGE_TESTNET } from './cctp.ts'
import { createXyloQuote, minimumSwapOutput, prepareXyloSwapRequest, SWAP_QUOTE_MAX_AGE_MS, XYLO_ROUTER, xyloRouterAbi, type SwapQuote } from './swap.ts'
import { getOfficialCctpQuote, prepareExactCctpApproval, prepareOfficialCctpBurn, type CctpAdapterDependencies } from '../protocols/circle/cctpAdapter.ts'

/** Adapted from donor agent read/quote/prepare contracts. Results contain data, never a provider or signer. */
export type ToolStatus = 'OK' | 'PARTIAL' | 'STALE' | 'UNAVAILABLE'
export type ToolResult<T> = Readonly<{ status: ToolStatus; source: string; observedAt: number; data?: T; reason?: string }>
export type WalletObservation = Readonly<{ account: Address; chainId: number }>
export type BalanceObservation = Readonly<{ asset: TokenMeta; account: Address; units: bigint }>
export type AllowanceObservation = Readonly<{ asset: TokenMeta; owner: Address; spender: Address; units: bigint }>
export type ReceiptObservation = Readonly<{ hash: Hex; status: 'pending' | 'confirmed' | 'failed' | 'unknown'; blockNumber?: bigint }>
export type BoundedRequest = Readonly<{ from: Address; to: Address; data: Hex; value: '0x0'; gas: Hex; gasPrice: Hex }>
export type CctpTransferSpeed = 'FAST' | 'SLOW'
export type CctpIntentSemantics = Readonly<{
  asset: 'USDC'
  amount: bigint
  expectedReceive: bigint
  destinationChainId: 84532
  destinationDomain: number
  recipient: Address
  spender: Address
  providerFee: bigint
  forwarderFee: bigint
  maxFee: bigint
  transferSpeed: CctpTransferSpeed
  approvalAmount?: bigint
  finalityThreshold?: bigint
}>
export type PreparedGasEstimate = Readonly<{ gasLimit: bigint; unitPrice: bigint; maximumFee: bigint }>
export type SwapToolQuote = Readonly<{ quote: SwapQuote; account: Address; balance: bigint; allowance: bigint; minimumReceive: bigint; slippage: 0.005 | 0.01 | 0.03; expiresAt: number; provider: 'XyloNet StableSwap' }>
export type BridgeToolQuote = Readonly<{
  account: Address
  sourceChainId: typeof ARC.chainId
  destinationChainId: 84532
  destinationDomain: number
  recipient: Address
  spender: Address
  asset: 'USDC'
  amount: bigint
  totalDebit: bigint
  expectedReceive: bigint
  providerFee: bigint
  forwarderFee: bigint
  maxFee: bigint
  transferSpeed: CctpTransferSpeed
  quotedAt: number
  expiresAt: number
  provider: 'Circle CCTP v2 official'
}>
export type PreparedToolAction = Readonly<{
  kind: 'swap' | 'approval' | 'cctp-burn'
  account: Address
  chainId: number
  request: BoundedRequest
  preparedAt: number
  expiresAt: number
  quoteId: Hex
  executionEnabled: false
  cctp?: CctpIntentSemantics
  gasEstimate?: PreparedGasEstimate
}>

const empty = <T>(reason: string, source = 'wallet-provider'): ToolResult<T> => Object.freeze({ status: 'UNAVAILABLE', source, observedAt: Date.now(), reason })
const ok = <T>(data: T, source = 'wallet-provider'): ToolResult<T> => Object.freeze({ status: 'OK', source, observedAt: Date.now(), data })
const req = (p: SendProvider, method: string, params: unknown[] = []) => p.request({ method, params })
const hex = (value: bigint): Hex => `0x${value.toString(16)}`
const address = (value: string): Address => { if (!isAddress(value) || getAddress(value) === zeroAddress) throw new Error('Invalid address'); return getAddress(value) }
const bigint = (value: unknown): bigint => { if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) throw new Error('Invalid RPC result'); return BigInt(value) }

export async function readWallet(p = getProvider()): Promise<ToolResult<WalletObservation>> {
  if (!p) return empty('Wallet provider unavailable')
  try {
    const [rawAccounts, rawChain] = await Promise.all([req(p, 'eth_accounts'), req(p, 'eth_chainId')])
    const account = Array.isArray(rawAccounts) ? rawAccounts[0] : undefined
    if (typeof account !== 'string' || !isAddress(account)) return empty('Wallet disconnected')
    const chainId = Number(rawChain)
    if (!Number.isSafeInteger(chainId) || chainId <= 0) return empty('Wallet chain unavailable')
    return ok({ account: address(account), chainId })
  } catch { return empty('Wallet context unavailable') }
}

export async function readNetwork(p: SendProvider): Promise<ToolResult<{ chainId: number; blockNumber: bigint; gasPrice: bigint }>> {
  try {
    const wallet = await requireArc(p)
    const [block, gasPrice] = await Promise.all([req(p, 'eth_blockNumber'), req(p, 'eth_gasPrice')])
    return ok({ chainId: wallet.chainId, blockNumber: bigint(block), gasPrice: bigint(gasPrice) }, 'arc-rpc')
  } catch (error) { return empty(error instanceof Error ? error.message : 'Network unavailable', 'arc-rpc') }
}

export function readActivitySnapshot(activity: readonly Tx[], options: { connected: boolean; loading: boolean; error?: string | null; observedAt: number }): ToolResult<readonly Tx[]> {
  if (!options.connected) return { status: 'UNAVAILABLE', source: 'arc-explorer', observedAt: Date.now(), reason: 'Connect a wallet for live activity' }
  if (options.error) return { status: 'UNAVAILABLE', source: 'arc-explorer', observedAt: Date.now(), reason: options.error }
  if (options.loading) return { status: 'STALE', source: 'arc-explorer', observedAt: options.observedAt, reason: 'Activity is loading' }
  return { status: 'OK', source: 'arc-explorer+local-receipts', observedAt: options.observedAt, data: Object.freeze([...activity]) }
}

/** The current wallet API owns balance semantics, including Arc native USDC.
 * Read its verified display snapshot instead of inventing another valuation. */
export function readAgentWalletSnapshot(input: {
  mode: 'demo' | 'watch' | 'connected'; address: string; holdings: readonly Holding[];
  loading: boolean; walletError?: string | null; balanceError?: string | null;
  total: number; pricesReady: boolean; observedAt: number;
}): ToolResult<{ account: string; holdings: readonly Holding[]; totalUsd?: number }> {
  const unavailable = (reason: string): ToolResult<{ account: string; holdings: readonly Holding[]; totalUsd?: number }> => ({ status: 'UNAVAILABLE', source: 'arc-wallet-snapshot', observedAt: input.observedAt, reason })
  if (input.mode === 'demo' || !isAddress(input.address) || input.address === zeroAddress) return unavailable('Wallet address required')
  if (input.walletError) return unavailable('Wallet data unavailable')
  if (input.loading) return { status: 'STALE', source: 'arc-wallet-snapshot', observedAt: input.observedAt, reason: 'Wallet data is loading' }
  const holdings = TOKENS.map((token) => input.holdings.find((holding) => holding.verified && holding.address.toLowerCase() === token.address.toLowerCase() && holding.symbol === token.sym && holding.decimals === token.decimals))
  if (holdings.some((holding) => !holding || !Number.isFinite(holding.balance) || holding.balance < 0)) return unavailable('Verified wallet balances unavailable')
  const totalUsd = input.pricesReady && !input.balanceError && Number.isFinite(input.total) && input.total >= 0 ? input.total : undefined
  return { status: 'OK', source: 'arc-wallet-snapshot', observedAt: input.observedAt, data: Object.freeze({ account: input.address, holdings: Object.freeze(holdings.map((holding) => Object.freeze({ ...holding! }))), ...(totalUsd === undefined ? {} : { totalUsd }) }) }
}

/** Global Arc telemetry is read-only and does not require a connected wallet. */
export function readAgentNetworkSnapshot(network: NetworkInfo | undefined, options: { error: boolean; observedAt: number }): ToolResult<NetworkInfo> {
  const base = { source: 'arc-rpc-snapshot', observedAt: network?.updatedAt ?? options.observedAt }
  if (options.error || !network || network.chainId !== ARC.chainId || !Number.isInteger(network.blockNumber) || network.blockNumber < 0 || !Number.isFinite(network.updatedAt)) return { ...base, status: 'UNAVAILABLE', reason: 'Network data unavailable' }
  if (options.observedAt - network.updatedAt > 60_000 || network.updatedAt > options.observedAt + 5000) return { ...base, status: 'STALE', reason: 'Network data is stale' }
  return { ...base, status: 'OK', data: Object.freeze({ ...network }) }
}

export async function readAgentWalletSummary(): Promise<ToolResult<{ wallet: WalletObservation; balances: readonly BalanceObservation[] }>> {
  const p = getProvider()
  if (!p) return empty('Wallet provider unavailable')
  const wallet = await readWallet(p)
  if (wallet.status !== 'OK' || !wallet.data || wallet.data.chainId !== ARC.chainId) return empty(wallet.reason ?? 'Arc wallet unavailable')
  const results = await Promise.all(TOKENS.map((token) => readBalance(p, token.sym, wallet.data!.account)))
  if (results.some((result) => result.status !== 'OK' || !result.data)) return empty('One or more token balances unavailable', 'arc-rpc')
  return ok({ wallet: wallet.data, balances: results.map((result) => result.data!) }, 'arc-rpc')
}

export async function readAgentNetwork(): Promise<ToolResult<{ chainId: number; blockNumber: bigint; gasPrice: bigint }>> {
  const p = getProvider()
  return p ? readNetwork(p) : empty('Wallet provider unavailable')
}

async function requireArc(p: SendProvider, expectedAccount?: string): Promise<WalletObservation> {
  const result = await readWallet(p)
  if (result.status !== 'OK' || !result.data) throw new Error(result.reason ?? 'Wallet unavailable')
  if (result.data.chainId !== ARC.chainId) throw new Error('Wrong network')
  if (expectedAccount && result.data.account.toLowerCase() !== expectedAccount.toLowerCase()) throw new Error('Account changed')
  return result.data
}

async function verifyToken(p: SendProvider, token: TokenMeta) {
  const [code, decimals, rawSymbol] = await Promise.all([req(p, 'eth_getCode', [token.address, 'latest']), req(p, 'eth_call', [{ to: token.address, data: '0x313ce567' }, 'latest']), req(p, 'eth_call', [{ to: token.address, data: '0x95d89b41' }, 'latest'])])
  if (typeof code !== 'string' || code === '0x' || bigint(decimals) !== BigInt(token.decimals)) throw new Error('Token metadata unavailable')
  if (typeof rawSymbol !== 'string' || !rawSymbol.startsWith('0x') || decodeFunctionResult({ abi: erc20Abi, functionName: 'symbol', data: rawSymbol as Hex }) !== token.sym) throw new Error('Token symbol mismatch')
}

export async function readBalance(p: SendProvider, symbol: string, expectedAccount?: string): Promise<ToolResult<BalanceObservation>> {
  try {
    const wallet = await requireArc(p, expectedAccount)
    const asset = TOKENS.find((item) => item.sym === symbol)
    if (!asset) return empty('Unsupported asset')
    await verifyToken(p, asset)
    const data = encodeFunctionData({ abi: erc20Abi, functionName: 'balanceOf', args: [wallet.account] })
    const units = bigint(await req(p, 'eth_call', [{ to: asset.address, data }, 'latest']))
    return ok({ asset, account: wallet.account, units }, 'arc-rpc')
  } catch (error) { return empty(error instanceof Error ? error.message : 'Balance unavailable', 'arc-rpc') }
}

/** Arc's native USDC gas balance is reported in the chain's native smallest units. */
export async function readGasBalance(p: SendProvider, expectedAccount?: string): Promise<ToolResult<bigint>> {
  try {
    const wallet = await requireArc(p, expectedAccount)
    return ok(bigint(await req(p, 'eth_getBalance', [wallet.account, 'latest'])), 'arc-native-balance')
  } catch (error) { return empty(error instanceof Error ? error.message : 'Gas balance unavailable', 'arc-native-balance') }
}

export async function readAllowance(p: SendProvider, symbol: string, spender: string, expectedAccount?: string): Promise<ToolResult<AllowanceObservation>> {
  try {
    const wallet = await requireArc(p, expectedAccount)
    const asset = TOKENS.find((item) => item.sym === symbol)
    if (!asset) return empty('Unsupported asset')
    const target = address(spender)
    await verifyToken(p, asset)
    const data = encodeFunctionData({ abi: erc20Abi, functionName: 'allowance', args: [wallet.account, target] })
    const units = bigint(await req(p, 'eth_call', [{ to: asset.address, data }, 'latest']))
    return ok({ asset, owner: wallet.account, spender: target, units }, 'arc-rpc')
  } catch (error) { return empty(error instanceof Error ? error.message : 'Allowance unavailable', 'arc-rpc') }
}

export async function readReceipt(p: SendProvider, hash: string): Promise<ToolResult<ReceiptObservation>> {
  if (!isHash(hash)) return empty('Invalid hash', 'arc-rpc')
  try {
    const receipt = await req(p, 'eth_getTransactionReceipt', [hash])
    if (!receipt) return ok({ hash, status: 'pending' }, 'arc-rpc')
    if (receipt.transactionHash?.toLowerCase() !== hash.toLowerCase() || !receipt.blockHash || !receipt.blockNumber) return ok({ hash, status: 'unknown' }, 'arc-rpc')
    return ok({ hash, status: receipt.status === '0x1' ? 'confirmed' : receipt.status === '0x0' ? 'failed' : 'unknown', blockNumber: bigint(receipt.blockNumber) }, 'arc-rpc')
  } catch { return empty('Receipt unavailable', 'arc-rpc') }
}

export async function quoteSwap(p: SendProvider, input: { account: string; from: 'USDC' | 'EURC'; to: 'USDC' | 'EURC'; amount: string; slippage: 0.005 | 0.01 | 0.03 }, now = Date.now()): Promise<ToolResult<SwapToolQuote>> {
  try {
    const wallet = await requireArc(p, input.account)
    if (input.from === input.to) throw new Error('Swap pair must differ')
    const from = getAssetById(input.from.toLowerCase() as SupportedAssetId)!
    const to = getAssetById(input.to.toLowerCase() as SupportedAssetId)!
    const amount = parseSendAmount(input.amount, from.decimals)
    const [routerCode, balance, allowance] = await Promise.all([req(p, 'eth_getCode', [XYLO_ROUTER, 'latest']), readBalance(p, input.from, wallet.account), readAllowance(p, input.from, XYLO_ROUTER, wallet.account)])
    if (routerCode === '0x' || balance.status !== 'OK' || allowance.status !== 'OK' || !balance.data || !allowance.data) throw new Error('Swap evidence unavailable')
    if (balance.data.units < amount) throw new Error('Insufficient balance')
    const callData = encodeFunctionData({ abi: xyloRouterAbi, functionName: 'getAmountOut', args: [from.address, to.address, amount] })
    const raw = await req(p, 'eth_call', [{ to: XYLO_ROUTER, data: callData }, 'latest'])
    if (typeof raw !== 'string' || !raw.startsWith('0x')) throw new Error('Swap quote unavailable')
    const out = decodeFunctionResult({ abi: xyloRouterAbi, functionName: 'getAmountOut', data: raw as Hex }) as bigint
    const quote = createXyloQuote(from.id, to.id, amount, out, now)
    return ok({ quote, account: wallet.account, balance: balance.data.units, allowance: allowance.data.units, minimumReceive: minimumSwapOutput(out, input.slippage), slippage: input.slippage, expiresAt: now + SWAP_QUOTE_MAX_AGE_MS, provider: 'XyloNet StableSwap' }, 'XyloNet StableSwap')
  } catch (error) { return empty(error instanceof Error ? error.message : 'Swap quote unavailable', 'XyloNet StableSwap') }
}

export async function quoteBridge(p: SendProvider, input: { account: string; amount: string; asset?: string; sourceChainId?: number; destinationChainId?: number; transferSpeed?: CctpTransferSpeed }, now = Date.now(), dependencies: CctpAdapterDependencies = {}): Promise<ToolResult<BridgeToolQuote>> {
  try {
    if (input.asset !== undefined && input.asset !== 'USDC') throw new Error('CCTP write execution supports USDC only')
    if (input.sourceChainId !== undefined && input.sourceChainId !== ARC.chainId) throw new Error('Only Arc Testnet to Base Sepolia is supported')
    if (input.destinationChainId !== undefined && input.destinationChainId !== 84532) throw new Error('Only Arc Testnet to Base Sepolia is supported')
    const wallet = await requireArc(p, input.account)
    const amount = parseSendAmount(input.amount, 6)
    const quote = await getOfficialCctpQuote(p, { account: wallet.account, amount, transferSpeed: input.transferSpeed ?? 'FAST', now }, dependencies)
    const balance = await readBalance(p, 'USDC', wallet.account)
    if (balance.status !== 'OK' || !balance.data || balance.data.units < quote.totalDebit) throw new Error('Insufficient USDC or balance unavailable')
    return ok(quote, 'Circle CCTP v2 official')
  } catch (error) { return empty(error instanceof Error ? error.message : 'CCTP quote unavailable', 'Circle CCTP v2 official') }
}

export async function boundRequest(p: SendProvider, account: Address, to: Address, data: Hex): Promise<BoundedRequest> {
  await requireArc(p, account)
  const estimate = bigint(await req(p, 'eth_estimateGas', [{ from: account, to, data, value: '0x0' }]))
  const price = bigint(await req(p, 'eth_gasPrice'))
  const gas = (estimate * 12n + 9n) / 10n
  const gasPrice = price * 2n > 20_000_000_000n ? price * 2n : 20_000_000_000n
  const gasBalance = bigint(await req(p, 'eth_getBalance', [account, 'latest']))
  const usdc = await readBalance(p, 'USDC', account)
  if (!gas || !gasPrice || gasBalance < gas * gasPrice || usdc.status !== 'OK' || !usdc.data || usdc.data.units < (gas * gasPrice + 999_999_999_999n) / 1_000_000_000_000n) throw new Error('Fee unavailable or unaffordable')
  return Object.freeze({ from: account, to, data, value: '0x0', gas: hex(gas), gasPrice: hex(gasPrice) })
}

export async function prepareApproval(p: SendProvider, input: { account: string; symbol: 'USDC' | 'EURC'; spender: string; amount: bigint }, now = Date.now()): Promise<PreparedToolAction> {
  const wallet = await requireArc(p, input.account)
  const asset = TOKENS.find((item) => item.sym === input.symbol)!
  const spender = address(input.spender)
  if (spender.toLowerCase() !== XYLO_ROUTER.toLowerCase() && spender.toLowerCase() !== CCTP_KIT_BRIDGE_TESTNET.toLowerCase()) throw new Error('Untrusted spender')
  if (input.amount <= 0n || input.amount >= (1n << 256n) - 1n) throw new Error('Approval must be finite')
  const data = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, input.amount] })
  const request = await boundRequest(p, wallet.account, address(asset.address), data)
  return Object.freeze({ kind: 'approval', account: wallet.account, chainId: wallet.chainId, request, preparedAt: now, expiresAt: now + 60_000, quoteId: keccak256(stringToHex(`${asset.address}:${spender}:${input.amount}`)), executionEnabled: false })
}

export async function prepareSwap(p: SendProvider, quoted: SwapToolQuote, now = Date.now()): Promise<PreparedToolAction> {
  const wallet = await requireArc(p, quoted.account)
  if (now > quoted.expiresAt || quoted.allowance < quoted.quote.amountIn || quoted.account !== wallet.account) throw new Error('Swap quote expired or approval required')
  const prepared = prepareXyloSwapRequest(quoted.quote, quoted.slippage, wallet.account, now)
  const request = await boundRequest(p, wallet.account, XYLO_ROUTER, prepared.calldata)
  return Object.freeze({ kind: 'swap', account: wallet.account, chainId: wallet.chainId, request, preparedAt: now, expiresAt: Math.min(quoted.expiresAt, now + 60_000), quoteId: keccak256(stringToHex(`${quoted.quote.quotedAt}:${quoted.quote.amountIn}:${quoted.quote.amountOut}:${quoted.minimumReceive}`)), executionEnabled: false })
}

export async function prepareCctpBurn(p: SendProvider, quoted: BridgeToolQuote, now = Date.now(), dependencies: CctpAdapterDependencies = {}): Promise<PreparedToolAction> {
  const wallet = await requireArc(p, quoted.account)
  if (now > quoted.expiresAt || quoted.account.toLowerCase() !== wallet.account.toLowerCase()) throw new Error('CCTP quote expired or account changed')
  const allowance = await readAllowance(p, 'USDC', quoted.spender, wallet.account)
  if (allowance.status !== 'OK' || !allowance.data || allowance.data.units < quoted.totalDebit) throw new Error('CCTP approval required')
  return prepareOfficialCctpBurn(p, quoted, now, dependencies)
}

/** Exact finite Makoto approval; Circle's additive increaseAllowance primitive is deliberately not used. */
export async function prepareCctpApproval(p: SendProvider, quoted: BridgeToolQuote, currentAllowance: bigint, now = Date.now(), dependencies: CctpAdapterDependencies = {}): Promise<PreparedToolAction> {
  const wallet = await requireArc(p, quoted.account)
  if (now > quoted.expiresAt || quoted.account.toLowerCase() !== wallet.account.toLowerCase()) throw new Error('CCTP quote expired or account changed')
  if (currentAllowance >= quoted.totalDebit) throw new Error('CCTP approval is not required')
  return prepareExactCctpApproval(p, quoted, currentAllowance, now, dependencies)
}

/** Send stays owned by its proven implementation; exposing this entry does not replace its request path. */
export const prepareCanonicalSend = (p: SendProvider, input: Parameters<typeof prepareSend>[1]): Promise<PreparedSend> => prepareSend(p, input)
