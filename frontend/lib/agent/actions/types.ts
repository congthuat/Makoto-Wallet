import type { TransactionIntent } from "../../transactionSafety.ts";
import type { TransactionReviewSnapshot } from "../../transactionOrchestrator.ts";
import type { AgentActionDraft } from "../types.ts";

export type AgentPreparedActionStatus = "draft" | "needs-input" | "preparing" | "ready-for-review" | "expired" | "blocked";

/** Data-only Agent state. Never place a connector, provider, signer, or callback here. */
export type AgentPreparedAction = Readonly<{
  draft: AgentActionDraft;
  status: AgentPreparedActionStatus;
  transactionIntent?: TransactionIntent;
  reviewSnapshot?: TransactionReviewSnapshot;
  missingFields?: readonly string[];
  warnings?: readonly string[];
  handoff?: AgentActionHandoff;
}>;

export type AgentActionHandoff = Readonly<{
  path: string;
  query: Readonly<Record<string, string>>;
  source: "makoto-agent";
}>;

export type AgentDraftValidation = Readonly<{
  valid: boolean;
  missingFields: readonly string[];
  errors: readonly string[];
}>;
