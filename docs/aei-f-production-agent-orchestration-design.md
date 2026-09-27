# AEI-F — Production Agent Orchestration

**Status:** DESIGN APPROVED / NEXT / NOT STARTED. Baseline: clean `bca5610919ebab80296dd6d704bc784345023587` on `phase12h-planner-strategy-integration`. AEI-A/B/B1/B2/C/D/E are COMPLETE / CLOSED; AEI-G and Phase 13 are NOT STARTED. This design changes no runtime, tests, UI or transaction authority.

## Decision and inspected production seam

AEI-F is a client-side production coordinator for one current Agent request and one eligible Strategy ACTION at a time. Its endpoint is a truthful, exact transaction Review presentation after a fresh AEI-E eligibility check. It never signs, submits, polls receipts, retries/resubmits or declares completion. The closed chain is user request → Phase 11 Planner/B1 proposal → B2 native parameter confirmation → fixed-field evidence → AEI-B compiler and AEI-A v2 binding → AEI-C semantic materialization → AEI-D operational orchestration → AEI-E Phase 12 mapping → fresh Review eligibility → Review presentation. Every stage uses its canonical owner; the coordinator's own labels, IDs and digest summaries are correlation, not authority.

The live page is `MakotoAgentPage`, which passes a wallet read snapshot and services to `useMakotoAgent`; `AgentWorkspace` renders the conversation. The hook's planner mode posts `{text, locale, sessionId}` to `/api/planner-proposal`. The server route calls `runPlannerProposal` with server-only provider adapters and bounded request parsing. The hook's `createAgentRequestGeneration` rejects stale proposal replies on new input, mode/session/account/chain/locale changes. `PlannerProposalCard` uses `PlannerParameterConfirmControl` to mint private, native-click B2 source authority, then creates evidence and calls `compilePlannerStrategy`, but currently discards the compilation after setting a confirmation label. No production caller invokes `materializePlannerStrategy`, `createAeiDOrchestrator`, `integrateAeiDOperationalState` or `validateAeiEReviewEligibility` from this flow. Planner mode currently starts in `legacy`; that legacy parser and draft handoff are not a substitute for the closed B1–E chain.

The existing `TransactionSafetyReview` is presentation with a caller-supplied `onContinue`; `SendFlow` and `RealSwapFlow` own their own review/revalidation and wallet execution. The older Agent draft handoff stores a route handoff and navigates to those flows. It carries neither AEI-E live authority nor a canonical prepared-step binding. AEI-F must not activate that legacy handoff for a canonical Planner ACTION or directly mount an existing executing flow as proof of AEI-E Review eligibility. A dedicated adapter may reuse presentational review components only while its callback stops before execution authority. The downstream final action must independently recheck AEI-E currentness, exact payload, current account/chain and final policy/fee/simulation at handoff time; if that guard is absent, keep the action unavailable and record it for AEI-G/deployment hardening. Merely opening Review never counts as user approval.

## Entry, ownership and lineage

The future `useProductionAgentFlow` (or an equivalently single owned client coordinator integrated into `useMakotoAgent`) is the sole B1→E caller. `MakotoAgentPage` supplies the current wallet read host and canonical Phase 8 services; the existing hook supplies the submitted text, `en`/`vi` locale, session ID and request-generation token. The route generates request/proposal IDs; the coordinator must accept them only through the current host-paired proposal. It retains the exact live B2 source, compilation, materialization, D envelope and E integration **in memory** while current. A minimal view record contains stage, generation, session/request/proposal/Strategy/ACTION IDs, D revision, selected E state/sidecar IDs and a pointer to those exact live objects. It is not a second authority registry or parallel Phase 12 state machine. A rendered chat string, localStorage entry or digest cannot rebuild the pointers.

