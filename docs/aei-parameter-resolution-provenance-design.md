# AEI-B parameter-resolution provenance — design audit

**Status:** design only. AEI-B remains IMPLEMENTED / PENDING REVIEW / BLOCKED. AEI-C and Phase 13 are NOT STARTED. Baseline: `7d27487e70d8a9d96b98173e409c42a193a26538` on `phase12h-planner-strategy-integration`, clean worktree and index. No runtime fix or execution authority is supplied by this document.

**Current approved prerequisites:** **AEI-B1 — Production Planner Proposal Pipeline**, DESIGN APPROVED / NEXT / NOT STARTED, supplies the production proposal source; **AEI-B2 — Trusted Planner Proposal Confirmation Boundary**, DESIGN APPROVED / BLOCKED BY AEI-B1, confirms it. B2 was formalized at baseline `17a559e8dcb158c7827bf85db831a3086d1b03f1`; B1 is specified in [its separate design](aei-b1-production-planner-proposal-pipeline-design.md) at baseline `ab0c4348b34a34279eda5eee76d5053af3243188`. The earlier audit and implementation history below remains historical. The runtime still refuses caller-created fixed-origin evidence. AEI-B remains IMPLEMENTED / PENDING REVIEW / BLOCKED until both sources are implemented, verified and separately reviewed for closeout.

## Reproduced blocker and current lifecycle

The [AEI-B adversarial review](aei-b-review-audit.md) used a mocked 11D provider. For a Swap followed by “send 50% of actual output EURC” or “send the amount from the receipt in EURC”, 11D returned `RESOLVED` with downstream Send amount `10`; AEI-B returned `COMPILED`. This is the exact known reproduction, not a new live provider call. The 11D `dynamicAmount` pattern misses those expressions. Its `quoted(text, amount)` check searches the whole request, so the earlier Swap's `10` can support an invented downstream `10`. The global dynamic check can also flag unrelated goals. A decimal's validity and occurrence in the request do not prove its meaning for one goal.

Current flow: bounded original request text enters 11B classification, then 11C produces `PlannerPlan {version,id,classification,goals:[{id,kind,dependsOn}]}`. The plan has no parameters. 11D gives the original text and frozen plan to a provider that returns nullable string candidates by goal ID. Deterministic code checks shape, performs selected canonicalizations/defaults, tests some candidates against request-wide text, and runs 11A `validatePlannerIntent`. A `RESOLVED` result contains only `planId` and fixed `intents`. AEI-B checks plan/result and goal/intent identity, 11A support and graph shape, then hashes fixed intent tuples into a non-executable Strategy skeleton and AEI-A binding. AEI-A binds the resolved *values*, not how they were obtained. No request text or parameter evidence reaches AEI-B.

| Goal | Executable 11A fields | Current 11D source and transformation | Recorded after `RESOLVED` |
| --- | --- | --- | --- |
| SEND | `asset`, `amount`, `recipient`, `chainId` | Provider `asset`/`amount`/`recipient`/`chain`; single-goal asset may come from `assetAfterAmount`; asset/address canonicalized; null chain defaults to Arc. | Values only. |
| SWAP | `fromAsset`, `toAsset`, `amount`, `chainId` | Provider candidates; single-goal asset/target may come from text helpers; absent side may be uniquely inferred from the other supported asset; null chain defaults to Arc. | Values only. |
| BRIDGE | `asset`, `amount`, `recipient`, `sourceChainId`, `destinationChainId` | Provider candidates; absent asset defaults to USDC (single-goal text helper may supply it); null chains default to Arc and Base Sepolia; address/asset canonicalized. | Values only. |

The 11D draft schema has `goalId` and nullable `chain`, `asset`, `amount`, `recipient`, `fromAsset`, `toAsset`, `sourceChain`, `destinationChain`. It has no origin, confidence, dependency/source goal, expression kind, user evidence, or normalization proof. `PlannerParameterResult` has a status and, on failure, issue codes such as `DYNAMIC_AMOUNT`; successful intents have none of those fields. 11C `dependsOn` is an **order** edge, not a value dependency. No Planner sender/account, balance, quote, output or receipt field exists. 11A validates a fixed decimal, supported route and address; it does not validate natural-language provenance. The provider instruction forbids invention and dynamic-to-decimal conversion, but that instruction is not an authority boundary.

