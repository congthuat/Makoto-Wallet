import { formatUnits, isAddress } from "viem";
import { arcTestnet } from "viem/chains";
import { getAssetById } from "./assets.ts";
import { isLiveConfirmedPlannerSource } from "./plannerConfirmationAuthority.ts";
import { createPlannerParameterEvidence, type PlannerEvidenceSource } from "./plannerParameterEvidence.ts";
import { compilePlannerStrategy } from "./plannerStrategyCompiler.ts";
import { materializePlannerStrategy } from "./strategyMaterialization.ts";
import { createAeiDOrchestrator, type AEIDHostPorts, type AEIDOperationalEnvelopeV1 } from "./aeiDOrchestration.ts";
import { integrateAeiDOperationalState, validateAeiEReviewEligibility, type AeiEIntegrationResult } from "./agentTransition.ts";
import type { SendQuote, SwapQuoteData } from "./agent/quoteTools.ts";

export type ProductionAgentStatus =
  | "CONFIRMATION_REQUIRED" | "CONFIRMATION_REVOKED" | "COMPILING" | "STRATEGY_REJECTED"
  | "MATERIALIZATION_FAILED" | "DEPENDENCY_BLOCKED" | "PREPARING" | "ORCHESTRATION_BLOCKED"
  | "REQUOTE_REQUIRED" | "REVALIDATION_REQUIRED" | "REVIEW_REQUIRED" | "WARNING"
  | "REVIEW_ELIGIBLE" | "HANDOFF_REQUIRED" | "UNSUPPORTED" | "OPERATIONAL_FAILED"
  | "STALE_RESULT" | "CANCELLED";

export type ReviewPresentation = Readonly<{
  version: 1; requestId: string; sessionId: string; strategyId: string; actionStepId: string; goalId: string;
  account: string; chainId: typeof arcTestnet.id; stateId: string; materializationRevision: string;
  orchestrationRevision: string; quoteDigest: string; preparationDigest: string; policyDigest: string;
  technicalStepId: string; technicalStepIndex: number; technicalStepKind: "send" | "swap" | "finite-approval";
  kind: "SEND" | "SWAP"; asset: string; amount: string; recipient: string | null; route: string | null;
  outputAsset: string | null; expectedOutput: string | null; minimumReceived: string | null;
  approvalSpender: string | null; quoteFingerprint: string;
  quoteExpiresAt: number; preparationExpiresAt: number; fee: string;
  warnings: readonly string[]; reviewRequirements: readonly string[];
  executionEnabled: false;
}>;

const reviewKeys = ["version", "requestId", "sessionId", "strategyId", "actionStepId", "goalId",
  "account", "chainId", "stateId", "materializationRevision", "orchestrationRevision", "quoteDigest",
  "preparationDigest", "policyDigest", "technicalStepId", "technicalStepIndex", "technicalStepKind",
  "kind", "asset", "amount", "recipient", "route", "outputAsset", "expectedOutput", "minimumReceived",
  "approvalSpender", "quoteFingerprint", "quoteExpiresAt", "preparationExpiresAt", "fee", "warnings",
  "reviewRequirements", "executionEnabled"] as const;
const digest = (value: unknown) => typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
const shortText = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 256;
const decimal = (value: unknown) => typeof value === "string" && /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value) && Number(value) > 0;
/** Structural validation only; the live E result is still required at every Review opening. */
export function validateProductionReviewPresentation(input: unknown): input is ReviewPresentation {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype ||
      Reflect.ownKeys(input).length !== reviewKeys.length || reviewKeys.some((key) => {
        const field = Object.getOwnPropertyDescriptor(input, key);
        return !field?.enumerable || !Object.hasOwn(field, "value");
      })) return false;
    const value = input as ReviewPresentation;
    return value.version === 1 && value.executionEnabled === false && value.chainId === arcTestnet.id &&
      value.technicalStepIndex === 0 && ["send", "swap", "finite-approval"].includes(value.technicalStepKind) &&
      ["SEND", "SWAP"].includes(value.kind) && isAddress(value.account) &&
      (value.recipient === null || isAddress(value.recipient)) &&
      (value.approvalSpender === null || isAddress(value.approvalSpender)) &&
      [value.requestId, value.sessionId, value.strategyId, value.actionStepId, value.goalId, value.stateId,
        value.technicalStepId, value.asset, value.fee].every(shortText) && decimal(value.amount) &&
      [value.materializationRevision, value.orchestrationRevision, value.quoteDigest,
        value.preparationDigest, value.policyDigest, value.quoteFingerprint].every(digest) &&
      [value.route, value.outputAsset].every((part) => part === null || shortText(part)) &&
      [value.expectedOutput, value.minimumReceived].every((part) => part === null || decimal(part)) &&
      (value.kind === "SEND" ? value.technicalStepKind === "send" && value.recipient !== null && value.route === null &&
        value.outputAsset === null && value.expectedOutput === null && value.minimumReceived === null && value.approvalSpender === null :
        (value.technicalStepKind === "swap" || value.technicalStepKind === "finite-approval") && value.recipient === null &&
        value.route === "xylonet-stableswap" && ["USDC", "EURC"].includes(value.asset) &&
        ["USDC", "EURC"].includes(value.outputAsset ?? "") && value.outputAsset !== value.asset &&
        value.expectedOutput !== null && value.minimumReceived !== null &&
        (value.technicalStepKind === "finite-approval" ? value.approvalSpender !== null : value.approvalSpender === null)) &&
      [value.quoteExpiresAt, value.preparationExpiresAt].every((time) => Number.isSafeInteger(time) && time > 0) &&
      Array.isArray(value.warnings) && value.warnings.every(shortText) &&
      Array.isArray(value.reviewRequirements) && value.reviewRequirements.every(shortText);
  } catch { return false; }
}

