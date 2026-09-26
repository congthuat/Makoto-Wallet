# AEI-B1 adversarial review before closeout

**Decision:** AEI-B1 is **PENDING REVIEW / READY_TO_CLOSE** for its proposal-only architecture. Public deployment is **DEPLOYMENT_GATED_BY_AUTH_AND_RATE_LIMIT**. AEI-B2 is NEXT / NOT STARTED; AEI-B remains BLOCKED BY B2; AEI-C and Phase 13 are NOT STARTED. Review baseline: clean `a58bccfe92359dddb8702c4756bcb1d2e6a9ccdc` on `phase12h-planner-strategy-integration`. Scoped runtime fix: `c03d850381ff9c4b0cb130e45b942ecfc02f0136`.

## What the proposal proves

The production `POST /api/planner-proposal` route creates a non-executable, unconfirmed proposal for one accepted request and browser session correlation ID. Server UUIDs and versioned digests bind exact accepted text/locale, the validated plan, goal IDs/kinds/dependencies, resolution classification and proposal identity. They do not authenticate a person, prove model interpretation, record user confirmation, authorize compilation, or grant transaction authority. Provider credentials remain inside server adapters. The Agent's legacy draft/Review path is separate.

## Findings and scoped fixes

1. **Provider-owned graph mutation:** 11C returned a validated reference to provider data. A resolver callback could change a dependency while 11D ran; the final proposal then described a graph different from the one resolved. A failing regression reproduced it. The coordinator now takes a descriptor-safe copy, revalidates it against the retained classification, freezes its graph and uses that same graph for 11D and proposal construction.
2. **Digest/order instability:** goal array order and object property insertion order changed proposal digests or caused valid requests to fail. A failing regression reproduced both. Goals/dependencies are now sorted by bounded ID; resolution/proposal hashes use explicit field tuples. Semantic field changes still change provenance. The validated proposal and all nested records are frozen.
3. **Uncaught hostile provider validation:** a proxy returned by a mocked classifier escaped validation as an exception. A failing regression reproduced it. The coordinator now maps thrown classifier, plan and resolver validation failures to typed non-proposal results.
4. **Live source and UI separation:** the Agent had not retained accepted locale with the proposal; a bare `proposal` property could render a canonical card. The host now retains a frozen text/locale/request/proposal source record, checks the pair before rendering, and refuses to display a legacy draft as a Planner proposal. Wallet binding changes remove the old live proposal; request generations, session changes, edits, mode changes and clear already invalidate pending replies. EN/VI cards now render localized parameter and unresolved-reason labels.
5. **Bounded request handling and dynamic phrase:** `Request.text()` read the complete body before the size check. The route now stops its stream at 8,192 UTF-8 bytes, in addition to Phase 11's 2,000-character text limit. “Previous transaction” is now treated as dynamic; a provider decimal cannot become a fixed candidate for it.

Phase 11D intentionally drops partial candidates on clarification. B1 shows all corresponding fields as unresolved and never restores a dropped decimal or default. Its request-wide dynamic check may conservatively mark another goal's amount unresolved. This reduces specificity but does not grant authority. There is no UI production caller for Phase 11E replanning; a fresh plan ID or changed graph creates new plan/proposal digests and requires a fresh request.

## Deployment abuse-control audit

The new route has no server-side account authentication, Origin/CSRF gate, or distributed rate limit. Browser wallet connection and the app lock are client-side state; the submitted session UUID is caller-controlled correlation data. `jar-activity` has an in-memory, `x-forwarded-for`-based throttle, but it is neither shared across instances nor applied to this route. No repository middleware or platform-level quota for the Planner route was found. With `OPENAI_API_KEY` configured, an arbitrary internet client could repeatedly call the three-stage paid provider pipeline. The bounded body and provider timeouts limit one request, not repeated cost. **Public deployment is blocked by both an authenticated/otherwise approved access boundary and a distributed cost/rate-control decision.** Those are deployment/infrastructure work, not a reason to grant B1 semantic authority or start B2. No new authentication system was invented in this review.

## 40-item acceptance evidence

