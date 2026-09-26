import { getAddress, isAddress } from "viem";
import { arcTestnet, baseSepolia } from "viem/chains";
import { SUPPORTED_ASSETS } from "./assets.ts";
import { validatePlannerIntent, type PlannerIntent } from "./plannerIntent.ts";
import { validatePlannerPlan, type PlannerPlan, type PlannerPlanValidationIssue } from "./plannerPlan.ts";
import { validatePlannerClassificationRequest, type PlannerClassificationRequest } from "./plannerSemanticClassifier.ts";
import { isXyloSwappableAssetId, oppositeAssetId } from "./swap.ts";
import { createDynamicPlannerParameterEvidence, createPlannerParameterEvidence, type PlannerEvidenceResult,
  type PlannerStructuredInput } from "./plannerParameterEvidence.ts";
import { snapshotPlannerStrategyData } from "./plannerStrategyBinding.ts";

export type PlannerParameterRequest = PlannerClassificationRequest & Readonly<{ plan: PlannerPlan }>;
/** The provider returns unknown extraction data, never a canonical PlannerIntent. */
export interface PlannerParameterResolver {
  resolve(request: PlannerParameterRequest): Promise<unknown>;
}
export type PlannerParameterIssue = Readonly<{
  goalId: string;
  field: string;
  code: "MISSING" | "DYNAMIC_AMOUNT" | "UNSUPPORTED" | "INVALID_FORMAT" | "CONTRADICTORY" | "UNTRUSTED_VALUE";
}>;
export type PlannerParameterResult =
  | Readonly<{ status: "RESOLVED"; planId: string; intents: readonly PlannerIntent[] }>
  | Readonly<{ status: "NEEDS_CLARIFICATION"; issues: readonly PlannerParameterIssue[] }>
  | Readonly<{ status: "INVALID_PARAMETERS"; issues: readonly PlannerParameterIssue[] }>
  | Readonly<{ status: "INVALID_PLAN"; errors: readonly PlannerPlanValidationIssue[] }>
  | Readonly<{ status: "PROVIDER_ERROR" }>;

type Candidate = Readonly<{ goalId: string; chain: string | null; asset: string | null; amount: string | null; recipient: string | null; fromAsset: string | null; toAsset: string | null; sourceChain: string | null; destinationChain: string | null }>;
const candidateFields = ["goalId", "chain", "asset", "amount", "recipient", "fromAsset", "toAsset", "sourceChain", "destinationChain"] as const;
const valueFields = candidateFields.slice(1) as readonly (keyof Omit<Candidate, "goalId">)[];
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).every((key) => typeof key === "string" && Object.getOwnPropertyDescriptor(value, key)?.enumerable && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"));
const exactKeys = (value: Record<string, unknown>, fields: readonly string[]) => fields.every((key) => Object.hasOwn(value, key)) && Object.keys(value).length === fields.length;
const dense = (value: unknown): value is unknown[] => Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && Object.keys(value).length === value.length && Reflect.ownKeys(value).length === value.length + 1 && Array.from({ length: value.length }, (_, index) => Object.hasOwn(value, index) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, String(index))!, "value")).every(Boolean);

function parseDraft(input: unknown, plan: PlannerPlan): Map<string, Candidate> | undefined {
  if (!record(input) || !exactKeys(input, ["resolutions"]) || !dense(input.resolutions) || input.resolutions.length !== plan.goals.length) return undefined;
  const candidates = new Map<string, Candidate>();
  for (const item of input.resolutions) {
    if (!record(item) || !exactKeys(item, candidateFields) || typeof item.goalId !== "string" || !plan.goals.some((goal) => goal.id === item.goalId) || candidates.has(item.goalId)) return undefined;
    if (valueFields.some((field) => item[field] !== null && (typeof item[field] !== "string" || (item[field] as string).length > 256))) return undefined;
    candidates.set(item.goalId, item as Candidate);
  }
  return candidates;
}

function canonicalAsset(value: string): string {
  const key = value.trim().toLowerCase();
  return SUPPORTED_ASSETS.find((asset) => [asset.id, asset.symbol.toLowerCase(), asset.name.toLowerCase()].includes(key))?.id ?? value.trim();
}
function canonicalChain(value: string): number | string {
  const key = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (key === "arc" || key === "arc testnet" || key === String(arcTestnet.id)) return arcTestnet.id;
  if (key === "base sepolia" || key === String(baseSepolia.id)) return baseSepolia.id;
  return value.trim();
}
function canonicalAddress(value: string): string { return isAddress(value, { strict: true }) ? getAddress(value) : value.trim(); }
const dynamicAmount = (value: string) => /\b(?:all(?:\s+(?:my|the))?|half|maximum|max|whatever\s+(?:i|we)\s+receive)\b|\d+(?:\.\d+)?\s*%|\b(?:previous|prior)\s+(?:step|output|result|transaction)\b|\breceiv(?:e|ed)\b|\breceipt\b|\breturns?\b/i.test(value);
const quoted = (text: string, value: string) => text.toLowerCase().includes(value.trim().toLowerCase());
const assetAfterAmount = (text: string) => text.match(/\b\d+(?:\.\d+)?\s+([a-z][a-z0-9]{1,15})\b/i)?.[1];
const swapTarget = (text: string) => text.match(/\bswap\b[^.;]{0,120}\bto\s+([a-z][a-z0-9]{1,15})\b/i)?.[1];

