import { bindAgentTransaction, type AgentTransactionBinding } from "./agentTransactionBinding.ts";

/** Phase 12A describes session truth only. It does not authorize or advance work. */
export type AgentArtifactReference = Readonly<
  | { kind: "PLANNER_PLAN"; id: string }
  | { kind: "STRATEGY_STEP"; strategyId: string; stepId: string }
  | { kind: "TRANSACTION_ATTEMPT"; id: string }
  | { kind: "RECEIPT"; chainId: number; transactionHash: string }
>;

export type TransactionScope = "SINGLE_CHAIN" | "SOURCE_CHAIN" | "DESTINATION_CHAIN";
type Identity = Readonly<{ version: 2; sessionId: string; stateId: string }>;
type TransactionBase = Identity & Readonly<{
  kind: "TRANSACTION";
  step: Extract<AgentArtifactReference, { kind: "STRATEGY_STEP" }>;
  scope: TransactionScope;
  binding: AgentTransactionBinding;
}>;

export type AgentState =
  | (Identity & Readonly<{ kind: "REQUESTED" }>)
  | (Identity & Readonly<{ kind: "PLAN_READY"; plan: Extract<AgentArtifactReference, { kind: "PLANNER_PLAN" }> }>)
  | (TransactionBase & Readonly<{ status: "PREPARED" | "AWAITING_SIGNATURE" }> )
  | (TransactionBase & Readonly<{ status: "SUBMITTED" | "CONFIRMING"; submittedHash: string; attempt: Extract<AgentArtifactReference, { kind: "TRANSACTION_ATTEMPT" }> }> )
  | (TransactionBase & Readonly<{ status: "SUCCESS"; submittedHash: string; attempt: Extract<AgentArtifactReference, { kind: "TRANSACTION_ATTEMPT" }>; receipt: Extract<AgentArtifactReference, { kind: "RECEIPT" }> }> )
  | (TransactionBase & Readonly<{ status: "REJECTED" | "EXPIRED"; attempt: Extract<AgentArtifactReference, { kind: "TRANSACTION_ATTEMPT" }> | null }>)
  | (TransactionBase & Readonly<{ status: "FAILED"; submittedHash: string; attempt: Extract<AgentArtifactReference, { kind: "TRANSACTION_ATTEMPT" }> | null }>);

export type AgentStateValidationResult =
  | Readonly<{ valid: true; value: AgentState }>
  | Readonly<{ valid: false; reason: string }>;

type Data = Record<string, unknown>;
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const record = (value: unknown): value is Data => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).every((key) => typeof key === "string" && Object.getOwnPropertyDescriptor(value, key)?.enumerable === true && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"));
const keys = (value: Data, names: readonly string[]) => Reflect.ownKeys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));
const hash = (value: unknown): value is string => typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);

function reference(value: unknown, kind: AgentArtifactReference["kind"]): boolean {
  if (!record(value) || value.kind !== kind) return false;
  if (kind === "PLANNER_PLAN" || kind === "TRANSACTION_ATTEMPT") return keys(value, ["kind", "id"]) && id(value.id);
  if (kind === "STRATEGY_STEP") return keys(value, ["kind", "strategyId", "stepId"]) && id(value.strategyId) && id(value.stepId);
  return keys(value, ["kind", "chainId", "transactionHash"]) && Number.isSafeInteger(value.chainId) && (value.chainId as number) > 0 && hash(value.transactionHash);
}

const time = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
function validBinding(value: unknown): boolean {
  if (!record(value) || !keys(value, ["account", "chainId", "action", "preparedAction", "quoteExpiresAt", "preparationExpiresAt", "handoffExpiresAt"])) return false;
  const ref = value.preparedAction;
  return typeof value.account === "string" && /^0x[0-9a-fA-F]{40}$/.test(value.account) && !/^0x0{40}$/i.test(value.account) && Number.isSafeInteger(value.chainId) && Number(value.chainId) > 0 && ["SEND", "SWAP", "APPROVE", "BRIDGE"].includes(value.action as string) &&
    record(ref) && keys(ref, ["kind", "tool", "quoteFingerprint", "stepIndex"]) && ref.kind === "PREPARED_ACTION" && ["send.prepare", "swap.prepare", "bridge.prepare"].includes(ref.tool as string) && hash(ref.quoteFingerprint) && time(ref.stepIndex) &&
    time(value.quoteExpiresAt) && time(value.preparationExpiresAt) && (value.handoffExpiresAt === null || time(value.handoffExpiresAt));
}

