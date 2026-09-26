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

**Status:** OPEN. AEI-A, AEI-B1 and AEI-B2 are COMPLETE / CLOSED; AEI-B is COMPLETE / CLOSED, including its reviewed B1 and B2 prerequisites. AEI-C is NEXT / NOT STARTED; AEI-D, AEI-E, AEI-F and AEI-G are NOT STARTED. This milestone follows the closed Phase 12 — Agent State Machine and precedes Phase 13 — Makoto MCP. The earlier “12H” worktree/design was the contract audit for this milestone; it does not reopen Phase 12. `docs/phase12h-planner-strategy-integration-design.md` and ADR-031 provide the design baseline; `docs/aei-b1-production-planner-proposal-pipeline-design.md` and `docs/aei-parameter-resolution-provenance-design.md` specify B1 and B2. `PROJECT_STATE.md` remains the execution pointer.

**Target:** a truthful, bounded production path: user request → Phase 11 Planner/`PlannerPlan` and parameter proposals → visible canonical proposal review and explicit parameter confirmation → trusted field evidence → canonical `PlannerStrategyBinding` → Phase 10 Strategy → Phase 8 tools → Phase 9 policy/review → canonical preparation → explicit transaction review → user wallet signature → Phase 10F submission record → Phase 10C receipt verification → Phase 12 guarded state → Phase 10D/10E fresh revalidation and continuation. Each dependent write remains a separate user-controlled step. A valid PlannerPlan and parameter confirmation establish no transaction authorization. The Planner cannot invent connected account, wallet, chain observation, quote, preparation, policy, consent, or receipt evidence. Only routes proved by existing canonical contracts may enter the pipeline; this target does not promise every Strategy shape or action can execute.

| Subphase | Purpose and scope | Non-goals | Primary acceptance criteria | Key dependency |
| --- | --- | --- | --- | --- |
| **AEI-A — canonical binding contract** | Define versioned, exact `PlannerStrategyBinding`/compilation-result schemas for trusted request/session, plan and resolved-intent digests, goal ID ↔ action-step ID, Strategy identity and revisions. | No compiler, tool call, policy decision or wallet action. | JSON-safe validation, deterministic identity rules, exact fields, runtime-object and replay rejection. | Approved ADR-031/design audit. **COMPLETE / CLOSED; history unchanged.** |
| **AEI-B — deterministic skeleton compiler** | Validate the complete plan, one-to-one resolved intents and goal graph; map supported semantic goals to a non-executable Strategy skeleton with explicit goal-step identity and dependency edges. | No quote/preparation/approval fabrication, account invention, provider call or execution. | Same validated inputs yield the same IDs/graph; substitutions, unresolved/dynamic values, unsupported routes and malformed data fail closed without dropping a goal. | AEI-A. **COMPLETE / CLOSED; deterministic non-executable skeleton only.** |
| **AEI-B1 — Production Planner Proposal Pipeline** | Add one production proposal-only caller sequencing Phase 11 classification, plan generation and parameter resolution; retain request/session/plan/goal identity and send a validated, non-executable canonical proposal to distinct Agent UI state. | No confirmation evidence, Strategy compilation/binding, quote/preparation, Phase 9, wallet, signing, submission, receipt or retry. | Real Agent request reaches validated proposal; wrong/stale identities and malformed provider output fail; dynamic fields remain unresolved and provider candidates unverified; legacy drafts stay distinct. | Existing Phase 11 ports and AEI-B provenance design. **COMPLETE / CLOSED; public deployment gated by auth and distributed rate limiting.** |
| **AEI-B2 — Trusted Planner Proposal Confirmation Boundary** | Review the exact canonical B1 proposal in Makoto Agent; capture explicit application-level confirmation and field evidence for AEI-B. | No wallet handoff, transaction approval, quote/preparation, materialization, policy approval, signing, submission, receipt, retry or full Agent execution orchestration. | Complete fixed proposal confirms through the approved UI boundary; JSON/provider forgery fails; edits/replans invalidate confirmation; dynamic previews remain nonfixed; EN/VI, keyboard and mobile review; output remains non-executable. | Exact retained AEI-B1 proposal and host source plus existing AEI-B evidence/compiler contracts. **COMPLETE / CLOSED.** |
| **AEI-C — Strategy materialization and provenance** | Bind later real quote/preparation references to versioned Strategy content; preserve submitted-step identity and tool-derived approval prerequisites. | No signing, submission or in-place rewriting of a submitted step. | Exact fingerprint/index/account/chain/step binding, revision checks and fresh review after changed artifacts. | AEI-B (closed) and the Strategy revision contract identified in the audit. **NEXT / NOT STARTED.** |
| **AEI-D — tool and policy orchestration boundary** | Coordinate Phase 8 read/quote/prepare with Phase 9 final policy and Phase 10 single-step review for one eligible action. | No policy override, automatic wallet action, retry or receipt claim. | BLOCK > REQUOTE > REVALIDATE > REQUIRE_REVIEW > WARN > ALLOW; fresh evidence and explicit user review before a wallet handoff; unsupported handoffs stop. | AEI-C; existing Phase 8/9/10 contracts. |
| **AEI-E — Phase 12 state integration** | Add a guarded canonical PLAN_READY → PREPARED proof and preserve plan→goal→step→artifact→attempt→receipt identity across later legal edges and historical persistence. | No shortcut, automatic state advancement or historical-state promotion. | Cross-session/plan/goal/account/chain/step substitutions fail; existing Phase 12 transition/recovery truth and CCTP source scope remain intact. | AEI-C/D and an explicit state-version/migration decision if needed. |
| **AEI-F — production Agent orchestration** | Connect the approved boundaries through a dedicated domain coordinator and truthful Agent UI for supported routes; sequence explicit wallet review, 10F attempt, 10C receipt, 10D/10E continuation. | No LLM authority, autonomous dependent write, signer, automatic retry/resubmission or blanket Bridge support. | Fixed-parameter supported flows use one action at a time; ambiguous submission stops; fresh receipt and review precede the next step; unavailable status remains truthful when no canonical caller/evidence exists. | AEI-D/E and a supported wallet handoff. |
| **AEI-G — robustness audit and closeout** | Adversarial identity, replay, malformed-input, policy, receipt, EN/VI UI and bounded browser regression; document exact scope and results. | No silent roadmap expansion or deployment. | Required integration suites pass; unsupported value-dependent and Direct CCTP Agent paths remain explicitly blocked unless separately implemented and tested. | AEI-A through AEI-F. |