/** Validate the 11C graph before a single provider call, then bind every result to its goal ID. */
export async function resolvePlannerParameters(textInput: unknown, planInput: unknown, resolver: PlannerParameterResolver): Promise<PlannerParameterResult> {
  const planResult = validatePlannerPlan(planInput);
  if (!planResult.valid) return { status: "INVALID_PLAN", errors: planResult.errors };
  const textRequest = validatePlannerClassificationRequest(textInput);
  if (!textRequest) return { status: "INVALID_PARAMETERS", issues: [{ goalId: planResult.value.id, field: "text", code: "INVALID_FORMAT" }] };
  const plan: PlannerPlan = Object.freeze({ ...planResult.value, goals: Object.freeze(planResult.value.goals.map((goal) => Object.freeze({ ...goal, dependsOn: Object.freeze([...goal.dependsOn]) }))) });
  let untrusted: unknown;
  try { untrusted = await resolver.resolve({ ...textRequest, plan }); }
  catch { return { status: "PROVIDER_ERROR" }; }
  const candidates = parseDraft(untrusted, plan);
  if (!candidates) return { status: "PROVIDER_ERROR" };

  const invalid: PlannerParameterIssue[] = [], missing: PlannerParameterIssue[] = [], intents: PlannerIntent[] = [];
  const reject = (goalId: string, field: string, code: PlannerParameterIssue["code"]) => invalid.push({ goalId, field, code });
  const clarify = (goalId: string, field: string, code: "MISSING" | "DYNAMIC_AMOUNT") => missing.push({ goalId, field, code });
  for (const goal of plan.goals) {
    const draft = candidates.get(goal.id)!;
    const allowed = goal.kind === "SEND" ? ["chain", "asset", "amount", "recipient"] : goal.kind === "SWAP" ? ["chain", "fromAsset", "toAsset", "amount"] : ["sourceChain", "destinationChain", "asset", "amount", "recipient"];
    for (const field of valueFields) if (!allowed.includes(field) && draft[field] !== null) reject(goal.id, field, "CONTRADICTORY");
    const requireValue = (field: keyof Omit<Candidate, "goalId">): string | undefined => {
      const value = draft[field];
      if (value === null || !value.trim()) { clarify(goal.id, field, "MISSING"); return undefined; }
      return value.trim();
    };
    const amount = requireValue("amount");
    const dynamic = dynamicAmount(textRequest.text) || Boolean(amount && dynamicAmount(amount));
    if (dynamic) clarify(goal.id, "amount", "DYNAMIC_AMOUNT");
    if (amount && !dynamic && !quoted(textRequest.text, amount)) reject(goal.id, "amount", "UNTRUSTED_VALUE");
    const recipient = goal.kind === "SWAP" ? undefined : requireValue("recipient");
    if (goal.kind !== "SWAP" && !recipient && /\b0x[0-9a-z]+\b/i.test(textRequest.text)) reject(goal.id, "recipient", "INVALID_FORMAT");
    if (recipient && !quoted(textRequest.text, recipient)) reject(goal.id, "recipient", "UNTRUSTED_VALUE");
    if (goal.kind === "SEND") {
      const asset = draft.asset?.trim() || (plan.goals.length === 1 ? assetAfterAmount(textRequest.text) : undefined);
      if (!asset) clarify(goal.id, "asset", "MISSING");
      if (asset && !quoted(textRequest.text, asset)) reject(goal.id, "asset", "UNTRUSTED_VALUE");
      const intent = { version: 1, id: goal.id, kind: "SEND", chainId: draft.chain === null ? arcTestnet.id : canonicalChain(draft.chain), asset: asset && canonicalAsset(asset), amount, recipient: recipient && canonicalAddress(recipient) };
      if (asset && amount && recipient && !dynamic) checkIntent(intent, goal.id, invalid, intents);
    } else if (goal.kind === "SWAP") {
      let from = draft.fromAsset?.trim() || (plan.goals.length === 1 ? assetAfterAmount(textRequest.text) : undefined);
      let to = draft.toAsset?.trim() || (plan.goals.length === 1 ? swapTarget(textRequest.text) : undefined);
      if (from && !quoted(textRequest.text, from)) reject(goal.id, "fromAsset", "UNTRUSTED_VALUE");
      if (to && !quoted(textRequest.text, to)) reject(goal.id, "toAsset", "UNTRUSTED_VALUE");
      if (from) from = canonicalAsset(from);
      if (to) to = canonicalAsset(to);
      if (!from && to && isXyloSwappableAssetId(to as Parameters<typeof oppositeAssetId>[0])) from = oppositeAssetId(to as Parameters<typeof oppositeAssetId>[0]);
      if (!to && from && isXyloSwappableAssetId(from as Parameters<typeof oppositeAssetId>[0])) to = oppositeAssetId(from as Parameters<typeof oppositeAssetId>[0]);
      if (!from) clarify(goal.id, "fromAsset", "MISSING");
      if (!to) clarify(goal.id, "toAsset", "MISSING");
      const intent = { version: 1, id: goal.id, kind: "SWAP", chainId: draft.chain === null ? arcTestnet.id : canonicalChain(draft.chain), fromAsset: from, toAsset: to, amount };
      if (from && to && amount && !dynamic) checkIntent(intent, goal.id, invalid, intents);
    } else {
      const asset = canonicalAsset(draft.asset ?? (plan.goals.length === 1 ? assetAfterAmount(textRequest.text) : undefined) ?? "usdc");
      if (draft.asset && !quoted(textRequest.text, draft.asset)) reject(goal.id, "asset", "UNTRUSTED_VALUE");
      const intent = { version: 1, id: goal.id, kind: "BRIDGE", sourceChainId: draft.sourceChain === null ? arcTestnet.id : canonicalChain(draft.sourceChain), destinationChainId: draft.destinationChain === null ? baseSepolia.id : canonicalChain(draft.destinationChain), asset, amount, recipient: recipient && canonicalAddress(recipient) };
      if (amount && recipient && !dynamic) checkIntent(intent, goal.id, invalid, intents);
    }
  }
  if (invalid.length) return { status: "INVALID_PARAMETERS", issues: invalid };
  if (missing.length) return { status: "NEEDS_CLARIFICATION", issues: missing };
  return intents.length === plan.goals.length ? { status: "RESOLVED", planId: plan.id, intents } : { status: "PROVIDER_ERROR" };
}

