import { decodeEventLog, getAddress, isAddress, isHash, type Address, type Hash, type Hex } from "viem";

export const BRIDGE_OPERATION_STORAGE_VERSION = 1;
export const BRIDGE_OPERATION_UPDATED_EVENT = "makoto-wallet:bridge-operation-updated";

const STORAGE_PREFIX = `makoto-wallet:bridge-operations:v${BRIDGE_OPERATION_STORAGE_VERSION}`;
const MAX_OPERATIONS = 25;

export type BridgeOperationState =
  | "approval-review"
  | "approval-submitted"
  | "approval-confirming"
  | "approval-confirmed"
  | "approval-failed"
  | "approval-confirmation-unknown"
  | "burn-review"
  | "burn-submitted"
  | "source-confirming"
  | "source-confirmed"
  | "source-failed"
  | "source-confirmation-unknown"
  | "waiting-circle"
  | "forwarding-submitted"
  | "destination-verification-pending"
  | "destination-confirmed"
  | "destination-failed";

export type BridgeTransactionRole = "approval" | "burn" | "forward" | "mint";
export type BridgeTransactionStatus = "submitted" | "confirming" | "confirmed" | "reverted" | "unknown";

export type BridgeOperationTransaction = {
  role: BridgeTransactionRole;
  chainId: number;
  hash: Hash;
  status: BridgeTransactionStatus;
  blockNumber?: string;
  explorerUrl: string;
};

export type BridgeDestinationEvidence = {
  transactionHash: Hash;
  transferAmount: string;
  transferLogIndex: number;
  balance: string;
  verifiedAt: number;
};

export type BridgeOperation = {
  id: string;
  provider: "circle-cctp-v2-forwarding";
  route: "arc-testnet-to-base-sepolia";
  sourceChainId: 5_042_002;
  destinationChainId: 84_532;
  sender: Address;
  recipient: Address;
  asset: "usdc";
  requestedAmount: string;
  totalSourceDebit: string;
  fees: { protocol: string; forwarding: string };
  state: BridgeOperationState;
  circle?: { messageStatus?: string; attestationStatus?: string; forwardingState?: string; checkedAt: number };
  destinationEvidence?: BridgeDestinationEvidence;
  createdAt: number;
  updatedAt: number;
  transactions: BridgeOperationTransaction[];
};

export type BridgeLogicalIntent = {
  provider: string;
  route: string;
  sourceChainId: number;
  destinationChainId: number;
  sender: Address;
  recipient: Address;
  asset: string;
  requestedAmount: string;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const transferEventAbi = [{
  type: "event",
  name: "Transfer",
  inputs: [
    { indexed: true, name: "from", type: "address" },
    { indexed: true, name: "to", type: "address" },
    { indexed: false, name: "value", type: "uint256" },
  ],
}] as const;

export function bridgeOperationKey(address: Address) {
  return `${STORAGE_PREFIX}:${address.toLowerCase()}`;
}

export function bridgeLogicalIntentIdentity(intent: BridgeLogicalIntent) {
  return JSON.stringify([
    intent.provider,
    intent.route,
    intent.sourceChainId,
    intent.destinationChainId,
    getAddress(intent.sender).toLowerCase(),
    getAddress(intent.recipient).toLowerCase(),
    intent.asset.toLowerCase(),
    BigInt(intent.requestedAmount).toString(),
  ]);
}

export function isSameBridgeLogicalIntent(left: BridgeLogicalIntent, right: BridgeLogicalIntent) {
  return bridgeLogicalIntentIdentity(left) === bridgeLogicalIntentIdentity(right);
}

export function createBridgeOperation(input: {
  id?: string;
  sender: Address;
  recipient?: Address;
  requestedAmount: bigint;
  totalSourceDebit: bigint;
  protocolFee: bigint;
  forwardingFee: bigint;
  state: "approval-review" | "burn-review";
  now?: number;
}): BridgeOperation {
  if (input.requestedAmount <= 0n || input.totalSourceDebit < input.requestedAmount) throw new Error("Invalid bridge amounts.");
  const now = input.now ?? Date.now();
  return {
    id: input.id ?? crypto.randomUUID(),
    provider: "circle-cctp-v2-forwarding",
    route: "arc-testnet-to-base-sepolia",
    sourceChainId: 5_042_002,
    destinationChainId: 84_532,
    sender: getAddress(input.sender),
    recipient: getAddress(input.recipient ?? input.sender),
    asset: "usdc",
    requestedAmount: input.requestedAmount.toString(),
    totalSourceDebit: input.totalSourceDebit.toString(),
    fees: { protocol: input.protocolFee.toString(), forwarding: input.forwardingFee.toString() },
    state: input.state,
    createdAt: now,
    updatedAt: now,
    transactions: [],
  };
}

export function updateBridgeOperation(operation: BridgeOperation, patch: Partial<Pick<BridgeOperation, "state" | "circle" | "destinationEvidence">>, now = Date.now()): BridgeOperation {
  return { ...operation, ...patch, updatedAt: now };
}

export function updateBridgeOperationQuote(operation: BridgeOperation, input: { totalSourceDebit: bigint; protocolFee: bigint; forwardingFee: bigint }, now = Date.now()): BridgeOperation {
  if (input.totalSourceDebit < BigInt(operation.requestedAmount) || input.protocolFee < 0n || input.forwardingFee < 0n) throw new Error("Invalid bridge quote.");
  return {
    ...operation,
    totalSourceDebit: input.totalSourceDebit.toString(),
    fees: { protocol: input.protocolFee.toString(), forwarding: input.forwardingFee.toString() },
    updatedAt: now,
  };
}

export function upsertBridgeTransaction(operation: BridgeOperation, transaction: BridgeOperationTransaction, now = Date.now()): BridgeOperation {
  const identity = bridgeTransactionIdentity(transaction);
  const existing = operation.transactions.findIndex((item) => bridgeTransactionIdentity(item) === identity);
  const transactions = existing < 0
    ? [...operation.transactions, normalizeTransaction(transaction)]
    : operation.transactions.map((item, index) => index === existing ? normalizeTransaction({ ...item, ...transaction }) : item);
  return { ...operation, transactions, updatedAt: now };
}

export function bridgeTransactionIdentity(transaction: Pick<BridgeOperationTransaction, "role" | "chainId" | "hash">) {
  return `${transaction.role}:${transaction.chainId}:${transaction.hash.toLowerCase()}`;
}

export function loadBridgeOperations(address: Address, storage = browserStorage()): BridgeOperation[] {
  if (!storage) return [];
  try {
    const payload = storage.getItem(bridgeOperationKey(address));
    if (payload === null) return [];
    const parsed: unknown = JSON.parse(payload);
    if (!Array.isArray(parsed)) return [];
    const operations = parsed.map(parseBridgeOperation);
    return operations.every(Boolean) ? (operations as BridgeOperation[]).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_OPERATIONS) : [];
  } catch {
    return [];
  }
}