## Security invariant and scope decision

`RESOLVED` and a valid 11A intent never suffice for AEI-B compilation. Every executable intent field must have independently checked, exact-value provenance from an allowed fixed source. A provider's assertion of `USER_EXPLICIT` is merely another untrusted candidate. A dynamic expression must remain typed dynamic/unsupported, without a numeric fallback, even if a provider proposes a valid decimal. A source digest provides integrity against retained evidence; it cannot prove that a model interpreted free text correctly.

**Scope decision: keep this as a required AEI-B prerequisite, not a new roadmap phase.** It is necessary for AEI-B's existing “unresolved/dynamic values fail closed” acceptance gate. The work will extend 11D's result contract and provider boundary and add a compiler gate, but it does not change the closed Phase 11 historical milestone, introduce AEI-C, or expand the integration roadmap. Do the contract/validator work in a separately reviewable AEI-B implementation commit before closing AEI-B. Existing v1 `RESOLVED` output remains usable for historical Planner behavior but cannot pass the new AEI-B gate. This decision does not silently mark the present compiler safe.

## Closed origin taxonomy

The taxonomy describes *validated origin*, never authority to execute. `FIXED_USER_INPUT` means a fixed field was supplied through a separately retained, trusted structured user-input/confirmation event that names goal and field and exact canonical value. Current free-text extraction alone cannot produce this class. `DETERMINISTIC_DEFAULT` means a versioned repository rule derived the field from other already validated fixed fields or an exact capability constraint; record rule ID and input field references. The unique 11D Arc/route/opposite-asset defaults are candidates for this class after their inputs are proved. `DYNAMIC_EXPRESSION` means the field depends on another goal's actual output, percentage, receipt, balance, or other future observation; current Planner contracts do not evaluate it. `UNVERIFIED` covers provider-only values, ambiguous/unresolved values, unsupported forms, and malformed provenance. These four states are exhaustive in v1; an unknown origin is invalid.

| Origin | Producer after validation | AEI-B | Later runtime resolution | Authority |
| --- | --- | --- | --- | --- |
| `FIXED_USER_INPUT` | Trusted user-input/confirmation boundary plus deterministic validator | May compile exact fixed value | No for that semantic field | Semantic provenance only |
| `DETERMINISTIC_DEFAULT` | Repository rule, with verified inputs and rule version | May compile exact fixed value | No for that semantic field | Semantic provenance only |
| `DYNAMIC_EXPRESSION` | Validator classifies an expression; provider may propose class but cannot certify it | Reject/clarify | Would require a separately designed value-dependency contract | None |
| `UNVERIFIED` | Fail-closed validator result | Reject/clarify | Maybe new user input, not silent runtime substitution | None |

Wallet context, tool/quote outputs and prior-step receipts are not alternate fixed origins in this contract. A request for them is `DYNAMIC_EXPRESSION` or `UNVERIFIED` according to whether the dependency is expressible; future runtime evidence belongs to later boundaries. The 11C plan supplies goal kind and order only, so `PLAN_DERIVED` is not a value origin. No confidence score upgrades an origin.

## Proposed versioned JSON-safe contract

Introduce a v2 authoritative result alongside the v1 result, with a closed `ResolvedParameterEvidence` record for **each** executable 11A field, including defaults. Illustrative shape (exact TypeScript naming may be chosen in implementation):

