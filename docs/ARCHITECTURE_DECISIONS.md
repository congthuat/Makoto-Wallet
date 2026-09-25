# Makoto Wallet — Architecture Decisions

Durable decisions below remain in force unless the user explicitly changes them.

## ADR-001 — Non-custodial
Makoto remains non-custodial. Never store, transmit, log, or expose seed phrases/private keys.

## ADR-002 — Human signature boundary
The agent may read, plan, quote, simulate, and prepare. It does not sign. The connected user wallet is the final signing authority.

## ADR-003 — Deterministic Policy/Risk Engine
Safety is enforced by deterministic code, not only prompt/model judgment. Wrong chain, unsupported assets, unsafe approvals, expired quotes, reverts, bad spenders, or excessive slippage must follow explicit block/warn/requote rules.

## ADR-004 — Typed tool boundaries
Prefer READ, QUOTE, and PREPARE/WRITE tools with typed schemas. The agent must not invent arbitrary calldata when a supported tool exists.

## ADR-005 — Sequential dependent execution
Dependent writes run one at a time:
read -> quote/plan -> policy -> simulate -> review -> user sign -> verify receipt -> re-read/revalidate -> next step.

## ADR-006 — Truthful execution UI
Never show transaction success before verified receipt/state evidence. Distinguish prepared, awaiting signature, submitted, confirming, success, rejected, expired, and failed.

## ADR-007 — Memory is not blockchain truth
Memory may retain preferences/context. Balances, allowances, quotes, receipts, network state, and transaction status must be re-read from authoritative sources. Never store signing secrets in memory.

## ADR-008 — MCP is an integration boundary
MCP exposes stable capabilities. It does not replace the Policy/Risk Engine or wallet signing boundary.

## ADR-009 — Phase 7 scope freeze
During 7H–7J, do not pull Phase 8+ architecture work into Phase 7 unless required to fix an actual Phase 7 regression.

## ADR-010 — Vitael is reference material, not a clone target
Useful patterns may be adapted, but Makoto remains wallet + safety + agent orchestration rather than a requirement to build a proprietary lending/DEX protocol.

## ADR-011 — FLOP / Technocore
FLOP/Technocore remains planned Phase 17 integration. It is not required for core wallet operation and must not weaken the non-custodial boundary.

## ADR-012 — Source-of-truth order
1. `docs/PROJECT_STATE.md`
2. `docs/ROADMAP.md`
3. `docs/ARCHITECTURE_DECISIONS.md`
4. current code/tests/git state
5. legacy docs for history/component-specific context

If these conflict, surface the conflict instead of inventing behavior.

## ADR-013 - Provider SDKs stay behind Makoto boundaries
Circle App Kit, Gateway, CCTP, Xylo, marketplace services, and future providers are implementation adapters. They do not become the Agent's direct authority. Canonical Makoto READ/QUOTE/PREPARE tools and deterministic policy remain the stable boundary.

## ADR-014 - Existing integration before replacement
Before adopting a new SDK or Arc App Kit path, audit the current Makoto implementation. Prefer reuse or a second provider adapter when the existing flow already has stronger transaction-review, simulation, truthfulness, or recovery semantics.

## ADR-015 - Installed dependency is not implemented capability
A package present in package.json (including x402) is not evidence of runtime integration. Capability status must be established from executable code, wiring, tests, and verified behavior.

## ADR-016 - Arc Studio is a development specialist, not runtime architecture
Arc Studio may be used for isolated prototypes, Arc/Circle reference implementations, or developer experiments. Its generated output must be reviewed and tested before integration. Arc Studio does not directly control Makoto runtime, signing, policy, or production architecture.

## ADR-017 - External data and marketplace services are untrusted inputs
External intelligence and Circle Agent Marketplace services may inform plans or provide capabilities, but their outputs are not transaction authority. Action-critical data must carry provenance/freshness and pass Makoto policy, simulation/revalidation, and user approval.

