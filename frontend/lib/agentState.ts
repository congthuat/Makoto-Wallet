/** Phase 12A describes session truth only. It does not authorize or advance work. */
export type AgentArtifactReference = Readonly<
  | { kind: "PLANNER_PLAN"; id: string }
  | { kind: "STRATEGY_STEP"; strategyId: string; stepId: string }
  | { kind: "TRANSACTION_ATTEMPT"; id: string }
  | { kind: "RECEIPT"; chainId: number; transactionHash: string }
>;

export type TransactionScope = "SINGLE_CHAIN" | "SOURCE_CHAIN" | "DESTINATION_CHAIN";
type Identity = Readonly<{ version: 1; sessionId: string; stateId: string }>;
type TransactionBase = Identity & Readonly<{
  kind: "TRANSACTION";
  step: Extract<AgentArtifactReference, { kind: "STRATEGY_STEP" }>;
  scope: TransactionScope;
}>;

export type AgentState =
  | (Identity & Readonly<{ kind: "REQUESTED" }>)
  | (Identity & Readonly<{ kind: "PLAN_READY"; plan: Extract<AgentArtifactReference, { kind: "PLANNER_PLAN" }> }>)
  | (TransactionBase & Readonly<{ status: "PREPARED" | "AWAITING_SIGNATURE" }> )
  | (TransactionBase & Readonly<{ status: "SUBMITTED" | "CONFIRMING"; attempt: Extract<AgentArtifactReference, { kind: "TRANSACTION_ATTEMPT" }> }> )
  | (TransactionBase & Readonly<{ status: "SUCCESS"; attempt: Extract<AgentArtifactReference, { kind: "TRANSACTION_ATTEMPT" }>; receipt: Extract<AgentArtifactReference, { kind: "RECEIPT" }> }> )
  | (TransactionBase & Readonly<{ status: "REJECTED" | "EXPIRED" | "FAILED"; attempt: Extract<AgentArtifactReference, { kind: "TRANSACTION_ATTEMPT" }> | null }>);

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

/** Strict structural check only; receipt authenticity and transitions belong to later phases. */
export function validateAgentState(input: unknown): AgentStateValidationResult {
  const invalid = (reason: string): AgentStateValidationResult => ({ valid: false, reason });
  if (!record(input)) return invalid("INVALID_SCHEMA");
  if (input.version !== 1) return invalid("UNSUPPORTED_VERSION");
  if (!id(input.sessionId) || !id(input.stateId)) return invalid("INVALID_ID");
  if (input.kind === "REQUESTED") return keys(input, ["version", "sessionId", "stateId", "kind"]) ? { valid: true, value: input as AgentState } : invalid("INVALID_SCHEMA");
  if (input.kind === "PLAN_READY") return keys(input, ["version", "sessionId", "stateId", "kind", "plan"]) && reference(input.plan, "PLANNER_PLAN") ? { valid: true, value: input as AgentState } : invalid("INVALID_SCHEMA");
  if (input.kind !== "TRANSACTION") return invalid("UNKNOWN_KIND");
  if (!reference(input.step, "STRATEGY_STEP") || !["SINGLE_CHAIN", "SOURCE_CHAIN", "DESTINATION_CHAIN"].includes(input.scope as string)) return invalid("INVALID_REFERENCE");
  const base = ["version", "sessionId", "stateId", "kind", "step", "scope", "status"];
  if (input.status === "PREPARED" || input.status === "AWAITING_SIGNATURE") return keys(input, base) ? { valid: true, value: input as AgentState } : invalid("INVALID_SCHEMA");
  if (input.status === "SUBMITTED" || input.status === "CONFIRMING") return keys(input, [...base, "attempt"]) && reference(input.attempt, "TRANSACTION_ATTEMPT") ? { valid: true, value: input as AgentState } : invalid("INVALID_SCHEMA");
  if (input.status === "SUCCESS") return keys(input, [...base, "attempt", "receipt"]) && reference(input.attempt, "TRANSACTION_ATTEMPT") && reference(input.receipt, "RECEIPT") ? { valid: true, value: input as AgentState } : invalid("INVALID_SCHEMA");
  if (input.status === "REJECTED" || input.status === "EXPIRED" || input.status === "FAILED") return keys(input, [...base, "attempt"]) && (input.attempt === null || reference(input.attempt, "TRANSACTION_ATTEMPT")) ? { valid: true, value: input as AgentState } : invalid("INVALID_SCHEMA");
  return invalid("UNKNOWN_STATUS");
}