```ts
type FixedEvidence = {
  version: 1;
  requestId: string; sessionId: string; requestDigest: Hex;
  planId: string; planDigest: Hex; goalId: string; parameterKey: string;
  state: "FIXED"; value: string | number;
  origin: "FIXED_USER_INPUT" | "DETERMINISTIC_DEFAULT";
  source: { kind: "USER_EVENT"; eventId: string; eventDigest: Hex }
        | { kind: "RULE"; ruleId: string; ruleVersion: 1; inputKeys: string[] };
  digest: Hex;
};
type NonfixedEvidence = {
  version: 1;
  requestId: string; sessionId: string; requestDigest: Hex;
  planId: string; planDigest: Hex; goalId: string; parameterKey: string;
  state: "NONFIXED"; origin: "DYNAMIC_EXPRESSION" | "UNVERIFIED";
  expressionClass: "PRIOR_GOAL_OUTPUT" | "PERCENT_OF_OUTPUT" |
    "RECEIPT_VALUE" | "WALLET_STATE" | "OTHER_DYNAMIC" | "UNKNOWN";
  sourceGoalId: string | null;
  digest: Hex;
};
```

Use a closed set of parameter keys by kind: SEND `asset,amount,recipient,chainId`; SWAP `fromAsset,toAsset,amount,chainId`; BRIDGE `asset,amount,recipient,sourceChainId,destinationChainId`. Fixed `value` must equal the corresponding canonical 11A intent field, including numeric chain IDs. A nonfixed record must have **no** `value` and prevents `RESOLVED_WITH_EVIDENCE`; it cannot coexist with a fallback fixed amount for the same field. The canonical result is `RESOLVED_WITH_EVIDENCE` only when every required field is fixed and evidence validates; otherwise it returns typed clarification/unsupported issues with nonfixed records and no compilable intent. Do not add evidence fields to the closed 11A `PlannerIntent` or v1 result in place. No signer, provider/RPC/wallet client, preparation, calldata, transaction or receipt object appears here.

The trusted caller assigns and retains `requestId`/`sessionId`, exact bounded request bytes and digest, plan, and any user event. Neither the provider nor display text assigns these identities. Compute `requestDigest` with a versioned, domain-separated keccak256 tuple of the exact validated request (`text`, `locale`) and request/session IDs. Bind `planDigest` using AEI-A's canonical 11C plan tuple (or an explicitly versioned equivalent), including goal kinds and dependencies. Compute each evidence digest over a fixed-order, domain-separated tuple of **all** declared fields, including value or expression class, origin, source, and goal/key; sort only designated sets. Recompute from separately retained authoritative inputs and reject different request, session, plan, goal, key, value, source event/rule, or digest. Do not use a digest as authentication: the creator and validator must have the trusted retained source. The AEI-A binding must eventually bind the complete validated evidence-set digest as well as its existing resolved-intent digest; otherwise a skeleton's values remain attributable only to an unproven v1 resolution.

The current request text must be retained by the trusted caller long enough to check its digest and bind it to the user event, subject to the application's retention policy. Its digest prevents substitution, but a raw-text match or regex cannot establish per-goal explicitness. The current 11D `quoted` and `dynamicAmount` checks may remain conservative hints for clarification; they cannot mint `FIXED_USER_INPUT`. Until a deterministic semantic parser with reviewed evidence rules exists, a user must supply/confirm the exact canonical fixed fields in structured input. A confirmation event must identify the presented goal, field and value and be captured by a trusted user interaction boundary; a provider cannot fabricate it. A generic “approve plan” label or model-produced claim is insufficient. If the original request asked for a dynamic amount and the user later chooses a fixed amount, treat that as an explicit request revision with new request identity and plan/resolution evidence; do not reinterpret the earlier request under its old digest.

## Provider, dynamic values and replanning

The provider may propose candidate values, source spans, or expression classes in a strict closed draft. It cannot set authoritative origin, user event, digest, or compilation status. Deterministic code snapshots plain data once, rejects symbols/extra fields/accessors/prototype anomalies/throwing proxies, validates the plan and per-goal schema, verifies source events and rule derivations against retained inputs, then emits the authoritative result. If an apparently fixed provider amount conflicts with a dynamic user event/expression, fail closed. In particular, “50% of actual output”, “all received EURC”, “amount from receipt”, and “whatever previous step returns” have no fixed decimal 11A representation; the current result is typed nonfixed/unsupported or clarification, never `amount: "10"`.

