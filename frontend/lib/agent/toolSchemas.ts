import {
  decodeFunctionData,
  getAddress,
  isAddress,
  isHash,
  keccak256,
  maxUint256,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { arcTestnet, baseSepolia } from "viem/chains";
import { erc20BalanceAbi } from "../abi/erc20.ts";
import {
  addressToBytes32,
  BASE_SEPOLIA_CCTP_DOMAIN,
  CCTP_FORWARDING_HOOK_DATA,
  CCTP_STANDARD_FINALITY,
  CCTP_TOKEN_MESSENGER_ABI,
  CCTP_TOKEN_MESSENGER_V2,
} from "../cctp.ts";
import { getAssetById, SUPPORTED_ASSETS, type SupportedAssetId } from "../assets.ts";
import { XYLO_ROUTER, xyloRouterAbi } from "../swap.ts";
import type { NormalizedTransactionRequest } from "../transactionOrchestrator.ts";
import type {
  ReadResult,
  ReadSource,
  ReadToolId,
} from "./readTools.ts";
import type {
  QuoteError,
  QuoteProvider,
  QuoteResult,
  QuoteToolId,
} from "./quoteTools.ts";
import type {
  PrepareRequest,
  PrepareResult,
  PreparedAction,
  PrepareToolId,
} from "./prepareTools.ts";
import type { AgentActionHandoff } from "./actions/types.ts";

export type ToolValidationCode =
  | "INVALID_SCHEMA"
  | "INVALID_INPUT"
  | "INVALID_CONTEXT"
  | "WRONG_ACCOUNT"
  | "WRONG_CHAIN"
  | "UNSUPPORTED"
  | "QUOTE_EXPIRED"
  | "QUOTE_MISMATCH"
  | "EXECUTION_AUTHORITY"
  | "UNKNOWN_PROVENANCE";

export type ToolValidationIssue = Readonly<{
  path: string;
  code: ToolValidationCode;
  message: string;
}>;

export type ToolValidationResult<T> =
  | Readonly<{ valid: true; value: T }>
  | Readonly<{ valid: false; errors: readonly ToolValidationIssue[] }>;

export type PreparedValidationOptions = Readonly<{
  now?: number;
  quote?: unknown;
}>;

const READ_TOOLS = new Set<ReadToolId>([
  "wallet.identity",
  "wallet.state",
  "network.verified",
  "assets.balances",
  "activity.recent",
  "activity.status",
  "token.allowance",
  "transaction.receipt",
  "bridge.operation",
]);
const READ_ERRORS = new Set(["INVALID_REQUEST", "UNSUPPORTED", "WALLET_UNAVAILABLE", "DATA_UNAVAILABLE", "PROVIDER_FAILURE"]);
const READ_SOURCES = new Set<ReadSource>([
  "wallet-provider",
  "wallet-balance-hook",
  "arc-rpc",
  "arcscan-api",
  "local-receipt",
  "bridge-operation-persistence",
  "circle-status",
  "unknown",
]);
const QUOTE_TOOLS = new Set<QuoteToolId>(["send.quote", "swap.quote", "bridge.quote"]);
const QUOTE_ERRORS = new Set<QuoteError>([
  "INVALID_INPUT",
  "WRONG_CONTEXT",
  "PROVIDER_UNAVAILABLE",
  "ROUTE_UNAVAILABLE",
  "QUOTE_FAILED",
  "QUOTE_EXPIRED",
  "EVIDENCE_UNAVAILABLE",
]);
const PROVIDERS = new Set<QuoteProvider>(["Arc RPC", "XyloNet StableSwap", "Circle CCTP V2 Forwarding", "Circle App Kit"]);
const FRESHNESS = new Set(["live", "snapshot", "unknown", "persisted"]);
const ASSETS = new Set<SupportedAssetId>(["usdc", "eurc", "cirbtc"]);
const QUOTE_SOURCES = new Set([...READ_SOURCES, "xylo-router", "circle-fee-api", "local-calculation"]);
const PREPARE_TOOLS = new Set<PrepareToolId>(["send.prepare", "swap.prepare", "bridge.prepare"]);
const PREPARE_ERRORS = new Set(["INVALID_INPUT", "WALLET_UNAVAILABLE", "WRONG_CONTEXT", "UNSUPPORTED", "INSUFFICIENT_BALANCE", "QUOTE_UNAVAILABLE", "QUOTE_EXPIRED", "QUOTE_MISMATCH", "EVIDENCE_UNAVAILABLE", "PREPARATION_FAILED"]);
const PREPARE_PROVENANCE = new Set([...QUOTE_SOURCES, "canonical-read", "canonical-quote"]);
const SLIPPAGES = new Set([0.005, 0.01, 0.03]);
const FORBIDDEN_KEYS = new Set([
  "signer",
  "walletClient",
  "publicClient",
  "connector",
  "submit",
  "sendTransaction",
  "writeContract",
  "execute",
  "executeAsync",
  "privateKey",
  "seed",
  "mnemonic",
  "secret",
  "password",
  "callback",
]);

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const has = (value: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const integer = (value: unknown): value is number => finite(value) && Number.isInteger(value);
const bigintValue = (value: unknown): value is bigint => typeof value === "bigint";
const nonNegative = (value: unknown): value is bigint => bigintValue(value) && value >= 0n;
const positive = (value: unknown): value is bigint => bigintValue(value) && value > 0n;
const address = (value: unknown): value is Address => typeof value === "string" && isAddress(value, { strict: true }) && getAddress(value) !== zeroAddress;
const sameAddress = (left: unknown, right: unknown) => address(left) && address(right) && getAddress(left) === getAddress(right);
const sameHex = (left: unknown, right: unknown) => typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();
const assetForAddress = (value: unknown): SupportedAssetId | undefined => address(value) ? SUPPORTED_ASSETS.find((asset) => getAddress(asset.address) === getAddress(value))?.id : undefined;
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every((key) => keys.includes(key));

function issue(path: string, code: ToolValidationCode, message: string): ToolValidationIssue {
  return Object.freeze({ path, code, message });
}

function invalid<T>(...errors: ToolValidationIssue[]): ToolValidationResult<T> {
  return Object.freeze({ valid: false, errors: Object.freeze(errors) });
}

function valid<T>(value: T): ToolValidationResult<T> {
  return Object.freeze({ valid: true, value });
}

function hasExecutionAuthority(value: unknown, path = ""): ToolValidationIssue[] {
  const errors: ToolValidationIssue[] = [];
  if (typeof value === "function") errors.push(issue(path, "EXECUTION_AUTHORITY", "Functions are not permitted in tool values."));
  if (!isObject(value) && !Array.isArray(value)) return errors;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (FORBIDDEN_KEYS.has(key)) errors.push(issue(childPath, "EXECUTION_AUTHORITY", `Execution authority field '${key}' is not permitted.`));
    errors.push(...hasExecutionAuthority(child, childPath));
  }
  return errors;
}

function validateEnvelope(value: unknown, tool: string, path: string, accountRequired: boolean): ToolValidationIssue[] {
  if (!isObject(value)) return [issue(path, "INVALID_SCHEMA", "Expected an object."), ...hasExecutionAuthority(value, path)];
  const errors: ToolValidationIssue[] = [];
  if (value.tool !== tool) errors.push(issue(`${path}.tool`, "INVALID_SCHEMA", `Expected tool ${tool}.`));
  if (accountRequired && !address(value.account)) errors.push(issue(`${path}.account`, "INVALID_CONTEXT", "A non-zero wallet address is required."));
  if (value.chainId !== undefined && (!integer(value.chainId) || value.chainId <= 0)) errors.push(issue(`${path}.chainId`, "WRONG_CHAIN", "Chain ID must be a positive integer."));
  errors.push(...hasExecutionAuthority(value, path));
  return errors;
}

function validateReadData(tool: ReadToolId, data: unknown, path: string, account?: Address): ToolValidationIssue[] {
  const errors: ToolValidationIssue[] = [];
  if (!isObject(data) && tool !== "assets.balances" && tool !== "activity.recent") return [issue(path, "INVALID_SCHEMA", "Read data must be an object.")];
  switch (tool) {
    case "wallet.identity": {
      const d = data as Record<string, unknown>;
      if (typeof d.exists !== "boolean") errors.push(issue(`${path}.exists`, "INVALID_SCHEMA", "Wallet identity must preserve exists."));
      if (d.kind !== undefined && d.kind !== "external" && d.kind !== "local") errors.push(issue(`${path}.kind`, "INVALID_SCHEMA", "Unknown wallet kind."));
      if (d.address !== undefined && !address(d.address)) errors.push(issue(`${path}.address`, "INVALID_SCHEMA", "Invalid wallet address."));
      break;
    }
    case "wallet.state": {
      const d = data as Record<string, unknown>;
      if (typeof d.exists !== "boolean" || typeof d.externallyConnected !== "boolean" || typeof d.localSigningLocked !== "boolean") errors.push(issue(path, "INVALID_SCHEMA", "Wallet state flags are required."));
      if (d.status !== "connected" && d.status !== "locked" && d.status !== "unavailable") errors.push(issue(`${path}.status`, "INVALID_SCHEMA", "Wallet state must be connected, locked, or unavailable."));
      if (d.status === "locked" && d.localSigningLocked !== true) errors.push(issue(`${path}.localSigningLocked`, "INVALID_CONTEXT", "Locked state must remain explicit."));
      break;
    }
    case "network.verified": {
      const d = data as Record<string, unknown>;
      if (d.chainId !== undefined && (!integer(d.chainId) || d.chainId <= 0)) errors.push(issue(`${path}.chainId`, "WRONG_CHAIN", "Invalid observed chain."));
      if (typeof d.isArc !== "boolean" || d.requiredChainId !== arcTestnet.id) errors.push(issue(path, "INVALID_CONTEXT", "Verified network must identify Arc Testnet."));
      break;
    }
    case "assets.balances": {
      if (!isObject(data)) return [issue(path, "INVALID_SCHEMA", "Balances must be an object.")];
      for (const [key, amount] of Object.entries(data)) {
        if (!ASSETS.has(key as SupportedAssetId) || !nonNegative(amount)) errors.push(issue(`${path}.${key}`, "INVALID_SCHEMA", "Balances must use known assets and non-negative bigint values."));
      }
      break;
    }
    case "activity.recent":
      if (!Array.isArray(data)) errors.push(issue(path, "INVALID_SCHEMA", "Recent activity must be an array."));
      break;
    case "activity.status": {
      const d = data as Record<string, unknown>;
      if (!["loading", "loaded", "partial", "unavailable"].includes(String(d.loadState)) || !integer(d.loadedCount) || !integer(d.confirmedCount) || !integer(d.unresolvedCount) || d.completeHistory !== false) errors.push(issue(path, "INVALID_SCHEMA", "Invalid activity status evidence."));
      break;
    }
    case "token.allowance": {
      const d = data as Record<string, unknown>;
      if (!ASSETS.has(d.assetId as SupportedAssetId) || !address(d.token) || !address(d.owner) || !address(d.spender) || !nonNegative(d.amount)) errors.push(issue(path, "INVALID_SCHEMA", "Invalid allowance evidence."));
      if (account && !sameAddress(d.owner, account)) errors.push(issue(`${path}.owner`, "WRONG_ACCOUNT", "Allowance owner does not match the read account."));
      const asset = getAssetById(d.assetId as SupportedAssetId);
      if (asset && !sameAddress(d.token, asset.address)) errors.push(issue(`${path}.token`, "INVALID_SCHEMA", "Allowance token does not match the asset registry."));
      break;
    }
    case "transaction.receipt": {
      const d = data as Record<string, unknown>;
      if (!isHash(d.hash as string) || !["pending", "confirmed", "failed", "unknown"].includes(String(d.state)) || typeof d.verified !== "boolean") errors.push(issue(path, "INVALID_SCHEMA", "Invalid receipt evidence."));
      if (d.blockNumber !== undefined && !nonNegative(d.blockNumber)) errors.push(issue(`${path}.blockNumber`, "INVALID_SCHEMA", "Invalid receipt block number."));
      break;
    }
    case "bridge.operation": {
      const d = data as Record<string, unknown>;
      if (typeof d.operationId !== "string" || !integer(d.sourceChainId) || !integer(d.destinationChainId) || !["not-submitted", "submitted", "confirmed", "failed", "unknown"].includes(String(d.source)) || !["pending", "confirmed", "failed", "unknown"].includes(String(d.destination))) errors.push(issue(path, "INVALID_SCHEMA", "Invalid bridge evidence."));
      if (d.sourceHash !== undefined && !isHash(d.sourceHash as string)) errors.push(issue(`${path}.sourceHash`, "INVALID_SCHEMA", "Invalid source transaction hash."));
      if (d.destinationHash !== undefined && !isHash(d.destinationHash as string)) errors.push(issue(`${path}.destinationHash`, "INVALID_SCHEMA", "Invalid destination transaction hash."));
      break;
    }
  }
  return errors;
}

/** Validates the common READ envelope and preserves locked/disconnected/partial states. */
export function validateReadResult(value: unknown): ToolValidationResult<ReadResult<unknown>> {
  if (!isObject(value) || !READ_TOOLS.has(value.tool as ReadToolId)) return invalid(issue("tool", "INVALID_SCHEMA", "Unknown READ tool."));
  const tool = value.tool as ReadToolId;
  const errors = validateEnvelope(value, tool, "read", false);
  if (value.account !== undefined && !address(value.account)) errors.push(issue("read.account", "INVALID_CONTEXT", "Invalid READ account."));
  if (!finite(value.capturedAt) || value.capturedAt < 0) errors.push(issue("read.capturedAt", "INVALID_SCHEMA", "capturedAt must be a finite timestamp."));
  if (value.observedAt !== null && !finite(value.observedAt)) errors.push(issue("read.observedAt", "INVALID_SCHEMA", "observedAt must be null or a finite timestamp."));
  if (!FRESHNESS.has(String(value.freshness))) errors.push(issue("read.freshness", "INVALID_SCHEMA", "Unknown freshness value."));
  if (!Array.isArray(value.source) || value.source.length === 0 || value.source.some((source) => !READ_SOURCES.has(source as ReadSource))) errors.push(issue("read.source", "UNKNOWN_PROVENANCE", "READ provenance must use known sources."));
  if (value.status !== "AVAILABLE" && value.status !== "PARTIAL" && value.status !== "UNAVAILABLE") errors.push(issue("read.status", "INVALID_SCHEMA", "Unknown READ status."));
  if (value.status === "UNAVAILABLE") {
    if (!READ_ERRORS.has(String(value.error)) || has(value, "data")) errors.push(issue("read", "INVALID_SCHEMA", "UNAVAILABLE READ results require a known error and no data."));
  } else {
    if (!has(value, "data")) errors.push(issue("read.data", "INVALID_SCHEMA", "Available READ results require data."));
    errors.push(...validateReadData(tool, value.data, "read.data", address(value.account) ? value.account : undefined));
    if (value.status === "PARTIAL" && !READ_ERRORS.has(String(value.error))) errors.push(issue("read.error", "INVALID_SCHEMA", "PARTIAL READ results require a known error."));
  }
  return errors.length ? invalid(...errors) : valid(value as ReadResult<unknown>);
}

function validateQuoteData(tool: QuoteToolId, data: unknown, path: string, base: Record<string, unknown>): ToolValidationIssue[] {
  if (!isObject(data)) return [issue(path, "INVALID_SCHEMA", "Quote data must be an object.")];
  const errors: ToolValidationIssue[] = [];
  const amount = base.inputAmount;
  if (!positive(amount)) errors.push(issue("quote.inputAmount", "INVALID_INPUT", "Quote amount must be positive bigint."));
  if (tool === "send.quote") {
    const d = data as Record<string, unknown>;
    if (!address(d.recipient) || !nonNegative(d.availableBalance) || typeof d.tokenBalanceCovers !== "boolean") errors.push(issue(path, "INVALID_SCHEMA", "Invalid send quote data."));
    for (const key of ["gasBalance", "maximumFeeRaw18", "maximumFeeUsdc6", "remainingBeforeFees", "remaining", "remainingGasBalance"]) if (d[key] !== undefined && !nonNegative(d[key])) errors.push(issue(`${path}.${key}`, "INVALID_SCHEMA", "Optional quote balances must be non-negative bigint values."));
    if (d.feeAwareAffordable !== undefined && typeof d.feeAwareAffordable !== "boolean") errors.push(issue(`${path}.feeAwareAffordable`, "INVALID_SCHEMA", "Invalid fee affordability flag."));
  } else if (tool === "swap.quote") {
    const d = data as Record<string, unknown>;
    if (!ASSETS.has(d.outputAsset as SupportedAssetId) || d.outputAsset === base.inputAsset || !positive(d.expectedOutput) || !positive(d.minimumReceived) || d.minimumReceived > d.expectedOutput || !SLIPPAGES.has(d.slippage as number) || ![50, 100, 300].includes(d.slippageBps as number) || d.route !== "xylonet-stableswap" || !sameAddress(d.router, XYLO_ROUTER) || d.fee !== "not-estimated") errors.push(issue(path, "INVALID_SCHEMA", "Invalid Xylo quote data."));
    if (d.slippage === 0.005 && d.slippageBps !== 50 || d.slippage === 0.01 && d.slippageBps !== 100 || d.slippage === 0.03 && d.slippageBps !== 300) errors.push(issue(`${path}.slippageBps`, "INVALID_SCHEMA", "Slippage and basis points must agree."));
    if (d.allowance !== undefined && !nonNegative(d.allowance) || d.approvalAmount !== undefined && !positive(d.approvalAmount)) errors.push(issue(path, "INVALID_SCHEMA", "Invalid allowance evidence."));
    if (d.approvalRequired !== undefined && typeof d.approvalRequired !== "boolean") errors.push(issue(`${path}.approvalRequired`, "INVALID_SCHEMA", "Invalid approval flag."));
    if (d.approvalRequired === true && (!nonNegative(d.allowance) || !positive(d.approvalAmount) || d.approvalAmount !== base.inputAmount)) errors.push(issue(path, "INVALID_CONTEXT", "Required approval must be finite and cover the quote amount."));
  } else {
    const d = data as Record<string, unknown>;
    const sourceDebitMatches = bigintValue(amount) && bigintValue(d.maximumFee) && d.sourceDebit === amount + d.maximumFee;
    if (d.destinationChainId !== base.destinationChainId || d.route !== "cctp-direct-forwarding" || !address(d.recipient) || !positive(d.expectedReceive) || !positive(d.sourceDebit) || !nonNegative(d.protocolFee) || !nonNegative(d.forwardingFee) || !nonNegative(d.maximumFee) || !sourceDebitMatches || d.expectedReceive !== amount || d.finalityThreshold !== CCTP_STANDARD_FINALITY || !sameAddress(d.spender, CCTP_TOKEN_MESSENGER_V2) || d.gasFee !== "not-estimated") errors.push(issue(path, "INVALID_SCHEMA", "Invalid Direct CCTP quote data."));
    if (d.allowance !== undefined && !nonNegative(d.allowance) || d.approvalAmount !== undefined && !positive(d.approvalAmount)) errors.push(issue(path, "INVALID_SCHEMA", "Invalid bridge allowance evidence."));
    if (d.approvalRequired !== undefined && typeof d.approvalRequired !== "boolean") errors.push(issue(`${path}.approvalRequired`, "INVALID_SCHEMA", "Invalid approval flag."));
    if (d.approvalRequired === true && (!nonNegative(d.allowance) || d.approvalAmount !== d.sourceDebit)) errors.push(issue(path, "INVALID_CONTEXT", "Required bridge approval must exactly cover source debit."));
  }
  return errors;
}

/** Validates quote identity, provider binding, freshness, expiry, and operation-specific data. */
export function validateQuoteResult(value: unknown, now = Date.now()): ToolValidationResult<QuoteResult<unknown>> {
  if (!isObject(value) || !QUOTE_TOOLS.has(value.tool as QuoteToolId)) return invalid(issue("tool", "INVALID_SCHEMA", "Unknown QUOTE tool."));
  const tool = value.tool as QuoteToolId;
  const errors = validateEnvelope(value, tool, "quote", true);
  if (!PROVIDERS.has(value.provider as QuoteProvider)) errors.push(issue("quote.provider", "UNKNOWN_PROVENANCE", "Unknown quote provider."));
  if (!ASSETS.has(value.inputAsset as SupportedAssetId) || !positive(value.inputAmount)) errors.push(issue("quote.inputAmount", "INVALID_INPUT", "Quote input asset and amount are invalid."));
  if (!integer(value.chainId) || value.chainId !== arcTestnet.id) errors.push(issue("quote.chainId", "WRONG_CHAIN", "Quotes are bound to Arc Testnet."));
  if (!finite(value.observedAt) || value.observedAt < 0) errors.push(issue("quote.observedAt", "INVALID_SCHEMA", "Invalid quote observation timestamp."));
  if (value.outputAsset !== undefined && !ASSETS.has(value.outputAsset as SupportedAssetId)) errors.push(issue("quote.outputAsset", "INVALID_SCHEMA", "Unknown output asset."));
  if (value.destinationChainId !== undefined && (!integer(value.destinationChainId) || value.destinationChainId <= 0)) errors.push(issue("quote.destinationChainId", "WRONG_CHAIN", "Invalid destination chain."));
  if (value.recipient !== undefined && !address(value.recipient)) errors.push(issue("quote.recipient", "INVALID_SCHEMA", "Invalid quote recipient."));
  if (!Array.isArray(value.provenance) || value.provenance.length === 0 || value.provenance.some((source) => !QUOTE_SOURCES.has(source as string))) errors.push(issue("quote.provenance", "UNKNOWN_PROVENANCE", "Quote provenance must use known sources."));
  if (!Array.isArray(value.warnings) || value.warnings.some((warning) => typeof warning !== "string")) errors.push(issue("quote.warnings", "INVALID_SCHEMA", "Quote warnings must be strings."));
  if (!(["local-max-age", "observation-only"] as string[]).includes(String(value.validity))) errors.push(issue("quote.validity", "INVALID_SCHEMA", "Unknown quote validity."));
  if (value.status === "AVAILABLE" || value.status === "PARTIAL") {
    if (value.status === "AVAILABLE" && (!finite(value.quotedAt) || !finite(value.expiresAt) || value.expiresAt <= value.quotedAt || now > (value.expiresAt as number))) errors.push(issue("quote.expiresAt", "QUOTE_EXPIRED", "Currently usable quotes must have a future expiry."));
    if (value.status === "PARTIAL" && ((value.quotedAt === null) !== (value.expiresAt === null) || value.quotedAt !== null && (!finite(value.quotedAt) || !finite(value.expiresAt) || value.expiresAt <= value.quotedAt))) errors.push(issue("quote.expiresAt", "INVALID_SCHEMA", "Partial quote timestamps must be both null or a valid pair."));
    errors.push(...validateQuoteData(tool, value.data, "quote.data", value));
    if (value.status === "PARTIAL" && !QUOTE_ERRORS.has(value.error as QuoteError)) errors.push(issue("quote.error", "INVALID_SCHEMA", "PARTIAL quotes require a known error."));
  } else {
    if (!QUOTE_ERRORS.has(value.error as QuoteError) || has(value, "data")) errors.push(issue("quote", "INVALID_SCHEMA", "Unavailable quote results require a known error and no data."));
    if (value.status !== "EXPIRED" && (value.quotedAt !== null || value.expiresAt !== null)) errors.push(issue("quote.expiresAt", "INVALID_SCHEMA", "Unavailable quotes cannot advertise a usable expiry."));
    if (value.status === "EXPIRED" && value.error !== "QUOTE_EXPIRED") errors.push(issue("quote.error", "QUOTE_EXPIRED", "Expired quote results must carry QUOTE_EXPIRED."));
  }
  if (tool === "send.quote" && value.provider !== "Arc RPC" || tool === "swap.quote" && value.provider !== "XyloNet StableSwap" || tool === "bridge.quote" && value.provider !== "Circle CCTP V2 Forwarding" && value.provider !== "Circle App Kit") errors.push(issue("quote.provider", "QUOTE_MISMATCH", "Provider does not match the quote tool."));
  return errors.length ? invalid(...errors) : valid(value as QuoteResult<unknown>);
}

/** A valid terminal/partial quote is not automatically safe to prepare. */
export function isCurrentlyUsableQuote(value: QuoteResult<unknown>, now = Date.now()): boolean {
  return value.status === "AVAILABLE" && finite(value.quotedAt) && finite(value.expiresAt) && value.expiresAt > value.quotedAt && now <= value.expiresAt;
}

function validateRequest(value: unknown, path: string): ToolValidationIssue[] {
  if (!isObject(value)) return [issue(path, "INVALID_SCHEMA", "Transaction request must be an object.")];
  const errors: ToolValidationIssue[] = [];
  if (!exactKeys(value, ["to", "data", "value", "chainId", "gas", "maxFeePerGas", "maxPriorityFeePerGas"])) errors.push(issue(path, "INVALID_SCHEMA", "Transaction request contains unsupported fields."));
  if (!address(value.to) || typeof value.data !== "string" || !/^0x[0-9a-f]*$/i.test(value.data) || value.data.length < 10 || value.chainId !== arcTestnet.id || value.value !== "0") errors.push(issue(path, "INVALID_SCHEMA", "Transaction request must be normalized for Arc with zero native value."));
  for (const key of ["gas", "maxFeePerGas", "maxPriorityFeePerGas"]) if (value[key] !== undefined && (typeof value[key] !== "string" || !/^\d+$/.test(value[key] as string))) errors.push(issue(`${path}.${key}`, "INVALID_SCHEMA", "Normalized fee fields must be decimal strings."));
  return errors;
}

function decode(request: NormalizedTransactionRequest, abi: readonly unknown[]): { functionName: string; args: readonly unknown[] } | undefined {
  try {
    const decoded = decodeFunctionData({ abi: abi as never, data: request.data });
    return { functionName: decoded.functionName, args: (decoded.args ?? []) as readonly unknown[] };
  } catch {
    return undefined;
  }
}

function validateStep(step: unknown, action: Record<string, unknown>, index: number): ToolValidationIssue[] {
  const path = `prepared.steps[${index}]`;
  if (!isObject(step)) return [issue(path, "INVALID_SCHEMA", "Prepare steps must be objects.")];
  const errors: ToolValidationIssue[] = [];
  if (!exactKeys(step, ["kind", "chainId", "account", "target", "assetId", "amount", "request", "spender", "minimumOutput", "destinationChainId", "requiresConfirmedPriorStep", "requiresFreshReview"])) errors.push(issue(path, "INVALID_SCHEMA", "Step contains unsupported fields."));
  if (step.chainId !== arcTestnet.id || !address(step.account) || !sameAddress(step.account, action.account) || !address(step.target) || !ASSETS.has(step.assetId as SupportedAssetId) || !positive(step.amount) || step.requiresFreshReview !== true) errors.push(issue(path, "INVALID_CONTEXT", "Step account, chain, asset, amount, and fresh-review flag are invalid."));
  errors.push(...validateRequest(step.request, `${path}.request`));
  if (!isObject(step.request)) return errors;
  if (step.request.to !== getAddress(step.target as Address)) errors.push(issue(`${path}.request.to`, "INVALID_SCHEMA", "Request target must match step target."));
  const asset = getAssetById(step.assetId as SupportedAssetId);
  if (step.kind === "send") {
    if (index !== 0 || !asset) return [...errors, issue(`${path}.kind`, "UNSUPPORTED", "Send preparation has exactly one known token transfer step.")];
    const decoded = decode(step.request as NormalizedTransactionRequest, erc20BalanceAbi);
    const args = decoded?.args ?? [];
    if (decoded?.functionName !== "transfer" || args.length !== 2 || !address(args[0]) || args[1] !== step.amount || step.amount !== action.inputAmount || !sameAddress(step.target, asset.address)) errors.push(issue(path, "INVALID_SCHEMA", "Send step must be a bounded ERC-20 transfer."));
  } else if (step.kind === "finite-approval") {
    const decoded = decode(step.request as NormalizedTransactionRequest, erc20BalanceAbi);
    const spender = step.spender;
    const expectedSpender = action.tool === "swap.prepare" ? XYLO_ROUTER : action.tool === "bridge.prepare" ? CCTP_TOKEN_MESSENGER_V2 : undefined;
    const args = decoded?.args ?? [];
    if (!expectedSpender || decoded?.functionName !== "approve" || !sameAddress(spender, expectedSpender) || !sameAddress(args[0], expectedSpender) || args[1] !== step.amount || !positive(args[1]) || args[1] >= maxUint256 || !asset || !sameAddress(step.target, asset.address)) errors.push(issue(path, "INVALID_SCHEMA", "Approval step must be finite and use the operation's known spender."));
    if (step.requiresConfirmedPriorStep !== undefined) errors.push(issue(`${path}.requiresConfirmedPriorStep`, "INVALID_SCHEMA", "Approval cannot require a prior step."));
  } else if (step.kind === "swap") {
    const decoded = decode(step.request as NormalizedTransactionRequest, xyloRouterAbi);
    const args = decoded?.args[0] as Record<string, unknown> | undefined;
    const output = assetForAddress(args?.tokenOut);
    const outputAsset = output ? getAssetById(output) : undefined;
    if (action.tool !== "swap.prepare" || decoded?.functionName !== "swap" || !sameAddress(step.target, XYLO_ROUTER) || !asset || !outputAsset || output === step.assetId || !args || !sameAddress(args.tokenIn, asset.address) || !sameAddress(args.tokenOut, outputAsset.address) || args.amountIn !== step.amount || step.amount !== action.inputAmount || !positive(step.minimumOutput) || args.minAmountOut !== step.minimumOutput || !sameAddress(args.to, action.account) || !positive(args.deadline)) errors.push(issue(path, "INVALID_SCHEMA", "Swap step must match the known Xylo route and bounded minimum output."));
    if (index === 0 && step.requiresConfirmedPriorStep !== undefined) errors.push(issue(`${path}.requiresConfirmedPriorStep`, "INVALID_SCHEMA", "Swap cannot claim a prior approval when it is the first step."));
  } else if (step.kind === "cctp-burn") {
    const decoded = decode(step.request as NormalizedTransactionRequest, CCTP_TOKEN_MESSENGER_ABI);
    const args = decoded?.args ?? [];
    if (action.tool !== "bridge.prepare" || decoded?.functionName !== "depositForBurnWithHook" || !sameAddress(step.target, CCTP_TOKEN_MESSENGER_V2) || step.assetId !== "usdc" || step.destinationChainId !== baseSepolia.id || args.length !== 8 || args[0] !== step.amount || args[1] !== BASE_SEPOLIA_CCTP_DOMAIN || !sameHex(args[2], addressToBytes32(action.account as Address)) || !sameAddress(args[3], getAssetById("usdc")!.address) || !sameHex(args[4], "0x0000000000000000000000000000000000000000000000000000000000000000") || !nonNegative(args[5]) || args[6] !== CCTP_STANDARD_FINALITY || !sameHex(args[7], CCTP_FORWARDING_HOOK_DATA)) errors.push(issue(path, "INVALID_SCHEMA", "CCTP burn step must match the known Direct CCTP forwarding route."));
  } else errors.push(issue(`${path}.kind`, "UNSUPPORTED", "Unknown prepare step kind."));
  return errors;
}

/** Validates bounded PREPARE output, finite approvals, and absence of execution authority. */
export function validatePreparedAction(value: unknown, options: PreparedValidationOptions = {}): ToolValidationResult<PreparedAction> {
  if (!isObject(value) || !PREPARE_TOOLS.has(value.tool as PrepareToolId)) return invalid(issue("tool", "INVALID_SCHEMA", "Unknown PREPARE tool."));
  const errors = validateEnvelope(value, value.tool as string, "prepared", true);
  const preparedExpiresAt = finite(value.expiresAt) ? value.expiresAt : undefined;
  if (value.chainId !== arcTestnet.id || value.executionEnabled !== false) errors.push(issue("prepared.executionEnabled", "EXECUTION_AUTHORITY", "Prepared actions are data-only and Arc-bound."));
  if (!PROVIDERS.has(value.provider as QuoteProvider) || !ASSETS.has(value.inputAsset as SupportedAssetId) || !positive(value.inputAmount)) errors.push(issue("prepared", "INVALID_SCHEMA", "Invalid prepared action identity."));
  if (!finite(value.preparedAt) || !finite(value.expiresAt) || !finite(value.quoteQuotedAt) || !finite(value.balanceObservedAt) || value.expiresAt <= value.preparedAt || value.quoteQuotedAt > value.preparedAt) errors.push(issue("prepared", "INVALID_SCHEMA", "Prepared timestamps and expiry are invalid."));
  if (finite(options.now) && (options.now as number) > (value.expiresAt as number)) errors.push(issue("prepared.expiresAt", "QUOTE_EXPIRED", "Prepared action has expired."));
  if (typeof value.quoteFingerprint !== "string" || !isHash(value.quoteFingerprint)) errors.push(issue("prepared.quoteFingerprint", "INVALID_SCHEMA", "Quote fingerprint must be a hash."));
  if (!Array.isArray(value.provenance) || value.provenance.length === 0 || value.provenance.some((source) => !PREPARE_PROVENANCE.has(source as string))) errors.push(issue("prepared.provenance", "UNKNOWN_PROVENANCE", "Prepared provenance must use known sources."));
  if (!Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > 2) errors.push(issue("prepared.steps", "INVALID_SCHEMA", "Prepared actions may contain one bounded write or one finite approval followed by it."));
  if (!Array.isArray(value.reviewSummary) || value.reviewSummary.some((line) => typeof line !== "string")) errors.push(issue("prepared.reviewSummary", "INVALID_SCHEMA", "Review summary must be text."));
  if (value.limitations !== undefined && (!Array.isArray(value.limitations) || value.limitations.some((line) => typeof line !== "string"))) errors.push(issue("prepared.limitations", "INVALID_SCHEMA", "Limitations must be text."));
  if (value.handoff !== undefined) {
    const handoff = validateHandoff(value.handoff, options.now ?? Date.now());
    if (!handoff.valid) errors.push(...handoff.errors);
    else if (preparedExpiresAt !== undefined && preparedExpiresAt > handoff.value.expiresAt) errors.push(issue("prepared.expiresAt", "QUOTE_MISMATCH", "Prepared expiry cannot exceed handoff validity."));
  }
  if (Array.isArray(value.steps)) {
    value.steps.forEach((stepValue, index) => errors.push(...validateStep(stepValue, value, index)));
    const kinds = value.steps.map((stepValue) => isObject(stepValue) ? stepValue.kind : undefined);
    if (value.tool === "send.prepare" && (kinds.length !== 1 || kinds[0] !== "send")) errors.push(issue("prepared.steps", "UNSUPPORTED", "Send preparation requires one send step."));
    if (value.tool === "swap.prepare" && (kinds[kinds.length - 1] !== "swap" || kinds.some((kind, index) => kind === "finite-approval" && index !== 0))) errors.push(issue("prepared.steps", "INVALID_SCHEMA", "Swap approval must precede its swap step."));
    if (value.tool === "bridge.prepare" && (kinds[kinds.length - 1] !== "cctp-burn" || kinds.some((kind, index) => kind === "finite-approval" && index !== 0))) errors.push(issue("prepared.steps", "INVALID_SCHEMA", "Bridge approval must precede its CCTP burn step."));
    if (value.steps.length === 2 && isObject(value.steps[1]) && value.steps[1].requiresConfirmedPriorStep !== true) errors.push(issue("prepared.steps[1].requiresConfirmedPriorStep", "INVALID_SCHEMA", "Dependent writes require a confirmed prior receipt."));
  }
  if (value.tool === "swap.prepare" && (value.provider !== "XyloNet StableSwap" || value.route !== "xylonet-stableswap")) errors.push(issue("prepared.route", "QUOTE_MISMATCH", "Swap preparation must remain bound to Xylo."));
  if (value.tool === "bridge.prepare" && (value.provider !== "Circle CCTP V2 Forwarding" || value.route !== "cctp-direct-forwarding" || value.destinationChainId !== baseSepolia.id || !sameAddress(value.recipient, value.account))) errors.push(issue("prepared.route", "QUOTE_MISMATCH", "Bridge preparation must remain bound to Direct CCTP."));
  if (options.quote !== undefined) {
    const quote = validateQuoteResult(options.quote, options.now ?? Date.now());
    if (!quote.valid) errors.push(...quote.errors);
    else if (!isCurrentlyUsableQuote(quote.value, options.now ?? Date.now())) errors.push(issue("prepared.quote", "QUOTE_EXPIRED", "Prepared actions require a currently usable quote."));
    else if (preparedExpiresAt !== undefined && finite(quote.value.expiresAt) && preparedExpiresAt > quote.value.expiresAt) errors.push(issue("prepared.expiresAt", "QUOTE_MISMATCH", "Prepared expiry cannot exceed quote expiry."));
    else if (quoteFingerprint(quote.value) !== value.quoteFingerprint) errors.push(issue("prepared.quoteFingerprint", "QUOTE_MISMATCH", "Prepared fingerprint does not match the supplied quote."));
  }
  return errors.length ? invalid(...errors) : valid(value as PreparedAction);
}

/** Validates the PREPARE result envelope, including truthful unavailable states. */
export function validatePrepareResult(value: unknown, options: PreparedValidationOptions = {}): ToolValidationResult<PrepareResult> {
  if (!isObject(value) || !PREPARE_TOOLS.has(value.tool as PrepareToolId)) return invalid(issue("tool", "INVALID_SCHEMA", "Unknown PREPARE tool."));
  const tool = value.tool as PrepareToolId;
  const errors = validateEnvelope(value, tool, "prepare", false);
  if (value.status === "PREPARED") {
    if (!has(value, "data") || has(value, "error")) errors.push(issue("prepare", "INVALID_SCHEMA", "PREPARED results require data and no error."));
    else {
      const prepared = validatePreparedAction(value.data, options);
      if (!prepared.valid) errors.push(...prepared.errors);
    }
  } else if (value.status === "UNAVAILABLE" || value.status === "UNSUPPORTED" || value.status === "EXPIRED") {
    if (!PREPARE_ERRORS.has(value.error as string) || has(value, "data")) errors.push(issue("prepare", "INVALID_SCHEMA", "Unavailable PREPARE results require a known error and no data."));
  } else errors.push(issue("prepare.status", "INVALID_SCHEMA", "Unknown PREPARE status."));
  return errors.length ? invalid(...errors) : valid(value as PrepareResult);
}

/** Validates the discriminated PREPARE request and rejects arbitrary calldata fields. */
export function validatePrepareRequest(value: unknown, now = Date.now()): ToolValidationResult<PrepareRequest> {
  if (!isObject(value) || !PREPARE_TOOLS.has(value.tool as PrepareToolId)) return invalid(issue("tool", "INVALID_SCHEMA", "Unknown PREPARE request."));
  const tool = value.tool as PrepareToolId;
  const required = tool === "send.prepare" ? ["tool", "account", "chainId", "assetId", "amount", "recipient", "quote"] : tool === "swap.prepare" ? ["tool", "account", "chainId", "inputAsset", "outputAsset", "amount", "slippage", "quote"] : ["tool", "account", "chainId", "destinationChainId", "assetId", "amount", "recipient", "route", "quote"];
  const errors: ToolValidationIssue[] = [];
  if (!exactKeys(value, required)) errors.push(issue("request", "INVALID_SCHEMA", "PREPARE request contains unsupported fields."));
  if (!address(value.account) || value.chainId !== arcTestnet.id || !positive(value.amount) || value.amount >= maxUint256) errors.push(issue("request", "INVALID_INPUT", "Prepare request context or amount is invalid."));
  if (tool !== "swap.prepare" && (!ASSETS.has(value.assetId as SupportedAssetId) || !address(value.recipient))) errors.push(issue("request", "INVALID_INPUT", "Send/bridge asset and recipient are invalid."));
  if (tool === "swap.prepare" && (!ASSETS.has(value.inputAsset as SupportedAssetId) || !ASSETS.has(value.outputAsset as SupportedAssetId) || value.inputAsset === value.outputAsset || !SLIPPAGES.has(value.slippage as number))) errors.push(issue("request", "INVALID_INPUT", "Swap assets or slippage are invalid."));
  if (tool === "bridge.prepare" && (value.destinationChainId !== baseSepolia.id || value.route !== "cctp-direct-forwarding" || value.assetId !== "usdc" || !sameAddress(value.recipient, value.account))) errors.push(issue("request", "UNSUPPORTED", "Only Arc to Base Sepolia Direct CCTP is supported."));
  const quote = validateQuoteResult(value.quote, now);
  if (!quote.valid) errors.push(...quote.errors);
  else {
    const candidate = quote.value;
    const expectedTool = tool.replace("prepare", "quote");
    const expectedAsset = tool === "swap.prepare" ? value.inputAsset : value.assetId;
    if (!isCurrentlyUsableQuote(candidate, now)) errors.push(issue("request.quote", candidate.status === "EXPIRED" ? "QUOTE_EXPIRED" : "QUOTE_MISMATCH", "PREPARE requires a currently usable quote."));
    if (candidate.tool !== expectedTool || !sameAddress(candidate.account, value.account) || candidate.chainId !== value.chainId || candidate.inputAsset !== expectedAsset || candidate.inputAmount !== value.amount) errors.push(issue("request.quote", "QUOTE_MISMATCH", "Quote does not match PREPARE identity."));
    if (tool === "send.prepare" && (candidate.provider !== "Arc RPC" || !sameAddress(candidate.recipient, value.recipient))) errors.push(issue("request.quote", "QUOTE_MISMATCH", "Send quote recipient or provider does not match."));
    const candidateRecord = candidate as unknown as Record<string, unknown>;
    if (tool === "swap.prepare" && (candidate.provider !== "XyloNet StableSwap" || candidate.outputAsset !== value.outputAsset || candidate.route !== "xylonet-stableswap" || !isObject(candidateRecord.data) || candidateRecord.data.slippage !== value.slippage)) errors.push(issue("request.quote", "QUOTE_MISMATCH", "Swap quote does not match pair, route, or slippage."));
    if (tool === "bridge.prepare" && (candidate.provider !== "Circle CCTP V2 Forwarding" || candidate.destinationChainId !== value.destinationChainId || !sameAddress(candidate.recipient, value.recipient) || candidate.route !== value.route)) errors.push(issue("request.quote", "QUOTE_MISMATCH", "Bridge quote does not match route or destination."));
  }
  return errors.length ? invalid(...errors) : valid(value as PrepareRequest);
}

/** Validates the data-only agent handoff shape used by prepared actions. */
export function validateHandoff(value: unknown, now = Date.now()): ToolValidationResult<AgentActionHandoff> {
  if (!isObject(value)) return invalid(issue("handoff", "INVALID_SCHEMA", "Handoff must be an object."));
  const errors: ToolValidationIssue[] = [];
  if (!exactKeys(value, ["id", "path", "action", "account", "createdAt", "expiresAt", "amount", "asset", "sourceChain", "destinationChain", "outputAsset", "recipient", "jarId", "source"])) errors.push(issue("handoff", "INVALID_SCHEMA", "Handoff contains unsupported fields."));
  if (typeof value.id !== "string" || typeof value.path !== "string" || !["send", "swap", "bridge", "vault-deposit", "vault-withdraw"].includes(String(value.action)) || value.source !== "makoto-agent" || !address(value.account) || !finite(value.createdAt) || !finite(value.expiresAt) || value.expiresAt <= value.createdAt || typeof value.amount !== "string" || !/^\d+(\.\d{1,8})?$/.test(value.amount) || typeof value.asset !== "string") errors.push(issue("handoff", "INVALID_SCHEMA", "Handoff identity, timestamps, or amount is invalid."));
  if (finite(value.expiresAt) && now > (value.expiresAt as number)) errors.push(issue("handoff.expiresAt", "QUOTE_EXPIRED", "Handoff has expired."));
  if (value.recipient !== undefined && !address(value.recipient)) errors.push(issue("handoff.recipient", "INVALID_SCHEMA", "Invalid handoff recipient."));
  if (value.sourceChain !== undefined && value.sourceChain !== "Arc Testnet" && value.sourceChain !== "Base Sepolia") errors.push(issue("handoff.sourceChain", "WRONG_CHAIN", "Unknown handoff source chain."));
  if (value.destinationChain !== undefined && value.destinationChain !== "Arc Testnet" && value.destinationChain !== "Base Sepolia") errors.push(issue("handoff.destinationChain", "WRONG_CHAIN", "Unknown handoff destination chain."));
  if (value.action === "swap" && (value.asset !== "USDC" && value.asset !== "EURC" || value.outputAsset !== "USDC" && value.outputAsset !== "EURC")) errors.push(issue("handoff", "UNSUPPORTED", "Swap handoffs require known stablecoins."));
  if (value.action === "send" && value.asset !== "USDC" && value.asset !== "EURC") errors.push(issue("handoff.asset", "UNSUPPORTED", "Send handoffs require USDC or EURC."));
  errors.push(...hasExecutionAuthority(value, "handoff"));
  return errors.length ? invalid(...errors) : valid(value as AgentActionHandoff);
}

/** Stable fingerprint used to bind a prepared action to the exact quote evidence. */
export function quoteFingerprint(value: QuoteResult<unknown>): Hex {
  return keccak256(toHex(JSON.stringify(value, (_key, child) => typeof child === "bigint" ? child.toString() : child)));
}

export type { PrepareResult };
