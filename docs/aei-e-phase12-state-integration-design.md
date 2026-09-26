# AEI-E — Phase 12 State Integration

**Status:** DESIGN APPROVED / NEXT / NOT STARTED. This is a design contract, not implemented runtime behavior. AEI-A/B/B1/B2/C/D are COMPLETE / CLOSED. AEI-F/G and Phase 13 are NOT STARTED. Baseline: clean `12d895152ba52148e87738ef2d92123dd9d76d71` on `phase12h-planner-strategy-integration`.

## Decision and audited Phase 12 fit

AEI-E consumes a **live-valid, registered** AEI-D `OPERATIONAL_ONLY` envelope with the retained live B2/AEI-C input, the current Phase 12 session and a validated `PLAN_READY` state. It converts one selected ACTION's operational facts into a provenance-bound integration result. It may request only the legal Phase 12 `PLAN_READY → TRANSACTION/PREPARED` edge after its new canonical proof guard accepts. It does not execute an ACTION, transition a second edge, sign, submit, poll, recover, or drive the Agent UI.

Code audited: `agentState.ts`, `agentTransition.ts`, `agentTransactionBinding.ts`, `agentStatePersistence.ts`, `agentRecovery.ts`, `agentStatusPresentation.ts`, their focused tests, `strategyModel.ts`, `strategyStep.ts`, `strategyRecovery.ts`, AEI-C/D runtime and final audits. The older `phase12h-planner-strategy-integration-design.md` row suggesting AEI-D includes Phase 10B Review is historical; the closed AEI-D contract stops before wallet Review. Phase 12's `PLAN_READY → PREPARED` guard still unconditionally returns `MISSING_CANONICAL_STRATEGY_BINDING`. This design does **not** claim that edge now works.

Actual v2 `AgentState` kinds are `REQUESTED`, `PLAN_READY`, and `TRANSACTION`. Transaction statuses are `PREPARED`, `AWAITING_SIGNATURE`, `SUBMITTED`, `CONFIRMING`, `SUCCESS`, `REJECTED`, `EXPIRED`, and `FAILED`. `PREPARED` and `AWAITING_SIGNATURE` have a Strategy step, `SINGLE_CHAIN` or `SOURCE_CHAIN` scope and `AgentTransactionBinding`, **without attempt ID or submitted hash**. `SUBMITTED`/`CONFIRMING` add a 10F attempt and real submitted hash. `SUCCESS` additionally needs a receipt reference; `REJECTED`/`EXPIRED` carry a nullable attempt, and `FAILED` carries a submitted hash and nullable attempt. State validation is structural; `createPreparedAgentState` builds a descriptive `PREPARED` state from a Strategy step already bearing an exact `PREPARED_ACTION` reference, quote and preparation. It does not prove Planner origin or permit review.

The current reducer permits `REQUESTED → PLAN_READY`, `PREPARED → AWAITING_SIGNATURE`, `AWAITING_SIGNATURE → SUBMITTED`, `SUBMITTED → CONFIRMING`, and `CONFIRMING → SUCCESS`, plus guarded terminal `REJECTED`, `EXPIRED`, and `FAILED` edges. It denies `PLAN_READY → PREPARED` pending canonical binding. `PREPARED → AWAITING_SIGNATURE` separately calls Phase 10B and checks Phase 9 review policy and the same transaction binding. Later submitted/receipt edges require 10F/10C evidence. AEI-E extends **only** the denied entry edge with a new closed evidence variant and exact validation; it does not weaken the existing edges or add a direct `PREPARED → SUBMITTED` path.

`storeAgentState` persists only valid v2 state under an account/chain/session key; `restoreAgentState` returns `HISTORICAL`, `ABSENT` or `INVALID`. A restored label, attempt, hash or receipt never becomes current authority. `evaluateAgentRecovery` reports `FRESH_REVIEW_REQUIRED` for historical PREPARED and never auto-resubmits. `presentAgentStatus` deliberately refuses a caller-made current transaction result; a future AEI-F production caller must separately authenticate a live status surface. For CCTP, `SOURCE_CHAIN` confirmation never means destination completion. Phase 10F's `StrategyRecoveryRecord` owns attempt ID, ambiguous submission and duplicate-send safety; AEI-E must not create that record.

## Canonical input and validation

