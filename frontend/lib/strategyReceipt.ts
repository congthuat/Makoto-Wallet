import { getAddress, isAddress, isHash, type Address, type Hash, type Hex, type PublicClient } from "viem";
import { arcTestnet } from "viem/chains";
import type { PrepareResult } from "./agent/prepareTools.ts";
import { validatePrepareResult } from "./agent/toolSchemas.ts";
import type { StrategyDependencyEvidence } from "./strategyStep.ts";
import { validateStrategy, type ActionStep, type PreparedActionReference } from "./strategyModel.ts";

/** Captured by the wallet submission boundary, after it returns a hash. No signing data is retained. */
export type SubmittedStrategyAction = Readonly<{
  strategyId: string;
  stepId: string;
  action: ActionStep["action"];
  preparedAction: PreparedActionReference;
  hash: Hash;
  account: Address;
  chainId: number;
}>;

/** JSON-safe, read-only RPC observation. A submitted hash alone is never confirmation. */
export type StrategyReceiptObservation =
  | Readonly<{ status: "PENDING" | "UNAVAILABLE"; observedAt: number }>
  | Readonly<{ status: "FOUND"; observedAt: number; chainId: number; receipt: Readonly<{ hash: Hash; status: "success" | "reverted"; blockNumber: string }>; transaction: Readonly<{ hash: Hash; from: Address; to: Address | null; input: Hex; value: string; chainId?: number }> }>;

export type StrategyReceiptResult =
  | Readonly<{ status: "CONFIRMED"; strategyId: string; stepId: string; action: ActionStep["action"]; hash: Hash; chainId: number; blockNumber: string; scope: "SOURCE_TRANSACTION"; dependencies: readonly StrategyDependencyEvidence[] }>
  | Readonly<{ status: "REVERTED"; strategyId: string; stepId: string; hash: Hash; chainId: number; blockNumber: string }>
  | Readonly<{ status: "PENDING" | "UNAVAILABLE"; strategyId: string; stepId: string; hash: Hash }>
  | Readonly<{ status: "MISMATCH"; reason: "STRATEGY" | "STEP" | "ACTION" | "ARTIFACT" | "HASH" | "CHAIN" | "ACCOUNT" | "TRANSACTION" }>
  | Readonly<{ status: "INVALID_EVIDENCE"; reason: "STRATEGY" | "SUBMISSION" | "PREPARATION" | "OBSERVATION" }>;

const sameAddress = (a: string, b: string) => isAddress(a) && isAddress(b) && getAddress(a) === getAddress(b);
const sameHash = (a: string, b: string) => isHash(a) && isHash(b) && a.toLowerCase() === b.toLowerCase();
const sameReference = (a: PreparedActionReference, b: PreparedActionReference) => a.kind === b.kind && a.tool === b.tool && a.quoteFingerprint === b.quoteFingerprint && a.stepIndex === b.stepIndex;
const expectedKind = (action: ActionStep["action"]) => action === "APPROVE" ? "finite-approval" : action === "BRIDGE" ? "cctp-burn" : action.toLowerCase();
const nonNegativeInteger = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);

/** One bounded RPC receipt lookup, followed by a transaction read only when a receipt exists. */
export async function acquireStrategyReceipt(client: PublicClient, hash: Hash, observedAt: number): Promise<StrategyReceiptObservation> {
  if (!isHash(hash) || !Number.isFinite(observedAt) || observedAt < 0 || client.chain?.id !== arcTestnet.id) return { status: "UNAVAILABLE", observedAt };
  try {
    const receipt = await client.getTransactionReceipt({ hash });
    const transaction = await client.getTransaction({ hash });
    return {
      status: "FOUND", observedAt, chainId: client.chain.id,
      receipt: { hash: receipt.transactionHash, status: receipt.status, blockNumber: receipt.blockNumber.toString() },
      transaction: { hash: transaction.hash, from: transaction.from, to: transaction.to, input: transaction.input, value: transaction.value.toString(), ...(transaction.chainId === undefined ? {} : { chainId: transaction.chainId }) },
    };
  } catch (error) {
    return { status: error instanceof Error && /TransactionReceiptNotFoundError/.test(error.name) ? "PENDING" : "UNAVAILABLE", observedAt };
  }
}

