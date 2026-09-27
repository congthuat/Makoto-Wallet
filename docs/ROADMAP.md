# Makoto Wallet — Canonical Roadmap

This is the canonical roadmap for Makoto Wallet / Makoto Agent.

## Rules
- Work only on the current sub-phase in `docs/PROJECT_STATE.md`.
- Do not invent, rename, skip, merge, or expand phases unless the user explicitly changes the roadmap.
- New ideas go to backlog notes; they do not silently expand the active phase.
- Do not pull Phase 8+ work into Phase 7H–7J.

## Phase 7 — Ledger Calm
- **7H — ACTIVE:** continue the already-defined 7H scope only. Inspect current code/tests/docs before editing.
- **7I — Robustness Audit:** edge cases, race conditions, state ownership, truthfulness, failure handling, regression.
- **7J — Final Visual Regression + Release Handoff:** responsive, EN/VI, light/dark, final UI regression, build/release readiness.

Exit: `7H -> 7I -> 7J -> Phase 7 complete -> 8A`

## Phase 8 — Makoto Tool Layer
- **8A** current-system audit
- **8B** read tools
- **8C** quote tools
- **8D** prepare/write tools returning bounded unsigned transactions
- **8E** schemas + validation
- **8F** agent integration
- **8G** regression + closeout

### 8A audit detail - current providers and capabilities

Treat 8A as an inventory/reuse audit before adding new code:

- **Makoto Send:** existing custom flow with simulation, review, revalidation, fee/account/network checks. Do not replace by default with a provider SDK.
- **Circle App Kit Bridge:** already integrated. Preserve quote expiry, fee breakdown, transfer lifecycle, receipt evidence, and current safety semantics.
- **Circle Unified Balance / Gateway spend:** already integrated. Preserve confirmed/pending truth, allocation review, fee fingerprinting, and pre-submit revalidation.
- **Xylo Swap:** existing custom provider/browser execution path.
- **Circle App Kit Swap:** candidate additional provider only. Evaluate behind a provider adapter; do not replace Xylo automatically.
- **x402 packages:** installed dependency is not proof of active runtime capability. Verify real use before planning integration work.
- **Makoto Agent / planner / orchestration / indexer:** identify and reuse stable existing boundaries instead of rebuilding them.

8A classification vocabulary:
existing / partial / candidate / inactive dependency.

Provider-specific SDKs must sit behind Makoto's canonical tool boundary. The Agent must not call raw provider SDKs directly once the canonical tool layer exists.

## Phase 9 — Policy & Risk Engine
- **9A** threat model + policy inventory
- **9B** core deterministic policy engine
- **9C** chain/contract/token/approval/slippage controls
- **9D** simulation + expiry + revalidation gate
- **9E** block/warn/review UX contract
- **9F** adversarial + failure-path tests
- **9G** robustness audit + closeout

## Phase 10 — Sequential Strategy Engine
- **10A** strategy/step model
- **10B** single-step execution
- **10C** receipt verification
- **10D** state re-read/requote/revalidation after receipt
- **10E** controlled multi-step continuation
- **10F** interruption/rejection/expiry/retry/recovery
- **10G** end-to-end regression + closeout

## Phase 11 — Intent Planner
- **11A** intent schema
- **11B** classify information/action/strategy
- **11C** structured plan generation
- **11D** parameter resolution + validation
- **11E** replanning after changed state/failure
- **11F** planner tests + closeout

## Phase 12 — Agent State Machine
- **12A** state definitions
- **12B** legal transitions + guards
- **12C** session/state persistence boundaries
- **12D** error/expired/rejected/failed states
- **12E** recovery/resume
- **12F** UI wiring + truthful status surfaces
- **12G** robustness audit + closeout

**Agent Core milestone:** after Phase 12 the core agentic-wallet execution architecture is complete.

## Integration Milestone — Agent Execution Integration

