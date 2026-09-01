import type { Address } from "viem";

import type { AgentPlanningResult } from "./planning.ts";
import type { AgentActionDraft, AgentIntent, AgentPreparationInput, AgentRequestMode, AgentTopic } from "./types.ts";

export type AgentCapabilityId =
  | "wallet_overview" | "recent_activity" | "activity_explanation" | "vault_summary" | "network_status" | "safety_capabilities"
  | "latest_transaction" | "today_spending" | "send_planning" | "swap_planning" | "bridge_planning" | "blocking_explanation"
  | "send_preparation" | "swap_preparation" | "bridge_preparation" | "vault_preparation"
  | "clarification" | "unknown";

export type AgentOrchestrationDecision = Readonly<{
  topic: AgentTopic;
  mode: AgentRequestMode;
  capabilityId: AgentCapabilityId;
  freshDataRequired: boolean;
  draftAllowed: boolean;
  clarification?: "missing-topic" | "swap-or-bridge" | "approval-topic" | "missing-details";
}>;

const PLANNING = new Set<AgentIntent["kind"]>(["latest-transaction", "today-spending", "send-affordability", "send-remaining", "swap-quote", "swap-allowance", "swap-affordability", "bridge-estimate", "bridge-route", "bridge-completion", "blocking-explanation"]);

export function routeAgentRequest(intent: AgentIntent): AgentOrchestrationDecision {
  if (intent.kind === "clarification") return decision(topicOf(intent), "clarification", "clarification", false, false, intent.clarification);
  if (intent.kind === "unknown") return decision("unknown", "clarification", "unknown", false, false);
  if (intent.kind === "prepare-action") {
    const input = intent.preparation;
    if (!input || missingPreparation(input).length || conflictingPreparation(input)) return decision(input ? actionTopic(input.kind) : "unknown", "clarification", "clarification", false, false, "missing-details");
    return decision(actionTopic(input.kind), "preparation", `${input.kind.startsWith("vault-") ? "vault" : input.kind}_preparation` as AgentCapabilityId, input.kind === "send" || input.kind === "swap" || input.kind === "bridge", true);
  }
  if (PLANNING.has(intent.kind)) return decision(topicOf(intent), "planning", planningCapability(intent), true, false);
  return decision(topicOf(intent), "informational", informationalCapability(intent), false, false);
}

export function createAgentActionDraft(intent: AgentIntent, planning?: AgentPlanningResult): AgentActionDraft | undefined {
  if (intent.kind !== "prepare-action" || !intent.preparation || missingPreparation(intent.preparation).length || conflictingPreparation(intent.preparation)) return undefined;
  const input = intent.preparation;
  if (input.kind === "send" || input.kind === "swap" || input.kind === "bridge") {
    if (!planning || !planningAllowsDraft(planning)) return undefined;
  }
  const common = { version: 1 as const, mode: "prepare-only" as const, rawUserText: input.rawUserText, executionEnabled: false as const };
  if (input.kind === "send") return Object.freeze({ ...common, kind: "send", asset: assetName(input.assetId), amount: input.amount!, recipient: input.recipient!, sourceChain: "Arc Testnet" });
  if (input.kind === "swap") return Object.freeze({ ...common, kind: "swap", inputAsset: assetName(input.assetId), outputAsset: assetName(input.outputAssetId), amount: input.amount!, slippage: 0.005, sourceChain: "Arc Testnet" });
  if (input.kind === "bridge") {
    const sourceChain = chainName(input.sourceChainId)!;
    const destinationChain = chainName(input.destinationChainId)!;
    return Object.freeze({ ...common, kind: "bridge", asset: "USDC", amount: input.amount!, sourceChain, destinationChain, ...(input.recipient ? { recipient: input.recipient } : {}), routeMode: sourceChain === "Arc Testnet" && destinationChain === "Base Sepolia" ? "cctp-direct-forwarding" : "circle-app-kit-cctp" });
  }
  return Object.freeze({ ...common, kind: input.kind, asset: "USDC", amount: input.amount! });
}

export function missingPreparation(input: AgentPreparationInput): readonly string[] {
  const missing: string[] = [];
  if (!input.amount || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(input.amount) || Number(input.amount) <= 0) missing.push("amount");
  if (input.kind === "send" && !input.recipient) missing.push("recipient");
  if (input.kind === "swap" && !input.outputAssetId) missing.push("outputAsset");
  if (input.kind === "bridge" && !input.destinationChainId) missing.push("destinationChain");
  return Object.freeze(missing);
}

function conflictingPreparation(input: AgentPreparationInput) {
  return Boolean(input.invalidRecipient || input.recipient?.toLowerCase() === "0x0000000000000000000000000000000000000000" || input.kind === "swap" && input.assetId === input.outputAssetId || input.kind === "bridge" && input.sourceChainId === input.destinationChainId);
}

function planningAllowsDraft(planning: AgentPlanningResult) {
  if (planning.status === "unavailable" || planning.refreshRequired || planning.completeness === "unavailable") return false;
  const nonFatal = new Set(["allowance-required", "approval-gas-unavailable"]);
  return planning.blockingReasons.every((reason) => nonFatal.has(reason));
}

function assetName(value: AgentPreparationInput["assetId"]): "USDC" | "EURC" { return value === "eurc" ? "EURC" : "USDC"; }
function actionTopic(kind: AgentPreparationInput["kind"]): AgentTopic { return kind.startsWith("vault-") ? "vault" : kind as AgentTopic; }
function chainName(value: number | undefined): "Arc Testnet" | "Base Sepolia" | undefined { return value === 5_042_002 ? "Arc Testnet" : value === 84_532 ? "Base Sepolia" : undefined; }
function decision(topic: AgentTopic, mode: AgentRequestMode, capabilityId: AgentCapabilityId, freshDataRequired: boolean, draftAllowed: boolean, clarification?: AgentOrchestrationDecision["clarification"]): AgentOrchestrationDecision { return Object.freeze({ topic, mode, capabilityId, freshDataRequired, draftAllowed, ...(clarification ? { clarification } : {}) }); }
function topicOf(intent: AgentIntent): AgentTopic { if (intent.kind.includes("swap")) return "swap"; if (intent.kind.includes("bridge")) return "bridge"; if (intent.kind.includes("send")) return "send"; if (intent.kind.includes("activity") || intent.kind === "latest-transaction" || intent.kind === "today-spending") return "activity"; if (intent.kind.includes("network")) return "network"; if (intent.kind.includes("vault")) return "vault"; if (intent.kind.includes("safety") || intent.kind === "blocking-explanation") return "safety"; if (intent.kind === "wallet-overview") return "wallet"; return "unknown"; }
function planningCapability(intent: AgentIntent): AgentCapabilityId { if (intent.kind.startsWith("swap-")) return "swap_planning"; if (intent.kind.startsWith("bridge-")) return "bridge_planning"; if (intent.kind.startsWith("send-")) return "send_planning"; if (intent.kind === "latest-transaction") return "latest_transaction"; if (intent.kind === "today-spending") return "today_spending"; return "blocking_explanation"; }
function informationalCapability(intent: AgentIntent): AgentCapabilityId { return ({ "wallet-overview": "wallet_overview", "recent-activity": "recent_activity", "activity-explanation": "activity_explanation", "vault-summary": "vault_summary", "network-status": "network_status", "safety-capabilities": "safety_capabilities" } as Partial<Record<AgentIntent["kind"], AgentCapabilityId>>)[intent.kind] ?? "unknown"; }

export type AgentBindingMetadata = Readonly<{ generation: number; account?: Address; chainId?: number }>;