11E returns only semantic graph advice. `REPLAN_REQUIRED` changes plan ID and dependencies while retaining goal IDs/kinds; the changed `planDigest` invalidates *every* old evidence record, even for an unchanged-looking field. `RE_RESOLVE_PARAMETERS` and any new amount/recipient/asset/chain require new evidence evaluation against retained request/user events and current plan. No provenance is copied by goal ID alone. Cross-plan reuse fails closed; a fresh plan with equivalent values needs new evidence and a new AEI-A/AEI-B binding. Submitted-step identity and recovery stay with Phase 10F, never with 11E.

## AEI-B acceptance and regression design

AEI-B accepts only a complete v2 `RESOLVED_WITH_EVIDENCE` set in which every field is `FIXED_USER_INPUT` or `DETERMINISTIC_DEFAULT`, validates it against trusted retained request/plan/user-event sources, rechecks exact canonical values and allowed default rules, then compiles the same non-executable skeleton. The current v1 `RESOLVED` result must be rejected for integration. Wallet context, tool/quote values, previous output, percentages, receipt-derived amounts, missing and unsupported sources all defer/reject. A `COMPILED` result still grants no quote, policy, preparation, consent, signing, submission, receipt, retry, or state-transition authority.

Focused tests for the implementation prerequisite:

1. Structured user event for “Send 10 EURC” binds amount `10` to its goal and compiles; every other field also has valid evidence.
2. “Send 50% of actual output”, “all received EURC”, and “amount from receipt” remain nonfixed with no numeric fallback, even if provider supplies `10`.
3. Provider labels dynamic `10` as fixed or claims an unretained user event: reject.
4. Reuse evidence across request/session, plan, goal, or parameter key: reject each independently.
5. Mutate a value, default input, rule/version, user event, plan dependency, plan ID or request bytes after evidence creation: reject.
6. Replan with retained goal IDs/kinds but new graph: old evidence rejects; fresh evidence required.
7. Unknown provenance fields, symbol keys, malformed arrays/numbers/digests, getter/proxy exceptions and malformed runtime evidence: typed fail-closed result.
8. A valid deterministic Arc/route/opposite-asset default derives from proved inputs; an unsupported or nonunique rule rejects.
9. One missing/nonfixed field prevents the entire goal set from compiling; no partial Strategy or AEI-C behavior.

Implementation order recorded by the design: (1) specify trusted user event and canonical digest/closed schema; (2) implement descriptor-safe evidence validator and v2 11D result, with provider proposals remaining untrusted; (3) add request/plan/goal/key/value and replan regression tests; (4) make AEI-B and AEI-A binding require and digest the validated evidence; (5) rerun focused Planner, AEI-A and AEI-B tests and required integration checks, then review AEI-B closeout. The implementation below covers the bounded contract and checks; adversarial re-review remains pending. No migration of v1 evidence to v2 by inference is safe; historical results may be re-resolved only with retained authoritative request and user events. If those are unavailable, request new structured user input.

## Implemented AEI-B prerequisite contract

The scoped implementation adds `plannerParameterEvidence.ts`. Its v2 `RESOLVED_WITH_EVIDENCE` result contains every validated 11A intent field exactly once and a sorted, domain-separated evidence-set digest. Each fixed field records `FIXED_USER_INPUT`, exact canonical value, request/session/plan/goal/key identity, a retained `USER_EVENT` reference, and its own digest. The structured event carries exact request and plan digests as well as IDs and fields. Creation and validation use descriptor-safe snapshots and compare against separately retained request, plan, v1 resolution and structured event. A request with no structured event yields `UNVERIFIED` nonfixed records with no fixed fallback. A recognized 11D `DYNAMIC_AMOUNT` issue yields `DYNAMIC_EXPRESSION` nonfixed evidence. No `DETERMINISTIC_DEFAULT` rule is certified by this first implementation; a claimed rule origin is rejected.

