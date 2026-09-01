import { getAddress, isAddress, zeroAddress } from "viem";
import type { AgentActionDraft } from "../types.ts";
import type { AgentDraftValidation } from "./types.ts";

const ASSETS = new Set(["USDC", "EURC"]);
const CHAINS = new Set(["Arc Testnet", "Base Sepolia"]);
const AMOUNT = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;

export function validateAgentActionDraft(draft: AgentActionDraft): AgentDraftValidation {
  const missing = new Set<string>();
  const errors: string[] = [];
  if (draft.version !== 1 || draft.mode !== "prepare-only" || draft.executionEnabled !== false) errors.push("draft");
  if (!draft.amount) missing.add("amount");
  else if (/^(?:max|all|everything|entire balance)$/i.test(draft.amount)) errors.push("MAX actions require the manual flow.");
  else if (!AMOUNT.test(draft.amount) || Number(draft.amount) <= 0) errors.push("amount");
  const asset = draft.kind === "swap" ? draft.inputAsset : draft.asset;
  if (!asset || !ASSETS.has(asset.toUpperCase())) errors.push("asset");
  if (draft.kind === "swap" && !ASSETS.has(draft.outputAsset.toUpperCase())) errors.push("outputAsset");

  if (draft.kind === "send") {
    if (!draft.recipient) missing.add("recipient");
    else if (!isAddress(draft.recipient, { strict: true }) || getAddress(draft.recipient) === zeroAddress) errors.push("recipient");
  }
  if (draft.kind === "swap" && draft.outputAsset.toUpperCase() === draft.inputAsset.toUpperCase()) errors.push("outputAsset");
  if (draft.kind === "bridge") {
    if (!draft.destinationChain) missing.add("destinationChain");
    if (draft.sourceChain && !CHAINS.has(draft.sourceChain)) errors.push("sourceChain");
    if (draft.destinationChain && !CHAINS.has(draft.destinationChain)) errors.push("destinationChain");
    if (draft.sourceChain === draft.destinationChain) errors.push("destinationChain");
  }
  return Object.freeze({ valid: missing.size === 0 && errors.length === 0, missingFields: Object.freeze([...missing]), errors: Object.freeze(errors) });
}
