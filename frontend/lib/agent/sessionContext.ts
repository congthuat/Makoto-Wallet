import type { AgentIntent, AgentPreparationInput } from "./types.ts";

export const AGENT_SESSION_CONTEXT_KEY = "makoto.agent.session-context.v1";
export const AGENT_SESSION_CONTEXT_TTL_MS = 20 * 60_000;

export type AgentSessionTopic = "swap" | "bridge" | "send";
export type AgentSessionPlanningIntent =
  | "send-affordability"
  | "send-remaining"
  | "swap-quote"
  | "swap-allowance"
  | "swap-affordability"
  | "bridge-estimate"
  | "bridge-route";

export type AgentSessionContext = Readonly<{
  version: 1;
  activeTopic: AgentSessionTopic;
  updatedAt: number;
  account: string;
  chainId: number;
  swap?: Readonly<{ inputAsset: "usdc" | "eurc"; outputAsset: "usdc" | "eurc"; amount?: string; slippage: number }>;
  bridge?: Readonly<{ asset: "usdc"; sourceChainId?: number; destinationChainId?: number; amount?: string }>;
  send?: Readonly<{ asset: "usdc" | "eurc"; amount?: string }>;
  pendingPreparation?: AgentPendingPreparation;
  lastPlanningIntent?: AgentSessionPlanningIntent;
  lastPlanningAt?: number;
}>;

export type AgentPendingPreparation = Readonly<{
  version: 1;
  locale: "en" | "vi";
  kind: AgentPreparationInput["kind"];
  assetId?: "usdc" | "eurc";
  amount?: string;
  recipient?: string;
  sourceChainId?: number;
  destinationChainId?: number;
  outputAssetId?: "usdc" | "eurc";
}>;

export type AgentSessionBinding = Readonly<{ account?: string; chainId?: number }>;
type SessionStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type AgentRequestGeneration = Readonly<{
  capture: () => number;
  invalidate: () => void;
  isCurrent: (generation: number) => boolean;
}>;

export function createAgentRequestGeneration(): AgentRequestGeneration {
  let current = 0;
  return Object.freeze({
    capture: () => current,
    invalidate: () => { current += 1; },
    isCurrent: (generation: number) => generation === current,
  });
}

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const AMOUNT = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;
const PLANNING_INTENTS: readonly AgentSessionPlanningIntent[] = [
  "send-affordability", "send-remaining", "swap-quote", "swap-allowance", "swap-affordability", "bridge-estimate", "bridge-route",
];

export function readAgentSessionContext(store: SessionStore, binding: AgentSessionBinding, now = Date.now()): AgentSessionContext | undefined {
  const raw = store.getItem(AGENT_SESSION_CONTEXT_KEY);
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isAgentSessionContext(parsed, binding, now)) {
      store.removeItem(AGENT_SESSION_CONTEXT_KEY);
      return undefined;
    }
    return freezeContext(parsed);
  } catch {
    store.removeItem(AGENT_SESSION_CONTEXT_KEY);
    return undefined;
  }
}

export function storeAgentSessionContext(store: SessionStore, context: AgentSessionContext) {
  store.setItem(AGENT_SESSION_CONTEXT_KEY, JSON.stringify(context));
}

export function clearAgentSessionContext(store: Pick<Storage, "removeItem">) {
  store.removeItem(AGENT_SESSION_CONTEXT_KEY);
}