type Mapped = Extract<AeiEIntegrationResult, { status: "MAPPED" }>;
export type ProductionAgentView = Readonly<{ status: ProductionAgentStatus; reason?: string; review?: ReviewPresentation }>;

/** One mounted B2 card owns this instance. Nothing here can submit a transaction. */
export function createProductionAgentFlow(host: AEIDHostPorts, onChange: (view: ProductionAgentView) => void) {
  let generation = 0;
  let retained: PlannerEvidenceSource | undefined;
  let envelope: AEIDOperationalEnvelopeV1 | undefined;
  let mapped: Mapped | undefined;
  let review: ReviewPresentation | undefined;
  let opening = false;
  let cancelled = false;
  const publish = (status: ProductionAgentStatus, reason?: string, nextReview?: ReviewPresentation) => {
    review = nextReview;
    onChange({ status, ...(reason ? { reason } : {}), ...(nextReview ? { review: nextReview } : {}) });
  };
  const live = (token: number) => !cancelled && token === generation && !!retained && isLiveConfirmedPlannerSource(retained);
  const cancel = () => { cancelled = true; generation++; retained = undefined; envelope = undefined; mapped = undefined; review = undefined; publish("CANCELLED"); };

  async function confirm(source: PlannerEvidenceSource): Promise<void> {
    if (retained) return;
    if (cancelled || !isLiveConfirmedPlannerSource(source)) { publish("CONFIRMATION_REVOKED"); return; }
    retained = source;
    const token = ++generation;
    publish("COMPILING");
    try {
      const evidence = createPlannerParameterEvidence(source);
      if (!live(token)) return;
      if (!evidence.valid || evidence.value.status !== "RESOLVED_WITH_EVIDENCE") { publish("STRATEGY_REJECTED", "Parameter evidence unavailable"); return; }
      const compiled = compilePlannerStrategy({ version: 2, requestId: source.requestId, sessionId: source.sessionId,
        createdAt: Date.now(), plan: source.plan, resolution: evidence.value, provenanceSource: source });
      if (!live(token)) return;
      if (compiled.status !== "COMPILED" || compiled.executionEnabled !== false || compiled.binding.version !== 2) {
        publish("STRATEGY_REJECTED", compiled.status === "REJECTED" ? compiled.reason : "Invalid compilation"); return;
      }
      const materialized = materializePlannerStrategy({ version: 1, compilation: compiled,
        bindingSource: { requestId: source.requestId, sessionId: source.sessionId, plan: source.plan,
          resolution: source.resolution, strategy: compiled.strategy, goalSteps: compiled.binding.goalSteps,
          provenance: evidence.value, provenanceSource: source } });
      if (!live(token)) return;
      if (materialized.status !== "MATERIALIZED") { publish("MATERIALIZATION_FAILED", materialized.reason); return; }
      const roots = materialized.materialization.actions.filter((action) => action.dependsOnStepIds.length === 0);
      if (!roots.length) { publish("DEPENDENCY_BLOCKED", "No independent action"); return; }
      // Preparation and policy are not verified completion. Only one independent ACTION progresses.
      const selected = roots[0];
      publish("PREPARING");
      const d = await createAeiDOrchestrator(host).orchestrate({ materialization: materialized.materialization,
        retainedLiveInput: { version: 1, compilation: compiled,
          bindingSource: { requestId: source.requestId, sessionId: source.sessionId, plan: source.plan,
            resolution: source.resolution, strategy: compiled.strategy, goalSteps: compiled.binding.goalSteps,
            provenance: evidence.value, provenanceSource: source } }, actionStepId: selected.actionStepId,
        ...(selected.actionKind === "SWAP" ? { slippage: 0.01 as const } : {}) });
      if (!live(token)) return;
      if (!d.envelope) { publish("OPERATIONAL_FAILED", d.status); return; }
      envelope = d.envelope;
      const e = await integrateAeiDOperationalState({ version: 1, envelope: d.envelope,
        retainedLiveInput: { version: 1, compilation: compiled,
          bindingSource: { requestId: source.requestId, sessionId: source.sessionId, plan: source.plan,
            resolution: source.resolution, strategy: compiled.strategy, goalSteps: compiled.binding.goalSteps,
            provenance: evidence.value, provenanceSource: source } },
        currentState: { version: 2, kind: "PLAN_READY", sessionId: source.sessionId,
          stateId: `aei-f:${crypto.randomUUID()}`, plan: { kind: "PLANNER_PLAN", id: source.plan.id } } });
      if (!live(token) || envelope !== d.envelope) return;
      if (e.status !== "MAPPED") { publish("OPERATIONAL_FAILED", e.reason); return; }
      mapped = e;
      if (e.state.kind === "TRANSACTION" && e.state.status === "PREPARED") {
        publish(e.sidecar.policyDecision === "REQUIRE_REVIEW" ? "REVIEW_REQUIRED" : e.sidecar.policyDecision === "WARN" ? "WARNING" : "REVIEW_ELIGIBLE");
      } else {
        const status: ProductionAgentStatus = d.status === "HANDOFF_REQUIRED" ? "HANDOFF_REQUIRED" :
          d.status === "REQUOTE_REQUIRED" || d.status === "QUOTE_STALE" ? "REQUOTE_REQUIRED" :
          d.status === "REVALIDATION_REQUIRED" ? "REVALIDATION_REQUIRED" :
          d.status === "DEPENDENCY_BLOCKED" ? "DEPENDENCY_BLOCKED" :
          d.status === "UNSUPPORTED_ACTION" || d.status === "UNSUPPORTED_ACCOUNT_CONTEXT" ? "UNSUPPORTED" :
          d.status === "BLOCKED_BY_POLICY" ? "ORCHESTRATION_BLOCKED" : "OPERATIONAL_FAILED";
        publish(status, d.status);
      }
    } catch { if (live(token)) publish("OPERATIONAL_FAILED", "Production preparation unavailable"); }
  }

  async function openReview(): Promise<void> {
    if (opening || !retained || !mapped || !envelope || review) return;
    const token = generation, e = mapped, d = envelope;
    opening = true;
    try {
      const eligible = await validateAeiEReviewEligibility(e);
      if (!live(token) || mapped !== e || envelope !== d) return;
      if (!eligible.eligible) { publish("STALE_RESULT", eligible.reason); return; }
      const presentation = reviewFrom(e, d);
      if (!presentation) { publish("STALE_RESULT", "Review facts did not match preparation"); return; }
      publish("REVIEW_ELIGIBLE", undefined, presentation);
    } finally { opening = false; }
  }

  async function refreshReview(): Promise<void> {
    if (!review || !mapped || !envelope) return;
    const token = generation, e = mapped, d = envelope, prior = review;
    const eligible = await validateAeiEReviewEligibility(e);
    if (!live(token) || mapped !== e || envelope !== d || review !== prior) return;
    if (!eligible.eligible || !reviewFrom(e, d) || Date.now() > prior.quoteExpiresAt || Date.now() > prior.preparationExpiresAt)
      publish("STALE_RESULT", eligible.eligible ? "Review expired" : eligible.reason);
  }

  return { confirm, openReview, refreshReview, cancel };
}

