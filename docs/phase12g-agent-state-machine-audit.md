# Phase 12G — Agent State Machine robustness audit

**Status:** PENDING REVIEW / READY_TO_CLOSE. Phase 12 remains OPEN. Audit baseline: `9045777a0189f12df89c6fdc3ff053e7e3479b68` on `phase12-agent-state-machine`. The roadmap names Phase 12 **Agent State Machine**, its final sub-phase **12G robustness audit + closeout**, and the following heading **Phase 13 — Makoto MCP**. Phase 13 was not started.

## Scope and authority reviewed

- 12A state schema and canonical transaction binding: `agentState.ts`, `agentTransactionBinding.ts`.
- 12B/12D one-edge guards: `agentTransition.ts`; Phase 9 `policyEngine.ts` and Phase 10B `strategyStep.ts` review boundary.
- 12C account/chain/session persistence: `agentStatePersistence.ts`.
- 12E recovery: `agentRecovery.ts`, Phase 10C `strategyReceipt.ts`, Phase 10F `strategyRecovery.ts`.
- 12F presentation: `agentStatusPresentation.ts`, `AgentStatusSurface.tsx`, `MakotoAgentPage.tsx`, EN/VI dictionaries, the Agent workspace fixture and browser runner.
- Phase 11 `plannerPlan.ts` and `plannerIntent.ts`, their tests, relevant Phase 12 tests, ADR-019 through ADR-030, and the recent Phase 12 commits.

## State matrix — SATISFIED

| State | Required boundary and audit finding |
| --- | --- |
| REQUESTED | Closed v2 identity; descriptive only. |
| PLAN_READY | Structural plan reference; REQUESTED edge requires a validated Phase 11 generated plan. It is not executable. |
| PREPARED | Existing Strategy step, canonical quote/preparation, account/chain/action/artifact binding; fresh review still required. |
| AWAITING_SIGNATURE | Phase 10B/Phase 9 review accepted; explicit wallet confirmation remains outstanding. |
| SUBMITTED | Matching Phase 10F attempt ID and submitted hash; hash is not confirmation. |
| CONFIRMING | Matching submitted attempt and Phase 10C PENDING result; nonterminal. |
| SUCCESS | Matching Phase 10C CONFIRMED source receipt and Phase 10F identity through the guarded CONFIRMING edge. A receipt reference alone fails. |
| REJECTED | Matching pre-submission Phase 10F USER_REJECTED record; not an on-chain revert. |
| EXPIRED | Bound canonical artifact expiry, proven pre-submission failure, 10F agreement, and runtime `Date.now() > expiresAt`. |
| FAILED | Matching submitted attempt and Phase 10C REVERTED source receipt accepted by 10F. Pending/unknown cannot become FAILED. |

The validator requires plain data objects with exact declared fields, v2 identity, bounded IDs, references, and transaction binding. Arrays, accessors, extra fields, unsupported versions/statuses, and malformed nested data fail closed. This audit fixed throwing runtime objects escaping the exported validator; they now return `INVALID_RUNTIME`. The transition evaluator retains its existing `INVALID_EVIDENCE` result for that case. Structural validation is not external evidence authentication.

## Transition and identity audit — SATISFIED

The one-edge evaluator permits only REQUESTED→PLAN_READY, PREPARED→AWAITING_SIGNATURE, AWAITING_SIGNATURE→SUBMITTED, SUBMITTED→CONFIRMING, CONFIRMING→SUCCESS, AWAITING_SIGNATURE→REJECTED/EXPIRED, and SUBMITTED/CONFIRMING→FAILED under their respective guards. PLAN_READY→PREPARED is explicitly denied with `MISSING_CANONICAL_STRATEGY_BINDING`. Direct REQUESTED→transaction, PREPARED→SUBMITTED, AWAITING_SIGNATURE→SUCCESS, SUBMITTED→SUCCESS, terminal→in-flight, and receipt/hash-only success remain denied. No transition stores or advances another state.

Existing adversarial tests substitute session/state IDs, Strategy/step, action, account, chain, prepared reference, attempt ID, hash, scope, and receipt identity. They also build an internally valid alternate account/attempt/hash/receipt accepted by 10F for *that* transaction but denied against the original AgentState. The original bound expiry timestamps must match the supplied 10F artifact summary. No public clock injection exists; callers supplying `now` are rejected for terminal outcomes. At equality with expiry, EXPIRED is denied; only a later runtime clock observation permits it. Invalid/throwing clock observations fail closed.

## Persistence and recovery audit — SATISFIED

12C keys and envelopes independently bind account, chain, and session; delimiter-bearing session IDs remain distinct. Copied envelopes, corrupt JSON, unsupported/v1 data, storage faults, and serialization faults fail closed. Every accepted restore is `HISTORICAL`. Restored PREPARED and AWAITING_SIGNATURE cannot execute or open a wallet; SUBMITTED/CONFIRMING do not gain a fresh receipt; SUCCESS and other terminal labels do not grant retry.