| # | Review condition | Result and evidence |
| --- | --- | --- |
| 1 | SEND | PASS — `plannerProposalPipeline.test.ts` SEND case. |
| 2 | SWAP | PASS — SWAP case. |
| 3 | BRIDGE | PASS — BRIDGE case. |
| 4 | Multi-goal | PASS — STRATEGY case preserves two goal records. |
| 5 | Server request ID | PASS — route test observes server UUID; caller ID is rejected. |
| 6 | Server proposal ID | PASS — distinct server UUID; caller proposal ID is rejected. |
| 7 | Session binding | PASS — request/session digest and host-pair tests reject substitution. |
| 8 | Request digest | PASS — recomputed from accepted text/locale and request/session IDs. |
| 9 | Plan digest | PASS — Phase 11 plan digest, mutation/replan tests. |
| 10 | Proposal digest | PASS — canonical tuple/hash and meaningful-change tests. |
| 11 | Goal IDs | PASS — exact ID matching in 11D and proposal tests. |
| 12 | Dependencies | PASS — graph, reordering and mutation regression. |
| 13 | Provider candidate untrusted | PASS — `UNVERIFIED_PROVIDER`, never fixed-origin evidence. |
| 14 | Unresolved remains unresolved | PASS — partial-clarification regression. |
| 15 | Dynamic 50% | PASS — guessed decimal removed. |
| 16 | All received | PASS — guessed decimal removed. |
| 17 | Receipt-derived | PASS — guessed decimal removed. |
| 18 | No numeric fallback authority | PASS — dynamic and previous-transaction regressions. |
| 19 | Malformed classification | PASS — typed failure, including hostile proxy. |
| 20 | Malformed plan | PASS — typed failure and unsupported-version case. |
| 21 | Malformed resolver | PASS — typed failure, wrong goal and hostile proxy. |
| 22 | Request substitution | PASS — live host recomputes digest against retained text/locale. |
| 23 | Session substitution | PASS — host pair and live session checks. |
| 24 | Plan substitution | PASS — classification match, retained graph copy and plan digest; model semantic accuracy still needs human review. |
| 25 | Goal substitution | PASS — exact goal ID/kind coverage and closed validator. |
| 26 | Dependency substitution | PASS — 11C graph validation, copied graph and changed-digest regression. |
| 27 | Stale reply rejected | PASS — request-generation and session checks. |
| 28 | Old reply cannot overwrite new | PASS — A/B generation regression and hook invalidation. |
| 29 | Legacy draft separation | PASS — EN/VI fixture spoof case cannot render Planner card. |
| 30 | No automatic wallet handoff | PASS — proposal card has no action button; browser QA. |
| 31 | No Strategy | PASS — closed response schema and route JSON check. |
| 32 | No binding | PASS — closed response schema; no AEI-A caller. |
| 33 | No trusted evidence | PASS — `FIXED_USER_INPUT` absent; no B2 event factory call. |
| 34 | No wallet/signer | PASS — response schema and production-path source audit. |
| 35 | No provider secret | PASS — mocked secret absent from route response. |
| 36 | No Phase 9 authority | PASS — no policy call in B1 path. |
| 37 | No preparation | PASS — no preparation call in B1 path. |
| 38 | No execution | PASS — literal `executionEnabled: false`; no transaction path. |
| 39 | B2 identity inputs | PASS — proposal and frozen host source retain IDs, digests, graph, values/status and exact request text/locale; confirmation still absent. |
| 40 | Abuse classification | GATED — `DEPLOYMENT_GATED_BY_AUTH_AND_RATE_LIMIT`. |

## Verification

Sequential results: focused B1 review 24/24; Phase 11 Planner 58/58; provenance 8/8; AEI-B 9/9; AEI-A 15/15; Strategy 62/62; selected Phase 12 97/97; Agent 301/301; EN/VI fixture 31/31; full frontend 1517/1517. Typecheck PASS. Lint: 0 errors, 7 inherited warnings. Normal Turbopack build PASS from a clean source copy with local `npm ci` dependencies; the worktree's inherited `node_modules` junction still prevents an in-place Turbopack build. Root contract compile PASS (nothing to compile). `git diff --check` and staged diff check PASS. Built-route HTTP checks: GET 405, malformed POST 400, oversized POST 400. Deterministic browser QA passed at EN 1440px and VI 390px, with no horizontal overflow or handoff control and zero accessibility violations. All provider responses in tests were mocked. No live provider/model call, transaction, deployment or push occurred.
