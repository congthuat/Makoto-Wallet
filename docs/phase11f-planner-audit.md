# Phase 11F — Planner end-to-end regression and robustness audit

Status: **PENDING REVIEW**. Assessment: **READY_TO_CLOSE** for the committed Phase 11 domain scope. Phase 11 remains **OPEN**. Audit base: `c0cce559fdb0a8830ed6d76cc35b1c7389d74ac4` on `phase11-intent-planner`, initially clean. No Phase 12 work, push, deployment, new live provider call, or live transaction occurred.

## Scope and observed reachability

Reviewed `PROJECT_STATE`, `ROADMAP`, ADR-019–023, the Phase 10G and Phase 9G audits, Phase 11 source, imports, routes, and tests. The end-to-end regression composes exported domain APIs with mocked providers; it does not add a production orchestrator. Source import search found no production caller composing 11B → 11C → 11D. The only Phase 11 HTTP endpoint is `/api/planner-classify`, disabled unless the exact server setting `PLANNER_CLASSIFIER_HTTP_ENABLED=true`; 11C, 11D, and 11E have no public endpoints. The existing Agent hook imports the separate legacy `lib/agent/planner.ts`, not the Phase 11 domain pipeline. No Phase 11 UI, Agent integration, Strategy conversion, or transaction execution caller exists. Domain implementation and production wiring are distinct; this audit claims no planner UX.

| Component | Contract and deterministic boundary | Assessment |
| --- | --- | --- |
| 11A intent schema | `validatePlannerIntent` admits only version-one, JSON-safe SEND, SWAP, or BRIDGE intents with supported canonical chain/asset/pair, decimal amount, and explicit nonzero recipient where required. It excludes execution artifacts. | Coherent; capability validity is not Phase 9 safety approval. |
| 11B classification | `classifyPlannerRequest` validates bounded raw text before provider use, then validates the untrusted category/status. INFORMATION, AMBIGUOUS, UNSUPPORTED, and invalid input do not proceed to 11C. A malformed provider result is `INVALID_PROVIDER_OUTPUT`; transport failure is `PROVIDER_UNAVAILABLE`. | Coherent; enabled HTTP route still needs the previously documented abuse-control decision before production exposure. |
| 11C goal plan | `generatePlannerPlan` requires canonical ACTION/STRATEGY classification and bounded text. `validatePlannerPlan` enforces version, exact fields, goal count/kinds, unique IDs and dependencies, known edges, no self edge/cycle, and explicit STRATEGY composition. INFORMATION and stopped classifications have no plan call. | Coherent; graph validity is not parameter or execution validity. |
| 11D parameter resolution | `resolvePlannerParameters` validates and freezes the 11C graph, requires exactly one draft per original goal ID, rejects extra fields, checks visible values against the request, canonicalizes only supported known values, and validates each final intent through unchanged 11A. Missing/dynamic values require clarification; invalid/unsupported values fail. | Coherent; cross-goal runtime amounts remain unresolved. |
| 11E semantic replanning | `evaluatePlannerReplan` validates input and original 11C plan, stops policy BLOCK and known/ambiguous submission before provider use, and validates any replacement with unchanged 11C plus original classification/goal ID/kind/count binding, changed dependencies, and a new plan ID. | Coherent; caller supplies changed-state impact, and proposals need later 11D and safety review. |

## Provider schemas and authority

Every OpenAI adapter sends one non-streaming, no-tools, non-stored Responses request. The key is read only from server-side `OPENAI_API_KEY` or an injected test option; the adapters return sanitized errors and never return raw headers, errors, or credentials. Source imports show no browser bundle importing these adapters. The classifier route has a strict, default-off server gate and bounded input. The schema rejects additional output properties, while deterministic validation remains authoritative after JSON parsing.

| Output path | Schema-enforced invariants | Deterministic-only invariants and failure behavior |
| --- | --- | --- |
| 11B classification | Nested status/category union and no extra fields; provider cannot emit local `INVALID_INPUT`. | Plain-object shape and canonical result validation; malformed output fails `INVALID_PROVIDER_OUTPUT`. Request length/locale validation precedes provider. |
| 11C plan | Version **exactly 1** after this audit fix, ACTION/STRATEGY and SEND/SWAP/BRIDGE enums, required fields, no extra fields. | Nonempty IDs, bounded/dense arrays, goal count, unique IDs/edges, known references, acyclicity, classification match, STRATEGY edge; invalid output fails `INVALID_PLAN`. |
| 11D parameters | Required nullable extraction fields and no extras; no graph or transaction fields. | Exact original ID set, finite string lengths, text grounding, dynamic/missing/contradictory handling, capability and 11A validation; malformed draft/transport is `PROVIDER_ERROR`, invalid parameters and clarification stay distinct. |
| 11E replacement | Reuses the corrected 11C plan schema. | Unchanged 11C graph validation and original ID/kind/count/classification binding, new plan ID and changed graph; invalid candidate is `UNSUPPORTED / INVALID_REPLACEMENT_PLAN`, transport failure `PROVIDER_ERROR`. |