`resolvePlannerParametersWithEvidence` is an opt-in 11D boundary. The existing 11D resolver/provider schema stays compatible for its prior non-executable Planner callers; provider proposals cannot add origin fields to its closed candidate schema. The v2 boundary never promotes a legacy `RESOLVED` result by itself. The trusted host must retain a real structured user-input event; no production Planner UI or host currently creates one. Therefore natural-language-only requests remain unverified for AEI-B, including apparently fixed “Send 10 EURC” text. Positive tests supply a separately retained **test fixture** event; they do not establish a production user-confirmation path.

AEI-B now requires input version 2, validated v2 field evidence, and the separately retained source. A legacy `RESOLVED` or `UNVERIFIED` result rejects with `MISSING_PARAMETER_EVIDENCE`; malformed or mismatched v2 evidence rejects with `INVALID_PARAMETER_EVIDENCE`. It still emits only the non-executable ACTION skeleton. AEI-A's v1 binding functions and tests remain intact. A new v2 binding adds `parameterEvidenceDigest` to a versioned binding digest over the v1 identities; it validates against separately retained field evidence and its source. A changed request, plan/replan, goal, key, value, origin, event, or digest cannot reuse the old evidence. This is integrity against retained inputs, not authentication of a caller or user action. No production caller or transaction authority was introduced.

**Adversarial re-review correction:** A caller could fabricate the structured event and all matching digests, then compile without a real user action. The public factory therefore no longer mints `FIXED_USER_INPUT` from any plain event; such input returns `UNVERIFIED` failure. Prior positive fixture compilation was structural only and is removed from current acceptance. AEI-B and AEI-A v2 have no positive fixed-origin production path until a separately reviewed trusted capture boundary exists. See `docs/aei-b-provenance-re-review-audit.md`. AEI-B remains pending review and is not ready to close.

## AEI-B2 — Trusted Planner Proposal Confirmation Boundary

**Decision and status:** DESIGN APPROVED / BLOCKED BY AEI-B1 / NOT STARTED. B1 first creates a real canonical production proposal; B2 then establishes: “I confirm these structured values represent what I intend.” It does not establish transaction approval, wallet consent, policy approval, execution readiness, submission or retry permission. This section is a design contract; no described model, capability, UI state or production wiring has been implemented by this formalization.

### Confirmed production gap and placement

At baseline `17a559e`, `AgentMessage` in `frontend/hooks/useMakotoAgent.ts` carries a legacy `AgentActionDraft` and optional preparation/quote/policy presentation. `AgentDraftContext` in `frontend/lib/agent/types.ts` binds account/chain only. Neither carries canonical Planner request/session/plan/goal identity or field provenance. `ActionDraftCard.prepare` in `frontend/components/MakotoAgentPage.tsx` selects or creates an `AgentActionHandoff`, stores it, and navigates to wallet review. `frontend/lib/agent/actions/types.ts` and `prepare.ts` define that separate handoff identity and parameter shape. It cannot be treated as a Planner confirmation source.

AEI-B1 adds the proposal-only application host and minimum wiring from retained Phase 11 inputs into a distinct Agent proposal state. B2 extends that state with exact visible review and explicit confirmation, using Ledger Calm styling and existing EN/VI conventions. Reuse presentation primitives, but keep the parameter-confirmation action separate from `ActionDraftCard`'s wallet Review behavior. Neither phase may synthesize a Planner plan from a wallet draft or send this lane through the existing quote/prepare/wallet handoff path. B2 cannot be accepted with a dormant component or test-only fixture: the proposal must come from B1's reachable production caller.

The B1 host assigns and retains request/session correlation when accepting user input, independently of provider output, and keeps the bounded accepted request text/locale and validated plan/resolution together. B2 receives the **same immutable B1 proposal and retained source**, without rebuilding it from UI labels or visible field text. The required path is:

`request ID → session ID → PlannerPlan ID/digest → goal ID → exact structured parameters → proposal/review surface → explicit user confirmation → field-level provenance evidence`

The request digest additionally binds the exact accepted request text and locale. IDs are mapped explicitly, never inferred from array position, display labels, UI order, action-name similarity or wallet draft state. Plan identity includes classification, goal kinds and dependency edges. B1 ends at the unconfirmed proposal in Agent UI; B2 ends at confirmed field evidence and may invoke only non-executable AEI-B compilation after confirmation. AEI-F retains full production execution orchestration.

