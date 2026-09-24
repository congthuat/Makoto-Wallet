import type { PrepareToolId } from "./agent/prepareTools.ts";
import type { QuoteToolId } from "./agent/quoteTools.ts";

/** Phase 10A describes prerequisites only. It carries no transaction or execution adapter. */
export type StrategyMetadata = Readonly<{ label?: string; description?: string }>;
export type PreparedActionReference = Readonly<{
  kind: "PREPARED_ACTION";
  tool: PrepareToolId;
  quoteFingerprint: `0x${string}`;
  stepIndex: number;
}>;
export type QuoteReference = Readonly<{
  kind: "QUOTE";
  tool: QuoteToolId;
  fingerprint: `0x${string}`;
}>;
export type PolicyResultReference = Readonly<{ kind: "POLICY_RESULT"; id: string }>;
/** Points to the action whose future receipt must be verified; it is not receipt evidence. */
export type ReceiptReference = Readonly<{ kind: "RECEIPT"; actionStepId: string }>;

type StepBase = Readonly<{
  id: string;
  dependsOn: readonly string[];
  metadata?: StrategyMetadata;
}>;
export type ActionStep = StepBase & Readonly<{
  kind: "ACTION";
  action: "APPROVE" | "SEND" | "SWAP" | "BRIDGE";
  confirmation: "EXPLICIT_USER_CONFIRMATION";
  preparedAction?: PreparedActionReference;
}>;
export type WaitReceiptStep = StepBase & Readonly<{
  kind: "WAIT_RECEIPT";
  receipt: ReceiptReference;
}>;
export type RevalidateStep = StepBase & Readonly<{
  kind: "REVALIDATE";
  quote?: QuoteReference;
  policy?: PolicyResultReference;
}>;
export type StrategyStep = ActionStep | WaitReceiptStep | RevalidateStep;
export type Strategy = Readonly<{
  version: 1;
  id: string;
  createdAt: number;
  steps: readonly StrategyStep[];
  metadata?: StrategyMetadata;
}>;

export type StrategyValidationCode =
  | "INVALID_SCHEMA" | "DUPLICATE_STEP_ID" | "SELF_DEPENDENCY" | "UNKNOWN_DEPENDENCY"
  | "DEPENDENCY_CYCLE" | "UNSUPPORTED_STEP_KIND" | "UNSUPPORTED_ACTION"
  | "CONFIRMATION_REQUIRED" | "INVALID_ARTIFACT_REFERENCE";
export type StrategyValidationIssue = Readonly<{ path: string; code: StrategyValidationCode; message: string }>;
export type StrategyValidationResult =
  | Readonly<{ valid: true; value: Strategy }>
  | Readonly<{ valid: false; errors: readonly StrategyValidationIssue[] }>;

type Data = Record<string, unknown>;
const prepareTools = new Set<PrepareToolId>(["send.prepare", "swap.prepare", "bridge.prepare"]);
const quoteTools = new Set<QuoteToolId>(["send.quote", "swap.quote", "bridge.quote"]);
const actionKinds = new Set<ActionStep["action"]>(["APPROVE", "SEND", "SWAP", "BRIDGE"]);
const hash = (value: unknown): value is `0x${string}` => typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
const id = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const record = (value: unknown): value is Data => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const keys = (value: Data, required: readonly string[], optional: readonly string[] = []) => required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));

/** Rejects methods, clients, cycles, non-finite numbers and other non-JSON values at every depth. */
function jsonData(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;
  if (Array.isArray(value) && Object.getPrototypeOf(value) !== Array.prototype) return false;
  if (!Array.isArray(value) && !record(value)) return false;
  const ownKeys = Reflect.ownKeys(value).filter((key) => !Array.isArray(value) || key !== "length");
  if (ownKeys.length !== Object.keys(value).length || ownKeys.some((key) => !("value" in Object.getOwnPropertyDescriptor(value, key)!))) return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? Object.keys(value).length === value.length && Array.from({ length: value.length }, (_, index) => Object.hasOwn(value, index) && jsonData(value[index], ancestors)).every(Boolean)
    : Object.values(value).every((item) => jsonData(item, ancestors));
  ancestors.delete(value);
  return valid;
}

