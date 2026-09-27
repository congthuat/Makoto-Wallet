# AEI-G — Robustness / Final Integration Audit (approved design)

**Closeout addendum (2026-09-27):** AEI-G is **COMPLETE / CLOSED** after its [final adversarial review](aei-g-final-review-audit.md). The whole Agent Execution Integration milestone is **ALL SUBPHASES COMPLETE / ALL SUBPHASE REVIEWS PASSED / PENDING FINAL MILESTONE INTEGRATION REVIEW**, not CLOSED; Phase 13 is NOT STARTED. Both final defects were reproduced with failing browser regressions, fixed and passed: explicit null/undefined Planner fields with a legacy draft now remain non-actionable through own-field presence, and fresh AEI-E currentness removes an unopened Review control after expiry. The 140 reviewed classes are 18 TESTED, 42 BROWSER_QA, 44 ADVERSARIAL_RUNTIME, 1 PROPERTY_TESTED, 34 SOURCE_INSPECTED, 1 DEFERRED_OUTSIDE_AEI and 0 AEI-owned pre-execution NOT_PROVEN. Criterion 98 is `DEFERRED_OUTSIDE_AEI` / NOT PROVEN. This docs-only closeout grants no wallet authority and does not assert live-chain or cryptographic proof. Next is **FINAL AEI MILESTONE INTEGRATION REVIEW** before canonical-branch integration; `DEPLOYMENT_GATED_BY_AUTH_AND_RATE_LIMIT` and deferred `makoto-wallet.zip` remain in force. Older statuses below are historical.

**Final-review addendum (2026-09-27):** [The independent AEI-G final adversarial review](aei-g-final-review-audit.md) passed after two failing-first scoped fixes. AEI-G is IMPLEMENTED / FINAL REVIEW PASSED / READY_TO_CLOSE, not COMPLETE; the Agent Execution Integration milestone remains OPEN pending separate closeout and integration review. Criterion 98 remains deferred/unproven; deployment stays gated by authentication and distributed rate limiting. Older design/implementation status below is historical.

**Implementation addendum (2026-09-27):** AEI-G is IMPLEMENTED / PENDING FINAL REVIEW on [the implementation audit](aei-g-implementation-audit.md), not COMPLETE. The 140 future gates below are now classified there, including Criterion 98 as deferred/unproven. One failing-first mixed Planner/legacy draft control defect received a scoped fail-closed fix. The milestone remains OPEN; Phase 13 is NOT STARTED and deployment remains gated by authentication and distributed rate limiting. The design status below records the original approved baseline.

**Status (2026-09-27): DESIGN APPROVED / NEXT / NOT STARTED.** Starting baseline: `phase12h-planner-strategy-integration` at `66e1a90322653b86fbd5a73c0c2cac1e74ecb20f`, clean worktree and index. AEI-A/B/B1/B2/C/D/E/F are COMPLETE / CLOSED. Phase 13 is NOT STARTED. This document formalizes future audit work; it reports no new runtime, test, browser, wallet, deployment, or criterion results. `DEPLOYMENT_GATED_BY_AUTH_AND_RATE_LIMIT` remains in force.

## Evidence and exact ownership

This contract follows [the milestone baseline](phase12h-planner-strategy-integration-design.md), the A/B/B1/B2/C/D/E/F design, implementation and final-review records, and the current `MakotoAgentPage` → `PlannerParameterConfirmControl` → `createProductionAgentFlow` → `createAeiDOrchestrator` → `integrateAeiDOperationalState` → `validateAeiEReviewEligibility` source. The F coordinator selects one root ACTION and creates only an inert Review. `ActionDraftCard` and existing wallet pages still exist in the same application; the audit must prove that a canonical Planner failure cannot route its artifacts into their execution-capable handoffs. Documentation is a claim to test against code, not a substitute for source or runtime evidence.