export function updateAgentSessionContext(
  current: AgentSessionContext | undefined,
  intent: AgentIntent,
  binding: Required<AgentSessionBinding>,
  now = Date.now(),
): AgentSessionContext | undefined {
  const account = normalizeAccount(binding.account);
  if (!account || !validChainId(binding.chainId)) return undefined;
  const planningIntent = isSessionPlanningIntent(intent.kind) ? intent.kind : undefined;
  const preparation = intent.kind === "prepare-action" ? intent.preparation : undefined;
  const topic = planningTopic(intent) ?? preparation?.kind;
  if (topic !== "swap" && topic !== "bridge" && topic !== "send") return current?.pendingPreparation && intent.kind !== "unknown" && intent.kind !== "clarification" ? undefined : current;

  const base = { version: 1 as const, activeTopic: topic, updatedAt: now, account, chainId: binding.chainId };
  if (preparation) {
    if (conflictingPreparation(preparation)) return undefined;
    if (!completePreparation(preparation)) return freezeContext({ ...base, pendingPreparation: pendingPreparation(preparation, intent.locale) });
  }
  if (topic === "swap") {
    const prior = current?.activeTopic === "swap" ? current.swap : undefined;
    const inputAsset = intent.assetId ?? preparation?.assetId ?? prior?.inputAsset;
    const outputAsset = intent.outputAssetId ?? preparation?.outputAssetId ?? prior?.outputAsset;
    if (!inputAsset || !outputAsset || inputAsset === outputAsset) return undefined;
    return freezeContext({ ...base, swap: { inputAsset, outputAsset, ...(validAmount(intent.amount ?? preparation?.amount ?? prior?.amount) ? { amount: intent.amount ?? preparation?.amount ?? prior?.amount } : {}), slippage: prior?.slippage ?? 0.005 }, ...(planningIntent ? { lastPlanningIntent: planningIntent, lastPlanningAt: now } : {}) });
  }
  if (topic === "bridge") {
    const prior = current?.activeTopic === "bridge" ? current.bridge : undefined;
    const sourceChainId = intent.sourceChainId ?? preparation?.sourceChainId ?? prior?.sourceChainId;
    const destinationChainId = intent.destinationChainId ?? preparation?.destinationChainId ?? prior?.destinationChainId;
    return freezeContext({ ...base, bridge: { asset: "usdc", ...(sourceChainId ? { sourceChainId } : {}), ...(destinationChainId ? { destinationChainId } : {}), ...(validAmount(intent.amount ?? preparation?.amount ?? prior?.amount) ? { amount: intent.amount ?? preparation?.amount ?? prior?.amount } : {}) }, ...(planningIntent ? { lastPlanningIntent: planningIntent, lastPlanningAt: now } : {}) });
  }
  const prior = current?.activeTopic === "send" ? current.send : undefined;
  const inputAsset = intent.assetId ?? preparation?.assetId ?? prior?.asset ?? "usdc";
  return freezeContext({ ...base, send: { asset: inputAsset, ...(validAmount(intent.amount ?? preparation?.amount ?? prior?.amount) ? { amount: intent.amount ?? preparation?.amount ?? prior?.amount } : {}) }, ...(planningIntent ? { lastPlanningIntent: planningIntent, lastPlanningAt: now } : {}) });
}

export function isAgentSessionContext(value: unknown, binding: AgentSessionBinding, now = Date.now()): value is AgentSessionContext {
  if (!record(value) || value.version !== 1 || !["swap", "bridge", "send"].includes(String(value.activeTopic))) return false;
  if (!onlyKeys(value, ["version", "activeTopic", "updatedAt", "account", "chainId", "swap", "bridge", "send", "pendingPreparation", "lastPlanningIntent", "lastPlanningAt"])) return false;
  if (typeof value.updatedAt !== "number" || !Number.isSafeInteger(value.updatedAt) || value.updatedAt > now || now - value.updatedAt >= AGENT_SESSION_CONTEXT_TTL_MS) return false;
  const account = normalizeAccount(value.account);
  if (!account || !validChainId(value.chainId) || account !== normalizeAccount(binding.account) || value.chainId !== binding.chainId) return false;
  if (value.lastPlanningIntent !== undefined && !isSessionPlanningIntent(value.lastPlanningIntent)) return false;
  if (value.lastPlanningAt !== undefined && (typeof value.lastPlanningAt !== "number" || !Number.isSafeInteger(value.lastPlanningAt) || value.lastPlanningAt > now || value.lastPlanningAt < value.updatedAt)) return false;
  const pending = value.pendingPreparation;
  if (pending !== undefined && !validPendingPreparation(pending, value.activeTopic)) return false;
  const keys = [value.swap !== undefined, value.bridge !== undefined, value.send !== undefined, pending !== undefined].filter(Boolean).length;
  if (keys !== 1) return false;
  if (pending) return true;
  if (value.activeTopic === "swap") return validSwap(value.swap) && value.bridge === undefined && value.send === undefined;
  if (value.activeTopic === "bridge") return validBridge(value.bridge) && value.swap === undefined && value.send === undefined;
  return validSend(value.send) && value.swap === undefined && value.bridge === undefined;
}

