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
  id: string;
  path: string;
  action: AgentActionDraft["kind"];
  account: string;
  createdAt: number;
  expiresAt: number;
  amount: string;
  asset: string;
  sourceChain?: string;
  destinationChain?: string;
  outputAsset?: string;
  recipient?: string;
  jarId?: string;
  source: "makoto-agent";
}>;

export type AgentActionResult = Readonly<{
  id: string;
  account: string;
  action: AgentActionDraft["kind"];
  status: "confirmed" | "cancelled" | "failed" | "unknown";
  createdAt: number;
  amount?: string;
  asset?: string;
  outputAmount?: string;
  outputAsset?: string;
  transactionHash?: string;
}>;

export type AgentDraftValidation = Readonly<{
  valid: boolean;
  missingFields: readonly string[];
  errors: readonly string[];
}>;