### Canonical proposal/review model

Define a new versioned, closed-schema `PlannerProposalReview` data contract, separate from both `AgentActionDraft` and transaction review. Its v1 semantic content is JSON-safe and validated against separately retained host inputs. The following is the approved field model, not an implemented TypeScript API:

| Field | Required meaning |
| --- | --- |
| `version` | Literal `1`; unsupported versions fail closed. |
| `proposalId` | Host-assigned identity for one immutable review snapshot; any semantic revision creates a new proposal ID. |
| `requestId`, `sessionId`, `requestDigest` | Retained application request/session and exact request digest; provider-supplied identities cannot replace them. |
| `planId`, `planDigest` | Exact validated PlannerPlan identity and digest, including goal kinds and dependencies. |
| `goals` | Complete set of explicit `goalId`, `kind`, `dependsOn` and closed, kind-specific `parameters`; exactly one entry per retained plan goal. |
| `resolutionStatus`, `resolutionDigest` | B1's versioned field/issue/origin classification and digest, still untrusted as user intent; B2 must retain and revalidate them. |
| `proposalDigest` | Versioned, domain-separated digest over all declared semantic fields except the digest itself; recomputed from the immutable snapshot. This proves content consistency only. |
| `executionEnabled` | Literal `false`; neither proposal nor confirmation can enable execution. |

For every required parameter, the model distinguishes a canonical **fixed candidate** (`state: FIXED_CANDIDATE`, `value`) from an **unresolved** expression (`state: UNRESOLVED`, bounded `expression`, closed `expressionClass`). These are mutually exclusive closed variants; unresolved/dynamic records have no `value` or authoritative numeric fallback. Fixed candidates remain untrusted proposals until confirmation. Parameter keys are closed by goal kind and use existing Planner names; duplicate/missing goals or fields, extra properties, malformed IDs/digests, accessors, symbol fields, hostile proxies and non-JSON values fail closed before display or evidence creation. Reuse existing plan/intent bounds and descriptor-safe validation; the implementation must define the exact versioned expression-class enum and bounded serialization contract in its tests. Canonical decimal strings, asset IDs, address values and numeric chain IDs must match the retained intent exactly; display formatting cannot alter them. Proposal digest serialization must declare fixed field order, sort goal/dependency IDs and parameter keys by the existing bounded ASCII convention, and bind every field including parameter state/expression and `executionEnabled`.

The model contains only semantic review content and its provenance envelope. It contains no signer, wallet/RPC client, executable callback, prepared transaction, calldata, quote, receipt, policy approval, submission authority or runtime capability. An immutable copy supplies both the visible review and subsequent evidence input; a later provider result cannot update a displayed snapshot in place. A new request, session, plan, goal kind, dependency or parameter invalidates the active confirmation. Closing/replacing the proposal, changing session or clearing the conversation revokes its live capability. JSON persistence, if used for display, restores an unconfirmed proposal only.

### Exact visible parameter set

Confirm the complete parameter set for the displayed proposal, with evidence retained per goal/field. Each goal's kind and dependencies must be understandable in the review; the values below must be visible before the action is available. A hidden/defaulted field cannot gain evidence through another field's confirmation.

| Goal | Visible canonical fields and evidence keys |
| --- | --- |
| SEND | Asset (`asset`), full decimal amount (`amount`), full recipient (`recipient`), chain (`chainId`). |
| SWAP | Input token (`fromAsset`), output token (`toAsset`), input amount (`amount`), chain (`chainId`). Token-in/token-out labels must have an unambiguous mapping to these keys. |
| BRIDGE | Asset (`asset`), amount (`amount`), source chain (`sourceChainId`), destination chain (`destinationChainId`), recipient (`recipient`). Current 11A Bridge requires an explicit recipient, so it is always shown for this route. |