## ADR-018 - Phase 17 remains FLOP / Technocore
FLOP/Technocore remains the planned Phase 17 optional ecosystem integration. x402, Agent Marketplace, Onramp, Earn, or other new Arc/Circle references do not rename, replace, or silently expand Phase 17.

## ADR-019 - Phase 11A planner intent boundary
`PlannerIntent` is a resolved, JSON-safe transaction goal distinct from the current Agent request model `AgentIntent`. It is upstream of Phase 10 `Strategy`; 11A validates supported Send, Swap, and Bridge goals but does not classify user text, generate Strategy steps, or execute. Later planning may introduce implementation steps such as approval. Phase 9 remains transaction safety authority, and the user wallet remains final signing authority.

## ADR-020 - Phase 11B request classification boundary
The 11B categories are INFORMATION, ACTION, and STRATEGY, based on user-level goals. Technical prerequisites such as approval, receipt wait, and revalidation do not turn one swap goal into STRATEGY. Classification precedes PlannerIntent resolution and is not transaction safety; Phase 9 remains safety authority. The existing Agent keyword parser loses composed-goal information, so its `AgentIntent` output cannot serve as authoritative raw-request classification. A provider-agnostic `PlannerSemanticClassifier` port accepts raw requests through a server-only OpenAI Responses API adapter. OpenAI output is untrusted and must pass deterministic 11B validation. The browser never receives the API key. The HTTP classifier route is disabled by default and requires the exact server-only setting `PLANNER_CLASSIFIER_HTTP_ENABLED=true`; future production exposure requires an approved abuse-control boundary. The provider can be replaced without changing the PlannerIntent contract; classification remains semantic routing, not transaction safety.

## ADR-021 - Phase 11C user-goal plan boundary
`PlannerPlan` holds user-goal kinds (SEND, SWAP, BRIDGE) and explicit goal-ID dependencies. An ACTION has one goal and no dependency; a STRATEGY has at least two goals and a dependency edge. Array order does not imply execution order. 11C does not resolve amount, asset, chain, or recipient. Phase 11D — parameter resolution + validation — will turn plan goals into resolved `PlannerIntent` values through the 11A validator. Phase 10 `Strategy` owns later technical execution steps such as approval, receipt waits, and revalidation. The provider-agnostic plan port accepts only bounded text with canonical 11B ACTION or STRATEGY classification. Its server-only OpenAI Responses adapter has no public HTTP route. Model output is untrusted until deterministic `PlannerPlan` graph validation accepts it; neither the model nor this validation substitutes for 11D and 11A validation. A valid plan describes structure, not transaction safety: Phase 9 remains safety authority and the user wallet remains final signing authority. 11C does not compile a Phase 10 Strategy, prepare or execute transactions, or add Phase 12 autonomy.

## ADR-022 - Phase 11D parameter resolution boundary
11D accepts bounded original text and a valid 11C `PlannerPlan`, whose ID, goal IDs, kinds, classification, and dependency graph are immutable input. The provider-agnostic resolver and server-only OpenAI Responses adapter extract nullable parameter candidates keyed by existing goal ID; they neither regenerate the graph nor expose a public endpoint. Deterministic code canonicalizes registered asset names/casing, supported chain names, and explicit EVM addresses, applies only unique capability-derived defaults, and uses the unchanged 11A `validatePlannerIntent` for every candidate. A resolved intent inherits its goal ID; the plan is `RESOLVED` only when every goal validates. Missing or dynamic parameters require clarification; explicit invalid or unsupported parameters fail without substitution. Provider output is untrusted and no resolution result proves transaction safety. Phase 9 remains safety authority, the user wallet remains final signing authority, and Phase 10 `Strategy` remains a later execution domain. 11D does not execute, persist a conversation, or start Phase 12 state behavior.