| Owner | Begins with | Ends at; authority it cannot grant |
| --- | --- | --- |
| User request / Planner prose | User text, classification, model output | Advisory intent; no authoritative account, parameters, quote or transaction |
| B1 | Validated retained request/session and canonical proposal | Structured unconfirmed proposal; no user authority |
| B2 | Native browser confirmation of the exact currently displayed proposal | Live application-level fixed-parameter evidence; no policy or transaction approval |
| AEI-B | Exact B2-backed evidence | Deterministic `executionEnabled:false` Strategy skeleton; no operational facts |
| AEI-A v2 | Retained request/plan/evidence/Strategy identities | Exact provenance binding; digest is not an authority token |
| AEI-C | Live-valid compilation and v2 binding | Semantic ACTION descriptors and graph; no read, quote or preparation |
| AEI-D | Exact C action, current host account/Arc chain and Phase 8 tools | Privately registered one-ACTION operational evidence, Phase 9 decision and unsigned preparation; `executionAuthority:FORBIDDEN` |
| AEI-E | Exact live D registration and retained source | Guarded Phase 12 `PLAN_READY → PREPARED`, historical sidecar and fresh eligibility validator; no submission |
| AEI-F | Live B2 through E, current generation and separate Review click | Frozen factual Review presentation; no final action, wallet client or durable capability |
| Future wallet transaction Review | Separately approved, freshly revalidated handoff | Explicit user transaction authority, still subject to wallet confirmation; absent today |
| Phase 10F | Actual execution attempt/submission evidence | Recovery and double-submission control; outside AEI A–G |

**Primary invariant:** Agent may understand intent, obtain parameter confirmation, compile, materialize, read, quote, apply deterministic policy, prepare unsigned data, map truthful state and present Review. It may not approve for the user, sign, submit, report receipt/completion, retry/resubmit or auto-execute a dependent ACTION. AEI-G owns cross-boundary adversarial audit, authority/provenance continuity, races, staleness, fallback/downgrade, regression consolidation and closeout-readiness evidence. It excludes wallet execution, signing, submission, receipts, recovery, UI redesign, auth/rate-limit implementation, deployment and Phase 13.

## Continuity and adversarial model

The exact chain is **request → B1 proposal → live B2 event → fixed-field evidence → AEI-B Strategy → AEI-A v2 binding → AEI-C materialization → eligible ACTION → host account/chain → AEI-D reads → quote → unsigned preparation → actual Phase 9 policy → AEI-E state/sidecar → fresh E eligibility → AEI-F Review**. At every boundary, retain and compare exact request/session, plan, proposal, evidence, Strategy/ACTION/goal, account/chain, materialization/D/E revision, quote/preparation/policy and technical-step identity. Never recover authority from UI labels, array position, action name, copied JSON, matching public digest, localStorage or historical state.

Attack each bypass independently: skip B1 or B2; supply manual Strategy, AEI-A v1 binding, loose C descriptor, fake D read/quote/preparation/policy, direct PREPARED reducer dispatch, restored E object, old Agent/wallet draft, old execution-capable Review or Surf prototype logic. Each must stop at its first authoritative boundary. Mutate an artifact, recompute **all** exposed digests, and confirm that live private B2/D/E registration and current host observation remain unavailable. Transplant every artifact from Strategy A to B and from ACTION A to B within one Strategy, including Xylo finite-approval versus swap technical step. Matching shape or digest must not transfer live authority.

For account and chain separately, switch before B2, after B2 before D, during D, after E and with Review open. For request and session, release A's late proposal, B2 callback, orchestration, state and Review after B is current. Cancel at each stage; unmount, remount, refresh and restore history. Only current generation and exact lineage may activate Review. Duplicate native confirmation, D orchestration, E mapping and Review-open, plus nested/reentrant callbacks, must not mint duplicate live authority. A same-account reconnect with an indistinguishable host observation is not independently detectable; record that host trust limit rather than claim cryptographic continuity.

Hostile public inputs include `null`, `undefined`, primitives, arrays, extra/symbol keys, accessor/throwing getter, Proxy, poisoned prototype, cycles where applicable, malformed IDs/digests and caller-rehashed records. Each exported boundary must return a typed rejection or guarded failure, without an uncontrolled crash. Bounded deterministic fuzz cases should permute canonical object key order, mutate each provenance link/revision and replay cross-Strategy, cross-ACTION and stale lineage; no live provider is needed.