function checkIntent(input: unknown, goalId: string, invalid: PlannerParameterIssue[], intents: PlannerIntent[]): void {
  const result = validatePlannerIntent(input);
  if (result.valid) { intents.push(result.value); return; }
  for (const issue of result.errors) invalid.push({ goalId, field: issue.path.replace(/^intent\.?/, "") || "intent", code: issue.code === "UNSUPPORTED" || issue.code === "UNSUPPORTED_KIND" ? "UNSUPPORTED" : "INVALID_FORMAT" });
}

/** Opt-in v2 boundary. Free-text extraction alone returns UNVERIFIED, never fixed-origin authority. */
export async function resolvePlannerParametersWithEvidence(textInput: unknown, planInput: unknown,
  resolver: PlannerParameterResolver, context: Readonly<{ requestId: string; sessionId: string;
    structuredInput: PlannerStructuredInput | null }>): Promise<PlannerParameterResult | PlannerEvidenceResult> {
  const captured = snapshotPlannerStrategyData({ textInput, planInput, context });
  if (!captured.valid || !captured.value || typeof captured.value !== "object" || Array.isArray(captured.value))
    return { valid: false, reason: "INVALID_RUNTIME" };
  const stable = captured.value as { textInput: unknown; planInput: unknown; context: unknown };
  if (!stable.context || typeof stable.context !== "object" || Array.isArray(stable.context) ||
    Reflect.ownKeys(stable.context).length !== 3 || !["requestId", "sessionId", "structuredInput"].every((key) => Object.hasOwn(stable.context as object, key)))
    return { valid: false, reason: "INVALID_RUNTIME" };
  const trusted = stable.context as typeof context;
  const resolution = await resolvePlannerParameters(stable.textInput, stable.planInput, resolver);
  if (resolution.status === "NEEDS_CLARIFICATION") {
    const dynamic = resolution.issues.find((issue) => issue.code === "DYNAMIC_AMOUNT");
    if (dynamic) return createDynamicPlannerParameterEvidence({ requestId: trusted.requestId, sessionId: trusted.sessionId,
      request: stable.textInput, plan: stable.planInput }, dynamic.goalId);
  }
  if (resolution.status !== "RESOLVED") return resolution;
  return createPlannerParameterEvidence({ requestId: trusted.requestId, sessionId: trusted.sessionId,
    request: stable.textInput, plan: stable.planInput, resolution, structuredInput: trusted.structuredInput });
}