export function saveBridgeOperation(operation: BridgeOperation, storage = browserStorage()) {
  const stored = loadBridgeOperations(operation.sender, storage);
  const replacesDraft = isReusableDraft(operation);
  const matchingDrafts = replacesDraft
    ? stored.filter((item) => isReusableDraft(item) && isSameBridgeLogicalIntent(item, operation))
    : [];
  const retainedDraft = [...matchingDrafts].sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))[0];
  const savedOperation = retainedDraft
    ? { ...operation, id: retainedDraft.id, createdAt: retainedDraft.createdAt }
    : operation;
  const operations = [savedOperation, ...stored.filter((item) =>
    item.id !== savedOperation.id
    && !(replacesDraft && isReusableDraft(item) && isSameBridgeLogicalIntent(item, savedOperation))
  )]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_OPERATIONS);
  try {
    storage?.setItem(bridgeOperationKey(operation.sender), JSON.stringify(operations));
    if (typeof window !== "undefined" && storage === window.localStorage) window.dispatchEvent(new CustomEvent(BRIDGE_OPERATION_UPDATED_EVENT, { detail: { id: savedOperation.id, address: savedOperation.sender.toLowerCase() } }));
  } catch {
    // This cache is non-authoritative. On-chain receipts remain the source of truth.
  }
  return savedOperation;
}

export function latestMonitorableBridgeOperation(address: Address, storage = browserStorage()) {
  return loadBridgeOperations(address, storage).find((operation) => operation.transactions.length > 0 && !isBridgeOperationTerminal(operation.state));
}

export function isBridgeOperationTerminal(state: BridgeOperationState) {
  return state === "approval-failed" || state === "source-failed" || state === "destination-confirmed" || state === "destination-failed";
}

export function findDestinationUsdcTransfer(input: {
  logs: readonly { address: Address; data: Hex; topics: readonly Hex[]; logIndex?: number | null; transactionHash?: Hash | null }[];
  token: Address;
  recipient: Address;
  transactionHash: Hash;
  expectedAmount: bigint;
}) {
  const token = getAddress(input.token);
  const recipient = getAddress(input.recipient);
  const matches: { amount: bigint; logIndex: number }[] = [];
  for (const log of input.logs) {
    if (getAddress(log.address) !== token || (log.transactionHash && log.transactionHash.toLowerCase() !== input.transactionHash.toLowerCase())) continue;
    try {
      const decoded = decodeEventLog({ abi: transferEventAbi, eventName: "Transfer", data: log.data, topics: [...log.topics] as [] | [Hex, ...Hex[]] });
      if (getAddress(decoded.args.to) === recipient && decoded.args.value === input.expectedAmount) matches.push({ amount: decoded.args.value, logIndex: log.logIndex ?? -1 });
    } catch {
      // Ignore unrelated logs from the USDC contract.
    }
  }
  if (matches.length !== 1) return undefined;
  return matches[0];
}