## Time, TOCTOU and policy

Audit B1/provider proposal age where a contract specifies it, host account snapshot age, Phase 8 read freshness, quote expiry, preparation expiry, policy input lineage and E Review eligibility. A historical PREPARED state may remain unchanged while live authority expires. Use the current validator, not a stored `eligible` boolean. Recheck owner by interval: D owns read→quote, quote→preparation and preparation→Phase 9 policy consistency; E owns D→Phase 12 mapping and later E currentness; F owns fresh E validation at Review click and invalidation while Review is open. **Review→future wallet handoff has no implemented recheck** and remains Criterion 98's deferred boundary.

Phase 9 precedence must stay **BLOCK > REQUOTE > REVALIDATE > REQUIRE_REVIEW > WARN > ALLOW** through D, E and F. BLOCK/REQUOTE/REVALIDATE stop PREPARED progress; REQUIRE_REVIEW and WARN remain visible; ALLOW grants only possible later Review. B2 confirms parameters only. PREPARED is unsigned and unsubmitted, with no attempt ID, transaction hash, receipt, confirmation count or submission timestamp. A predecessor's PREPARED, review eligibility, WARN or ALLOW never satisfies an execution dependency. Quote output, minimum output, prepared amount, Planner amount and UI estimate never become verified onchain output.

Xylo USDC↔EURC finite approval must match exact input amount and canonical spender, remain a separate technical step/Review from swap, and neither step auto-submits or assumes prior confirmation. cirBTC Xylo Swap must stop at every relevant layer. Direct CCTP remains a typed handoff/unsupported Agent path; Circle App Kit canonical Agent PREPARE remains unsupported. Neither claims bridge start or destination completion; a source receipt does not prove destination arrival. Unknown or unestimated gas/fees remain explicitly unknown; a quote or preparation does not constitute current final simulation. No AEI copy may call a transaction “sent”, “completed”, “confirmed”, “approved”, “safe”, “verified” or “protected” without the respective evidence.

## Criterion 98 and future boundary

AEI-F criterion 98 remains **`DEFERRED_OUTSIDE_AEI_F` / intentionally unproven**. AEI-G may recommend AEI milestone closeout with this explicit deferred requirement **only if** no execution handoff exists, no runtime claims one, deployment stays gated, and the later handoff contract is carried forward. Closure then means the pre-execution AEI milestone passed; it is not approval to deploy or execute. Any future real handoff must freshly validate exact E result/currentness, prepared artifact and technical step, account, chain, quote and preparation freshness, final Phase 9 policy, current fee/gas and simulation evidence where required, then obtain a distinct explicit user transaction Review before wallet action. Wallet authority begins only after that Review. AEI-G must not mark these future checks implemented or tested.

## Production trust, persistence and route audit

Audit the AEI production import graph for `wallet.request`, `personal_sign`, `signMessage`, `signTypedData`, `sendTransaction`, `eth_sendTransaction`, `writeContract`, `useWriteContract`, receipt polling/`waitForTransactionReceipt`, retry, resubmit, replacement and automatic continuation. Distinguish pre-existing wallet components from reachability through the AEI Review. Audit legacy Agent draft, prepared draft, wallet draft, mock quote and demo transaction paths for any canonical failure fallback. `ActionDraftCard` is present on the same page, so mode separation and absence of artifact transfer require explicit evidence. Phase 10F alone owns attempt, replacement, ambiguous submission and double-send recovery.

Saved Phase 12 v2 or E composite records are history only. Restore cannot register B2, D, E or F live authority, invoke a transition, or reopen Review. Public digests provide integrity comparisons, not authenticity. B2's native-event and WeakMap checks provide application-level trust, not cryptographic user identity; D/E private registries trust their application host and truthful account observation. Same-origin script compromise can act within that host. Provider results and host observations are not independently cryptographically authenticated. Document these limits without implying that a UI click or local hash defeats a malicious host.