## ADR-023 - Phase 11E semantic replanning boundary
11E accepts a versioned, JSON-safe original request, valid 11C `PlannerPlan`, and bounded changed-state/failure trigger. It returns semantic advice only: no replan, separate 11D parameter resolution, clarification, a proposed replacement graph, invalid input, unsupported change, or provider error. It does not verify the caller's changed-state assertion. A replacement is proposed only for a strategy graph change; it must pass the unchanged 11C validator, retain the classification and all original goal IDs and kinds, change dependencies, and use a new plan ID. This deliberately cannot invent a new goal kind or overcome an unavailable capability; those require fresh user intent. The optional server-only OpenAI Responses adapter uses one strict, no-tools, non-stored attempt. Structural checks cannot prove full semantic equivalence to the original natural-language request, so provider output remains untrusted and any replacement needs later 11D resolution and existing safety review. 11E never signs, submits, broadcasts, retries, approves, unlocks a wallet, or advances a transaction. Phase 10F owns execution-attempt recovery and double-submission safety, including ambiguous or known submitted attempts. Phase 9 remains transaction safety authority, cannot be overridden by 11E, and the user wallet remains final signing authority. No public replanning endpoint or Phase 12 state machine is added.

## ADR-024 - Phase 12B guarded transition boundary
12B evaluates one explicitly requested state edge without storing state or advancing another edge. REQUESTED to PLAN_READY requires a validated Phase 11 generated plan. PLAN_READY to transaction PREPARED fails closed until a canonical PlannerPlan-to-Strategy binding exists. PREPARED to AWAITING_SIGNATURE invokes the existing Phase 10B step and Phase 9 policy evaluation; AWAITING_SIGNATURE to SUBMITTED and SUBMITTED to CONFIRMING bind the Phase 10F attempt record and Phase 10C pending result. CONFIRMING to SUCCESS requires a matching Phase 10C CONFIRMED result, validated with the Phase 10F attempt and receipt binding; a structural receipt reference is not proof. Phase 10C's source-transaction result cannot establish CCTP destination completion. Behavioral transitions to REJECTED, EXPIRED, and FAILED remain deferred to 12D. This layer adds no signing, submission, retry, persistence, recovery, or automatic progression; Phase 9, Phase 10F, Phase 11, and wallet authority remain unchanged.

## ADR-025 - Phase 12C historical state persistence boundary
12C uses an injected Web Storage interface with a versioned, account/chain/session-scoped key and a separate versioned envelope. It stores only data accepted by the unchanged 12A state validator. Restore parses untrusted JSON, checks the envelope and current caller-supplied account/chain/session binding, revalidates the 12A state, and labels the result HISTORICAL. Persisted plans, attempts, receipts, transaction hashes, and status labels are descriptive and never become fresh policy, receipt, retry, or signing evidence. The boundary does not call 12B, Phase 9/10/11, RPC, wallet, or model services. There is no production caller, automatic restore-to-execution, transition, resume, recovery, or migration of unsupported versions.

## ADR-026 - Reverted receipt identity across Phase 10C and 10F
Receipt-derived failure evidence must retain enough identity already verified by Phase 10C for Phase 10F to bind it to the exact submitted action. A `REVERTED` result carries the verified action, account, prepared-action reference, source-transaction scope, strategy and step IDs, hash, chain, and block number. Phase 10F rejects a reverted result when these fields do not match its submitted record and Strategy action step. A revert proves only failure of that source transaction; it does not establish CCTP destination status or grant retry permission. Phase 12D remains next and has not started.

## ADR-027 - Phase 12D terminal outcome guards
The existing one-edge Agent transition evaluator accepts AWAITING_SIGNATURE to REJECTED only with a matching Phase 10F `USER_REJECTED` record. AWAITING_SIGNATURE to EXPIRED requires a matching proven pre-submission failure record, Phase 10F `REQUOTE_REQUIRED` or `REPREPARE_REQUIRED`, and an actually elapsed bound quote, preparation, or handoff expiry. SUBMITTED or CONFIRMING to FAILED requires the matching submitted attempt, a Phase 10C `REVERTED` source-transaction result, and Phase 10F acceptance of its identity. Proven pre-submission failure alone is not mapped to FAILED. Pending, unavailable, ambiguous, policy-stop, and confirmed evidence do not prove these terminal outcomes. The evaluator neither recovers nor retries; persisted states remain historical only. CCTP source results do not prove destination completion.
