# AEI-C — Strategy materialization and provenance (design approved)

**Status:** DESIGN APPROVED / IMPLEMENTED / FINAL REVIEW PASSED / READY_TO_CLOSE, not COMPLETE. The pure artifact producer began at `612c3c69d665941fefbd00e8cea6aa4dda58a73e`; review evidence is in `aei-c-final-review-audit.md`. AEI-A, AEI-B1, AEI-B2 and AEI-B are COMPLETE / CLOSED. AEI-D/E/F/G and Phase 13 are NOT STARTED. The reviewed AEI-B input is a non-executable Phase 10 `Strategy` skeleton plus AEI-A v2 binding; `executionEnabled` is false.

## Decision and repository fit

**Materialization** means a pure conversion of an exact, live-provenance-validated AEI-B `COMPILED` result into canonical semantic ACTION descriptors. It preserves identity, intent, dependency and requirements for later acquisition. It does **not** mean Phase 8 `PrepareResult`, a `PreparedActionReference`, a Phase 10 prepared Strategy, or transaction readiness.

Use a single `StrategyMaterialization` envelope containing one `StrategyActionMaterialization` for each ACTION. This matches Phase 10's Strategy/step split: the envelope binds whole-Strategy order and all artifact digests, while each action carries its own goal/step identity. Neither the envelope nor an action can be detached and reused under a different Strategy. They are separate proposed v1 contracts; the current Phase 10 `Strategy` remains version 1 and is not mutated.

The existing roadmap phrase about AEI-C binding *later real quote/preparation references* described a downstream provenance need, not an existing AEI-C permission. Under this approved design, AEI-C emits only the semantic descriptor and explicit requirements. AEI-D later acquires reads/quotes, evaluates Phase 9 policy and coordinates preparation against that descriptor; any real quote/preparation reference requires its own checked downstream revision/fingerprint, account and chain binding and fresh review. The existing `PreparedActionReference` in `strategyModel.ts` is not an AEI-C output.

## Exact input and trust

Proposed closed `StrategyMaterializationInputV1` fields: `{ version: 1, compilation, bindingSource }` and no others. `compilation` is the exact AEI-B `StrategyCompilationResult` with `status: COMPILED`, `executionEnabled: false`, `strategy` and `binding` only. `binding` must be AEI-A v2 (`version: 2`, `digestVersion: 2`, `strategy.stage: SKELETON`), not v1. `bindingSource` is the exact source shape consumed by `validatePlannerStrategyBindingV2`: retained `requestId`, `sessionId`, validated `plan`, `resolution`, `strategy`, `goalSteps`, validated field `provenance`, and the live B2 `provenanceSource`. The separately retained B1 proposal/host source must match that live B2 source's request/session/plan/proposal identity. This is a runtime-only input: serializing it loses the live private B2 source and cannot authorize materialization.

The proposed pure validator must take a descriptor-safe, bounded snapshot of all plain data, retain the original live source reference for AEI-A v2 validation, revalidate the exact closed AEI-B result and Phase 10 Strategy, and call `validatePlannerStrategyBindingV2(binding, bindingSource)`. Re-run the pure `compilePlannerStrategy` on the retained request/session, `strategy.createdAt`, plan, v2 resolution and live source; require its canonical `COMPILED` result to equal the supplied result. This prevents a caller from presenting a different structurally valid skeleton with newly recomputed public digests. Compare the binding to the exact supplied skeleton, recompute plan/resolved-intent/Strategy/evidence digests using existing validators, and require one-to-one `goalSteps` with equal action kinds and dependency edges. A matching digest copied from another object is inert. A loose Strategy, B1-only proposal, legacy Agent/wallet draft, v1 binding or JSON-restored confirmation source fails. AEI-C must not add an alternate path that mints `FIXED_USER_INPUT`.

The binding's `strategy.digest` is the **exact skeleton content digest**, including Phase 10 step order and `createdAt`; `binding.digest` binds it to request/session, plan, resolved intents, mapping and evidence set. `Strategy.id` and ACTION IDs are semantic identities, not content revisions. A changed `createdAt` can retain IDs while changing the bound skeleton digest and therefore materialization revision.

## Proposed closed artifacts

The envelope has exactly these fields:

