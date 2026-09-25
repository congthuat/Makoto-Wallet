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
