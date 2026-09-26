import { keccak256, stringToHex, type Hex } from "viem";
import { validatePlannerPlan, type PlannerPlan } from "./plannerPlan.ts";
import { validatePlannerIntent, type PlannerIntent } from "./plannerIntent.ts";
import { plannerParameterPlanDigest, plannerParameterRequestDigest } from "./plannerParameterEvidence.ts";
import { validatePlannerClassificationRequest, type PlannerClassificationRequest } from "./plannerSemanticClassifier.ts";
import { snapshotPlannerStrategyData } from "./plannerStrategyBinding.ts";
import type { PlannerParameterResult } from "./plannerParameterResolver.ts";

export type ProposalParameter = Readonly<{ key: string; state: "FIXED_CANDIDATE"; value: string | number; origin: "UNVERIFIED_PROVIDER" } |
  { key: string; state: "UNRESOLVED"; reason: "MISSING" | "DYNAMIC" | "UNSUPPORTED"; expressionClass: "NONE" | "PERCENTAGE" | "PREVIOUS_OUTPUT" | "RECEIPT" | "OTHER_DYNAMIC" }>;
export type PlannerProposalReview = Readonly<{ version: 1; executionEnabled: false; proposalId: string; requestId: string; sessionId: string;
  requestDigest: Hex; planId: string; planDigest: Hex; goals: readonly Readonly<{ goalId: string; kind: "SEND" | "SWAP" | "BRIDGE"; dependsOn: readonly string[]; parameters: readonly ProposalParameter[] }>[];
  resolutionStatus: "RESOLVED" | "NEEDS_CLARIFICATION"; resolutionDigest: Hex; proposalDigest: Hex }>;
export type ProposalSource = Readonly<{ requestId: string; sessionId: string; proposalId: string; request: PlannerClassificationRequest; plan: PlannerPlan; resolution: PlannerParameterResult }>;
export type PlannerProposalHostSource = Readonly<{ requestId: string; sessionId: string; proposalId: string; requestDigest: Hex; proposalDigest: Hex; request: PlannerClassificationRequest }>;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const fields = { SEND: ["asset", "amount", "recipient", "chainId"], SWAP: ["fromAsset", "toAsset", "amount", "chainId"], BRIDGE: ["asset", "amount", "recipient", "sourceChainId", "destinationChainId"] } as const;
const hash = (kind: string, value: unknown): Hex => keccak256(stringToHex(JSON.stringify(["makoto.planner-proposal", 1, kind, value])));
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const canonicalGoals = (goals: PlannerProposalReview["goals"]) => goals.map((goal) => [goal.goalId, goal.kind, goal.dependsOn,
  goal.parameters.map((item) => item.state === "FIXED_CANDIDATE" ? [item.key, item.state, item.value, item.origin] :
    [item.key, item.state, item.reason, item.expressionClass])]);
const resolutionHash = (p: Pick<PlannerProposalReview, "requestId" | "sessionId" | "requestDigest" | "planId" | "planDigest" | "resolutionStatus" | "goals">): Hex =>
  hash("RESOLUTION", [p.requestId, p.sessionId, p.requestDigest, p.planId, p.planDigest, p.resolutionStatus, canonicalGoals(p.goals)]);
const proposalHash = (p: Omit<PlannerProposalReview, "proposalDigest">): Hex => hash("PROPOSAL", [p.version, p.executionEnabled,
  p.proposalId, p.requestId, p.sessionId, p.requestDigest, p.planId, p.planDigest, canonicalGoals(p.goals), p.resolutionStatus, p.resolutionDigest]);
function freezeProposal(p: PlannerProposalReview): PlannerProposalReview {
  const goals = Object.freeze(p.goals.map((goal) => Object.freeze({ ...goal, dependsOn: Object.freeze([...goal.dependsOn]),
    parameters: Object.freeze(goal.parameters.map((parameter) => Object.freeze({ ...parameter }))) })));
  return Object.freeze({ ...p, goals });
}
const dynamicClass = (text: string): "NONE" | "PERCENTAGE" | "PREVIOUS_OUTPUT" | "RECEIPT" | "OTHER_DYNAMIC" => {
  if (/\d+(?:\.\d+)?\s*%|\bpercent\b/i.test(text)) return "PERCENTAGE";
  if (/\breceipt\b/i.test(text)) return "RECEIPT";
  if (/\b(?:previous|prior)\s+(?:step|output|result|transaction)\b|\breceiv(?:e|ed)\b|\breturns?\b/i.test(text)) return "PREVIOUS_OUTPUT";
  if (/\b(?:all|half|max|maximum|whatever)\b/i.test(text)) return "OTHER_DYNAMIC";
  return "NONE";
};