The `/api/planner-proposal` route is dynamic and no-store; it limits the request body to **8,192 bytes** before parsing and keeps OpenAI provider clients imported from server-only modules. Its session UUID is correlation, not account authentication. Source inspection currently shows **no server-side account authentication or distributed rate limiting**, leaving paid-provider abuse/cost exposure. AEI-G must inspect client bundle and payloads for provider keys, server secrets, privileged environment data and internal clients, and preserve `DEPLOYMENT_GATED_BY_AUTH_AND_RATE_LIMIT`; implementing those controls is post-AEI work. Do not print secrets in audit evidence.

## Browser, property and regression plan

Use deterministic, no-transaction browser fixtures for SEND and Xylo SWAP pre-execution happy paths; B2 cancel, keyboard confirmation, request replacement, account/chain switch, quote/preparation expiry, newer D orchestration, refresh/history, unsupported bridge/cirBTC, all six policy outcomes, duplicate confirmation and duplicate Review-open. Check visible warnings, disabled/stale controls, cancellation, focus where the current UI supports it, and mobile layout without redesign. No real wallet transaction, provider, model or RPC call.

AEI-G implementation runs these checks **sequentially** and records exact counts/failures: (1) G focused/adversarial; (2) F focused/browser/final; (3) E focused/browser/final; (4) D focused/browser/final; (5) C focused/browser/final; (6) B final; (7) B2; (8) B1; (9) A; (10) provenance; (11) Planner; (12) Strategy; (13) Phase 9; (14) Phase 10F; (15) Phase 12; (16) persistence/restore; (17) Agent/Tool Layer; (18) Agent UI; (19) full frontend; (20) typecheck; (21) lint; (22) isolated normal Turbopack build; (23) root contract compile; (24) `git diff --check`. Future audit evidence must distinguish browser QA, adversarial runtime, focused tests, source inspection and deferred/unproven guarantees.

## AEI-G acceptance matrix — future gates, not current results

Each numbered item requires recorded evidence and a pass/fail/deferred classification during implementation. Criterion 98 below remains explicitly deferred unless a separately approved real handoff exists.