| Field | Meaning |
| --- | --- |
| `version: 1`, `stage: SEMANTIC_ONLY`, `executionEnabled: false` | No execution readiness. |
| `strategyId`, `strategyVersion: 1`, `strategyCreatedAt`, `strategyDigest` | Exact AEI-B skeleton identity/content, including the host-supplied creation time. |
| `bindingVersion: 2`, `binding`, `bindingDigest`, `parameterEvidenceDigest` | Checked copy of the exact AEI-A v2 binding and B2 evidence-set provenance. `binding.digest` must equal `bindingDigest`. |
| `requestId`, `sessionId`, `requestDigest`, `proposalId`, `proposalDigest`, `planId`, `planDigest` | Trusted B1/B2 request, proposal and Planner provenance from the live source and binding. |
| `revision` | Content-derived materialization revision ID defined below. |
| `actions` | One action artifact per Strategy ACTION, in original Strategy step order. |
| `digest` | Domain-separated digest of the complete envelope payload. |

Each `StrategyActionMaterialization` has exactly: `version: 1`, `stage: SEMANTIC_ONLY`, `executionEnabled: false`, `strategyId`, `strategyDigest`, `bindingDigest`, `revision`, `actionStepId`, `goalId`, `actionKind`, `dependsOnStepIds`, `parameters`, `requirements`, `digest`. The `goalId` is found through the exact v2 `goalSteps` mapping, never by array position or a display label. `dependsOnStepIds` are the actual Strategy edges and must equal mapped Planner goal edges. The artifact has no account field because no connected account is part of the closed AEI-B binding. `requirements` are immutable declarations of future work, not evidence that work occurred.

`parameters` is a closed discriminated union of the **validated v1 `PlannerIntent`** fields, with the same goal ID and exact decimal strings. Preserve the confirmed values verbatim after validator acceptance; do not insert defaults or transform meaning:

| `actionKind` | Semantic parameters | Fixed route and limits |
| --- | --- | --- |
| SEND | `chainId`, `asset`, `amount`, `recipient` | Arc Testnet, registered asset, positive precision-valid amount, explicit nonzero recipient. |
| SWAP | `chainId`, `fromAsset`, `toAsset`, `amount` | Arc Testnet Xylo-supported USDC↔EURC pair only; cirBTC is not a swap asset. No expected/minimum output. |
| BRIDGE | `sourceChainId`, `destinationChainId`, `asset`, `amount`, `recipient` | Arc Testnet USDC → Base Sepolia USDC semantic intent only. No claim of Direct CCTP Agent wallet handoff or destination completion. |

Each action declares ordered requirements `ACCOUNT_CONTEXT`, `LIVE_READ`, `QUOTE`, `POLICY_EVALUATION`, `PREPARATION`, `EXPLICIT_REVIEW`, `SUPPORTED_WALLET_HANDOFF`. These are unsatisfied requirements, not flags granting any capability. `SUPPORTED_WALLET_HANDOFF` is especially unresolved for Direct CCTP Agent BRIDGE. Quote-dependent slippage, expected/minimum output, route/fee/freshness, gas, allowance/finite approval, bridge metadata and transaction target/calldata are absent. Circle App Kit canonical Agent PREPARE remains unavailable; swap gas may remain unavailable until later tool evidence. Source-chain CCTP receipt does not establish destination completion.

No artifact may contain an account/wallet/provider/RPC client, signer, `preparedAction`, quote result/reference, policy decision (`ALLOW`, `WARN`, `REQUIRE_REVIEW`, `REVALIDATE`, `REQUOTE`, `BLOCK`), executable request/calldata, signed payload, hash, receipt, attempt, retry/resubmit capability or arbitrary extensions. A downstream requirement name never satisfies itself.

## Canonical identity, revision and determinism

All digests use full-length keccak256 over UTF-8 JSON of fixed-order, versioned, domain-separated tuples, following AEI-A/B conventions. This is local integrity, not authentication or consent. The implementation must define and test the exact tuples before use; proposed tuples are:

```text
revision = H(["makoto.strategy-materialization-revision", 1,
              binding.digest, binding.strategy.digest])
action.digest = H(["makoto.strategy-action-materialization", 1,
                   strategyId, strategyDigest, bindingDigest, revision,
                   actionStepId, goalId, actionKind, sorted(dependsOnStepIds),
                   canonicalIntentTuple(parameters), fixedRequirementsTuple])
envelope.digest = H(["makoto.strategy-materialization", 1,
                     strategyId, strategyVersion, strategyCreatedAt, strategyDigest,
                     bindingVersion, bindingDigest, parameterEvidenceDigest,
                     requestId, sessionId, requestDigest, proposalId,
                     proposalDigest, planId, planDigest, revision,
                     actionsInStrategyStepOrder.map(action.digest)])
```

`H` is `keccak256(stringToHex(JSON.stringify(tuple)))`. Reuse AEI-B's exact validated intent fields and stable tuple order; plain-object property insertion order never enters a tuple. Sort goal/dependency IDs by bounded ASCII/code-point order, but **retain Strategy step order** in the envelope because Phase 10 eligibility can use it. Do not add an ambient clock or generated timestamp. The same complete canonical input yields byte-identical artifacts. `createdAt` remains in the upstream Strategy content digest and thus changes this revision/digest when it changes; no second artifact timestamp exists.

`revision` is a content-derived identity, not a mutable counter. A changed semantic intent, evidence set, Strategy content/order, dependency, mapping or confirmation source requires revalidation and yields a different binding and/or revision/artifact digest; the old artifact is historical only. Even if a semantic Strategy ID is stable, an old artifact cannot be promoted under a new binding. Later quote/preparation changes belong to an AEI-D operational revision with its own checked references; AEI-C never overwrites a submitted step or claims a prepared revision. No implicit rematerialization fallback is approved.

For two goals, SWAP `g_a` then SEND `g_b`, the envelope retains two distinct ACTION artifacts and the exact edge from `g_b`'s ACTION to `g_a`'s ACTION. This edge means ordering only. An amount such as “all received”, a percentage of prior output, receipt-derived amount or remaining balance is unresolved upstream and cannot be manufactured here, even if a provider supplies a decimal. A fresh fixed replacement needs a new B1 proposal, B2 confirmation and AEI-B/v2 binding.

## Fail-closed outcome and validation

Proposed result: `{ status: "MATERIALIZED", executionEnabled: false, materialization }` or `{ status: "REJECTED", reason, path? }`. No partial artifact set, dropped goal or guessed fallback. Proposed stable rejection reasons: `INVALID_RUNTIME`, `INVALID_SCHEMA`, `UNSUPPORTED_VERSION`, `NON_EXECUTABLE_INVARIANT_FAILED`, `INVALID_STRATEGY`, `BINDING_MISMATCH`, `PROVENANCE_MISMATCH`, `MISSING_PARAMETER_EVIDENCE`, `INVALID_MAPPING`, `INVALID_DEPENDENCY`, `UNSUPPORTED_ACTION`, `UNSUPPORTED_CHAIN`, `UNSUPPORTED_ASSET`, `INCOMPLETE_PARAMETERS`, `IDENTITY_COLLISION`. Map errors from authoritative validators to these without hiding the failing path when available.

Take one bounded descriptor-safe snapshot before reading mutable caller data. Reject null/undefined/primitives, arrays where objects are required, extra/hidden/symbol fields, accessors/throwing getters, proxies/throwing traps, non-plain or poisoned prototypes, sparse/cyclic structures, huge nested inputs, malformed IDs/hashes/decimals/addresses, duplicate goals or ACTION IDs, missing/extra ACTIONs, invalid/unknown/cyclic dependencies and unsupported step/action/asset/chain. Reuse `validateStrategy`, `validatePlannerPlan`, `validatePlannerIntent`, the live-source evidence validator and `validatePlannerStrategyBindingV2`; do not duplicate their semantic rules or accept merely well-shaped hashes. Reject `executionEnabled: true`, any `preparedAction`, metadata/technical steps outside the AEI-B skeleton, any executable field, v1 binding, legacy drafts and unsupported dynamic values. Array order that is semantically meaningful remains checked; plain-object insertion order is inert.

## Ownership and AEI-C → AEI-D handoff