/** Rebuild from retained, descriptor-safe stage results. A provider cannot supply proposal authority. */
export function createPlannerProposal(input: unknown): PlannerProposalReview | undefined {
  try { return createPlannerProposalChecked(input); } catch { return undefined; }
}
function createPlannerProposalChecked(input: unknown): PlannerProposalReview | undefined {
  const copy = snapshotPlannerStrategyData(input);
  if (!copy.valid) return undefined;
  const source = copy.value as ProposalSource;
  if (!source || typeof source !== "object" || Array.isArray(source) ||
    JSON.stringify(Object.keys(source).sort()) !== JSON.stringify(["plan", "proposalId", "request", "requestId", "resolution", "sessionId"].sort()) ||
    ![source.requestId, source.sessionId, source.proposalId].every((id) => typeof id === "string" && ID.test(id))) return undefined;
  const request = validatePlannerClassificationRequest(source.request);
  const plan = validatePlannerPlan(source.plan);
  if (!request || !plan.valid || JSON.stringify(Object.keys(request).sort()) !== JSON.stringify(Object.keys(source.request).sort()) ||
    request.text !== source.request.text || request.locale !== source.request.locale ||
    !ID.test(plan.value.id) || plan.value.goals.some((goal) => !ID.test(goal.id) || goal.dependsOn.some((id) => !ID.test(id)))) return undefined;
  const resolution = source.resolution;
  if (!resolution || (resolution.status !== "RESOLVED" && resolution.status !== "NEEDS_CLARIFICATION")) return undefined;
  const values = new Map<string, PlannerIntent>();
  if (resolution.status === "RESOLVED") {
    if (JSON.stringify(Object.keys(resolution).sort()) !== JSON.stringify(["status", "planId", "intents"].sort()) ||
      resolution.planId !== plan.value.id || !Array.isArray(resolution.intents) || resolution.intents.length !== plan.value.goals.length) return undefined;
    for (const raw of resolution.intents) {
      const checked = validatePlannerIntent(raw);
      if (!checked.valid || values.has(checked.value.id) || !plan.value.goals.some((g) => g.id === checked.value.id && g.kind === checked.value.kind)) return undefined;
      values.set(checked.value.id, checked.value);
    }
  } else if (JSON.stringify(Object.keys(resolution).sort()) !== JSON.stringify(["status", "issues"].sort()) ||
    !Array.isArray(resolution.issues) || resolution.issues.length === 0 || resolution.issues.some((issue) =>
      JSON.stringify(Object.keys(issue).sort()) !== JSON.stringify(["goalId", "field", "code"].sort()) ||
      !plan.value.goals.some((g) => g.id === issue.goalId && fields[g.kind].some((key) => key === issue.field)) ||
      !["MISSING", "DYNAMIC_AMOUNT"].includes(issue.code))) return undefined;
  const dynamic = dynamicClass(request.text);
  const goals = [...plan.value.goals].sort((a, b) => compare(a.id, b.id)).map((goal) => ({ goalId: goal.id, kind: goal.kind, dependsOn: [...goal.dependsOn].sort(compare), parameters: fields[goal.kind].map((key): ProposalParameter => {
    const intent = values.get(goal.id);
    if (key === "amount" && dynamic !== "NONE") return { key, state: "UNRESOLVED", reason: "DYNAMIC", expressionClass: dynamic };
    if (intent && Object.hasOwn(intent, key)) return { key, state: "FIXED_CANDIDATE", value: (intent as unknown as Record<string, string | number>)[key], origin: "UNVERIFIED_PROVIDER" };
    const issue = resolution.status === "NEEDS_CLARIFICATION" ? resolution.issues.find((item) => item.goalId === goal.id && item.field === key) : undefined;
    return { key, state: "UNRESOLVED", reason: issue?.code === "DYNAMIC_AMOUNT" ? "DYNAMIC" : "MISSING", expressionClass: issue?.code === "DYNAMIC_AMOUNT" ? "OTHER_DYNAMIC" : "NONE" };
  }) }));
  const resolutionStatus: PlannerProposalReview["resolutionStatus"] = resolution.status === "RESOLVED" && dynamic === "NONE" ? "RESOLVED" : "NEEDS_CLARIFICATION";
  const requestDigest = plannerParameterRequestDigest(source.requestId, source.sessionId, request);
  const planDigest = plannerParameterPlanDigest(plan.value);
  const resolutionDigest = resolutionHash({ requestId: source.requestId, sessionId: source.sessionId, requestDigest, planId: plan.value.id, planDigest, resolutionStatus, goals });
  const base = { version: 1 as const, executionEnabled: false as const, proposalId: source.proposalId, requestId: source.requestId,
    sessionId: source.sessionId, requestDigest, planId: plan.value.id, planDigest, goals, resolutionStatus, resolutionDigest };
  return freezeProposal({ ...base, proposalDigest: proposalHash(base) });
}

