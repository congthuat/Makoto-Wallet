import { getAddress, isAddress, keccak256, stringToHex, zeroAddress, type Address, type Hex } from "viem";
import { arcTestnet } from "viem/chains";
import { getAssetById, parseAssetAmount, type SupportedAssetId } from "./assets.ts";
import { XYLO_ROUTER, SWAP_SLIPPAGE_OPTIONS } from "./swap.ts";
import type { WalletReadContext } from "./walletAccount.ts";
import { evaluatePolicy, type PolicyResult } from "./policyEngine.ts";
import { validateStrategyMaterialization, type StrategyActionMaterialization, type StrategyMaterialization } from "./strategyMaterialization.ts";
import { runReadTool, type Allowance, type Balances, type ReadRequest, type ReadResult, type ReadServices, type VerifiedNetwork, type WalletState } from "./agent/readTools.ts";
import { runQuoteTool, type BridgeQuoteData, type QuoteRequest, type QuoteResult, type QuoteServices, type SendQuote, type SwapQuoteData } from "./agent/quoteTools.ts";
import { runPrepareTool, type PrepareRequest, type PrepareResult } from "./agent/prepareTools.ts";
import { quoteFingerprint, validatePrepareResult, validateQuoteResult, validateReadResult } from "./agent/toolSchemas.ts";
import type { AgentContextSnapshot } from "./agent/types.ts";

export type AEIDOutcome =
  | "ORCHESTRATED" | "BLOCKED_BY_POLICY" | "REQUOTE_REQUIRED" | "REVALIDATION_REQUIRED"
  | "REVIEW_REQUIRED" | "UNSUPPORTED_ACTION" | "UNSUPPORTED_ACCOUNT_CONTEXT"
  | "READ_FAILED" | "QUOTE_FAILED" | "QUOTE_STALE" | "PREPARATION_FAILED"
  | "HANDOFF_REQUIRED" | "PROVENANCE_MISMATCH" | "INVALID_MATERIALIZATION"
  | "DEPENDENCY_BLOCKED";

export type AEIDAccountContextV1 = Readonly<{
  version: 1; kind: "external" | "local"; account: Address; chainId: typeof arcTestnet.id;
  source: "wallet-read-context"; observedAt: number; contextRevision: Hex; digest: Hex;
}>;
type Bound = Readonly<{
  version: 1; materializationDigest: Hex; materializationRevision: Hex;
  actionDigest: Hex; actionStepId: string; goalId: string; accountDigest: Hex; chainId: number;
}>;
export type AEIDReadEvidenceV1 = Bound & Readonly<{
  kind: "READ_RESULT"; toolVersion: 1; request: ReadRequest; requestDigest: Hex;
  result: ReadResult<unknown>; resultDigest: Hex; digest: Hex;
}>;
export type AEIDQuoteEvidenceV1 = Bound & Readonly<{
  kind: "QUOTE_RESULT"; toolVersion: 1; request: QuoteRequest; requestDigest: Hex;
  result: QuoteResult<unknown>; resultDigest: Hex; fingerprint: Hex; digest: Hex;
}>;
export type AEIDPreparedEvidenceV1 = Bound & Readonly<{
  kind: "PREPARED_ARTIFACT"; toolVersion: 1; requestDigest: Hex;
  preflightQuoteDigest: Hex; quoteDigest: Hex; readDigests: readonly Hex[];
  result: PrepareResult; resultDigest: Hex; digest: Hex;
}>;
export type AEIDPolicyEvidenceV1 = Bound & Readonly<{
  kind: "POLICY_DECISION"; evaluator: "evaluatePolicy"; evaluatorVersion: 1;
  quoteDigest: Hex; preparedDigest: Hex; readDigests: readonly Hex[];
  observedAt: number; result: PolicyResult; resultDigest: Hex; digest: Hex;
}>;
export type AEIDOperationalEnvelopeV1 = Readonly<{
  version: 1; stage: "OPERATIONAL_ONLY"; executionEnabled: false; executionAuthority: "FORBIDDEN";
  status: AEIDOutcome; materialization: StrategyMaterialization;
  action: StrategyActionMaterialization; dependencies: readonly Readonly<{ actionStepId: string; dependsOnStepIds: readonly string[] }>[];
  accountContext?: AEIDAccountContextV1;
  reads: readonly AEIDReadEvidenceV1[]; preflightQuote?: AEIDQuoteEvidenceV1;
  quote?: AEIDQuoteEvidenceV1; prepared?: AEIDPreparedEvidenceV1; policy?: AEIDPolicyEvidenceV1;
  unmetRequirements: readonly string[]; warnings: readonly string[];
  revision: Hex; digest: Hex;
}>;
export type AEIDResult = Readonly<{ status: AEIDOutcome; executionEnabled: false; envelope?: AEIDOperationalEnvelopeV1 }>;