| Boundary | Owns | Does not own |
| --- | --- | --- |
| AEI-C | Pure semantic materialization, exact v2 provenance, deterministic revision/artifact-set identity, one-to-one goal/ACTION and dependency preservation, explicit unsatisfied requirements. | Reads, quotes, account acquisition, preparation, policy or execution. |
| AEI-D | Obtain and validate live account/chain/read/quote evidence, invoke Phase 9, coordinate later preparation/requote/revalidation for one eligible action, bind those operational artifacts to exact AEI-C revision and source identities. | Automatic wallet signing or submission; policy override. |
| AEI-E/F and existing Phase 10/12 | Guarded state lifecycle, production Agent composition, explicit review/wallet handoff, attempt/receipt/continuation under their own contracts. | Retrofitting execution authority into an AEI-C descriptor. |

AEI-D receives the whole validated envelope, selects an ACTION by exact step ID, and receives its semantic parameters, order edges, full request/plan/evidence/Strategy/binding lineage and unsatisfied requirements **without reconstructing provenance from UI text**. It must independently bind a live account and chain; no account may be inferred from a UI label, legacy draft, local storage or previous transaction. AEI-D must validate current tools and policy against this descriptor, not treat the descriptor as a quote or `PreparedActionReference`. The Planner route's **DEPLOYMENT_GATED_BY_AUTH_AND_RATE_LIMIT** classification remains unresolved; a session UUID is correlation, not account authentication.

## Fifty implementation acceptance criteria

These were implementation gates. The criterion-by-criterion review classification and exact test evidence are in `aei-c-final-review-audit.md`.

| # | Criterion | # | Criterion |
| --- | --- | --- | --- |
| 1 | Fixed SEND yields one semantic artifact. | 26 | Unsupported chain rejects. |
| 2 | Fixed SWAP yields one semantic artifact. | 27 | Missing parameter rejects. |
| 3 | Fixed BRIDGE yields one semantic artifact only. | 28 | Duplicate ACTION rejects. |
| 4 | Multi-goal keeps every action and edge. | 29 | Duplicate goal mapping rejects. |
| 5 | Exact Strategy ID retained. | 30 | Malformed/unknown/cyclic dependency rejects. |
| 6 | Exact Strategy content digest retained. | 31 | No quote acquired. |
| 7 | Exact AEI-A v2 binding revalidated. | 32 | No provider invoked. |
| 8 | Exact v2 binding digest retained. | 33 | No RPC invoked. |
| 9 | Exact ACTION ID retained. | 34 | No policy decision produced. |
| 10 | Exact Planner goal ID retained. | 35 | No transaction prepared. |
| 11 | Exact one-to-one goal/ACTION mapping. | 36 | No preparation calldata generated. |
| 12 | Exact canonical semantic fields retained. | 37 | No wallet client held/invoked. |
| 13 | Exact dependency graph retained. | 38 | No signer held/invoked. |
| 14 | Same input gives deterministic revision/digests. | 39 | No transaction submission. |
| 15 | Object key order does not change identity. | 40 | No retry/resubmit authority. |
| 16 | Changed amount changes provenance. | 41 | No silent account inference. |
| 17 | Changed recipient changes provenance. | 42 | Operational requirements explicit and unsatisfied. |
| 18 | Changed chain changes provenance. | 43 | Cross-Strategy artifact reuse rejects. |
| 19 | Changed edge changes provenance. | 44 | Legacy Agent draft rejects. |
| 20 | Changed Strategy content invalidates old artifact. | 45 | Legacy wallet draft rejects. |
| 21 | AEI-A v1 binding rejects. | 46 | Dynamic/runtime output remains unresolved. |
| 22 | Malformed v2 binding rejects. | 47 | Unsupported cirBTC swap/bridge rejects. |
| 23 | `executionEnabled: true` rejects. | 48 | Direct CCTP handoff limitation preserved. |
| 24 | Unsupported action rejects. | 49 | Circle App Kit PREPARE limitation preserved. |
| 25 | Unsupported asset rejects. | 50 | AEI-D can consume exact lineage without UI reconstruction. |

The later post-AEI-G “Bản thử nghiệm 1” Surf visual/UX port, full Agent Execution Integration review/closeout, canonical-branch integration, auth/rate-limit hardening, QA, deployment and Phase 13 remain in the existing roadmap sequence. This design does not start those tasks.