/** Pure structural validation. Policy, chain state and step execution remain separate boundaries. */
export function validateStrategy(input: unknown): StrategyValidationResult {
  const errors: StrategyValidationIssue[] = [];
  const add = (path: string, code: StrategyValidationCode, message: string) => errors.push({ path, code, message });
  if (!jsonData(input) || !record(input)) {
    add("strategy", "INVALID_SCHEMA", "Strategy must contain plain JSON data only.");
    return { valid: false, errors };
  }
  if (!keys(input, ["version", "id", "createdAt", "steps"], ["metadata"]) || input.version !== 1 || !id(input.id) || !Number.isSafeInteger(input.createdAt) || (input.createdAt as number) < 0 || !Array.isArray(input.steps) || input.steps.length === 0) {
    add("strategy", "INVALID_SCHEMA", "Strategy identity, version, creation time or steps are invalid.");
  }
  if (input.metadata !== undefined) validateMetadata(input.metadata, "strategy.metadata", add);
  if (!Array.isArray(input.steps)) return { valid: false, errors };

  const byId = new Map<string, Data>();
  input.steps.forEach((raw, index) => {
    const path = `strategy.steps[${index}]`;
    if (!record(raw)) { add(path, "INVALID_SCHEMA", "Step must be a plain object."); return; }
    if (!id(raw.id) || !Array.isArray(raw.dependsOn) || !raw.dependsOn.every(id) || new Set(raw.dependsOn).size !== raw.dependsOn.length) add(path, "INVALID_SCHEMA", "Step ID or dependencies are invalid.");
    if (id(raw.id)) {
      if (byId.has(raw.id)) add(`${path}.id`, "DUPLICATE_STEP_ID", "Step ID is duplicated.");
      else byId.set(raw.id, raw);
    }
    if (raw.metadata !== undefined) validateMetadata(raw.metadata, `${path}.metadata`, add);
    if (raw.kind === "ACTION") {
      if (!keys(raw, ["id", "kind", "dependsOn", "action", "confirmation"], ["preparedAction", "metadata"])) add(path, "INVALID_SCHEMA", "Action step contains missing or unsupported fields.");
      if (!actionKinds.has(raw.action as ActionStep["action"])) add(`${path}.action`, "UNSUPPORTED_ACTION", "Action is not supported.");
      if (raw.confirmation !== "EXPLICIT_USER_CONFIRMATION") add(`${path}.confirmation`, "CONFIRMATION_REQUIRED", "Every action requires explicit user confirmation.");
      if (raw.preparedAction !== undefined) validatePrepared(raw.preparedAction, raw.action, `${path}.preparedAction`, add);
    } else if (raw.kind === "WAIT_RECEIPT") {
      if (!keys(raw, ["id", "kind", "dependsOn", "receipt"], ["metadata"])) add(path, "INVALID_SCHEMA", "Receipt step contains missing or unsupported fields.");
      if (!record(raw.receipt) || !keys(raw.receipt, ["kind", "actionStepId"]) || raw.receipt.kind !== "RECEIPT" || !id(raw.receipt.actionStepId)) add(`${path}.receipt`, "INVALID_ARTIFACT_REFERENCE", "Receipt must reference an action step.");
    } else if (raw.kind === "REVALIDATE") {
      if (!keys(raw, ["id", "kind", "dependsOn"], ["quote", "policy", "metadata"])) add(path, "INVALID_SCHEMA", "Revalidation step contains missing or unsupported fields.");
      if (raw.quote !== undefined && (!record(raw.quote) || !keys(raw.quote, ["kind", "tool", "fingerprint"]) || raw.quote.kind !== "QUOTE" || !quoteTools.has(raw.quote.tool as QuoteToolId) || !hash(raw.quote.fingerprint))) add(`${path}.quote`, "INVALID_ARTIFACT_REFERENCE", "Quote reference is malformed.");
      if (raw.policy !== undefined && (!record(raw.policy) || !keys(raw.policy, ["kind", "id"]) || raw.policy.kind !== "POLICY_RESULT" || !id(raw.policy.id))) add(`${path}.policy`, "INVALID_ARTIFACT_REFERENCE", "Policy result reference is malformed.");
    } else add(`${path}.kind`, "UNSUPPORTED_STEP_KIND", "Step kind is not supported.");
  });

  input.steps.forEach((raw, index) => {
    if (!record(raw) || !id(raw.id) || !Array.isArray(raw.dependsOn)) return;
    const path = `strategy.steps[${index}]`;
    raw.dependsOn.forEach((dependency, dependencyIndex) => {
      if (!id(dependency)) return;
      if (dependency === raw.id) add(`${path}.dependsOn[${dependencyIndex}]`, "SELF_DEPENDENCY", "Step cannot depend on itself.");
      else if (!byId.has(dependency)) add(`${path}.dependsOn[${dependencyIndex}]`, "UNKNOWN_DEPENDENCY", "Dependency step does not exist.");
    });
    if (raw.kind === "WAIT_RECEIPT" && record(raw.receipt) && id(raw.receipt.actionStepId) && (byId.get(raw.receipt.actionStepId)?.kind !== "ACTION" || !raw.dependsOn.includes(raw.receipt.actionStepId))) add(`${path}.receipt`, "INVALID_ARTIFACT_REFERENCE", "Receipt source must be a directly required action step.");
  });

  const visiting = new Set<string>(), visited = new Set<string>();
  const cycle = (stepId: string): boolean => {
    if (visiting.has(stepId)) return true;
    if (visited.has(stepId)) return false;
    visiting.add(stepId);
    const step = byId.get(stepId);
    const found = Array.isArray(step?.dependsOn) && step.dependsOn.some((dependency) => typeof dependency === "string" && byId.has(dependency) && cycle(dependency));
    visiting.delete(stepId); visited.add(stepId);
    return found;
  };
  if ([...byId.keys()].some(cycle)) add("strategy.steps", "DEPENDENCY_CYCLE", "Step dependencies contain a cycle.");
  return errors.length ? { valid: false, errors } : { valid: true, value: input as Strategy };
}

function validateMetadata(value: unknown, path: string, add: (path: string, code: StrategyValidationCode, message: string) => void) {
  if (!record(value) || !keys(value, [], ["label", "description"]) || Object.values(value).some((field) => !id(field))) add(path, "INVALID_SCHEMA", "Metadata must contain descriptive text only.");
}

function validatePrepared(value: unknown, action: unknown, path: string, add: (path: string, code: StrategyValidationCode, message: string) => void) {
  if (!record(value) || !keys(value, ["kind", "tool", "quoteFingerprint", "stepIndex"]) || value.kind !== "PREPARED_ACTION" || !prepareTools.has(value.tool as PrepareToolId) || !hash(value.quoteFingerprint) || !Number.isSafeInteger(value.stepIndex) || (value.stepIndex as number) < 0 || action === "SEND" && value.tool !== "send.prepare" || action === "SWAP" && value.tool !== "swap.prepare" || action === "BRIDGE" && value.tool !== "bridge.prepare" || action === "APPROVE" && value.tool !== "swap.prepare" && value.tool !== "bridge.prepare") add(path, "INVALID_ARTIFACT_REFERENCE", "Prepared action reference is malformed or does not match the action.");
}
