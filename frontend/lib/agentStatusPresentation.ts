import { validateAgentState, type AgentState } from "./agentState.ts";
import type { AgentStateRestoreResult } from "./agentStatePersistence.ts";
import type { AgentTransitionResult } from "./agentTransition.ts";
import type { AgentRecoveryResult } from "./agentRecovery.ts";

export type AgentStatusInput =
  | Readonly<{ kind: "UNAVAILABLE" }>
  | Readonly<{ kind: "CURRENT_REQUEST"; state: unknown }>
  | Readonly<{ kind: "GUARDED_TRANSITION"; result: AgentTransitionResult }>
  | Readonly<{ kind: "RESTORED"; result: AgentStateRestoreResult }>
  | Readonly<{ kind: "RECOVERY_EVALUATION"; result: AgentRecoveryResult }>;

export type AgentStatusPresentation = Readonly<{
  status: "REQUESTED" | "PLAN_READY" | "PREPARED" | "AWAITING_SIGNATURE" | "SUBMITTED" | "CONFIRMING" | "SUCCESS" | "REJECTED" | "EXPIRED" | "FAILED" | "PENDING" | "UNKNOWN" | "UNAVAILABLE";
  historical: boolean;
  sourceOnly: boolean;
  hash?: string;
}>;

const unavailable = (): AgentStatusPresentation => ({ status: "UNAVAILABLE", historical: false, sourceOnly: false });
const fromState = (state: AgentState, historical: boolean): AgentStatusPresentation => ({
  status: state.kind === "TRANSACTION" ? state.status : state.kind,
  historical,
  sourceOnly: state.kind === "TRANSACTION" && state.scope === "SOURCE_CHAIN",
});
const exact = (value: unknown, fields: readonly string[]): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype &&
  Reflect.ownKeys(value).length === fields.length && fields.every((field) => {
    const property = Object.getOwnPropertyDescriptor(value, field);
    return property?.enumerable === true && Object.hasOwn(property, "value");
  });

/** Presentation only. A structural state or hash never proves a current outcome. */
export function presentAgentStatus(input: unknown): AgentStatusPresentation {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) return unavailable();
    const value = input as AgentStatusInput;
    if (value.kind === "UNAVAILABLE" && exact(value, ["kind"])) return unavailable();
    if (value.kind === "CURRENT_REQUEST") {
      if (!exact(value, ["kind", "state"])) return unavailable();
      const checked = validateAgentState(value.state);
      return checked.valid && checked.value.kind === "REQUESTED" ? fromState(checked.value, false) : unavailable();
    }
    if (value.kind === "GUARDED_TRANSITION") {
      if (!exact(value, ["kind", "result"]) || !exact(value.result, ["allowed", "state"]) || value.result.allowed !== true) return unavailable();
      const checked = validateAgentState(value.result.state);
      // No production Phase 12 transaction caller exists. A plain result object
      // cannot authenticate a guarded transaction edge or its receipt evidence.
      return checked.valid && checked.value.kind === "PLAN_READY" ? fromState(checked.value, false) : unavailable();
    }
    if (value.kind === "RESTORED") {
      if (!exact(value, ["kind", "result"]) || !exact(value.result, ["status", "state"]) || value.result.status !== "HISTORICAL") return unavailable();
      const checked = validateAgentState(value.result.state);
      return checked.valid ? fromState(checked.value, true) : unavailable();
    }
    if (value.kind === "RECOVERY_EVALUATION") {
      if (!exact(value, ["kind", "result"]) || !exact(value.result, ["status"])) return unavailable();
      const status = value.result?.status;
      if (status === "PENDING_CONFIRMATION") return { status: "PENDING", historical: true, sourceOnly: false };
      if (status === "OUTCOME_UNKNOWN" || status === "RECEIPT_VERIFICATION_REQUIRED" || status === "NO_DIRECT_SUCCESS_EDGE") return { status: "UNKNOWN", historical: true, sourceOnly: false };
      return unavailable();
    }
    return unavailable();
  } catch { return unavailable(); }
}