Proposed `AEIEInputV1` is a closed runtime tuple: `{ version: 1, operationalEnvelope, retainedLiveInput, currentState, selectedActionStepId, hostSessionId, observedAt }`. The host session ID, current v2 state and observation clock come from the approved application state owner, not model text, a caller-provided timestamp or a browser label. AEI-E first calls `validateAeiDOperationalEnvelope(operationalEnvelope, retainedLiveInput)`; matching JSON/digest is insufficient. It then checks D version/stage, forbidden execution flags, exact selected ACTION and goal, AEI-C request/session/plan/Strategy/v2-binding/evidence-set identities, materialization revision/digest, D revision/digest, current state session and plan ID, account/Arc chain, D typed outcome, policy/quote/preparation presence and each relevant expiry at the host clock. It rejects copied, stale, expired or caller-rehashed objects, legacy/wallet drafts, bare proposal, loose prepared data, loose policy decisions, hostile getters/proxies, unexpected fields and cross-Strategy/action/account/chain/revision reuse.

This check roots authority in D's private runtime registration and live host context. D already revalidates AEI-C/B2 and quote/preparation expiry for review-eligible outcomes. AEI-E must recheck immediately before its edge and before any later claim of current review eligibility. It must never cache the boolean as permanent authority. Historical snapshots may preserve the identity but cannot reconstitute registration. The host remains an application trust boundary, not cryptographic wallet ownership proof.

## Representation and legal state mapping

The existing state vocabulary has no `BLOCKED`, `REQUOTE`, `REVALIDATE`, `WARN`, `HANDOFF_REQUIRED` or operational-failure transaction status. Do not reinterpret `FAILED`, `EXPIRED` or `REJECTED`: those are guarded transaction lifecycle outcomes. AEI-E therefore defines a **versioned `Phase12OperationalStateBindingV1` sidecar**, not a second state machine. It records the exact v2 state ID when one exists; D envelope/revision, AEI-C materialization/Strategy/ACTION/goal, account/chain, quote/prepared/policy digests and expiries, warnings, review requirements, typed D outcome, currentness and `executionEnabled: false` / `executionAuthority: FORBIDDEN`. It has no signer, transaction hash, receipt, attempt or mutable execution capability. Its operational outcome is descriptive metadata under the same Phase 12 session; only an accepted reducer edge creates a new v2 transaction state.

| AEI-D outcome | Existing Phase 12 mapping | Sidecar/currentness and prohibited interpretation |
| --- | --- | --- |
| `ORCHESTRATED` with Phase 9 `ALLOW` or `WARN` | Eligible for guarded `PLAN_READY → PREPARED` only when D has a valid prepared artifact, exact per-step binding, no dependencies and no unmet blocker. | Preserve WARN and all review requirements. PREPARED is unsigned data; no user approval, signature or hash. |
| `REVIEW_REQUIRED` / policy `REQUIRE_REVIEW` | Same guarded PREPARED possibility; it is not `AWAITING_SIGNATURE`. | `REQUIRE_REVIEW` remains an explicit sidecar requirement. |
| `BLOCKED_BY_POLICY` / `BLOCK` | Remain at `PLAN_READY`; no transaction state. | Record blocked reason and policy provenance. No wallet review, retry or transaction failure. |
| `REQUOTE_REQUIRED` or `QUOTE_STALE` | Remain at `PLAN_READY`. | Old quote/preparation are historical; new D attempt required. No v2 `EXPIRED` terminal state, which belongs to a later 10F-proven pre-submission attempt. |
| `REVALIDATION_REQUIRED` | Remain at `PLAN_READY`. | Current account/read/preparation insufficient; acquire fresh D evidence. |
| `HANDOFF_REQUIRED`, `UNSUPPORTED_ACTION`, `UNSUPPORTED_ACCOUNT_CONTEXT`, `DEPENDENCY_BLOCKED` | Remain at `PLAN_READY`. | Typed stop with exact reason; BRIDGE never becomes `BRIDGING`, `CONFIRMING` or wallet-ready. |
| `READ_FAILED`, `QUOTE_FAILED`, `PREPARATION_FAILED` | Remain at `PLAN_READY`. | Operational failure, never v2 `FAILED` (a submitted transaction failure). |
| `PROVENANCE_MISMATCH`, `INVALID_MATERIALIZATION`, invalid D input | Reject the AEI-E request; do not create a new sidecar or state. | Existing historical state may remain displayable, never current authority. |