function planningTopic(intent: AgentIntent): AgentSessionTopic | undefined {
  if (["swap-quote", "swap-allowance", "swap-affordability"].includes(intent.kind)) return "swap";
  if (["bridge-estimate", "bridge-route"].includes(intent.kind)) return "bridge";
  if (["send-affordability", "send-remaining"].includes(intent.kind)) return "send";
  return undefined;
}
function isSessionPlanningIntent(value: unknown): value is AgentSessionPlanningIntent { return PLANNING_INTENTS.includes(value as AgentSessionPlanningIntent); }
function normalizeAccount(value: unknown) { return typeof value === "string" && ADDRESS.test(value) ? value.toLowerCase() : undefined; }
function validChainId(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) > 0; }
function validAmount(value: unknown): value is string { return typeof value === "string" && AMOUNT.test(value) && Number(value) > 0; }
function assetId(value: unknown) { const asset = typeof value === "string" ? value.toLowerCase() : ""; return asset === "usdc" || asset === "eurc" ? asset : undefined; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function validSwap(value: unknown) { return record(value) && onlyKeys(value, ["inputAsset", "outputAsset", "amount", "slippage"]) && assetId(value.inputAsset) !== undefined && assetId(value.outputAsset) !== undefined && value.inputAsset !== value.outputAsset && (value.amount === undefined || validAmount(value.amount)) && value.slippage === 0.005; }
function validBridge(value: unknown) { return record(value) && onlyKeys(value, ["asset", "sourceChainId", "destinationChainId", "amount"]) && value.asset === "usdc" && (value.sourceChainId === undefined || validChainId(value.sourceChainId)) && (value.destinationChainId === undefined || validChainId(value.destinationChainId)) && (value.amount === undefined || validAmount(value.amount)); }
function validSend(value: unknown) { return record(value) && onlyKeys(value, ["asset", "amount"]) && assetId(value.asset) !== undefined && (value.amount === undefined || validAmount(value.amount)); }
function validPendingPreparation(value: unknown, topic: unknown) {
  if (!record(value) || !onlyKeys(value, ["version", "locale", "kind", "assetId", "amount", "recipient", "sourceChainId", "destinationChainId", "outputAssetId"])) return false;
  if (value.version !== 1 || value.locale !== "en" && value.locale !== "vi") return false;
  if (value.kind !== topic || !["send", "swap", "bridge"].includes(String(value.kind))) return false;
  if (value.assetId !== undefined && assetId(value.assetId) === undefined || value.outputAssetId !== undefined && assetId(value.outputAssetId) === undefined) return false;
  if (value.amount !== undefined && !validAmount(value.amount) || value.recipient !== undefined && normalizeAccount(value.recipient) === undefined) return false;
  return (value.sourceChainId === undefined || validChainId(value.sourceChainId)) && (value.destinationChainId === undefined || validChainId(value.destinationChainId));
}
function pendingPreparation(input: AgentPreparationInput, locale: AgentIntent["locale"]): AgentPendingPreparation {
  return Object.freeze({ version: 1, locale, kind: input.kind, ...(input.assetId ? { assetId: input.assetId } : {}), ...(validAmount(input.amount) ? { amount: input.amount } : {}), ...(input.recipient ? { recipient: input.recipient } : {}), ...(input.sourceChainId ? { sourceChainId: input.sourceChainId } : {}), ...(input.destinationChainId ? { destinationChainId: input.destinationChainId } : {}), ...(input.outputAssetId ? { outputAssetId: input.outputAssetId } : {}) });
}
function completePreparation(input: AgentPreparationInput) {
  if (!validAmount(input.amount)) return false;
  if (input.kind === "send") return Boolean(input.assetId && input.recipient);
  if (input.kind === "swap") return Boolean(input.assetId && input.outputAssetId);
  if (input.kind === "bridge") return Boolean(input.sourceChainId && input.destinationChainId);
  return true;
}
function conflictingPreparation(input: AgentPreparationInput) { return Boolean(input.invalidRecipient || input.recipient?.toLowerCase() === "0x0000000000000000000000000000000000000000" || input.kind === "swap" && input.assetId && input.assetId === input.outputAssetId || input.kind === "bridge" && input.sourceChainId && input.sourceChainId === input.destinationChainId); }
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]) { return Object.keys(value).every((key) => allowed.includes(key)); }
function freezeContext<T extends AgentSessionContext>(value: T): T {
  if (value.swap) Object.freeze(value.swap);
  if (value.bridge) Object.freeze(value.bridge);
  if (value.send) Object.freeze(value.send);
  if (value.pendingPreparation) Object.freeze(value.pendingPreparation);
  return Object.freeze(value);
}
