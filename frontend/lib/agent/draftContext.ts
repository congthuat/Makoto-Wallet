import type { Address } from "viem";
import type { AgentDraftContext } from "./types.ts";

export type AgentDraftContextStatus = "current" | "historical" | "unknown";
export type AgentDraftContextReason = "match" | "account-changed" | "chain-changed" | "current-context-missing" | "origin-missing";

export type AgentDraftContextAssessment = Readonly<{
  status: AgentDraftContextStatus;
  reason: AgentDraftContextReason;
}>;

/**
 * Compares the wallet binding that produced a draft with the binding that can
 * prepare its next review. A draft is current only when every captured field
 * is available and still matches; missing origin data never masquerades as a
 * current-ready draft.
 */
export function assessAgentDraftContext(
  origin: AgentDraftContext | undefined,
  current: AgentDraftContext,
): AgentDraftContextAssessment {
  if (!origin || (origin.account === undefined && origin.chainId === undefined)) {
    return { status: "unknown", reason: "origin-missing" };
  }

  if (origin.account !== undefined) {
    if (current.account === undefined) return { status: "historical", reason: "current-context-missing" };
    if (normalizeAccount(origin.account) !== normalizeAccount(current.account)) return { status: "historical", reason: "account-changed" };
  }

  if (origin.chainId !== undefined) {
    if (current.chainId === undefined) return { status: "historical", reason: "current-context-missing" };
    if (origin.chainId !== current.chainId) return { status: "historical", reason: "chain-changed" };
  }

  return { status: "current", reason: "match" };
}

function normalizeAccount(account: Address | string) {
  return account.toLowerCase();
}