**Approved ordering:** AEI-A (closed) → AEI-B implementation → AEI-B1 (closed) → AEI-B2 (closed) → AEI-B final adversarial review and closeout (closed) → **AEI-C (NEXT / NOT STARTED)** → AEI-D → AEI-E → AEI-F → AEI-G → final Agent Execution Integration review/closeout → integration to the canonical development branch → post-AEI-G UI integration and deployment readiness → Phase 13. B1 supplies a real production proposal to B2; B2 alone may create confirmed parameter evidence from an approved application interaction. Their individual closeouts did not close AEI-B; the separate final review and closeout above did. AEI-C retains its dependency on completed AEI-B; AEI-F later composes the full transaction pipeline.

**Post-AEI-G deployment plan (unnumbered):** After AEI-G is implemented, reviewed, closed, and integrated, port the latest Surf UI visual/UX reference while preserving Makoto architecture, security, and Agent logic; resolve all deployment blockers, including the Planner route's **DEPLOYMENT_GATED_BY_AUTH_AND_RATE_LIMIT** classification; run full frontend/contracts tests, build, browser and accessibility QA; deploy to `makotowallet.xyz`; then begin Phase 13. The Surf reference uses the previous wallet UX as its base with the newer Agent-first Home, Ask / Monitor / Automate, Agent review flow, Tasks, improved sidebar/navigation, and restrained green with Makoto purple; it is not a trading analytics dashboard. Closing AEI-B neither starts this work nor permits public deployment. The route still lacks server-side account authentication and distributed rate limiting; its session UUID is correlation identity, not account authentication.

**Approved post-AEI-G UI reference:** "Bản thử nghiệm 1" is the primary Surf visual/UX reference after AEI-G final review/closeout and integration to the canonical development branch. Preserve the Agent-first Home, Ask / Monitor / Automate, sidebar grouping, Tasks, Portfolio / Assets / Activity wallet UX, Review Parameters concept, Send / Receive UX, mobile bottom navigation, dark Makoto purple/black with restrained green, and compact Arc Chain Pulse. Port visual/UX only; retain Makoto production architecture, security and Agent logic. Do not adopt prototype transaction handling, regex Agent logic, fake automation, weak App Lock, fake quotes or security claims. Resolve the auth/rate-limit deployment gate, then run full tests, production build and browser/accessibility QA before `makotowallet.xyz` deployment; Phase 13 follows deployment. This is deferred product/deployment work, not AEI-C scope.

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