The B2 control revokes its private source on unmount or on relevant proposal/host/active change. Current `PlannerProposalCard` cannot simply disappear after confirmation: the live B2 source must remain owned and mounted while AEI-C/D/E and later eligibility revalidate it. Implementation must preserve that actual source lifetime through Review, or stop and obtain a new confirmation; it must never snapshot/recreate source JSON. Editing request or fixed values, cancelling, a new request, mode/session/context change or unmount revokes current lineage, clears Review availability and leaves any saved history descriptive. Unresolved or runtime-derived parameters stop at clarification; a fixed replacement requires a new B1 proposal and native B2 confirmation. One B2 click cannot also activate transaction Review.

At every `await` and before every UI commit or Review open, compare the captured generation, session, locale, request/proposal ID and current host account/chain with the active lineage. After compilation also compare Strategy/v2 binding; after materialization compare its revision and selected ACTION; after D compare its revision/object; after E compare exact state/sidecar IDs and live result. A late A result after request B, cancellation, clear, remount or account/chain change is discarded, even if its internal operation completed. Abort pending network work where practical, but cancellation correctness rests on generation checks rather than abort success. A single-flight guard covers duplicate request submit, B2 confirmation and Review-open events; this is UI/request deduplication, not Phase 10F transaction double-submit control. A newer same-ACTION D envelope invalidates an open old Review without changing its displayed prepared payload in place.

## Canonical composition and ACTION eligibility

The coordinator uses the existing `/api/planner-proposal` route and host-paired B1 proposal. It renders the existing B2 native confirmation control, calls `createPlannerParameterEvidence` on the exact retained source, and requires `RESOLVED_WITH_EVIDENCE`. It calls `compilePlannerStrategy` and requires `COMPILED`, `executionEnabled: false` and exact AEI-A v2 binding. The AEI-C input has `version: 1`, that exact compilation, and a `bindingSource` carrying the same live source as `provenanceSource`, its request/session/plan/resolution, the compiler's Strategy and goal-step map, and the validated parameter evidence as `provenance`; no field is rebuilt from UI text. `materializePlannerStrategy` must return `MATERIALIZED`, `SEMANTIC_ONLY` and exact whole-Strategy/per-ACTION descriptors. AEI-F does not manually build Strategy, descriptors or evidence, infer intent from UI text, or use the legacy regex/Surf prototype parser. Rejections stop with a typed presentation result.

Eligible ACTION selection follows the validated Strategy dependency graph, not array position or the first unprocessed label. A predecessor's PREPARED, WARN, REQUIRE_REVIEW or policy ALLOW never proves completion. Before a dependent ACTION is considered, the existing Strategy continuation/receipt/recovery boundaries must provide a verified prior result; AEI-F cannot synthesize it. A dependency requiring the actual output of a predecessor remains unsupported until a separately approved value/provenance contract exists. Expected quote output, minimum output, prepared calldata and UI estimate are not a verified runtime value. AEI-D receives one selected eligible ACTION and the exact AEI-C envelope/live input; D owns current wallet-read account/Arc chain, reads, quote, freshness, unsigned preparation and Phase 9 policy. AEI-F never duplicates those validators or reuses a stopped D envelope.

The exact D result goes into `integrateAeiDOperationalState` with the matching Phase 12 `PLAN_READY` session/plan. Only AEI-E may request its private one-use reducer proof and create an authoritative PREPARED result. AEI-F does not dispatch `PLAN_READY → PREPARED`, construct a sidecar or promote saved history. D BLOCK/REQUOTE/REVALIDATE, dependency, handoff, unsupported and operational failures remain non-progressing PLAN_READY facts. REQUIRE_REVIEW and WARN reach the sidecar and Review display; ALLOW only permits a later fresh eligibility query. REQUOTE requires new D quote, preparation and policy; REVALIDATE requires fresh operational evidence. AEI-F may let the user start a new planning/orchestration attempt, which is distinct from transaction retry.

## Review presentation and downstream boundary