The previous hostile live retest produced a candidate with `plan.version: UNSUPPORTED_VERSION`. Before 11F, the shared strict `PLAN_FORMAT` allowed any integer although the deterministic 11C contract required `1`. This was a **ROBUSTNESS_GAP**, not an accepted unsafe plan: 11C rejected it. Commit `8b1a428` constrains the representable invariant to `enum: [1]` in the single shared schema used by both 11C and 11E; unchanged deterministic validation still rejects invalid output if a provider violates its schema. Graph and semantic invariants remain deterministic-only because the static schema cannot express their binding to the input graph or all graph relations. No other directly established schema mismatch required a code change.

No path from model output to transaction authorization, policy approval, signing, wallet confirmation, receipt truth, retry permission, or resubmission was found. Phase 11 returns semantic data only. Phase 9 remains the transaction safety authority, Phase 10F owns transaction-attempt recovery, and the connected user wallet with explicit confirmation remains the final signing authority. A 10F `RETRY_ELIGIBLE`, Phase 9 `ALLOW`, or 11E `NO_REPLAN_REQUIRED` is not an execution command. Phase 11 neither constructs arbitrary calldata nor calls wallet writers, signers, Strategy execution, or transaction submission.

## Adversarial and integrated regression

Existing tests cover malformed and prompt-injected classification, unsupported and ambiguous goals, invalid plan shape/version/classification, duplicate/unknown/self/cyclic dependencies, hostile extra execution fields, changed/extra/missing goal IDs or kinds during replan, invalid or missing parameters, unsupported assets/routes, dynamic amounts, malformed addresses, provider failures, Phase 9 BLOCK, and submitted/ambiguous attempt deferral to Phase 10F. New `plannerEndToEnd.test.ts` composes mocked classification → plan generation → parameter resolution for INFORMATION, Send, Swap, Bridge, Swap → Send, ambiguity, unsupported goals, bounded replan, and submitted/ambiguous recovery stops. The adapter regression asserts the exact shared version-one schema and the unchanged 11C rejection if a mocked provider nevertheless returns version two. No production orchestration was introduced.

Existing local live evidence: 11B seven semantic cases, 11C four plan cases, 11D an accepted eight-case matrix, 11E one valid three-goal replacement and one hostile-goal fail-closed candidate. Earlier 11E attempts yielded an invalid candidate and a technical provider error. These bounded samples do not establish broad semantic accuracy. No new live call was necessary to classify the schema defect.

## Verification

| Check | Result |
| --- | --- |
| Focused Phase 11 planner tests, including new integration | 68/68 PASS |
| Agent `agent*.test.ts` | 247/247 PASS |
| Phase 10 `strategy*.test.ts` | 58/58 PASS |
| Phase 9 `policy*.test.ts` | 28/28 PASS |
| Selected Phase 8 tool schema/read/quote/prepare/integration tests | 52/52 PASS; overlaps Agent set |
| Full frontend `npm test` | 1401/1401 PASS |
| Frontend typecheck | PASS |
| Frontend lint | 0 errors; 7 inherited warnings |
| Frontend production build | PASS |
| Root contract compile | PASS; nothing to compile |
| Browser regression | Not run: no Phase 11 production UI path; existing transaction-free domain tests cover this phase |
| `git diff --check` | PASS |

## Limitations and acceptance

Unwired Phase 11 pipeline, absent planner UX/Agent/Strategy conversion, caller-asserted change impact, semantic equivalence beyond structural checks, unresolved dynamic or cross-goal amounts, and bounded rather than broad live-model QA are **NON_BLOCKING_LIMITATION** for the roadmap's semantic planner domain scope. The enabled classifier HTTP route requires a separate abuse-control approval before production exposure; it remains disabled by default. No funded/live transaction QA is required to assess this semantic-only phase. The corrected schema gap has regression coverage, all observed deterministic and cross-phase boundaries hold, and no unresolved blocker remains within committed Phase 11 domain scope. Assessment: **READY_TO_CLOSE**, pending user review; Phase 11 is not closed by this audit.

Roadmap's next major phase is **Phase 12 — Agent State Machine**, beginning with **12A — state definitions**. This is information only; Phase 12 has not started.