/** Strict structural check only; receipt authenticity and transitions belong to later phases. */
export function validateAgentState(input: unknown): AgentStateValidationResult {
  const invalid = (reason: string): AgentStateValidationResult => ({ valid: false, reason });
  if (!record(input)) return invalid("INVALID_SCHEMA");
  if (input.version !== 2) return invalid("UNSUPPORTED_VERSION");
  if (!id(input.sessionId) || !id(input.stateId)) return invalid("INVALID_ID");
  if (input.kind === "REQUESTED") return keys(input, ["version", "sessionId", "stateId", "kind"]) ? { valid: true, value: input as AgentState } : invalid("INVALID_SCHEMA");
  if (input.kind === "PLAN_READY") return keys(input, ["version", "sessionId", "stateId", "kind", "plan"]) && reference(input.plan, "PLANNER_PLAN") ? { valid: true, value: input as AgentState } : invalid("INVALID_SCHEMA");
  if (input.kind !== "TRANSACTION") return invalid("UNKNOWN_KIND");
  if (!reference(input.step, "STRATEGY_STEP") || !["SINGLE_CHAIN", "SOURCE_CHAIN", "DESTINATION_CHAIN"].includes(input.scope as string)) return invalid("INVALID_REFERENCE");
  if (!validBinding(input.binding)) return invalid("INVALID_BINDING");
  const base = ["version", "sessionId", "stateId", "kind", "step", "scope", "binding", "status"];
  if (input.status === "PREPARED" || input.status === "AWAITING_SIGNATURE") return keys(input, base) ? { valid: true, value: input as AgentState } : invalid("INVALID_SCHEMA");
  if (input.status === "SUBMITTED" || input.status === "CONFIRMING") return keys(input, [...base, "attempt", "submittedHash"]) && hash(input.submittedHash) && reference(input.attempt, "TRANSACTION_ATTEMPT") ? { valid: true, value: input as AgentState } : invalid("INVALID_SCHEMA");
  if (input.status === "SUCCESS") return keys(input, [...base, "attempt", "receipt", "submittedHash"]) && hash(input.submittedHash) && reference(input.attempt, "TRANSACTION_ATTEMPT") && reference(input.receipt, "RECEIPT") ? { valid: true, value: input as AgentState } : invalid("INVALID_SCHEMA");
  if (input.status === "FAILED") return keys(input, [...base, "attempt", "submittedHash"]) && hash(input.submittedHash) && (input.attempt === null || reference(input.attempt, "TRANSACTION_ATTEMPT")) ? { valid: true, value: input as AgentState } : invalid("INVALID_SCHEMA");
  if (input.status === "REJECTED" || input.status === "EXPIRED") return keys(input, [...base, "attempt"]) && (input.attempt === null || reference(input.attempt, "TRANSACTION_ATTEMPT")) ? { valid: true, value: input as AgentState } : invalid("INVALID_SCHEMA");
  return invalid("UNKNOWN_STATUS");
}

/** Capture identity when an already prepared Strategy step enters Phase 12.
 * This describes PREPARED only; it neither creates a Strategy nor authorizes review.
 */
export function createPreparedAgentState(identity: Readonly<{ sessionId: string; stateId: string }>, context: Parameters<typeof bindAgentTransaction>[0]): AgentState | undefined {
  try {
    const binding = bindAgentTransaction(context);
    if (!binding) return undefined;
    const state = { version: 2, ...identity, kind: "TRANSACTION", status: "PREPARED", step: { kind: "STRATEGY_STEP", strategyId: (context.strategy as { id: string }).id, stepId: context.stepId }, scope: binding.action === "BRIDGE" || binding.preparedAction.tool === "bridge.prepare" ? "SOURCE_CHAIN" : "SINGLE_CHAIN", binding };
    const checked = validateAgentState(state);
    return checked.valid ? checked.value : undefined;
  } catch { return undefined; }
}