/** Structural transport check. The host separately compares its live session and request generation. */
export function validatePlannerProposal(input: unknown): PlannerProposalReview | undefined {
  try { return validatePlannerProposalChecked(input); } catch { return undefined; }
}
function validatePlannerProposalChecked(input: unknown): PlannerProposalReview | undefined {
  const copy = snapshotPlannerStrategyData(input);
  if (!copy.valid) return undefined;
  const p = copy.value as PlannerProposalReview;
  if (!p || typeof p !== "object" || Array.isArray(p) ||
    JSON.stringify(Object.keys(p).sort()) !== JSON.stringify(["version", "executionEnabled", "proposalId", "requestId", "sessionId", "requestDigest", "planId", "planDigest", "goals", "resolutionStatus", "resolutionDigest", "proposalDigest"].sort()) ||
    p.version !== 1 || p.executionEnabled !== false || ![p.proposalId, p.requestId, p.sessionId, p.planId].every((x) => typeof x === "string" && ID.test(x)) ||
    ![p.requestDigest, p.planDigest, p.resolutionDigest, p.proposalDigest].every((x) => typeof x === "string" && /^0x[0-9a-f]{64}$/.test(x)) ||
    !["RESOLVED", "NEEDS_CLARIFICATION"].includes(p.resolutionStatus) || !Array.isArray(p.goals) || p.goals.length < 1 || p.goals.length > 32) return undefined;
  const plan = { version: 1, id: p.planId, classification: p.goals.length === 1 ? "ACTION" : "STRATEGY", goals: p.goals.map((g) => ({ id: g.goalId, kind: g.kind, dependsOn: g.dependsOn })) };
  const checked = validatePlannerPlan(plan);
  if (!checked.valid || plannerParameterPlanDigest(checked.value) !== p.planDigest) return undefined;
  if (p.goals.some((g, index) => index > 0 && compare(p.goals[index - 1].goalId, g.goalId) >= 0 ||
    g.dependsOn.some((dependency: string, depIndex: number) => depIndex > 0 && compare(g.dependsOn[depIndex - 1], dependency) >= 0))) return undefined;
  for (const g of p.goals) {
    if (JSON.stringify(Object.keys(g).sort()) !== JSON.stringify(["goalId", "kind", "dependsOn", "parameters"].sort()) ||
      !["SEND", "SWAP", "BRIDGE"].includes(g.kind) || !Array.isArray(g.parameters) || JSON.stringify(g.parameters.map((item: ProposalParameter) => item.key)) !== JSON.stringify(fields[g.kind as keyof typeof fields])) return undefined;
    for (const item of g.parameters) {
      if (item.state === "FIXED_CANDIDATE") {
        if (JSON.stringify(Object.keys(item).sort()) !== JSON.stringify(["key", "state", "value", "origin"].sort()) || item.origin !== "UNVERIFIED_PROVIDER" ||
          !(typeof item.value === "string" && item.value.length <= 256 || typeof item.value === "number" && Number.isSafeInteger(item.value))) return undefined;
      } else if (item.state === "UNRESOLVED") {
        if (JSON.stringify(Object.keys(item).sort()) !== JSON.stringify(["key", "state", "reason", "expressionClass"].sort()) ||
          !["MISSING", "DYNAMIC", "UNSUPPORTED"].includes(item.reason) || !["NONE", "PERCENTAGE", "PREVIOUS_OUTPUT", "RECEIPT", "OTHER_DYNAMIC"].includes(item.expressionClass) ||
          (item.reason === "DYNAMIC") === (item.expressionClass === "NONE")) return undefined;
      } else return undefined;
    }
    if (g.parameters.every((item: ProposalParameter) => item.state === "FIXED_CANDIDATE")) {
      const intent = Object.fromEntries(g.parameters.map((item: ProposalParameter) => [item.key, item.state === "FIXED_CANDIDATE" ? item.value : undefined]));
      if (!validatePlannerIntent({ version: 1, id: g.goalId, kind: g.kind, ...intent }).valid) return undefined;
    }
  }
  const unresolved = p.goals.some((g) => g.parameters.some((item: ProposalParameter) => item.state === "UNRESOLVED"));
  if ((p.resolutionStatus === "RESOLVED") === unresolved) return undefined;
  const { proposalDigest, ...base } = p;
  if (resolutionHash(p) !== p.resolutionDigest || proposalHash(base) !== proposalDigest) return undefined;
  return freezeProposal(p);
}