Show supported asset labels and unambiguous chain names/IDs corresponding to canonical values. Do not round amounts or truncate addresses in the confirmation surface. Use wrapping for mobile fit. The action should say “Confirm parameters” with an EN/VI explanation that it confirms intended values. Use a semantic button, visible labels, keyboard activation, accessible status/focus handling, and text for unconfirmed/confirmed/unsupported states. It must not be labeled Sign, Execute, Submit or Approve transaction, and must not open a wallet. Browser acceptance must exercise EN desktop around 1440px and VI mobile around 390px, including long values, keyboard access, no raw translation keys and no automatic submission; run the repository's scoped accessibility check where supported.

### Application trust and capability contract

Only the approved interaction boundary for the currently rendered immutable proposal may create a runtime confirmation capability. The host binds that capability to the exact request/session, request/plan/proposal digests, goal/field/canonical value set, and a versioned confirmation event ID. The evidence factory consumes or validates that private authority and emits serializable field evidence. A module-private identity registry, such as a WeakMap holding the retained snapshot, is an acceptable design mechanism. The capability must remain non-serializable and non-persisted, outside provider/RPC/API JSON, and unavailable through public mint functions accepting arbitrary data, shared exported Symbols, or production test helpers.

The browser implementation must verify a genuine native user activation on the approved current confirmation control and bind it to the snapshot actually presented. It must reject fabricated event shapes, synthetic dispatch/programmatic clicks and stale or unrelated events. A native `isTrusted` check may participate alongside control/handler ownership and retained proposal identity; accepting `{ isTrusted: true }` or an arbitrary caller-supplied Event is insufficient. Exact browser event/capability mechanics must be demonstrated in implementation and adversarial browser tests before acceptance; design approval alone supplies no trust.

No caller `trusted: true`, `FIXED_USER_INPUT` claim, JSON event, magic string, digest, frontend/environment secret or TypeScript brand alone authenticates origin. The capability may authorize only creation/revalidation of parameter provenance. A confirmation event cannot be reused to mint evidence for another proposal; retained evidence may validate only against its exact live authoritative source. Serializable evidence/digests are inert without that source, and deserialization cannot reconstruct authority. The existing descriptor-safe JSON snapshot boundaries will require an explicit, separate channel for runtime capability validation; copying a token into a JSON source and then checking its fields is forbidden.

**This protects the application authority boundary. It is not cryptographic proof against a fully compromised browser/XSS runtime.** It assumes trusted application code and browser event integrity. It makes no claim to prove that a person read every field, and provides no transaction consent.

### Dynamic parameters and request revisions

“50% of previous output”, “all received output”, receipt-derived amounts and other runtime dependencies remain unresolved/unsupported. Provider-supplied numeric previews cannot turn them into fixed candidates eligible for the ordinary confirmation path. Unknown or conflicting origin requires clarification. A plain fixed natural-language request such as “Send 10 EURC” may become a candidate proposal, but cannot mint evidence until the user explicitly confirms its exact complete structured set. Provider classification alone cannot erase retained dynamic semantics.

An explicit user edit replacing a dynamic expression with a fixed amount creates a **new structured user input**. The host records that replacement and allocates a new request identity/digest and proposal identity, rebuilds/revalidates parameter resolution, and updates plan identity/digest where goal semantics or graph change. An unchanged structural graph may retain its plan identity only when validated as unchanged; the new request/proposal binding still invalidates all old confirmation. The replacement must be displayed and confirmed anew. Do not rewrite the old request, mutate its evidence, carry a confirmation across a replan, or evaluate prior output/receipt expressions in AEI-B2.

### Integration and authority separation

The eventual positive path is `trusted Planner proposal confirmation → plannerParameterEvidence → FIXED_USER_INPUT field evidence → AEI-B deterministic compiler → non-executable Strategy skeleton`. Every execution-required field must match the retained request/session/plan/goal/value set and accepted confirmation event; one missing, dynamic or unverified field prevents compilation. AEI-A v2 must bind the digest of that exact accepted evidence set. The result remains `executionEnabled: false`. Successful implementation makes AEI-B eligible for renewed final review; it does not itself mark AEI-B complete or weaken the current gate.