No new public AgentState status is introduced. A sidecar outcome can be `CURRENT` only while its exact D envelope remains live-valid and the current host session/account/chain/Strategy/action/revisions match. A `HISTORICAL` persisted sidecar is descriptive. `STALE` means a formerly live record failed freshness/context/current-policy matching; `INVALID` means schema/provenance failure and grants no state. These are sidecar currentness classifications, not new Phase 12 transaction statuses. A review-eligible label is a derived predicate, never a persisted permission: exact D `ORCHESTRATED`/`REVIEW_REQUIRED`, policy `ALLOW`/`WARN`/`REQUIRE_REVIEW`, live quote/preparation, matching context and binding, no `BLOCK`/`REQUOTE`/`REVALIDATE`/unresolved dependency, and a newly accepted PREPARED edge. B2 parameter confirmation is only intent evidence; it is not later transaction Review.

## Exact prepared entry proof and identity

Introduce one closed `AgentTransitionEvidence` variant for `PLAN_READY → PREPARED`, validated inside the existing reducer. It carries the live D envelope and retained live input, exact AEI-A v2/AEI-C lineage, selected ACTION/goal, a separately retained validated AEI-B Strategy skeleton, an immutable **prepared-step overlay** identity, and a proposed sidecar. The reducer must revalidate the D envelope itself, recompute the derived per-step `AgentTransactionBinding` through existing `bindAgentTransaction`, compare it to the proposed v2 PREPARED state, require `to.sessionId === D.materialization.sessionId === from.sessionId`, `from.plan.id === D.materialization.planId`, and enforce a fresh `stateId`. It must reject all other `PLAN_READY → PREPARED` evidence with the existing `MISSING_CANONICAL_STRATEGY_BINDING` denial. An additive integration wrapper returns the reducer's single accepted state together with the validated sidecar to its host; the reducer still owns the legal edge and neither component stores or advances a second state.

AEI-B's skeleton has no `preparedAction`, while `bindAgentTransaction` requires one. The overlay is a **new, versioned derived artifact**, not an in-place edit to the bound AEI-B skeleton. It retains the skeleton digest/revision and exact D operational revision; all pre-existing steps, IDs, semantics and dependency edges remain immutable. For the selected tool step it binds the D quote fingerprint, `PrepareResult` digest, tool, ordered `stepIndex`, account, chain, action and expiry, and validates the derived Strategy with `validateStrategy`. An exact content digest identifies the overlay; a changed quote, preparation, policy, account or materialization creates a different overlay and sidecar. It is not an attempted transaction and cannot carry a hash. A bare structural `preparedAction` or caller-built overlay cannot pass the D-rooted proof.

For a single SEND step, the overlay binds its original ACTION step ID to prepared index 0. For Xylo SWAP without approval, it binds the SWAP step to the swap index. Where D returns `[finite-approval, swap]`, the overlay must represent **two distinct technical steps** under one semantic ACTION: an exact derived APPROVE step bound to index 0, and the original SWAP step bound to index 1 with a confirmed-prior-step dependency. The technical ID is deterministically derived from the D revision and selected ACTION, collision-checked and bound to the original skeleton; it is not a new Planner goal. AEI-E may create a v2 PREPARED state only for the **currently eligible first step**. It cannot create a current swap state merely because both unsigned steps are present. A future independently verified approval receipt, fresh allowance/quote/preparation/policy and explicit review are required before a later swap step can become eligible. If the existing Strategy/10B validators cannot represent this overlay exactly, implementation must stop with a typed unsupported mapping, not flatten both steps or submit either. BRIDGE has no canonical Agent handoff and never enters this prepared edge.

The v2 PREPARED state binds `{sessionId, stateId, step:{strategyId,stepId}, scope, binding:{account,chainId,action,preparedAction:{tool,quoteFingerprint,stepIndex},quoteExpiresAt,preparationExpiresAt,handoffExpiresAt}}`. AEI-E additionally binds goal ID, original skeleton digest, materialization revision/digest, D envelope revision/digest, policy digest and warnings in the sidecar keyed by the exact state ID. **No attempt ID exists or is created at PREPARED. No hash or receipt exists.** An orchestration revision is never a 10F wallet attempt ID. Future attempt and submitted hash fields arise only at the existing post-review 10F/Phase 12 edges. Do not fabricate placeholder hashes.

