import { validatePrepareResult, validateQuoteResult } from "./agent/toolSchemas.ts";
import { validateStrategy, type ActionStep, type PreparedActionReference } from "./strategyModel.ts";

/** Descriptive identity captured from canonical preparation, never signing authority. */
export type AgentTransactionBinding = Readonly<{
  account: string;
  chainId: number;
  action: ActionStep["action"];
  preparedAction: PreparedActionReference;
  quoteExpiresAt: number;
  preparationExpiresAt: number;
  handoffExpiresAt: number | null;
}>;

/** Bind an existing Strategy step, without constructing a Strategy from a plan. */
export function bindAgentTransaction(input: Readonly<{ strategy: unknown; stepId: string; quote: unknown; preparation: unknown }>): AgentTransactionBinding | undefined {
  try {
    const strategy = validateStrategy(input.strategy);
    const quote = validateQuoteResult(input.quote, 0);
    const preparation = validatePrepareResult(input.preparation, { now: 0, quote: input.quote });
    if (!strategy.valid || !quote.valid || quote.value.status !== "AVAILABLE" || !preparation.valid || preparation.value.status !== "PREPARED") return undefined;
    const step = strategy.value.steps.find((item) => item.id === input.stepId);
    if (!step || step.kind !== "ACTION" || !step.preparedAction) return undefined;
    const ref = step.preparedAction, data = preparation.value.data, selected = data.steps[ref.stepIndex];
    const kind = step.action === "APPROVE" ? "finite-approval" : step.action === "BRIDGE" ? "cctp-burn" : step.action.toLowerCase();
    if (!selected || selected.kind !== kind || ref.tool !== preparation.value.tool || ref.quoteFingerprint !== data.quoteFingerprint || quote.value.tool !== ref.tool.replace("prepare", "quote") || quote.value.account?.toLowerCase() !== data.account.toLowerCase() || quote.value.chainId !== data.chainId || data.handoff && data.handoff.account.toLowerCase() !== data.account.toLowerCase()) return undefined;
    const times = [quote.value.expiresAt, data.expiresAt, ...(data.handoff ? [data.handoff.expiresAt] : [])];
    if (!times.every((time) => Number.isSafeInteger(time) && Number(time) >= 0)) return undefined;
    return Object.freeze({ account: data.account.toLowerCase(), chainId: data.chainId, action: step.action, preparedAction: Object.freeze({ ...ref }), quoteExpiresAt: quote.value.expiresAt!, preparationExpiresAt: data.expiresAt, handoffExpiresAt: data.handoff?.expiresAt ?? null });
  } catch { return undefined; }
}

export const sameAgentBinding = (a: AgentTransactionBinding, b: AgentTransactionBinding) =>
  a.account.toLowerCase() === b.account.toLowerCase() && a.chainId === b.chainId && a.action === b.action &&
  a.preparedAction.kind === b.preparedAction.kind && a.preparedAction.tool === b.preparedAction.tool && a.preparedAction.quoteFingerprint === b.preparedAction.quoteFingerprint && a.preparedAction.stepIndex === b.preparedAction.stepIndex &&
  a.quoteExpiresAt === b.quoteExpiresAt && a.preparationExpiresAt === b.preparationExpiresAt && a.handoffExpiresAt === b.handoffExpiresAt;
