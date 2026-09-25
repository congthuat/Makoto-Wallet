# AEI-B parameter-resolution provenance — design audit

**Status:** design only. AEI-B remains IMPLEMENTED / PENDING REVIEW / BLOCKED. AEI-C and Phase 13 are NOT STARTED. Baseline: `7d27487e70d8a9d96b98173e409c42a193a26538` on `phase12h-planner-strategy-integration`, clean worktree and index. No runtime fix or execution authority is supplied by this document.

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