/** Live host correlation; the digest is checked against the accepted request, never trusted by itself. */
export function acceptPlannerProposalResponse(input: unknown, sessionId: string, requestInput: unknown): PlannerProposalReview | undefined {
  try { return acceptPlannerProposalResponseChecked(input, sessionId, requestInput); } catch { return undefined; }
}
function acceptPlannerProposalResponseChecked(input: unknown, sessionId: string, requestInput: unknown): PlannerProposalReview | undefined {
  const request = validatePlannerClassificationRequest(requestInput);
  const proposal = validatePlannerProposal(input);
  if (!request || !proposal || proposal.sessionId !== sessionId ||
    proposal.requestDigest !== plannerParameterRequestDigest(proposal.requestId, sessionId, request)) return undefined;
  return proposal;
}

/** Retain the exact accepted request beside the immutable proposal for a later confirmation boundary. */
export function createPlannerProposalHostSource(proposalInput: unknown, sessionId: string, requestInput: unknown): PlannerProposalHostSource | undefined {
  try {
    const proposal = acceptPlannerProposalResponse(proposalInput, sessionId, requestInput);
    const request = validatePlannerClassificationRequest(requestInput);
    if (!proposal || !request) return undefined;
    return Object.freeze({ requestId: proposal.requestId, sessionId, proposalId: proposal.proposalId,
      requestDigest: proposal.requestDigest, proposalDigest: proposal.proposalDigest, request: Object.freeze({ ...request }) });
  } catch { return undefined; }
}

/** Presentation check only; a matching JSON pair is not user confirmation or authentication. */
export function validatePlannerProposalHostPair(proposalInput: unknown, sourceInput: unknown): PlannerProposalReview | undefined {
  try {
    const copy = snapshotPlannerStrategyData(sourceInput);
    if (!copy.valid || !copy.value || typeof copy.value !== "object" || Array.isArray(copy.value)) return undefined;
    const source = copy.value as PlannerProposalHostSource;
    if (JSON.stringify(Object.keys(source).sort()) !== JSON.stringify(["requestId", "sessionId", "proposalId", "requestDigest", "proposalDigest", "request"].sort())) return undefined;
    const proposal = acceptPlannerProposalResponse(proposalInput, source.sessionId, source.request);
    if (!proposal || proposal.requestId !== source.requestId || proposal.proposalId !== source.proposalId ||
      proposal.requestDigest !== source.requestDigest || proposal.proposalDigest !== source.proposalDigest) return undefined;
    return proposal;
  } catch { return undefined; }
}