**Canonical milestone closeout (2026-09-27):** Agent Execution Integration is **COMPLETE / CLOSED / INTEGRATED INTO `phase7-astra-ledger-calm`**. AEI-A/B/B1/B2/C/D/E/F/G and all subphase reviews are complete; the [final integration review](aei-milestone-integration-review.md) passed, and reviewed AEI SHA `a9d1117ef82a5510d48f346cce33c512dae7b94e` reached canonical by normal fast-forward without a merge commit. [Final closeout](aei-milestone-closeout.md) records QA and preservation of inherited dirty files. The closed path ends at inert Review, before wallet execution. Criterion 98 stays `DEFERRED_OUTSIDE_AEI` / NOT PROVEN; `DEPLOYMENT_GATED_BY_AUTH_AND_RATE_LIMIT` remains unresolved; Phase 13 is NOT STARTED. Older pending-review pointers below are historical.

**AEI-G closeout pointer (2026-09-27):** AEI-A/B/B1/B2/C/D/E/F/G are **COMPLETE / CLOSED** on the [G final adversarial review](aei-g-final-review-audit.md) and docs-only closeout. The whole milestone is **ALL SUBPHASES COMPLETE / ALL SUBPHASE REVIEWS PASSED / PENDING FINAL MILESTONE INTEGRATION REVIEW**, not CLOSED; Phase 13 is NOT STARTED. The **FINAL AEI MILESTONE INTEGRATION REVIEW** must verify A–G closeout commits, contiguous history, canonical branch ancestry/base and fast-forward feasibility, clean status and hidden files, no Phase 13/UI-port contamination, and preserved deployment/UI gates before normal integration into `phase7-astra-ledger-calm`. After verified integration and canonical SHA, port the deferred canonical `makoto-wallet.zip` visual/UX while retaining Makoto runtime/security/Agent logic; resolve authentication, distributed rate limiting and any approved wallet-handoff hardening; perform full QA; deploy `makotowallet.xyz`; then begin Phase 13. Criterion 98 remains `DEFERRED_OUTSIDE_AEI` / NOT PROVEN. **DEPLOYMENT_GATED_BY_AUTH_AND_RATE_LIMIT** persists. Older status pointers below record earlier stages.