Three separate authority boundaries remain explicit: parameter confirmation (“these values represent my intent”), later transaction review (“I reviewed this prepared transaction”), and later wallet signature (“I authorize this wallet transaction”). The current wallet Review click cannot stand in for parameter confirmation without a separately implemented canonical proposal display and capture path. Parameter confirmation grants neither Phase 9 approval nor wallet/signing consent.

AEI-B2 stops before AEI-C Strategy materialization, AEI-D tool/policy orchestration and AEI-E Phase 12 state integration. It adds no quote/preparation, wallet popup, signing, submission, receipt polling, retry/resubmission, automatic transaction execution or authoritative transaction-state transition. AEI-F later composes this proposal source with those separately approved boundaries. Direct CCTP Agent wallet handoff and dynamic output execution remain unsupported.

### Implementation acceptance criteria

All criteria below are requirements for the future implementation, not results of this documentation change.

1. A reachable production proposal path carries retained canonical request/session/plan/goal identity and exact request/plan/proposal digests end to end; no inference from wallet drafts or array/UI order.
2. The complete canonical semantic parameter set is visibly presented for every goal, including defaults, full amounts/recipients and both Bridge chains; no hidden field gains evidence.
3. Explicit user confirmation of the currently presented immutable proposal is required; merely rendering or generating it produces no evidence.
4. A caller fabricating all matching JSON fields, event shape, values and digests cannot mint trusted fixed evidence or compile.
5. A provider proposing matching fields/digests or self-certifying `FIXED_USER_INPUT` cannot mint capability/evidence; provider input remains untrusted.
6. An unconfirmed proposal and plain natural-language “Send 10 EURC” cannot compile.
7. A complete fixed proposal confirmed through the genuine production interaction can create field evidence and pass AEI-B with `executionEnabled: false`; AEI-A v2 binds exactly its accepted evidence-set digest.
8. Changing amount invalidates confirmation and requires a new proposal/confirmation.
9. Changing recipient invalidates confirmation and requires a new proposal/confirmation.
10. Changing asset or either Swap token invalidates confirmation and requires a new proposal/confirmation.
11. Changing chain, source chain or destination chain invalidates confirmation and requires a new proposal/confirmation.
12. Replanning, changing plan ID, goal kind or dependency invalidates old confirmation, even if displayed values otherwise match.
13. Dynamic percentage/output/receipt expressions cannot silently become fixed through a numeric provider preview; explicit fixed replacement has new request/proposal provenance and requires new confirmation.
14. Parameter confirmation opens no wallet and creates no wallet handoff.
15. Parameter confirmation does not quote, prepare a transaction or materialize Strategy.
16. Parameter confirmation grants no signing or submission authority.
17. Parameter confirmation supplies no policy approval and cannot bypass Phase 9 or later transaction review.
18. EN/VI labels, boundary explanations and status text are supported without raw translation keys.
19. Keyboard activation, visible labels/focus and accessible text status work; trust is never conveyed by color alone.
20. Mobile presentation preserves the complete values without horizontal overflow or truncation; bounded EN desktop/VI mobile browser QA is recorded.
21. Wrong request/session/goal/key/value, stale proposal, duplicate/missing evidence, malformed input, symbols, getters and hostile proxies fail closed.
22. Runtime capability cannot be created or restored through JSON, a digest, a public event factory or a test helper; synthetic clicks and stale/unrelated native events fail.
23. Proposal mutation while review is open, late provider replies, session changes and conversation clearing invalidate capture; evidence cannot transfer across revisions or restored history.
24. Focused unit and browser tests exercise both genuine confirmation and independent forgery attempts with mocked proposals, and an authority audit shows no new wallet, prepare, sign, submit, retry, receipt-polling or execution path from confirmation. A positive fixture alone is insufficient evidence of a production trust source.

AEI-B remains IMPLEMENTED / PENDING REVIEW / BLOCKED. AEI-B1 is DESIGN APPROVED / NEXT / NOT STARTED; AEI-B2 is DESIGN APPROVED / BLOCKED BY AEI-B1; AEI-C and Phase 13 are NOT STARTED. These design documents change no runtime authority; implementation and verification are future work.