Immediately before opening an actionable Review, call `validateAeiEReviewEligibility` on the **exact registered E result**, and compare the active generation plus selected Strategy/ACTION, D revision, state ID and technical step again after its async return. A PREPARED label, saved sidecar, earlier true result or B2 confirmation is insufficient. Review's immutable input binds the live E result and D prepared artifact, account/chain, quote/preparation/policy revisions, technical step ID/index/kind and selected action. It displays actual asset, amount, recipient or route, quote/fingerprint/expiry, finite approval details when applicable, warnings, explicit policy Review requirements, and authoritative fee/gas facts; unknown gas stays unknown. Avoid ungrounded “safe,” “verified,” “guaranteed,” “sent” or “completed” claims. The payload is presentation data, not execution authority.

Check eligibility before opening Review, again before enabling a final Review action when the UI supports one, and once more at the immediate downstream handoff. A timer or relevant account/chain/orchestration change should visibly disable an open Review; the final boundary must still recheck independently because expiry or supersession can occur between renders. If any bound field changes, close/invalidate that Review and create a new one after fresh orchestration and explicit user Review; never swap details silently under the user's existing Review. A Review view can say “ready for Review” only while current; it cannot claim approval. AEI-F ends at Review presentation/validated handoff. Wallet approval/signing and submission remain separate, user-controlled downstream authority. No `wallet.request`, `personal_sign`, `signMessage`, `signTypedData`, `eth_sendTransaction`, `sendTransaction` or `writeContract` belongs in the AEI-F coordinator.

SEND follows B1/B2 → AEI-B/A → C → one D SEND cycle → E PREPARED → fresh eligibility → exact SEND Review. Xylo SWAP supports only USDC↔EURC. CirBTC Swap stays unsupported; a required approval is finite and exact. E prepares the approval as a distinct technical step at index 0 and records the swap at index 1 as dependent. Approval PREPARED is neither submitted nor confirmed; approval confirmation does not itself establish swap Review eligibility. The future swap step needs verified prior completion plus a fresh quote, allowance, preparation, policy, E state and separate Review. Unknown swap gas is not guessed. Direct CCTP remains `HANDOFF_REQUIRED` or unsupported in Agent; Circle App Kit's external wallet flow is separate and canonical Agent PREPARE is unsupported. A source-chain receipt never proves destination arrival.

## Truthful presentation and outcomes

Conversation stages are presentation only: planning, awaiting parameters, compiling, materializing, preparing, blocked, requote, revalidate, Review available, handoff and error. They do not become Phase 12 transaction states or authority. The coordinator maps canonical results to a small presentation union: `PLANNER_FAILED`, `PROPOSAL_REJECTED`, `CONFIRMATION_REQUIRED`, `CONFIRMATION_REVOKED`, `STRATEGY_REJECTED`, `MATERIALIZATION_FAILED`, `DEPENDENCY_BLOCKED`, `ORCHESTRATION_BLOCKED`, `REQUOTE_REQUIRED`, `REVALIDATION_REQUIRED`, `REVIEW_REQUIRED`, `WARNING`, `REVIEW_ELIGIBLE`, `HANDOFF_REQUIRED`, `UNSUPPORTED`, `OPERATIONAL_FAILED`, `STALE_RESULT`, `CANCELLED`. These are proposed UI outcomes, not new Phase 12 statuses. READ/QUOTE/PREPARATION/PROVENANCE failures are pre-execution; none is an onchain transaction failure. Show saved history as historical. There is no fake Tasks execution, background monitoring or simulated transaction success.

