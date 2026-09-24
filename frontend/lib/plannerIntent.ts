import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import { arcTestnet, baseSepolia } from "viem/chains";
import { getAssetById, parseAssetAmount, type SupportedAssetId } from "./assets.ts";
import { isXyloSwappableAssetId, oppositeAssetId, type XyloSwappableAssetId } from "./swap.ts";

/** A resolved user goal. Amounts are decimal strings, never floating-point or raw gas units. */
type IntentBase = Readonly<{ version: 1; id: string }>;
export type SendPlannerIntent = IntentBase & Readonly<{ kind: "SEND"; chainId: typeof arcTestnet.id; asset: SupportedAssetId; amount: string; recipient: Address }>;
export type SwapPlannerIntent = IntentBase & Readonly<{ kind: "SWAP"; chainId: typeof arcTestnet.id; fromAsset: XyloSwappableAssetId; toAsset: XyloSwappableAssetId; amount: string }>;
export type BridgePlannerIntent = IntentBase & Readonly<{ kind: "BRIDGE"; sourceChainId: typeof arcTestnet.id; destinationChainId: typeof baseSepolia.id; asset: "usdc"; amount: string; recipient: Address }>;
export type PlannerIntent = SendPlannerIntent | SwapPlannerIntent | BridgePlannerIntent;

export type PlannerIntentValidationCode = "INVALID_SCHEMA" | "UNSUPPORTED_VERSION" | "UNSUPPORTED_KIND" | "INVALID_INPUT" | "UNSUPPORTED";
export type PlannerIntentValidationIssue = Readonly<{ path: string; code: PlannerIntentValidationCode; message: string }>;
export type PlannerIntentValidationResult =
  | Readonly<{ valid: true; value: PlannerIntent }>
  | Readonly<{ valid: false; errors: readonly PlannerIntentValidationIssue[] }>;

type Data = Record<string, unknown>;
const record = (value: unknown): value is Data => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const keys = (value: Data, allowed: readonly string[]) => allowed.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.includes(key));
const address = (value: unknown): value is Address => typeof value === "string" && isAddress(value, { strict: true }) && getAddress(value) !== zeroAddress;

/** Reject values that JSON would drop, alter, or invoke through a getter. */
function jsonData(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;
  if (Array.isArray(value) && Object.getPrototypeOf(value) !== Array.prototype) return false;
  if (!Array.isArray(value) && !record(value)) return false;
  const ownKeys = Reflect.ownKeys(value).filter((key) => !Array.isArray(value) || key !== "length");
  if (ownKeys.length !== Object.keys(value).length || ownKeys.some((key) => !("value" in Object.getOwnPropertyDescriptor(value, key)!))) return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? Object.keys(value).length === value.length && Array.from({ length: value.length }, (_, index) => Object.hasOwn(value, index) && jsonData(value[index], ancestors)).every(Boolean)
    : Object.values(value).every((item) => jsonData(item, ancestors));
  ancestors.delete(value);
  return valid;
}

/** Pure schema and capability check. Phase 9 still decides transaction safety. */
export function validatePlannerIntent(input: unknown): PlannerIntentValidationResult {
  const errors: PlannerIntentValidationIssue[] = [];
  const add = (path: string, code: PlannerIntentValidationCode, message: string) => errors.push({ path, code, message });
  if (!jsonData(input) || !record(input)) return { valid: false, errors: [{ path: "intent", code: "INVALID_SCHEMA", message: "Intent must contain plain JSON data only." }] };

  if (input.version !== 1) add("intent.version", "UNSUPPORTED_VERSION", "Unsupported planner intent version.");
  if (typeof input.id !== "string" || input.id.trim().length === 0) add("intent.id", "INVALID_INPUT", "Intent ID is required.");
  const base = ["version", "id", "kind"];
  if (input.kind === "SEND") {
    if (!keys(input, [...base, "chainId", "asset", "amount", "recipient"])) add("intent", "INVALID_SCHEMA", "Send requires only its declared fields.");
    if (input.chainId !== arcTestnet.id) add("intent.chainId", "UNSUPPORTED", "Send supports Arc Testnet only.");
    if (typeof input.asset !== "string" || !getAssetById(input.asset)) add("intent.asset", "UNSUPPORTED", "Unsupported Send asset.");
    if (!address(input.recipient)) add("intent.recipient", "INVALID_INPUT", "Recipient must be a non-zero EVM address.");
  } else if (input.kind === "SWAP") {
    if (!keys(input, [...base, "chainId", "fromAsset", "toAsset", "amount"])) add("intent", "INVALID_SCHEMA", "Swap requires only its declared fields.");
    if (input.chainId !== arcTestnet.id) add("intent.chainId", "UNSUPPORTED", "Swap supports Arc Testnet only.");
    const from = typeof input.fromAsset === "string" && getAssetById(input.fromAsset);
    const to = typeof input.toAsset === "string" && getAssetById(input.toAsset);
    if (!from || !to || !isXyloSwappableAssetId(from.id) || !isXyloSwappableAssetId(to.id) || to.id !== oppositeAssetId(from.id)) add("intent.toAsset", "UNSUPPORTED", "Unsupported Swap pair.");
  } else if (input.kind === "BRIDGE") {
    if (!keys(input, [...base, "sourceChainId", "destinationChainId", "asset", "amount", "recipient"])) add("intent", "INVALID_SCHEMA", "Bridge requires only its declared fields.");
    if (input.sourceChainId !== arcTestnet.id || input.destinationChainId !== baseSepolia.id) add("intent.destinationChainId", "UNSUPPORTED", "Only Arc Testnet to Base Sepolia is supported.");
    if (input.asset !== "usdc") add("intent.asset", "UNSUPPORTED", "Only USDC Bridge is supported.");
    if (!address(input.recipient)) add("intent.recipient", "INVALID_INPUT", "Recipient must be a non-zero EVM address.");
  } else add("intent.kind", "UNSUPPORTED_KIND", "Unsupported planner intent kind.");

  const assetId = input.kind === "SWAP" ? input.fromAsset : input.asset;
  const asset = typeof assetId === "string" ? getAssetById(assetId) : undefined;
  if (typeof input.amount !== "string" || !asset || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(input.amount) || parseAssetAmount(input.amount, asset) === undefined) add("intent.amount", "INVALID_INPUT", "Amount must be a positive decimal string within asset precision.");
  return errors.length ? { valid: false, errors } : { valid: true, value: input as PlannerIntent };
}
