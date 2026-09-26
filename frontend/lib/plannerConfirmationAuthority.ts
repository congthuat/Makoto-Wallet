import * as React from "react";
import type { MouseEvent } from "react";
import { validatePlannerProposalHostPair, type PlannerProposalHostSource, type PlannerProposalReview } from "./plannerProposal.ts";
import { plannerParameterPlanDigest, type PlannerEvidenceSource, type PlannerStructuredInput } from "./plannerParameterEvidence.ts";
import { validatePlannerPlan } from "./plannerPlan.ts";
import { validatePlannerIntent } from "./plannerIntent.ts";
import { snapshotPlannerStrategyData } from "./plannerStrategyBinding.ts";

// Runtime authority is attached to object identity. JSON, copied objects and digests cannot register it.
const confirmed = new WeakMap<object, { snapshot: string; proposalDigest: string; active: boolean }>();

export function isLiveConfirmedPlannerSource(input: unknown): boolean {
  try {
    if (!input || typeof input !== "object") return false;
    const record = confirmed.get(input);
    if (!record?.active) return false;
    const copy = snapshotPlannerStrategyData(input);
    return copy.valid && JSON.stringify(copy.value) === record.snapshot &&
      (copy.value as PlannerEvidenceSource).structuredInput?.proposalDigest === record.proposalDigest;
  } catch { return false; }
}

function buildSource(proposal: PlannerProposalReview, host: PlannerProposalHostSource): PlannerEvidenceSource | undefined {
  if (proposal.resolutionStatus !== "RESOLVED" || proposal.goals.some((goal) => goal.parameters.some((field) => field.state !== "FIXED_CANDIDATE"))) return undefined;
  const rawPlan = { version: 1, id: proposal.planId, classification: proposal.goals.length === 1 ? "ACTION" : "STRATEGY",
    goals: proposal.goals.map((goal) => ({ id: goal.goalId, kind: goal.kind, dependsOn: [...goal.dependsOn] })) };
  const checkedPlan = validatePlannerPlan(rawPlan);
  if (!checkedPlan.valid || plannerParameterPlanDigest(checkedPlan.value) !== proposal.planDigest) return undefined;
  const intents = proposal.goals.map((goal) => validatePlannerIntent({ version: 1, id: goal.goalId, kind: goal.kind,
    ...Object.fromEntries(goal.parameters.map((field) => [field.key, field.state === "FIXED_CANDIDATE" ? field.value : undefined])) }));
  if (intents.some((intent) => !intent.valid)) return undefined;
  const fields = proposal.goals.flatMap((goal) => goal.parameters.map((field) => ({ goalId: goal.goalId, parameterKey: field.key,
    value: field.state === "FIXED_CANDIDATE" ? field.value : "" })));
  const structuredInput: PlannerStructuredInput = { version: 1, eventId: crypto.randomUUID(), requestId: proposal.requestId,
    sessionId: proposal.sessionId, requestDigest: proposal.requestDigest, planId: proposal.planId, planDigest: proposal.planDigest,
    proposalId: proposal.proposalId, proposalDigest: proposal.proposalDigest, fields };
  return { requestId: proposal.requestId, sessionId: proposal.sessionId, request: host.request, plan: checkedPlan.value,
    resolution: { status: "RESOLVED", planId: proposal.planId, intents: intents.map((item) => item.valid && item.value) }, structuredInput };
}

/** Only this owned production control may register live parameter confirmation authority. */
export function PlannerParameterConfirmControl({ proposal, host, active, label, className, onConfirmed }: {
  proposal: PlannerProposalReview; host: PlannerProposalHostSource; active: boolean; label: string; className?: string;
  onConfirmed: (source: PlannerEvidenceSource) => void;
}) {
  const owned = React.useRef<PlannerEvidenceSource | null>(null);
  const button = React.useRef<HTMLButtonElement | null>(null);
  const confirming = React.useRef(false);
  const [done, setDone] = React.useState(false);
  const checked = validatePlannerProposalHostPair(proposal, host);
  const eligible = active && checked?.proposalDigest === proposal.proposalDigest && checked.resolutionStatus === "RESOLVED" &&
    checked.goals.every((goal) => goal.parameters.every((field) => field.state === "FIXED_CANDIDATE"));
  React.useLayoutEffect(() => () => {
    if (owned.current) { const record = confirmed.get(owned.current); if (record) record.active = false; owned.current = null; }
    confirming.current = false;
  }, [proposal.proposalDigest, host.sessionId, active]);
  function confirm(event: MouseEvent<HTMLButtonElement>) {
    const target = event?.currentTarget;
    const native = event?.nativeEvent;
    let dispatchedByBrowser = false;
    try {
      dispatchedByBrowser = native instanceof globalThis.MouseEvent && native.isTrusted === true &&
        Event.prototype.composedPath.call(native).includes(target) &&
        Object.getOwnPropertyDescriptor(Event.prototype, "target")?.get?.call(native) === target;
    } catch { /* A fabricated or stale event has no browser dispatch path. */ }
    if (!eligible || done || confirming.current || !dispatchedByBrowser || target !== button.current || !target.isConnected ||
      target.dataset.proposalDigest !== checked?.proposalDigest || !checked ||
      validatePlannerProposalHostPair(proposal, host)?.proposalDigest !== checked.proposalDigest) return;
    const source = buildSource(checked, host);
    if (!source) return;
    const copy = snapshotPlannerStrategyData(source);
    if (!copy.valid) return;
    confirming.current = true;
    confirmed.set(source, { snapshot: JSON.stringify(copy.value), proposalDigest: checked.proposalDigest, active: true });
    owned.current = source;
    try { onConfirmed(source); setDone(true); }
    catch (error) {
      const record = confirmed.get(source);
      if (record) record.active = false;
      owned.current = null;
      confirming.current = false;
      throw error;
    }
  }
  return eligible && !done ? React.createElement("button", { ref: button, type: "button", className, "data-proposal-digest": checked.proposalDigest, onClick: confirm }, label) : null;
}