| # | Required evidence | # | Required evidence |
| --- | --- | --- | --- |
| 1 | B1 canonical proposal | 2 | B2 canonical native confirmation |
| 3 | copied B2 lacks authority | 4 | B2 differs from transaction approval |
| 5 | stale B1 discarded | 6 | account switch revokes B2 |
| 7 | chain switch revokes B2 | 8 | AEI-B canonical compiler |
| 9 | compiled execution disabled | 10 | exact AEI-A v2 binding |
| 11 | v1 downgrade rejected | 12 | AEI-C canonical materialization |
| 13 | descriptor transplant rejected | 14 | key-order identity stable |
| 15 | AEI-D canonical orchestration | 16 | fake read rejected |
| 17 | fake quote rejected | 18 | quote freshness enforced |
| 19 | fake preparation rejected | 20 | actual Phase 9 evaluator required |
| 21 | BLOCK preserved | 22 | REQUOTE preserved |
| 23 | REVALIDATE preserved | 24 | REQUIRE_REVIEW preserved |
| 25 | WARN preserved | 26 | ALLOW is not approval |
| 27 | AEI-E canonical mapping | 28 | direct PREPARED mint rejected |
| 29 | restored PREPARED historical only | 30 | latest D orchestration enforced |
| 31 | AEI-F canonical composition | 32 | fresh E Review eligibility required |
| 33 | PREPARED alone insufficient | 34 | cached eligibility insufficient |
| 35 | Review inert | 36 | Review has no signer |
| 37 | Review has no wallet client | 38 | Review has no submit callback |
| 39 | Review immutable | 40 | older Review superseded |
| 41 | account switch invalidates Review | 42 | chain switch invalidates Review |
| 43 | quote expiry invalidates Review | 44 | preparation expiry invalidates Review |
| 45 | refresh restores no active Review | 46 | remount restores no authority |
| 47 | cancellation defeats late activation | 48 | stale request discarded |
| 49 | stale session discarded | 50 | duplicate B2 safe |
| 51 | duplicate Review-open safe | 52 | SEND facts truthful |
| 53 | SWAP facts truthful | 54 | finite approval exact |
| 55 | approval separately reviewed | 56 | swap separately reviewed |
| 57 | no approval auto-submit | 58 | no swap auto-submit |
| 59 | PREPARED predecessor not complete | 60 | ALLOW predecessor not complete |
| 61 | runtime output not inferred | 62 | cirBTC Swap rejected |
| 63 | Direct CCTP truthful stop | 64 | Circle App Kit truthful stop |
| 65 | source receipt not destination completion | 66 | unknown gas stays unknown |
| 67 | no guessed fee | 68 | no invented simulation |
| 69 | no legacy execution fallback | 70 | no mock quote authority |
| 71 | persistence history only | 72 | caller rehash lacks authority |
| 73 | cross-Strategy transplant fails | 74 | cross-ACTION transplant fails |
| 75 | cross-account transplant fails | 76 | cross-chain transplant fails |
| 77 | cross-session transplant fails | 78 | technical-step transplant fails |
| 79 | no AEI wallet signature | 80 | no AEI transaction submission |
| 81 | no AEI receipt polling | 82 | no AEI retry |
| 83 | no AEI resubmit | 84 | no Phase 10F duplication |
| 85 | no hash minted | 86 | no attempt minted |
| 87 | no receipt minted | 88 | no dependent auto-execution |
| 89 | no false success copy | 90 | no false safe/verified copy |
| 91 | server secrets absent from client | 92 | B1 request body bounded |
| 93 | auth deployment gate documented | 94 | distributed rate-limit gate documented |
| 95 | provider abuse exposure documented | 96 | host trust limits documented |
| 97 | same-origin/XSS limit documented | 98 | final handoff intentionally unproven/deferred |
| 99 | future handoff checks preserved | 100 | no UI redesign in G |
| 101 | `makoto-wallet.zip` reference retained | 102 | Phase 13 untouched |
| 103 | full regressions exact result | 104 | typecheck exact result |
| 105 | lint exact result | 106 | production build exact result |
| 107 | root compile exact result | 108 | diff check exact result |
| 109 | worktree clean after commits | 110 | index clean after commits |
| 111 | no push | 112 | no deployment |
| 113 | deployment gate remains | 114 | closeout-readiness decision evidenced |
| 115 | canonical integration sequence retained | 116 | post-AEI UI port sequence retained |
| 117 | auth/rate hardening before deploy | 118 | full QA before deploy |
| 119 | deploy before Phase 13 | 120 | execution remains forbidden |
| 121 | account switch before B2 safe | 122 | chain switch before B2 safe |
| 123 | switch between B2 and D safe | 124 | switch during D safe |
| 125 | switch after E safe | 126 | switch with Review open safe |
| 127 | late B1 result ignored | 128 | late D result ignored |
| 129 | late E result ignored | 130 | cancellation at every await safe |
| 131 | hostile getter/Proxy guarded | 132 | symbol/extra keys guarded |
| 133 | primitive/null/array guarded | 134 | poisoned prototype/cycle guarded |
| 135 | malformed IDs/digests guarded | 136 | duplicate D/E registration safe |
| 137 | nested callback safe | 138 | Review never durable capability |
| 139 | legacy draft isolation proven | 140 | no prototype Surf authority imported |

## Status decision and later sequence

Implementation may end as `AEI_G_IMPLEMENTED_PENDING_FINAL_REVIEW`, `AEI_G_BLOCKED`, or `AEI_G_IMPLEMENTED_WITH_EXPLICIT_DEFERRED_BOUNDARIES`. None means the whole AEI milestone is CLOSED. A material failed owned gate blocks readiness; criterion 98 can remain deferred only under the explicit no-handoff conditions above. After implementation: separate G adversarial final review → docs-only G closeout → final AEI milestone integration review → normal fast-forward/verified integration into canonical `phase7-astra-ledger-calm` if repository state permits, verify canonical SHA, never force-push → only then port the visual/UX from `makoto-wallet.zip`, retaining Makoto runtime/security/Agent authority → implement server-side authentication, distributed rate limiting and any separately approved final wallet-handoff hardening → full frontend/contracts/browser/accessibility/security QA → deploy `makotowallet.xyz` → Phase 13. This design performs none of those later actions.