/** The application host supplies current wallet identity and read-only provider ports. No signer fits this interface. */
export type AEIDHostPorts = Readonly<{
  current(): Promise<Readonly<{ wallet: WalletReadContext; snapshot: AgentContextSnapshot }>>;
  reads: ReadServices; quotes: QuoteServices; now?: () => number;
}>;
export type AEIDRequest = Readonly<{
  materialization: unknown; retainedLiveInput: unknown; actionStepId: string;
  slippage?: (typeof SWAP_SLIPPAGE_OPTIONS)[number];
}>;

const registered = new WeakMap<object, { digest: Hex; current: AEIDHostPorts["current"]; now: () => number }>();
const same = (a: string, b: string) => getAddress(a) === getAddress(b);
const failure = (status: AEIDOutcome): AEIDResult =>
  Object.freeze({ status, executionEnabled: false });

/** Descriptor-safe, bounded copy prevents getters, proxies, functions and secret-bearing fields entering evidence. */
function dataCopy(value: unknown, depth = 0, count = { n: 0 }): unknown {
  if (++count.n > 12000 || depth > 32) throw Error("Evidence exceeds bound");
  if (typeof value === "string" && value.length > 1_000_000) throw Error("Evidence string exceeds bound");
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object") throw Error("Non-data evidence");
  const array = Array.isArray(value);
  if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) throw Error("Non-plain evidence");
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) throw Error("Hidden evidence key");
  const forbidden = /^(?:signer|walletClient|privateKey|seed|mnemonic|secret|password|apiKey|submit|sendTransaction|writeContract)$/i;
  const out: Record<string, unknown> | unknown[] = array ? [] : {};
  for (const key of keys) {
    if (array && key === "length") continue;
    if (forbidden.test(key as string) || ["__proto__", "prototype", "constructor"].includes(key as string))
      throw Error("Forbidden evidence key");
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (!desc || !("value" in desc) || !desc.enumerable) throw Error("Accessor or hidden evidence");
    (out as Record<string, unknown>)[key as string] = dataCopy(desc.value, depth + 1, count);
  }
  if (array && (out as unknown[]).length !== (value as unknown[]).length) throw Error("Sparse evidence");
  return out;
}
function canonical(value: unknown): string {
  if (value === undefined) return JSON.stringify({ undefined: true });
  if (typeof value === "bigint") return JSON.stringify({ bigint: value.toString(10) });
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const digest = (domain: string, value: unknown): Hex => keccak256(stringToHex(canonical([domain, 1, value])));
function frozen<T>(value: T): T {
  if (value && typeof value === "object") { for (const item of Object.values(value)) frozen(item); Object.freeze(value); }
  return value;
}
function accountOf(observation: { wallet: WalletReadContext; snapshot: AgentContextSnapshot }, now: number): AEIDAccountContextV1 | undefined {
  const { wallet, snapshot } = observation;
  if (!Number.isSafeInteger(now) || now < 0 || !wallet || !snapshot || !wallet.address ||
    !isAddress(wallet.address) || same(wallet.address, zeroAddress) ||
    wallet.status !== "connected" || wallet.connectionStatus !== "connected" || !wallet.isArc ||
    wallet.chainId !== arcTestnet.id || wallet.providerChainId !== undefined && wallet.providerChainId !== arcTestnet.id ||
    wallet.connectorChainId !== undefined && wallet.connectorChainId !== arcTestnet.id ||
    !snapshot.connected || snapshot.walletStatus !== "connected" || snapshot.accountKind !== wallet.kind ||
    !snapshot.account || !same(snapshot.account, wallet.address) || snapshot.verifiedChainId !== arcTestnet.id || !snapshot.isArc ||
    !Number.isSafeInteger(snapshot.timestamp) || snapshot.timestamp > now || now - snapshot.timestamp > 30_000) return undefined;
  const account = getAddress(wallet.address);
  const contextRevision = digest("aei-d-wallet-observation", [wallet.kind, account, wallet.chainId, wallet.providerChainId,
    wallet.connectorChainId, wallet.connectionStatus, wallet.status, wallet.providerName, wallet.connectorId, snapshot.timestamp]);
  const base = { version: 1 as const, kind: wallet.kind, account, chainId: arcTestnet.id, source: "wallet-read-context" as const,
    observedAt: snapshot.timestamp, contextRevision };
  return frozen({ ...base, digest: digest("aei-d-account", base) });
}
function sameAccount(a: AEIDAccountContextV1, b: AEIDAccountContextV1 | undefined): boolean {
  return !!b && a.digest === b.digest;
}
function bound(m: StrategyMaterialization, a: StrategyActionMaterialization, c: AEIDAccountContextV1): Bound {
  return { version: 1, materializationDigest: m.digest, materializationRevision: m.revision, actionDigest: a.digest,
    actionStepId: a.actionStepId, goalId: a.goalId, accountDigest: c.digest, chainId: c.chainId };
}
function wrapRead(b: Bound, request: ReadRequest, result: ReadResult<unknown>): AEIDReadEvidenceV1 {
  const base = { ...b, kind: "READ_RESULT" as const, toolVersion: 1 as const, request,
    requestDigest: digest("aei-d-read-request", request), result, resultDigest: digest("aei-d-read-result", result) };
  return frozen({ ...base, digest: digest("aei-d-read-evidence", base) });
}
function wrapQuote(b: Bound, request: QuoteRequest, result: QuoteResult<unknown>): AEIDQuoteEvidenceV1 {
  const base = { ...b, kind: "QUOTE_RESULT" as const, toolVersion: 1 as const, request,
    requestDigest: digest("aei-d-quote-request", request), result, resultDigest: digest("aei-d-quote-result", result),
    fingerprint: quoteFingerprint(result) };
  return frozen({ ...base, digest: digest("aei-d-quote-evidence", base) });
}
function outcome(policy: PolicyResult): AEIDOutcome {
  if (policy.decision === "BLOCK") return "BLOCKED_BY_POLICY";
  if (policy.decision === "REQUOTE") return "REQUOTE_REQUIRED";
  if (policy.decision === "REVALIDATE") return "REVALIDATION_REQUIRED";
  return policy.decision === "REQUIRE_REVIEW" ? "REVIEW_REQUIRED" : "ORCHESTRATED";
}
function snapshot<T>(value: T): T { return dataCopy(value) as T; }

export function createAeiDOrchestrator(host: AEIDHostPorts) {
  async function orchestrate(raw: AEIDRequest): Promise<AEIDResult> {
    let stage: AEIDOutcome = "INVALID_MATERIALIZATION";
    try {
      if (!raw || typeof raw !== "object" || Object.getPrototypeOf(raw) !== Object.prototype ||
        !["materialization", "retainedLiveInput", "actionStepId"].every((key) => Object.hasOwn(raw, key)) ||
        Reflect.ownKeys(raw).some((key) => typeof key !== "string" ||
          !["materialization", "retainedLiveInput", "actionStepId", "slippage"].includes(key) ||
          !("value" in Object.getOwnPropertyDescriptor(raw, key)!))) return failure("INVALID_MATERIALIZATION");
      const input = raw;
      // Preserve B2's private live-source object identity while AEI-C validates its exact contents.
      const checked = validateStrategyMaterialization(raw.materialization, raw.retainedLiveInput);
      if (!checked.valid) return failure(checked.reason === "PROVENANCE_MISMATCH" ? "PROVENANCE_MISMATCH" : "INVALID_MATERIALIZATION");
      const materialization = checked.value;
      const action = materialization.actions.find((item) => item.actionStepId === input.actionStepId);
      if (!action) return failure("PROVENANCE_MISMATCH");
      const now = host.now ?? Date.now;
      stage = "UNSUPPORTED_ACCOUNT_CONTEXT";
      const startTime = now();
      const initial = await host.current();
      const context = accountOf(initial, startTime);
      if (!context) return failure("UNSUPPORTED_ACCOUNT_CONTEXT");
      const b = bound(materialization, action, context);
      const reads: AEIDReadEvidenceV1[] = [];
      const evidence: { preflightQuote?: AEIDQuoteEvidenceV1; quote?: AEIDQuoteEvidenceV1;
        prepared?: AEIDPreparedEvidenceV1; policy?: AEIDPolicyEvidenceV1 } = {};
      const dependencies = materialization.actions.map((item) => ({ actionStepId: item.actionStepId, dependsOnStepIds: item.dependsOnStepIds }));
      const finish = (status: AEIDOutcome, unmetRequirements: readonly string[] = [], warnings: readonly string[] = []): AEIDResult => {
        const base = { version: 1 as const, stage: "OPERATIONAL_ONLY" as const, executionEnabled: false as const,
          executionAuthority: "FORBIDDEN" as const, status, materialization, action, dependencies, accountContext: context,
          reads, ...evidence, unmetRequirements, warnings };
        const revision = digest("aei-d-operational-revision", [materialization.revision, action.digest, context.digest,
          reads.map((item) => item.digest), evidence.preflightQuote?.digest, evidence.quote?.digest,
          evidence.prepared?.digest, evidence.policy?.digest, status]);
        const envelope = frozen({ ...base, revision, digest: digest("aei-d-operational-envelope", [base, revision]) });
        registered.set(envelope, { digest: envelope.digest, current: () => host.current(), now });
        return { status, executionEnabled: false, envelope };
      };
      const current = async () => sameAccount(context, accountOf(await host.current(), now()));
      if (action.dependsOnStepIds.length) return finish("DEPENDENCY_BLOCKED", ["VERIFIED_PRIOR_ACTION"]);
      if (action.actionKind === "BRIDGE") {
        const recipient = action.parameters.kind === "BRIDGE" ? action.parameters.recipient : undefined;
        return finish(recipient && same(recipient, context.account) ? "HANDOFF_REQUIRED" : "UNSUPPORTED_ACTION",
          ["SUPPORTED_WALLET_HANDOFF"], ["Direct CCTP has no canonical Agent wallet handoff; Circle App Kit Agent PREPARE is unsupported."]);
      }
      const params = action.parameters;
      if (params.kind !== "SEND" && params.kind !== "SWAP") return finish("UNSUPPORTED_ACTION");
      const assetId: SupportedAssetId = params.kind === "SEND" ? params.asset : params.fromAsset;
      const asset = getAssetById(assetId);
      const amount = asset && parseAssetAmount(params.amount, asset);
      if (!amount) return finish("UNSUPPORTED_ACTION");
      const read = async (request: ReadRequest): Promise<ReadResult<unknown>> => {
        const result = await runReadTool({ snapshot: initial.snapshot, services: host.reads, now }, request as { tool: "assets.balances" });
        const copy = snapshot(result);
        if (!validateReadResult(copy).valid || copy.account && !same(copy.account, context.account) || copy.chainId !== context.chainId)
          throw Error("Invalid read provenance");
        reads.push(wrapRead(b, request, copy));
        return copy;
      };
      stage = "READ_FAILED";
      const wallet = await read({ tool: "wallet.state" }) as ReadResult<WalletState>;
      const network = await read({ tool: "network.verified" }) as ReadResult<VerifiedNetwork>;
      const balances = await read({ tool: "assets.balances" }) as ReadResult<Balances>;
      const allowanceRequest: ReadRequest | undefined = params.kind === "SWAP" ?
        { tool: "token.allowance", assetId, spender: XYLO_ROUTER } : undefined;
      const allowance = allowanceRequest ? await read(allowanceRequest) as ReadResult<Allowance> : undefined;
      if (!await current()) return finish("REVALIDATION_REQUIRED", ["ACCOUNT_CONTEXT"]);
      if (wallet.status !== "AVAILABLE" || wallet.data.status !== "connected" || network.status !== "AVAILABLE" ||
        network.data.chainId !== context.chainId || balances.status === "UNAVAILABLE" || balances.freshness !== "live" ||
        balances.observedAt === null || balances.data[assetId] === undefined || allowance && (allowance.status !== "AVAILABLE" ||
        allowance.freshness !== "live" || allowance.observedAt === null || !same(allowance.data.owner, context.account) ||
        allowance.data.assetId !== assetId || !same(allowance.data.spender, XYLO_ROUTER))) return finish("REVALIDATION_REQUIRED", ["LIVE_READ"]);
      if (params.kind === "SWAP" && (input.slippage === undefined || !SWAP_SLIPPAGE_OPTIONS.includes(input.slippage)))
        return finish("UNSUPPORTED_ACTION", ["SUPPORTED_SLIPPAGE"]);
      const quoteRequest: QuoteRequest = params.kind === "SEND"
        ? { tool: "send.quote", account: context.account, chainId: context.chainId, assetId, amount, recipient: params.recipient }
        : { tool: "swap.quote", account: context.account, chainId: context.chainId, inputAsset: assetId,
            outputAsset: params.toAsset, amount, slippage: input.slippage! };
      const quoteContext = { snapshot: initial.snapshot, reads: host.reads, services: host.quotes, now };
      stage = "QUOTE_FAILED";
      const first = params.kind === "SEND"
        ? await runQuoteTool(quoteContext, quoteRequest as Extract<QuoteRequest, { tool: "send.quote" }>)
        : await runQuoteTool(quoteContext, quoteRequest as Extract<QuoteRequest, { tool: "swap.quote" }>);
      const firstCopy = snapshot(first) as QuoteResult<SendQuote | SwapQuoteData>;
      if (!validateQuoteResult(firstCopy, 0).valid) return finish("QUOTE_FAILED", ["QUOTE"]);
      evidence.preflightQuote = wrapQuote(b, quoteRequest, firstCopy);
      if (firstCopy.status === "EXPIRED" || firstCopy.expiresAt !== null && now() > firstCopy.expiresAt)
        return finish("QUOTE_STALE", ["QUOTE"]);
      if (firstCopy.status !== "AVAILABLE" || firstCopy.validity !== "local-max-age" ||
        !same(firstCopy.account, context.account) || firstCopy.chainId !== context.chainId) return finish("QUOTE_FAILED", ["QUOTE"]);
      if (params.kind === "SEND" && (firstCopy.data as SendQuote).availableBalance !== balances.data[assetId] ||
        params.kind === "SWAP" && (firstCopy.data as SwapQuoteData).allowance !==
          (allowance?.status === "AVAILABLE" ? allowance.data.amount : undefined))
        return finish("REVALIDATION_REQUIRED", ["LIVE_READ"]);
      if (!await current()) return finish("REVALIDATION_REQUIRED", ["ACCOUNT_CONTEXT"]);
      let refreshed: QuoteResult<SendQuote | SwapQuoteData | BridgeQuoteData> | undefined;
      let internalBalance: ReadResult<Balances> | undefined;
      const prepareRequest: PrepareRequest = params.kind === "SEND"
        ? { tool: "send.prepare", account: context.account, chainId: context.chainId, assetId, amount,
            recipient: params.recipient, quote: firstCopy as QuoteResult<SendQuote> }
        : { tool: "swap.prepare", account: context.account, chainId: context.chainId, inputAsset: assetId,
            outputAsset: params.toAsset, amount, slippage: input.slippage!, quote: firstCopy as QuoteResult<SwapQuoteData> };
      const result = await runPrepareTool({ ...quoteContext, onValidatedQuote: (value) => { refreshed = value; },
        onValidatedBalance: (value) => { internalBalance = value; } }, prepareRequest);
      stage = "PREPARATION_FAILED";
      if (!await current()) return finish("REVALIDATION_REQUIRED", ["ACCOUNT_CONTEXT"]);
      if (result.status !== "PREPARED") return finish(result.status === "EXPIRED" || result.error === "QUOTE_EXPIRED" ||
        result.error === "QUOTE_MISMATCH" ? "REQUOTE_REQUIRED" : "PREPARATION_FAILED", ["PREPARATION"]);
      if (!refreshed) return finish("PREPARATION_FAILED", ["QUOTE"]);
      const fresh = snapshot(refreshed) as QuoteResult<SendQuote | SwapQuoteData>;
      if (!validateQuoteResult(fresh, now()).valid || fresh.status !== "AVAILABLE" || fresh.validity !== "local-max-age" ||
        !same(fresh.account, context.account) || fresh.chainId !== context.chainId) return finish("REQUOTE_REQUIRED", ["QUOTE"]);
      if (params.kind === "SEND" && (fresh.data as SendQuote).availableBalance !== balances.data[assetId] ||
        params.kind === "SWAP" && (fresh.data as SwapQuoteData).allowance !==
          (allowance?.status === "AVAILABLE" ? allowance.data.amount : undefined))
        return finish("REVALIDATION_REQUIRED", ["LIVE_READ"]);
      evidence.quote = wrapQuote(b, quoteRequest, fresh);
      const preparedResult = snapshot(result);
      if (!validatePrepareResult(preparedResult, { now: now(), quote: fresh }).valid ||
        preparedResult.status !== "PREPARED" || preparedResult.data.executionEnabled !== false ||
        preparedResult.data.quoteFingerprint !== evidence.quote.fingerprint) return finish("PREPARATION_FAILED", ["PREPARATION"]);
      if (params.kind === "SWAP") {
        const internal = internalBalance && snapshot(internalBalance);
        if (!internal || !validateReadResult(internal).valid || internal.status === "UNAVAILABLE" ||
          internal.freshness !== "live" || internal.observedAt === null ||
          !internal.account || !same(internal.account, context.account) || internal.chainId !== context.chainId ||
          internal.data[assetId] !== balances.data[assetId] ||
          internal.observedAt !== preparedResult.data.balanceObservedAt)
          return finish("REVALIDATION_REQUIRED", ["LIVE_READ"]);
        reads.push(wrapRead(b, { tool: "assets.balances" }, internal));
      }
      // PREPARE reacquires balance and allowance. A post-prepare read must agree before policy binds the artifact.
      const postBalances = await read({ tool: "assets.balances" }) as ReadResult<Balances>;
      const postAllowance = allowanceRequest ? await read(allowanceRequest) as ReadResult<Allowance> : undefined;
      if (!await current()) return finish("REVALIDATION_REQUIRED", ["ACCOUNT_CONTEXT"]);
      if (postBalances.status === "UNAVAILABLE" || postBalances.freshness !== "live" || postBalances.data[assetId] !== balances.data[assetId] ||
        postAllowance && (postAllowance.status !== "AVAILABLE" || postAllowance.freshness !== "live" ||
          postAllowance.data.amount !== allowance?.data.amount || postAllowance.data.amount !==
          (fresh.status === "AVAILABLE" ? (fresh.data as SwapQuoteData).allowance : undefined)))
        return finish("REVALIDATION_REQUIRED", ["LIVE_READ"]);
      const prepBase = { ...b, kind: "PREPARED_ARTIFACT" as const, toolVersion: 1 as const,
        requestDigest: digest("aei-d-prepare-request", { ...prepareRequest, quote: evidence.preflightQuote.digest }),
        preflightQuoteDigest: evidence.preflightQuote.digest, quoteDigest: evidence.quote.digest, readDigests: reads.map((item) => item.digest),
        result: preparedResult, resultDigest: digest("aei-d-prepare-result", preparedResult) };
      evidence.prepared = frozen({ ...prepBase, digest: digest("aei-d-prepared-evidence", prepBase) });
      stage = "BLOCKED_BY_POLICY";
      const decision = snapshot(evaluatePolicy({ action: action.actionKind, account: context.account,
        chainId: context.chainId, now: now(), wallet, network, quote: fresh, preparation: preparedResult }));
      if (!await current()) return finish("REVALIDATION_REQUIRED", ["ACCOUNT_CONTEXT"]);
      const policyBase = { ...b, kind: "POLICY_DECISION" as const, evaluator: "evaluatePolicy" as const, evaluatorVersion: 1 as const,
        quoteDigest: evidence.quote.digest, preparedDigest: evidence.prepared.digest, readDigests: reads.map((item) => item.digest),
        observedAt: now(), result: decision, resultDigest: digest("aei-d-policy-result", decision) };
      evidence.policy = frozen({ ...policyBase, digest: digest("aei-d-policy-evidence", policyBase) });
      const status = outcome(decision);
      return finish(status, status === "ORCHESTRATED" || status === "REVIEW_REQUIRED"
        ? ["EXPLICIT_REVIEW", "SUPPORTED_WALLET_HANDOFF", "FINAL_POLICY"] : [decision.requiredAction],
        [...fresh.warnings, ...(preparedResult.data.limitations ?? []), ...decision.findings.filter((item) =>
          item.decision === "WARN" || item.decision === "REQUIRE_REVIEW").map((item) => item.code)]);
    } catch { return failure(stage); }
  }
  return Object.freeze({ orchestrate });
}

/** Identity and current-context validation for later AEI-E/F consumers; a copied/rehashed object has no authority. */
export async function validateAeiDOperationalEnvelope(candidate: unknown, retainedLiveInput: unknown): Promise<boolean> {
  try {
    if (!candidate || typeof candidate !== "object") return false;
    const record = registered.get(candidate);
    if (!record) return false;
    const envelope = candidate as AEIDOperationalEnvelopeV1;
    if (envelope.digest !== record.digest || digest("aei-d-operational-envelope",
      [{ version: envelope.version, stage: envelope.stage, executionEnabled: envelope.executionEnabled,
        executionAuthority: envelope.executionAuthority, status: envelope.status, materialization: envelope.materialization,
        action: envelope.action, dependencies: envelope.dependencies, accountContext: envelope.accountContext,
        reads: envelope.reads, ...(envelope.preflightQuote ? { preflightQuote: envelope.preflightQuote } : {}),
        ...(envelope.quote ? { quote: envelope.quote } : {}), ...(envelope.prepared ? { prepared: envelope.prepared } : {}),
        ...(envelope.policy ? { policy: envelope.policy } : {}), unmetRequirements: envelope.unmetRequirements,
        warnings: envelope.warnings }, envelope.revision]) !== envelope.digest) return false;
    const materialization = validateStrategyMaterialization(envelope.materialization, retainedLiveInput);
    if (!materialization.valid || !envelope.accountContext) return false;
    const current = accountOf(await record.current(), record.now());
    return sameAccount(envelope.accountContext, current);
  } catch { return false; }
}