| Evidence or decision | Owner and authority |
| --- | --- |
| Planner/provider prose, Agent explanation, UI labels | Advisory/presentation only. |
| B1 proposal | Canonical provider-backed proposal boundary; unverified candidate fields. |
| B2 native confirmation | Exact fixed Planner parameter authority only. |
| AEI-B/A and AEI-C | Deterministic Strategy and semantic provenance, `executionEnabled: false`. |
| AEI-D | Current operational account/read/quote/preparation/Phase 9 evidence; no execution. |
| AEI-E | Truthful Phase 12 entry and fresh current Review eligibility. |
| Later transaction Review and wallet | Separate user decision and wallet signing authority. |
| Phase 10F/receipt boundaries | Submission ambiguity, recovery and verified transaction outcome. |

## Placement, ownership and deferred gates

Provider/model secrets and B1 calls remain server-side in `/api/planner-proposal`; client B2 interaction, wallet read identity, D/E live object registries and Review presentation remain in the trusted application runtime. The route's session UUID is correlation, not authentication. **DEPLOYMENT_GATED_BY_AUTH_AND_RATE_LIMIT** remains unresolved: server-side account authentication, distributed rate limiting and provider abuse controls are required before public deployment. No secret is copied into a browser orchestration object. The host and same-origin code are application trust boundaries, not cryptographic proof against a malicious host/XSS.

| Boundary | Owns | Excludes |
| --- | --- | --- |
| AEI-F | One production B1→E caller; async generation/cancellation; exact ACTION coordination; truthful Agent presentation; fresh E eligibility; exact Review presentation handoff. | Planner/model truth, B2 trust minting, Strategy/C/D/E validators, wallet execution, receipt lifecycle, transaction retry/resubmit. |
| AEI-G | Adversarial identity/race/replay/UI audit and final milestone review/closeout. | Redesigning AEI-F's approved boundaries or quietly adding unsupported routes. |
| Phase 10F | Attempt, ambiguous submission, retry/resubmit, replacement and duplicate-send recovery. | AEI-F's pre-execution planning/review presentation. |

AEI-F implementation may add the minimal current Agent UI wiring needed to reach this flow. It must not port the deferred `makoto-wallet.zip` visual/UX or its prototype execution logic. AEI-G later attacks the complete composition. After AEI-G and final milestone closeout: integrate the canonical development branch, port `makoto-wallet.zip` visuals while retaining Makoto runtime/security/Agent architecture, resolve auth and distributed rate limits, run full tests/build/browser/accessibility QA, deploy `makotowallet.xyz`, then begin Phase 13. AEI-G and Phase 13 remain NOT STARTED.

## Future implementation acceptance criteria

These are **design gates, not tests run**. A future AEI-F implementation must demonstrate at least the following 100 checks; no check asserts wallet submission authority for AEI-F.