/** Pure verification of one submitted ACTION. It never selects or invokes another step. */
export function verifyStrategyReceipt(input: Readonly<{ strategy: unknown; submitted: SubmittedStrategyAction; preparation: PrepareResult; observation: StrategyReceiptObservation }>): StrategyReceiptResult {
  const { submitted: s, observation: o } = input;
  if (!s || typeof s.strategyId !== "string" || typeof s.stepId !== "string" || !isHash(s.hash) || !isAddress(s.account) || !Number.isSafeInteger(s.chainId) || !s.preparedAction) return { status: "INVALID_EVIDENCE", reason: "SUBMISSION" };
  const validated = validateStrategy(input.strategy);
  if (!validated.valid) return { status: "INVALID_EVIDENCE", reason: "STRATEGY" };
  if (validated.value.id !== s.strategyId) return { status: "MISMATCH", reason: "STRATEGY" };
  const step = validated.value.steps.find((item) => item.id === s.stepId);
  if (!step || step.kind !== "ACTION") return { status: "MISMATCH", reason: "STEP" };
  if (step.action !== s.action) return { status: "MISMATCH", reason: "ACTION" };
  if (!step.preparedAction || !sameReference(step.preparedAction, s.preparedAction)) return { status: "MISMATCH", reason: "ARTIFACT" };
  if (!validatePrepareResult(input.preparation, { now: 0 }).valid || input.preparation.status !== "PREPARED") return { status: "INVALID_EVIDENCE", reason: "PREPARATION" };
  const prepared = input.preparation.data;
  const preparedStep = prepared.steps[s.preparedAction.stepIndex];
  if (!preparedStep || preparedStep.kind !== expectedKind(step.action) || prepared.tool !== s.preparedAction.tool || prepared.quoteFingerprint !== s.preparedAction.quoteFingerprint || !sameAddress(prepared.account, s.account) || prepared.chainId !== s.chainId || !sameAddress(preparedStep.account, s.account) || preparedStep.chainId !== s.chainId) return { status: "MISMATCH", reason: "ARTIFACT" };
  if (s.chainId !== arcTestnet.id) return { status: "MISMATCH", reason: "CHAIN" };
  if (!o || !Number.isFinite(o.observedAt) || o.observedAt < 0 || !["PENDING", "UNAVAILABLE", "FOUND"].includes(o.status)) return { status: "INVALID_EVIDENCE", reason: "OBSERVATION" };
  if (o.status !== "FOUND") return { status: o.status, strategyId: s.strategyId, stepId: s.stepId, hash: s.hash };
  const { receipt: r, transaction: tx } = o;
  if (!Number.isSafeInteger(o.chainId) || !r || !tx || !isHash(r.hash) || !isHash(tx.hash) || !nonNegativeInteger(r.blockNumber) || r.blockNumber === "0" || !nonNegativeInteger(tx.value) || !isAddress(tx.from) || !isAddress(tx.to ?? "") || !/^0x(?:[0-9a-fA-F]{2})*$/.test(tx.input) || !["success", "reverted"].includes(r.status)) return { status: "INVALID_EVIDENCE", reason: "OBSERVATION" };
  if (!sameHash(r.hash, s.hash) || !sameHash(tx.hash, s.hash)) return { status: "MISMATCH", reason: "HASH" };
  if (o.chainId !== s.chainId || tx.chainId !== undefined && tx.chainId !== s.chainId) return { status: "MISMATCH", reason: "CHAIN" };
  if (!sameAddress(tx.from, s.account)) return { status: "MISMATCH", reason: "ACCOUNT" };
  const request = preparedStep.request;
  if (!sameAddress(tx.to!, request.to) || tx.input.toLowerCase() !== request.data.toLowerCase() || BigInt(tx.value) !== BigInt(request.value)) return { status: "MISMATCH", reason: "TRANSACTION" };
  const identity = { strategyId: s.strategyId, stepId: s.stepId, hash: s.hash, chainId: s.chainId, blockNumber: r.blockNumber };
  if (r.status === "reverted") return { status: "REVERTED", ...identity };
  const dependency: StrategyDependencyEvidence = {
    kind: "CONFIRMED_RECEIPT", strategyId: s.strategyId, stepId: s.stepId, actionStepId: s.stepId, preparedAction: s.preparedAction, submittedHash: s.hash,
    receipt: { tool: "transaction.receipt", account: s.account, chainId: s.chainId, capturedAt: o.observedAt, observedAt: o.observedAt, freshness: "live", source: ["arc-rpc"], status: "AVAILABLE", data: { hash: s.hash, state: "confirmed", verified: true } },
  };
  const waits = validated.value.steps.filter((item) => item.kind === "WAIT_RECEIPT" && item.receipt.actionStepId === step.id && item.dependsOn.includes(step.id));
  return { status: "CONFIRMED", ...identity, action: step.action, scope: "SOURCE_TRANSACTION", dependencies: [dependency, ...waits.map((wait) => ({ ...dependency, stepId: wait.id }))] };
}