12E describes REQUESTED, reports the missing plan binding for PLAN_READY, requires fresh review for PREPARED, and requires fresh review plus explicit user confirmation for AWAITING_SIGNATURE. An ambiguous submission stays unknown. A known hash requires a matching 10F submitted record and a separately supplied read-only 10C observation. PENDING remains nonterminal, UNAVAILABLE stays unknown, and CONFIRMED/REVERTED outcomes still require the existing legal edge; SUBMITTED cannot skip to SUCCESS. Terminal history never auto-resumes. This audit fixed an exported recovery-input gap: non-enumerable and symbol-keyed undeclared fields are now rejected, as are malformed wrappers. Recovery does not write state, sign, submit, poll, retry, or authenticate the external acquisition origin of a supplied observation.

## CCTP, UI, and production wiring — SATISFIED

For Direct CCTP, canonical 10C evidence covers the source transaction. Source confirmation or revert does not establish destination completion, arrival, or destination failure. 12B/12D and 12E reject destination-scope inference from that source evidence. 12C source states remain historical; 12F labels source status explicitly and never turns a restored label into current proof.

The production Makoto Agent action operation passes `UNAVAILABLE` to the Phase 12 status surface because its draft and existing user-controlled Review handoff have no canonical Phase 12 transaction binding. REQUESTED can be shown as current descriptive state; PLAN_READY can be shown as non-executable planning state. No transaction state can be presented as current through a caller-constructed guarded result. Historical states use recorded-status wording and no signer, submission, resume, or retry controls. PENDING, UNKNOWN, and UNAVAILABLE remain distinct. Labels and explanations are visible in EN/VI, with `role="status"`; color is not the only cue.

Production search found no PlannerPlan→Phase 10 Strategy conversion, request→Planner→Strategy→Phase 12 transaction pipeline, Phase 12 automatic progression, automatic wallet submission, Phase 12-owned polling, automatic retry/resubmission, signer, or recovery-to-execution caller. The existing Agent draft Review button remains a separate explicit user-controlled wallet flow. Phase 9 remains policy authority, Phase 10F remains submission/recovery and double-submission safety authority, and the connected user wallet remains final signing authority.

## Adversarial coverage and browser QA

The two new 12G tests reproduced the throwing-state-validator and hidden-recovery-field defects before the scoped fixes. Existing Phase 12 tests cover the state/transition matrix, coordinated and individual identity substitutions, expiry boundaries, persistence isolation/faults, recovery ambiguity and receipt identity, CCTP source scope, and historical UI presentation. The new fixes preserved the established transition rejection code. No model or live provider was called.

Bounded browser QA used the existing isolated Agent workspace fixture with `agent-browser`, not a live wallet. English desktop at 1440px and Vietnamese mobile at 390px showed transaction status unavailable, no status controls, and document widths equal to viewports. A separate 390px historical REQUESTED render showed the recorded-history prefix, explanatory text, and no controls. Screenshots were inspected. The scoped accessibility audit reported **0 violations** and **2 incomplete manual checks**; no broader browser coverage is claimed.

## Verification

Sequential checks: focused 12G **2/2 PASS**; all Phase 12 **54/54 PASS**; Phase 11 Planner **76/76 PASS**; Phase 10 Strategy/receipt/recovery **62/62 PASS**; relevant Phase 9 policy/safety **65/65 PASS**; Agent **301/301 PASS**; EN/VI UI fixture **21/21 PASS**; full frontend **1459/1459 PASS**. Typecheck PASS. Lint PASS with **0 errors and 7 inherited warnings** (none in the changed paths). Production build PASS. Root contract compile PASS (nothing to compile). `git diff --check` PASS. Contract compile was not concurrent with frontend tests.

## Classification and closeout readiness

- **SATISFIED:** The bounded 12A–12F domain, UI truthfulness, Phase 9/10/11 authority separation, scoped adversarial fixes, and required verification above. No remaining Phase 12G defect was found after the fixes.
- **NON-BLOCKING LIMITATION for this bounded audit:** Canonical PlannerPlan→Strategy binding and a production Phase 12 transaction caller remain absent. They are a **blocker to an end-to-end Agent transaction claim**, so no such claim or Phase 12 transaction status is made in production. ADR-024 expressly denies PLAN_READY→PREPARED without that binding, and ADR-030 expressly keeps the unbound Agent UI unavailable; this audit does not redefine those approved boundaries. External acquisition origin of supplied read-only receipt observations is not authenticated by pure 12E. Runtime wall-clock accuracy remains a host dependency. Structural destination states can be represented historically, but current destination completion has no Phase 12 guard or production caller.
- **BLOCKER to 12G review readiness:** None identified within the approved bounded scope. This is **ready for review**, not a Phase 12 closeout. Phase 12 remains OPEN; Phase 13 was not started.