## Currentness, persistence and restore

The sidecar is live only in a private runtime registration paired with the accepted v2 state and D envelope; its digest is identity, not authority. A caller may serialize a historical copy, but cannot rebuild registration from JSON. To preserve provenance across refresh without changing the v2 `AgentState` schema, persist a **historical-only** versioned composite `{ state, sidecar }` as one JSON value under an additive account/chain/session-scoped key. The sidecar records the exact state ID and no live capability, signer, provider client, quote object or private source. One storage write avoids a torn state/sidecar pair; the existing `makoto.agent.state.v2` key and `restoreAgentState` contract remain unchanged. Composite restore validates the closed state and sidecar schemas and their exact ID/context match, applies the existing historical-only recovery semantics, and returns only historical facts. It never returns `CURRENT` or calls the entry guard. This is an additive provenance record, not a parallel lifecycle engine or automatic migration. Existing v2 records without a sidecar remain historical, cannot be retroactively upgraded and cannot supply an AEI-E prepared proof. If a single composite record cannot preserve those guarantees, implementation must make an explicit version/migration decision before writing persistent integration data.

On refresh/remount, restored BLOCK/REQUOTE/REVALIDATE/WARN/REVIEW/HANDOFF facts may be displayed as **recorded history**. A restored PREPARED state means a past unsigned preparation existed; it does not reopen wallet Review. A switch from account A to B, disconnect/reconnect, chain change, quote/preparation expiry, policy change, or artifact mutation turns prior currentness stale; the prior record remains historical. New authority needs a fresh D invocation and a new state/sidecar identity. Do not overwrite a historical state under the same ID with a new prepared artifact. Persisted `SUCCESS` and CCTP source-only labels retain their existing historical-only meaning; AEI-E cannot infer destination arrival.

Existing Phase 12 presentation continues to show current transaction status unavailable without an authenticated production caller. AEI-E's live sidecar is an internal fact for future AEI-F, not a UI action control. AEI-F later composes the production request/review flow and separately invokes Phase 10B, the wallet and 10F/10C boundaries. AEI-E itself does no storage-triggered resume or automatic dependent-action progression.

## Threat tests and implementation gates

Implementation must first add failing tests for the denied entry edge and prove the new guard accepts only the exact live D chain. Test copies, rehashed states, wrong Strategy/ACTION/goal, plan/session, account/chain, AEI-C/D/overlay revisions, quote/prep/policy mutation, duplicate state IDs, expired evidence, switch during async validation, hostile getter/proxy/prototype/cycle and oversized bounded inputs. Test one legal edge at a time and all forbidden direct jumps. Browser refresh and account/chain switches must reduce live review eligibility to historical only. Do not treat a valid v2 structural state or a successful `storeAgentState` write as authority.

The following **80 acceptance criteria are future implementation gates, not tests run by this design**:

| # | Criterion | # | Criterion |
| --- | --- | --- | --- |
| 1 | Valid SEND D envelope maps truthfully. | 41 | New quote creates new lineage. |
| 2 | Valid SWAP D envelope maps truthfully. | 42 | Old quote state remains historical. |
| 3 | Direct CCTP handoff stays typed/non-executable. | 43 | No Planner rerun or provider inference. |
| 4 | Circle App Kit Agent PREPARE stays unsupported. | 44 | No identity from UI text/labels. |
| 5 | Exact Strategy ID/digest bind. | 45 | Multi-ACTION states stay distinct. |
| 6 | Exact ACTION/goal IDs bind. | 46 | Prepared predecessor is not completed. |
| 7 | Host account binds exactly. | 47 | ALLOW predecessor is not completed. |
| 8 | Arc chain binds exactly. | 48 | Runtime-output-dependent successor stays blocked. |
| 9 | AEI-C materialization digest/revision bind. | 49 | No automatic dependent progression. |
| 10 | D envelope digest/revision bind. | 50 | B2 confirmation is not transaction Review. |
| 11 | Prepared overlay/step index bind. | 51 | No wallet signature in E. |
| 12 | Phase 9 policy digest/decision bind. | 52 | No transaction submission in E. |
| 13 | BLOCK remains PLAN_READY plus blocked fact. | 53 | No receipt polling in E. |
| 14 | REQUOTE remains PLAN_READY plus stale fact. | 54 | No retry in E. |
| 15 | REVALIDATE remains PLAN_READY plus stale fact. | 55 | No resubmit in E. |
| 16 | REQUIRE_REVIEW remains explicit. | 56 | No 10F authority duplication. |
| 17 | WARN remains explicit. | 57 | No placeholder transaction hash. |
| 18 | ALLOW reaches only PREPARED eligibility. | 58 | Operational failure is not tx `FAILED`. |
| 19 | ALLOW does not grant user approval. | 59 | Approval prepared differs from submitted. |
| 20 | PREPARED is unsigned. | 60 | Swap prepared differs from submitted. |
| 21 | PREPARED is unsubmitted. | 61 | Bridge handoff never becomes confirming. |
| 22 | No pre-submit transaction hash. | 62 | Source receipt is not destination completion. |
| 23 | No pre-submit receipt. | 63 | AEI-F receives exact truthful facts. |
| 24 | Invalid/copy/rehashed D input rejects. | 64 | Persistence cannot recreate live authority. |
| 25 | Stale D input rejects. | 65 | Execution flags remain forbidden. |
| 26 | Expired quote removes review eligibility. | 66 | PLAN_READY→PREPARED requires exact new proof. |
| 27 | Expired preparation removes eligibility. | 67 | Old loose PLAN_READY→PREPARED remains denied. |
| 28 | Account switch invalidates currentness. | 68 | PREPARED→SUBMITTED direct edge denied. |
| 29 | Chain switch invalidates currentness. | 69 | PREPARED has no attempt ID. |
| 30 | Disconnect/reconnect invalidates currentness. | 70 | 10F alone creates wallet attempt identity. |
| 31 | Restored state is historical only. | 71 | Sidecar state ID matches exact v2 state. |
| 32 | Restore cannot recreate live authority. | 72 | Sidecar and state persist as one composite record or fail. |
| 33 | Caller-rehashed state cannot create authority. | 73 | Legacy v2 history cannot mint sidecar. |
| 34 | Cross-Strategy transplant rejects. | 74 | Wrong session/plan ID rejects. |
| 35 | Cross-ACTION/goal transplant rejects. | 75 | Wrong prepared index/spender rejects. |
| 36 | Cross-account transplant rejects. | 76 | Approval/swap order and receipt gate hold. |
| 37 | Cross-chain transplant rejects. | 77 | Unsupported overlay shape stops typed. |
| 38 | Cross-materialization/D revision rejects. | 78 | Hostile getter/proxy/prototype/cycle fail closed. |
| 39 | Policy mutation invalidates old state. | 79 | No production current status from plain object. |
| 40 | Preparation mutation invalidates old state. | 80 | No Phase 13 or UI integration scope leaks. |

## Ownership and deferred sequence

| Boundary | Owns | Excludes |
| --- | --- | --- |
| AEI-E | Exact live D → existing Phase 12 entry mapping; one guarded legal edge; operational provenance sidecar/currentness; historical persistence; internal review-eligibility truth. | Wallet, signature, submission, receipt polling, 10F recovery, full Agent conversation/UI, dependent-action auto execution. |
| AEI-F | Production Agent composition, explicit transaction Review and later wallet/10F/10C calls under existing gates. | Policy override, restoration as live authority, automatic dependent write. |
| AEI-G | Adversarial whole-path review and final integration readiness. | New execution authority by audit alone. |
| Phase 10F | Attempt identity, ambiguity, recovery and double-submission safety. | AEI-E's operational-state mapping. |

After AEI-E design, the sequence remains AEI-E implementation/review/closeout → AEI-F → AEI-G → final Agent Execution Integration review/closeout → canonical branch integration → port `makoto-wallet.zip` visual/UX while retaining Makoto runtime/security/state logic → resolve authentication and distributed rate limiting → full frontend/contracts/build/browser/accessibility QA → `makotowallet.xyz` deployment → Phase 13. `makoto-wallet.zip` supersedes older Surf references; no UI work belongs in E. **DEPLOYMENT_GATED_BY_AUTH_AND_RATE_LIMIT** remains unresolved for the paid Planner route.