**AEI-F closeout pointer (historical, 2026-09-27):** AEI-A/B/B1/B2/C/D/E/F are COMPLETE / CLOSED; **AEI-G — robustness audit and final integration closeout is NEXT / NOT STARTED**. Phase 13 is NOT STARTED. [AEI-F's final review](aei-f-final-review-audit.md) closes its production pre-execution composition at fresh AEI-E eligibility and inert transaction Review; criterion 98's final wallet handoff remains `DEFERRED_OUTSIDE_AEI_F`. The earlier AEI-F design/implementation status statements are historical. AEI-G audits cross-boundary provenance, authority gaps, races, stale state, unsafe fallback and public production readiness before final milestone closeout. It does not silently add wallet execution, a UI port or deployment. **DEPLOYMENT_GATED_BY_AUTH_AND_RATE_LIMIT** and the deferred canonical `makoto-wallet.zip` reference remain in force.

**AEI-G final-review pointer (2026-09-27):** [The independent whole-milestone adversarial review](aei-g-final-review-audit.md) passed after failing-first fixes for falsy Planner-field/legacy-draft fallback and stale unopened Review control. AEI-G is **IMPLEMENTED / FINAL REVIEW PASSED / READY_TO_CLOSE**, not COMPLETE; the Agent Execution Integration milestone is **IMPLEMENTED / ALL SUBPHASE REVIEWS PASSED / PENDING FINAL MILESTONE CLOSEOUT**, not CLOSED. The final G browser suite passed 50/50, focused 3/3, full frontend 1541/1541, typecheck, lint with zero errors/seven inherited warnings, isolated Turbopack build and root compile. All 140 gates were reclassified; Criterion 98 remains intentionally deferred/unproven because no wallet handoff exists. Next is docs-only G closeout, then separate final milestone integration review before any canonical-branch integration or `makoto-wallet.zip` UI port. Phase 13 remains NOT STARTED and `DEPLOYMENT_GATED_BY_AUTH_AND_RATE_LIMIT` remains unresolved.

**AEI-G implementation pointer (2026-09-27):** AEI-G is **IMPLEMENTED / PENDING FINAL REVIEW**, not COMPLETE; the Agent Execution Integration milestone remains OPEN and Phase 13 NOT STARTED. [The implementation audit](aei-g-implementation-audit.md) classifies all 140 gates (18 TESTED, 42 BROWSER_QA, 44 ADVERSARIAL_RUNTIME, 1 PROPERTY_TESTED, 34 SOURCE_INSPECTED, 1 DEFERRED_OUTSIDE_AEI, 0 current AEI-owned NOT_PROVEN). A failing-first mixed Planner/legacy message regression found one action-control fallback at the exported Agent component boundary; the scoped fix renders a non-actionable unavailable Planner state. AEI-G focused 3/3, browser 43/43, full frontend 1541/1541, typecheck, lint with zero errors/seven inherited warnings, isolated Turbopack build and root compile passed. Criterion 98 remains deliberately unproven because no final wallet handoff exists. Separate G final review, docs-only closeout and final milestone integration review remain ahead. Deployment stays `DEPLOYMENT_GATED_BY_AUTH_AND_RATE_LIMIT`; `makoto-wallet.zip` remains the deferred canonical UI/UX reference.

**AEI-G design pointer (2026-09-27):** [Robustness / Final Integration Audit](aei-g-robustness-final-integration-design.md) is **DESIGN APPROVED / NEXT / NOT STARTED**. It defines 140 future acceptance gates, whole A–F authority/provenance review, sequential regressions and separate final review. Criterion 98 remains intentionally unproven: no wallet handoff exists; a later handoff requires fresh E, exact prepared artifact, account/chain, quote/preparation, final policy and required fee/gas/simulation checks plus distinct user transaction Review. AEI-F remains COMPLETE / CLOSED; the milestone remains OPEN and Phase 13 NOT STARTED. `DEPLOYMENT_GATED_BY_AUTH_AND_RATE_LIMIT` and deferred `makoto-wallet.zip` remain unchanged. Earlier AEI-G text below is the pre-design pointer.

**Status:** OPEN. AEI-A/B/B1/B2/C/D/E/F are COMPLETE / CLOSED; AEI-G is NEXT / NOT STARTED. This milestone follows the closed Phase 12 — Agent State Machine and precedes Phase 13 — Makoto MCP. The earlier “12H” worktree/design was the contract audit for this milestone; it does not reopen Phase 12. `docs/phase12h-planner-strategy-integration-design.md` and ADR-031 provide the design baseline; `docs/aei-b1-production-planner-proposal-pipeline-design.md` and `docs/aei-parameter-resolution-provenance-design.md` specify B1 and B2. `PROJECT_STATE.md` remains the execution pointer.

**Longer-term target:** a truthful, bounded production path: user request → Phase 11 Planner/`PlannerPlan` and parameter proposals → visible canonical proposal review and explicit parameter confirmation → trusted field evidence → canonical `PlannerStrategyBinding` → Phase 10 Strategy → Phase 8 tools → Phase 9 policy/review → canonical preparation → explicit transaction review → user wallet signature → Phase 10F submission record → Phase 10C receipt verification → Phase 12 guarded state → Phase 10D/10E fresh revalidation and continuation. Closed AEI-F ends at inert Review; this longer-term sequence does not assign wallet execution to AEI-G. Any final handoff needs separately approved scope and a fresh E/current prepared/account/chain/quote/preparation/final-policy/fee/simulation gate. Each dependent write remains a separate user-controlled step. A valid PlannerPlan and parameter confirmation establish no transaction authorization. The Planner cannot invent connected account, wallet, chain observation, quote, preparation, policy, consent, or receipt evidence. Only routes proved by existing canonical contracts may enter the pipeline; this target does not promise every Strategy shape or action can execute.

| Subphase | Purpose and scope | Non-goals | Primary acceptance criteria | Key dependency |
| --- | --- | --- | --- | --- |
| **AEI-A — canonical binding contract** | Define versioned, exact `PlannerStrategyBinding`/compilation-result schemas for trusted request/session, plan and resolved-intent digests, goal ID ↔ action-step ID, Strategy identity and revisions. | No compiler, tool call, policy decision or wallet action. | JSON-safe validation, deterministic identity rules, exact fields, runtime-object and replay rejection. | Approved ADR-031/design audit. **COMPLETE / CLOSED; history unchanged.** |
| **AEI-B — deterministic skeleton compiler** | Validate the complete plan, one-to-one resolved intents and goal graph; map supported semantic goals to a non-executable Strategy skeleton with explicit goal-step identity and dependency edges. | No quote/preparation/approval fabrication, account invention, provider call or execution. | Same validated inputs yield the same IDs/graph; substitutions, unresolved/dynamic values, unsupported routes and malformed data fail closed without dropping a goal. | AEI-A. **COMPLETE / CLOSED; deterministic non-executable skeleton only.** |
| **AEI-B1 — Production Planner Proposal Pipeline** | Add one production proposal-only caller sequencing Phase 11 classification, plan generation and parameter resolution; retain request/session/plan/goal identity and send a validated, non-executable canonical proposal to distinct Agent UI state. | No confirmation evidence, Strategy compilation/binding, quote/preparation, Phase 9, wallet, signing, submission, receipt or retry. | Real Agent request reaches validated proposal; wrong/stale identities and malformed provider output fail; dynamic fields remain unresolved and provider candidates unverified; legacy drafts stay distinct. | Existing Phase 11 ports and AEI-B provenance design. **COMPLETE / CLOSED; public deployment gated by auth and distributed rate limiting.** |
| **AEI-B2 — Trusted Planner Proposal Confirmation Boundary** | Review the exact canonical B1 proposal in Makoto Agent; capture explicit application-level confirmation and field evidence for AEI-B. | No wallet handoff, transaction approval, quote/preparation, materialization, policy approval, signing, submission, receipt, retry or full Agent execution orchestration. | Complete fixed proposal confirms through the approved UI boundary; JSON/provider forgery fails; edits/replans invalidate confirmation; dynamic previews remain nonfixed; EN/VI, keyboard and mobile review; output remains non-executable. | Exact retained AEI-B1 proposal and host source plus existing AEI-B evidence/compiler contracts. **COMPLETE / CLOSED.** |
| **AEI-C — Strategy materialization and provenance** | Purely convert the exact AEI-B non-executable skeleton and live-validated AEI-A v2 binding into a versioned semantic artifact set: one ACTION descriptor per goal plus a whole-Strategy envelope, canonical provenance/digests, dependencies and unsatisfied downstream requirements. | No account inference, read/quote/provider/RPC call, preparation/calldata, Phase 9 decision, wallet, signing, submission, receipt or retry. Real quote/preparation references and their account/chain/fingerprint checks are downstream AEI-D work. | Exact request/session/plan/evidence/Strategy/goal-step lineage; stable content-derived revision and digests; fixed SEND/SWAP/BRIDGE and multi-goal coverage; malformed, dynamic, replayed, v1/legacy or executable input fails closed; 50 implementation gates in `aei-c-strategy-materialization-design.md`. | AEI-A/B/B1/B2 (closed). **COMPLETE / CLOSED; semantic-only materialization.** |
| **AEI-D — tool and policy orchestration boundary** | Validate the live AEI-C envelope, bind current wallet context, acquire Phase 8 reads/quote, perform deterministic preflight, coordinate supported unsigned preparation, then invoke existing Phase 9 policy on the actual preparation for one eligible ACTION. Emit an execution-forbidden operational envelope for later review. | No policy override, Agent state transition, automatic wallet action, retry or receipt claim. | Exact account/action/provenance and freshness binding; BLOCK > REQUOTE > REVALIDATE > REQUIRE_REVIEW > WARN > ALLOW; unsupported handoffs stop; 64 implementation gates and verification in `aei-d-final-review-audit.md`. | AEI-C; existing Phase 8/9/10 contracts. **COMPLETE / CLOSED.** |
| **AEI-E — Phase 12 state integration** | Bind exact live-valid AEI-D outcomes to existing Phase 12 truth: blocked/stale/handoff/failure facts stay at PLAN_READY in a versioned operational sidecar; only a guarded canonical PLAN_READY → PREPARED proof may enter the unsigned transaction state. Preserve exact Strategy/ACTION/goal, account/chain, materialization/D revision, quote/preparation/policy and step identity. | No wallet Review, signature, submission, polling, retry, dependent-action advancement or historical-state promotion. | The [final review](aei-e-final-review-audit.md) records all 80 criteria, one-use private proof, historical-only persistence, latest-D supersession, separate approval/swap steps and Phase 10F ownership. AEI-F must freshly call `validateAeiEReviewEligibility` at later Review; a saved PREPARED label is insufficient. | AEI-C/D. **COMPLETE / CLOSED.** |
| **AEI-F — Production Agent Orchestration** | One production coordinator composes B1/B2/AEI-B/A/C/D/E for one eligible ACTION and creates inert Review only after fresh AEI-E eligibility. | No LLM authority, autonomous dependent write, final wallet handoff, signer, wallet call, submission, receipt polling, retry/resubmission or blanket Bridge support. 10F/10C/10D/10E retain separate downstream authority. | [Final review](aei-f-final-review-audit.md) reclassifies all 100 gates, records the fixed account-switch B2 race, exact Review lineage and isolated execution-capable flows. Criterion 98 remains `DEFERRED_OUTSIDE_AEI_F`: a future wallet handoff must freshly check E, exact prepared artifact, account/chain, quote/preparation freshness, final policy and required fee/gas/simulation evidence. | AEI-A/B/B1/B2/C/D/E. **COMPLETE / CLOSED.** |
| **AEI-G — robustness audit and closeout** | Audit AEI-A through AEI-F for cross-boundary provenance, authority gaps, identity/replay/races, stale state, unsafe fallback, policy, receipt and EN/VI UI; run bounded browser/integration regression and document final milestone readiness. | No silent wallet execution, Phase 13 work, UI port, roadmap expansion or deployment. | Required integration suites pass; unsupported runtime-output-dependent and Direct CCTP Agent paths remain blocked unless separately approved and tested; public readiness limits are explicit. | AEI-A through AEI-F. **COMPLETE / CLOSED.** |

**Approved ordering:** AEI-A/B/B1/B2/C/D/E/F/G and whole AEI milestone (COMPLETE / CLOSED / canonically integrated) → **new branch and new worktree from the verified final canonical closeout SHA (NEXT, not part of this closeout)** → port canonical `makoto-wallet.zip` visual/UX while retaining Makoto runtime/security/Agent logic → resolve authentication, distributed rate limiting and any approved final wallet-handoff/deployment-hardening requirements → full frontend/contracts/browser/accessibility/security QA → deploy `makotowallet.xyz` → Phase 13. B2 parameter confirmation does not grant transaction Review or wallet consent. AEI-F closes at inert Review, without final wallet, attempt, receipt or dependent-action execution authority. Phase 13–17 numbering is unchanged.

**Post-AEI-G deployment plan (unnumbered):** After AEI-G is implemented, reviewed, closed, and integrated, port the visual/UX from the user-provided `makoto-wallet.zip` reference while preserving Makoto architecture, security, and Agent logic; resolve all deployment blockers, including the Planner route's **DEPLOYMENT_GATED_BY_AUTH_AND_RATE_LIMIT** classification; run full frontend/contracts tests, build, browser and accessibility QA; deploy to `makotowallet.xyz`; then begin Phase 13. This reference supersedes "Bản thử nghiệm 1" and older Surf references. Do not copy prototype transaction, security or mock authority logic into production. The route still lacks server-side account authentication and distributed rate limiting; its session UUID is correlation identity, not account authentication.

**Approved post-AEI-G UI reference:** The user-provided `makoto-wallet.zip` is the primary/canonical visual/UX reference after AEI-G final review/closeout and integration to the canonical development branch. It supersedes "Bản thử nghiệm 1" and older Surf references. Port its visual/UX into Makoto while retaining Makoto production runtime, security and Agent architecture. Do not adopt prototype transaction handling, security logic or mock authority without independent production review. Resolve the auth/rate-limit deployment gate, then run full tests, production build and browser/accessibility QA before `makotowallet.xyz` deployment; Phase 13 follows deployment. This is deferred product/deployment work, not AEI-D scope.

**Dependency semantics:** `B dependsOn A` gives an order dependency: A must have the required verified outcome before B can be reviewed. A value dependency additionally requires B's parameter to be derived from A's verified output. “Swap 100 USDC to EURC, then send all received EURC” needs a new output-value/provenance contract; current PlannerIntent and Strategy cannot safely express or execute its dynamic second amount. This milestone records dynamic value dependency as **unsupported**, unless a separately approved implementation subphase defines and verifies it. Direct CCTP quote/preparation do not supply a Phase 10B Agent wallet handoff; Agent BRIDGE execution also remains **unsupported** unless that handoff is separately implemented and tested. Source-chain CCTP status never proves destination completion.

**Authority remains with existing boundaries:** Phase 9 owns transaction policy/safety; Phase 10 owns Strategy lifecycle and one-step execution contracts; Phase 10F owns submission, recovery, retry and double-submission safety; Phase 12 owns state/transition/recovery truthfulness; the user wallet is final signing authority. Integration may sequence these boundaries, but does not become a signer, policy, automatic retry/resubmission, or receipt authority. Deployment is a separate decision. Phase 13 remains NOT STARTED.

## Phase 13 — Makoto MCP
- **13A** MCP boundary/protocol design
- **13B** server shell/transport/lifecycle
- **13C** read tools
- **13D** quote tools
- **13E** prepare/write tools
- **13F** auth/security/abuse boundaries
- **13G** Makoto Agent integration
- **13H** security/compatibility audit + closeout

## Phase 14 — Agent Memory
- **14A** memory model/data classes
- **14B** session memory
- **14C** long-term preferences/durable context
- **14D** retrieval/relevance controls
- **14E** privacy/secret-exclusion/trust boundaries
- **14F** update/correction/forgetting behavior
- **14G** tests + closeout

## Phase 15 — Activity / Indexer Intelligence
- **15A** event/activity model
- **15B** RPC/indexing ingestion
- **15C** normalized SEND/RECEIVE/SWAP/BRIDGE/VAULT/APPROVAL activity
- **15D** persistence/checkpointing
- **15E** agent query surfaces
- **15F** reorg/RPC failure/recovery
- **15G** validation + closeout

## Phase 16 — Verifiable Agent Actions
- **16A** action IDs/lifecycle
- **16B** intent/plan records
- **16C** tool-call/simulation trace
- **16D** user approval + receipt binding
- **16E** audit/activity UI
- **16F** export/proof format
- **16G** security/integrity review + closeout

## Phase 17 — FLOP / Technocore Integration
Optional ecosystem integration after Agent Core is stable. It does not change Makoto's non-custodial trust model.
- **17A** integration architecture/boundaries
- **17B** Technocore DID adapter
- **17C** FLOP compute/inference adapter
- **17D** signed work/action receipts
- **17E** agent orchestration integration
- **17F** end-to-end tests/failure isolation
- **17G** release handoff

## Future integration backlog (not active phases)

These items are references/backlog only. They must not change the current execution pointer or silently create new numbered phases.

- **Arc Studio:** development specialist/subagent for isolated Arc/Circle prototypes, contract patterns, App Kit/Gateway/CCTP experiments, and test/reference implementations. Generated code must be reviewed and tested before entering Makoto.
- **Circle Onramp Kit:** candidate future fiat -> USDC funding path after Agent Core is stable.
- **Circle Earn Kit / external earn providers:** candidate future adapter behind Makoto Tool Layer + Policy/Risk Engine. Do not replace Makoto Vault merely because an external earn provider exists.
- **Circle Agent Marketplace:** discovery surface for external services. Marketplace listing is not a trust decision; services must enter through adapters and Makoto policy.
- **External onchain intelligence:** optional providers such as Alchemy/Allium/Arkham/CoinGecko-class data sources may enrich Phase 15 intelligence, but cannot authorize transactions.
- **x402 / paid agent services:** keep as future research for bounded service payments. It does not replace Phase 17 FLOP/Technocore and must not grant uncontrolled access to the user's primary wallet.

Important: **Phase 17 remains FLOP / Technocore Integration.** This backlog does not rename or remove it.

## Architecture direction
`User Intent -> Agent -> Planner -> Tool Layer -> Policy/Risk Engine -> Simulation -> Review -> User Wallet Signature -> Blockchain -> Receipt -> Re-read State -> Next Step/Done`

The LLM may propose and plan. It is never the final authority for transaction safety or wallet signing.