function normalizeTransaction(transaction: BridgeOperationTransaction): BridgeOperationTransaction {
  if (!isHash(transaction.hash) || !Number.isSafeInteger(transaction.chainId) || transaction.chainId <= 0) throw new Error("Invalid bridge transaction.");
  return { ...transaction, hash: transaction.hash.toLowerCase() as Hash };
}

function parseBridgeOperation(value: unknown): BridgeOperation | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id || value.provider !== "circle-cctp-v2-forwarding" || value.route !== "arc-testnet-to-base-sepolia" || value.sourceChainId !== 5_042_002 || value.destinationChainId !== 84_532 || typeof value.sender !== "string" || !isAddress(value.sender) || typeof value.recipient !== "string" || !isAddress(value.recipient) || value.asset !== "usdc" || !isAmount(value.requestedAmount) || !isAmount(value.totalSourceDebit) || !isRecord(value.fees) || !isAmount(value.fees.protocol, true) || !isAmount(value.fees.forwarding, true) || !isBridgeState(value.state) || !isSafeInteger(value.createdAt) || !isSafeInteger(value.updatedAt) || !Array.isArray(value.transactions)) return undefined;
  const transactions = value.transactions.map(parseTransaction);
  if (!transactions.every(Boolean)) return undefined;
  return {
    id: value.id,
    provider: value.provider,
    route: value.route,
    sourceChainId: value.sourceChainId,
    destinationChainId: value.destinationChainId,
    sender: getAddress(value.sender),
    recipient: getAddress(value.recipient),
    asset: value.asset,
    requestedAmount: value.requestedAmount,
    totalSourceDebit: value.totalSourceDebit,
    fees: { protocol: value.fees.protocol, forwarding: value.fees.forwarding },
    state: value.state,
    ...(isRecord(value.circle) && typeof value.circle.checkedAt === "number" ? { circle: { ...(typeof value.circle.messageStatus === "string" ? { messageStatus: value.circle.messageStatus } : {}), ...(typeof value.circle.attestationStatus === "string" ? { attestationStatus: value.circle.attestationStatus } : {}), ...(typeof value.circle.forwardingState === "string" ? { forwardingState: value.circle.forwardingState } : {}), checkedAt: value.circle.checkedAt } } : {}),
    ...(parseDestinationEvidence(value.destinationEvidence) ? { destinationEvidence: parseDestinationEvidence(value.destinationEvidence) } : {}),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    transactions: transactions as BridgeOperationTransaction[],
  };
}

function parseTransaction(value: unknown): BridgeOperationTransaction | undefined {
  if (!isRecord(value) || !isRole(value.role) || !isSafeInteger(value.chainId) || typeof value.hash !== "string" || !isHash(value.hash) || !isTransactionStatus(value.status) || typeof value.explorerUrl !== "string" || (value.blockNumber !== undefined && !isAmount(value.blockNumber, true))) return undefined;
  return { role: value.role, chainId: value.chainId, hash: value.hash.toLowerCase() as Hash, status: value.status, explorerUrl: value.explorerUrl, ...(typeof value.blockNumber === "string" ? { blockNumber: value.blockNumber } : {}) };
}

function parseDestinationEvidence(value: unknown): BridgeDestinationEvidence | undefined {
  if (!isRecord(value) || typeof value.transactionHash !== "string" || !isHash(value.transactionHash) || !isAmount(value.transferAmount) || !isSafeInteger(value.transferLogIndex) || !isAmount(value.balance, true) || !isSafeInteger(value.verifiedAt)) return undefined;
  return { transactionHash: value.transactionHash.toLowerCase() as Hash, transferAmount: value.transferAmount, transferLogIndex: value.transferLogIndex, balance: value.balance, verifiedAt: value.verifiedAt };
}

function isAmount(value: unknown, allowZero = false): value is string { return typeof value === "string" && /^\d+$/.test(value) && (allowZero || BigInt(value) > 0n); }
function isRole(value: unknown): value is BridgeTransactionRole { return value === "approval" || value === "burn" || value === "forward" || value === "mint"; }
function isTransactionStatus(value: unknown): value is BridgeTransactionStatus { return value === "submitted" || value === "confirming" || value === "confirmed" || value === "reverted" || value === "unknown"; }
function isReviewState(value: BridgeOperationState) { return value === "approval-review" || value === "burn-review"; }
function isReusableDraft(operation: BridgeOperation) { return operation.transactions.length === 0 && isReviewState(operation.state); }
function isBridgeState(value: unknown): value is BridgeOperationState { return typeof value === "string" && ["approval-review", "approval-submitted", "approval-confirming", "approval-confirmed", "approval-failed", "approval-confirmation-unknown", "burn-review", "burn-submitted", "source-confirming", "source-confirmed", "source-failed", "source-confirmation-unknown", "waiting-circle", "forwarding-submitted", "destination-verification-pending", "destination-confirmed", "destination-failed"].includes(value); }
function isSafeInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function browserStorage(): StorageLike | undefined { return typeof window === "undefined" ? undefined : window.localStorage; }