| # | Criterion | # | Criterion |
| --- | --- | --- | --- |
| 1 | Production Agent entry invokes one coordinator. | 51 | B2 confirmation differs from transaction Review. |
| 2 | Existing B1 route is used. | 52 | Opening Review never grants consent. |
| 3 | No local regex/Surf Planner fallback. | 53 | AEI-F performs no wallet signature. |
| 4 | Request text/locale/session bind exactly. | 54 | AEI-F performs no transaction submission. |
| 5 | Route-generated request/proposal IDs are host-paired. | 55 | AEI-F performs no receipt polling. |
| 6 | Stale B1 response is discarded. | 56 | AEI-F performs no transaction retry/resubmit. |
| 7 | B2 required for fixed parameters. | 57 | No dependent ACTION auto execution. |
| 8 | Native B2 control is used. | 58 | SEND reaches truthful Review presentation. |
| 9 | Copied B2 source cannot progress. | 59 | Xylo SWAP reaches truthful first-step Review. |
| 10 | B2 source remains live through downstream validation. | 60 | CirBTC Swap remains unsupported. |
| 11 | B2 cancellation revokes. | 61 | Exact finite approval preserved. |
| 12 | Request edit revokes. | 62 | Approval technical step is distinct. |
| 13 | Confirmed field edit needs new proposal/confirmation. | 63 | Swap technical step is distinct. |
| 14 | New request revokes old lineage. | 64 | Approval never auto-submits. |
| 15 | Unresolved/dynamic fields block B/C/D. | 65 | Swap never auto-submits. |
| 16 | AEI-B compiler is canonical. | 66 | Direct CCTP handoff is truthful. |
| 17 | Compilation requires `COMPILED`. | 67 | Circle App Kit Agent PREPARE stays unsupported. |
| 18 | Compilation keeps execution disabled. | 68 | Source receipt is not destination completion. |
| 19 | Exact AEI-A v2/evidence required. | 69 | Unknown gas remains unknown. |
| 20 | Compiler rejection stops truthfully. | 70 | Fee estimates are not guaranteed fees. |
| 21 | AEI-C materializer is canonical. | 71 | Late Planner result cannot overwrite new request. |
| 22 | Whole C envelope is retained. | 72 | Late D result cannot activate old Review. |
| 23 | Per-ACTION descriptor matches C. | 73 | Late E result cannot activate old Review. |
| 24 | Dependency graph is exact. | 74 | Cancellation blocks late activation. |
| 25 | C stays `SEMANTIC_ONLY`. | 75 | Session change invalidates old flow. |
| 26 | ACTION selection follows graph/verified results. | 76 | Duplicate confirmation is single-flight. |
| 27 | Unresolved dependency stays blocked. | 77 | Duplicate Review open is single-flight. |
| 28 | Runtime-output dependency stays blocked. | 78 | No fake success language appears. |
| 29 | AEI-D orchestrator is canonical. | 79 | Operational failure is not tx failure. |
| 30 | D account context matches current host. | 80 | Restored history stays historical. |
| 31 | D Arc chain matches current host. | 81 | UI text never mints authority. |
| 32 | D quote lineage is exact. | 82 | Storage status never mints authority. |
| 33 | D quote freshness is exact. | 83 | Provider secrets remain server-side. |
| 34 | D preparation lineage is exact. | 84 | Auth/rate-limit deployment gate persists. |
| 35 | D policy lineage is exact. | 85 | AEI-G receives complete composition. |
| 36 | D BLOCK stops Review. | 86 | Phase 10F authority is not duplicated. |
| 37 | D REQUOTE stops Review. | 87 | No parallel state engine appears. |
| 38 | D REVALIDATE stops Review. | 88 | No Surf prototype logic is ported. |
| 39 | REQUIRE_REVIEW remains explicit. | 89 | `makoto-wallet.zip` port remains deferred. |
| 40 | WARN remains explicit. | 90 | Execution authority stays forbidden in AEI-F. |
| 41 | ALLOW reaches only possible Review. | 91 | Account switch during B1/B2/D/E invalidates. |
| 42 | AEI-E integration is canonical. | 92 | Chain switch during B1/B2/D/E invalidates. |
| 43 | Direct PREPARED mint is denied. | 93 | Disconnect during pipeline invalidates. |
| 44 | Fresh E validator runs at Review open. | 94 | Quote expiry during open Review disables action. |
| 45 | Cached validator result has no authority. | 95 | Preparation expiry during Review disables action. |
| 46 | PREPARED alone is insufficient. | 96 | Newer D revision invalidates open Review. |
| 47 | Restored PREPARED cannot open active Review. | 97 | Review payload never mutates in place. |
| 48 | Review binds exact technical step/prep/quote. | 98 | Final downstream handoff rechecks E. |
| 49 | Review binds exact account/chain/policy. | 99 | Missing final handoff guard keeps action unavailable. |
| 50 | Review binds exact D/E revisions. | 100 | Remount cannot revive live authority from JSON. |

Adversarial fixtures must also inject hostile callbacks/proxies, double-clicks, concurrent requests, unmount/remount, refresh and forged history; verify exact current-lineage presentation without live provider/model/RPC/wallet calls. The future implementation must run focused, browser, full frontend, typecheck, lint and isolated production-build gates and record exact counts. This design does not run them.