function reviewFrom(e: Mapped, d: AEIDOperationalEnvelopeV1): ReviewPresentation | undefined {
  try {
    if (e.state.kind !== "TRANSACTION" || e.state.status !== "PREPARED" || !d.accountContext ||
      !d.quote || d.quote.result.status !== "AVAILABLE" || !d.prepared || d.prepared.result.status !== "PREPARED" || !d.policy ||
      e.sidecar.orchestrationDigest !== d.digest || e.sidecar.materializationDigest !== d.materialization.digest ||
      e.sidecar.preparationDigest !== d.prepared.digest || e.sidecar.quoteDigest !== d.quote.digest ||
      e.sidecar.policyDigest !== d.policy.digest || e.sidecar.account !== d.accountContext.account.toLowerCase() ||
      e.sidecar.chainId !== arcTestnet.id || e.sidecar.technicalStepIndex !== 0 ||
      e.sidecar.technicalStepId !== e.state.step.stepId || e.sidecar.quoteExpiresAt === null ||
      e.sidecar.preparationExpiresAt === null || Date.now() > e.sidecar.quoteExpiresAt ||
      Date.now() > e.sidecar.preparationExpiresAt) return undefined;
    const prepared = d.prepared.result.data, step = prepared.steps[0], params = d.action.parameters;
    if (!step || !["send", "swap", "finite-approval"].includes(step.kind) ||
      e.sidecar.technicalStepKind !== step.kind || step.account.toLowerCase() !== e.sidecar.account ||
      step.chainId !== arcTestnet.id || (params.kind !== "SEND" && params.kind !== "SWAP") ||
      d.action.actionKind !== params.kind || e.sidecar.actionStepId !== d.action.actionStepId ||
      e.sidecar.goalId !== d.action.goalId || e.sidecar.strategyId !== d.materialization.strategyId ||
      e.sidecar.materializationRevision !== d.materialization.revision ||
      e.sidecar.orchestrationRevision !== d.revision || e.state.binding.account.toLowerCase() !== e.sidecar.account ||
      e.state.binding.chainId !== arcTestnet.id) return undefined;
    const asset = getAssetById(step.assetId);
    if (!asset || step.amount <= 0n || params.kind === "SEND" && (step.kind !== "send" || !prepared.recipient ||
      prepared.recipient.toLowerCase() !== params.recipient.toLowerCase()) ||
      params.kind === "SWAP" && !["swap", "finite-approval"].includes(step.kind)) return undefined;
    const swapQuote = params.kind === "SWAP" ? d.quote.result.data as SwapQuoteData : undefined;
    const sendQuote = params.kind === "SEND" ? d.quote.result.data as SendQuote : undefined;
    const output = swapQuote ? getAssetById(swapQuote.outputAsset) : undefined;
    if (swapQuote && (!output || params.kind !== "SWAP" || swapQuote.outputAsset !== params.toAsset ||
      typeof swapQuote.expectedOutput !== "bigint" || swapQuote.expectedOutput <= 0n ||
      typeof swapQuote.minimumReceived !== "bigint" || swapQuote.minimumReceived <= 0n ||
      swapQuote.minimumReceived > swapQuote.expectedOutput || swapQuote.route !== prepared.route ||
      step.kind === "finite-approval" && (!step.spender || step.amount !== prepared.inputAmount))) return undefined;
    if (sendQuote && (typeof sendQuote.maximumFeeUsdc6 !== "bigint" || sendQuote.maximumFeeUsdc6 < 0n)) return undefined;
    const technicalStepKind = step.kind as ReviewPresentation["technicalStepKind"];
    const presentation = Object.freeze({ version: 1, requestId: d.materialization.requestId, sessionId: e.sidecar.sessionId,
      strategyId: e.sidecar.strategyId, actionStepId: e.sidecar.actionStepId, goalId: e.sidecar.goalId,
      account: e.sidecar.account, chainId: arcTestnet.id, stateId: e.sidecar.stateId,
      materializationRevision: e.sidecar.materializationRevision, orchestrationRevision: e.sidecar.orchestrationRevision,
      quoteDigest: e.sidecar.quoteDigest, preparationDigest: e.sidecar.preparationDigest, policyDigest: e.sidecar.policyDigest,
      technicalStepId: e.sidecar.technicalStepId, technicalStepIndex: 0, technicalStepKind,
      kind: params.kind, asset: asset.symbol, amount: formatUnits(step.amount, asset.decimals),
      recipient: prepared.recipient ?? null, route: prepared.route ?? null,
      outputAsset: output?.symbol ?? null, expectedOutput: swapQuote && output ? formatUnits(swapQuote.expectedOutput, output.decimals) : null,
      minimumReceived: swapQuote && output ? formatUnits(swapQuote.minimumReceived, output.decimals) : null,
      approvalSpender: step.kind === "finite-approval" ? step.spender ?? null : null,
      quoteFingerprint: prepared.quoteFingerprint,
      quoteExpiresAt: e.sidecar.quoteExpiresAt, preparationExpiresAt: e.sidecar.preparationExpiresAt,
      fee: params.kind === "SWAP" ? "Gas fee not estimated" : `Maximum estimated fee ${formatUnits(sendQuote!.maximumFeeUsdc6!, 6)} USDC`,
      warnings: Object.freeze([...e.sidecar.warnings]), reviewRequirements: Object.freeze([...e.sidecar.reviewRequirements]),
      executionEnabled: false });
    return validateProductionReviewPresentation(presentation) ? presentation : undefined;
  } catch { return undefined; }
}
