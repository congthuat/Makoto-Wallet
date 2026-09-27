# AEI-F final adversarial review

**Decision:** IMPLEMENTED / FINAL REVIEW PASSED / READY_TO_CLOSE; **not COMPLETE**. AEI-G is NEXT / NOT STARTED; Phase 13 is NOT STARTED. Review baseline: clean `200e96d12373918384a61997b705d7341bb113ef` on `phase12h-planner-strategy-integration`. This review used local deterministic fixtures; it made no live provider, model, RPC or wallet call.

## Authority trace and adversarial result

`MakotoAgentPage` calls `useMakotoAgent`; Planner mode calls the server B1 `/api/planner-proposal` route. The response must match the request, session and locale, and a request generation and wallet binding check discards stale replies. The mounted proposal card alone renders the native B2 control. It now also binds the response to its originating Arc account and chain *at render time*. A changed account or chain disables B2 before the hook's passive invalidation effect runs. New input, locale, mode, session replacement, cancellation and unmount remove or revoke the live source. Copied B2 evidence cannot replace that private source.

The card owns one `createProductionAgentFlow`. B2 confirms parameters only. The coordinator retains the live B2 source, makes canonical evidence, compiles AEI-B with the AEI-A v2 binding and `executionEnabled:false`, materializes AEI-C from the exact compilation, chooses one independent ACTION, invokes AEI-D with the exact retained materialization, then maps the exact D envelope through AEI-E against the matching Phase 12 PLAN_READY session and plan. It never treats PREPARED, ALLOW, WARN or REQUIRE_REVIEW as verified predecessor completion. It does not substitute a quote, estimate or prepared amount for a verified runtime output. No dependent ACTION is automatically prepared or executed.

The coordinator compares its generation and live B2 source after asynchronous D and E returns. Cancellation increments the generation and clears retained D/E/Review references. Unmount calls cancellation; remount creates a new card and requires a new B2 click. A late result cannot publish to the current card. Duplicate B2 confirmation is single flight; duplicate Review opening is guarded by `opening` and an existing Review identity. Historical or restored PREPARED has no registered AEI-E authority. The Agent session and card key prevent an old result from becoming a new session's Review.

Review is a second explicit click. `openReview` calls `validateAeiEReviewEligibility` on the exact registered E object, then checks generation and exact D/E references before deriving Review. A cached true, status label, sidecar, copied E result or B2 confirmation cannot grant Review. D/E revalidation checks current wallet context, quote/preparation expiry, and latest same-ACTION D lineage. The open Review is revalidated every second; stale currentness closes it. It is not a perpetual execution capability. A new orchestration cannot silently replace the old frozen payload: it requires a new B2 lineage and Review. Account and chain changes also close the visible Review. The browser regression reproduced the original pre-B2 account-switch defect before the fix and passes for both account and chain after the fix.

`ReviewPresentation` is a closed-schema, frozen data object. It binds request/session, Strategy/ACTION/goal, account/Arc chain, Phase 12 state, materialization/D/quote/preparation/policy digests and revisions, quote fingerprint and expiry, technical step ID/index/kind, exact asset/amount/recipient or route, swap output/minimum, finite approval spender, warnings, requirements and fee text. The issuer compares E sidecar against D and prepared facts. Hostile null, getter, Proxy, copied label and callback-bearing structural inputs fail closed in focused tests. Transplanting a Review across Strategy, ACTION, account, chain, quote, preparation, policy or technical step cannot make it current: presentation carries no validator identity or execution authority, while E validates its exact registered object and current D envelope. Its `executionEnabled` field is always false; E's execution authority remains forbidden. The browser shows no final action button.

SEND reaches factual, inert Review with exact asset, amount, recipient, account, chain and prepared action. Xylo USDC↔EURC SWAP reaches an inert first-step Review with finite approval when required; approval and swap remain distinct steps, and no approval or swap is submitted. cirBTC Swap is rejected. Unknown swap gas remains unknown; SEND fee is labeled a maximum estimate. Direct CCTP stops at typed handoff/unsupported and has no active Agent transaction Review or bridge progress claim. Circle App Kit has no canonical Agent PREPARE/Review in this path.

| Review component | Wallet callback? | Execution capability? | Direct AEI-F use? | Finding |
| --- | --- | --- | --- | --- |
| `TransactionSafetyReview` | Required `onContinue` supplied by caller | Yes when caller executes | No | Unsuitable as an AEI-F authority adapter. |
| `SendFlow` | `submitReviewed` / wallet write | Yes | No | Separate wallet route. |
| `RealSwapFlow` | Approval and swap submission callbacks | Yes | No | Separate wallet route. |
| AEI-F `ReviewPresentation` view | None | None | Yes | Data only; zero buttons inside Review. |

Import-graph inspection followed `MakotoAgentPage`, `ActionDraftCard`, existing wallet flows, `aeiFProduction`, AEI-D and AEI-E. The older Agent draft route can navigate to wallet flows, but the canonical proposal branch returns the proposal card before `ActionDraftCard` and never passes it a draft or handoff. AEI-F Review imports or mounts neither execution-capable flow. There is no signer, wallet client, wallet request, write, submission, receipt poll, retry, resubmit or Phase 10F attempt in the coordinator or its Review. Presentation status and Agent prose are advisory. Server provider keys remain server-side; no secret is in the client Review. Phase 10F owns attempt, ambiguity, retry/resubmit and receipt authority.

## Defect and scope decision

**Fixed defect:** when the displayed wallet changed while an old production proposal card was mounted, B2 could remain offered until `useMakotoAgent`'s passive effect removed the proposal. The deterministic browser check failed first (`account switch before B2 revokes old proposal: true !== false`). The fix stores the B1 response's originating account/chain, discards a late B1 result if its binding changed, disables the old B2 control synchronously on a mismatched render, and cancels the old flow. Account and chain browser regressions pass. Fix commit: `8e351f7`.

**Criterion 98:** the approved [AEI-F design](aei-f-production-agent-orchestration-design.md) ends at validated, inert Review presentation. Its ownership table excludes wallet execution, and the design requires any later final action to recheck AEI-E at handoff. There is no final action to test. Criterion 98 remains **DEFERRED_OUTSIDE_AEI_F / not proven**; it is not reported as TESTED. Criterion 99 is met because the missing guard leaves the action unavailable. Any future real wallet handoff must freshly verify E currentness, exact prepared artifact, account, chain, quote/preparation freshness, final policy, fee/gas evidence where required, and simulation evidence where required immediately before wallet execution. This is a future integration requirement, not an AEI-F implementation claim.

**Remaining gate:** `DEPLOYMENT_GATED_BY_AUTH_AND_RATE_LIMIT`. Server-side account authentication and distributed rate limiting for the paid Planner route remain unresolved. `makoto-wallet.zip` remains the canonical deferred UI/UX reference. No UI port, push or deployment occurred.

## Verification

| Gate | Exact result |
| --- | --- |
| AEI-F adversarial focused tests | 3/3 pass; hostile source, Review schema, composition/import boundary |
| AEI-F plus B1/B2 focused tests | 34/34 pass |
| AEI-F deterministic browser | 28/28 pass, including failing-first account and added chain pre-B2 regressions |
| B1/B2 browser | 8 scenarios pass |
| AEI-B browser | 91/91 pass |
| AEI-C browser | 135/135 pass |
| AEI-D browser | 104/104 pass |
| AEI-E browser | 70/70 pass |
| Phase 12 focused | 28/28 pass |
| Persistence/restore focused | 24/24 pass |
| Phase 10F focused | 13/13 pass |
| Planner focused | 121/121 pass |
| Strategy focused | 66/66 pass |
| Phase 9 policy focused | 28/28 pass |
| Agent/Tool focused | 301/301 pass |
| Agent UI focused | 36/36 pass |
| Full frontend | 1538/1538 pass |
| Typecheck | Pass |
| Lint | 0 errors, 7 inherited unrelated warnings |
| Isolated offline Turbopack build | Pass; 10/10 static pages generated |
| Root contract compile | Pass; nothing to compile |
| Git diff check | Pass |

The 100 classifications below re-evaluate the original numbered design gates without changing their wording. `BROWSER_QA`, `ADVERSARIAL_RUNTIME`, `TESTED` and `SOURCE_INSPECTED` have the same bounded meanings as the implementation audit. Source inspection is not a claim that every permutation ran in a browser. Totals: **25 BROWSER_QA, 5 ADVERSARIAL_RUNTIME, 18 TESTED, 51 SOURCE_INSPECTED, 1 DEFERRED_OUTSIDE_AEI_F, 0 AEI-F-owned NOT_PROVEN**. Criteria 4, 6, 12, 30 and 92 also have new account/chain binding evidence; criterion 98 stays explicitly deferred.

| # | Classification | Evidence or limit |
| --- | --- | --- |
| 1 | SOURCE_INSPECTED | Live page supplies one coordinator to current Agent card. |
| 2 | SOURCE_INSPECTED | Existing `/api/planner-proposal` fetch. |
| 3 | SOURCE_INSPECTED | No parser in Planner path. |
| 4 | SOURCE_INSPECTED | B1 request/session/locale/generation and originating wallet binding. |
| 5 | TESTED | B1 proposal host-pair validator. |
| 6 | SOURCE_INSPECTED | B1 generation, locale, session and wallet binding rechecked after response. |
| 7 | BROWSER_QA | Confirmation before preparation. |
| 8 | BROWSER_QA | Native B2 control. |
| 9 | ADVERSARIAL_RUNTIME | Copied source rejected by B2/AEI-B tests. |
| 10 | BROWSER_QA | Control stays mounted through Review. |
| 11 | BROWSER_QA | Cancel revokes and closes Review. |
| 12 | SOURCE_INSPECTED | Composer edit removes proposal/card; wallet mismatch disables B2 at render. |
| 13 | SOURCE_INSPECTED | Confirmed fields have no editor; replacement is a new request. |
| 14 | BROWSER_QA | Remount/new request requires B2. |
| 15 | BROWSER_QA | Dynamic proposal has no B2 control. |
| 16 | SOURCE_INSPECTED | Canonical compiler called. |
| 17 | SOURCE_INSPECTED | Only COMPILED progresses. |
| 18 | TESTED | Compiler and coordinator require false. |
| 19 | TESTED | Compiler v2/evidence regressions. |
| 20 | SOURCE_INSPECTED | Rejection yields STRATEGY_REJECTED. |
| 21 | SOURCE_INSPECTED | Canonical materializer called. |
| 22 | SOURCE_INSPECTED | Whole C envelope passed into D. |
| 23 | TESTED | D validates selected action against C. |
| 24 | TESTED | AEI-C/D dependency validation. |
| 25 | TESTED | AEI-C remains semantic only. |
| 26 | SOURCE_INSPECTED | Only dependency-free root selected; no completion inferred. |
| 27 | TESTED | D rejects dependent action. |
| 28 | SOURCE_INSPECTED | No runtime output substitution or dependent progression. |
| 29 | BROWSER_QA | Production D read service observed. |
| 30 | BROWSER_QA | Account switch before B2 and after Review revokes; D checks host. |
| 31 | TESTED | D Arc account-context validation. |
| 32 | TESTED | D/E quote digest lineage. |
| 33 | BROWSER_QA | Expiry closes Review. |
| 34 | TESTED | D/E preparation lineage. |
| 35 | TESTED | D/E policy lineage. |
| 36 | TESTED | D/E BLOCK cannot mint PREPARED. |
| 37 | TESTED | D/E REQUOTE cannot mint PREPARED. |
| 38 | TESTED | D/E REVALIDATE cannot mint PREPARED. |
| 39 | SOURCE_INSPECTED | Review requirements are displayed. |
| 40 | BROWSER_QA | Swap warnings appear in Review. |
| 41 | SOURCE_INSPECTED | ALLOW only enables later Review click. |
| 42 | BROWSER_QA | Exact D result enters E in SEND/SWAP. |
| 43 | ADVERSARIAL_RUNTIME | Existing E reducer proof tests. |
| 44 | BROWSER_QA | Review button invokes fresh E validator. |
| 45 | SOURCE_INSPECTED | No cached eligibility boolean. |
| 46 | ADVERSARIAL_RUNTIME | Copied PREPARED unregistered in E. |
| 47 | ADVERSARIAL_RUNTIME | Restored PREPARED unregistered in E. |
| 48 | SOURCE_INSPECTED | Review issuer checks exact technical step/quote/prep. |
| 49 | SOURCE_INSPECTED | Review issuer checks account/chain/policy. |
| 50 | SOURCE_INSPECTED | Review binds D/E revisions. |
| 51 | BROWSER_QA | Separate buttons and Review only after B2. |
| 52 | SOURCE_INSPECTED | No consent or Phase 12 approval transition. |
| 53 | SOURCE_INSPECTED | No signing API. |
| 54 | SOURCE_INSPECTED | No submission API. |
| 55 | SOURCE_INSPECTED | No receipt polling. |
| 56 | SOURCE_INSPECTED | No retry/resubmit. |
| 57 | SOURCE_INSPECTED | Only one root D invocation. |
| 58 | BROWSER_QA | SEND factual inert Review. |
| 59 | BROWSER_QA | Xylo first-step inert Review. |
| 60 | SOURCE_INSPECTED | D rejects cirBTC swap. |
| 61 | BROWSER_QA | Exact 10 USDC finite approval first step. |
| 62 | TESTED | E overlay approval step distinct. |
| 63 | TESTED | E overlay swap step remains dependent. |
| 64 | SOURCE_INSPECTED | No approval callback. |
| 65 | SOURCE_INSPECTED | No swap callback. |
| 66 | BROWSER_QA | Direct CCTP stops before Review. |
| 67 | SOURCE_INSPECTED | D Circle App Kit Agent PREPARE unsupported. |
| 68 | SOURCE_INSPECTED | No bridge completion claim. |
| 69 | BROWSER_QA | Swap gas displayed unknown. |
| 70 | SOURCE_INSPECTED | SEND fee labeled maximum estimate. |
| 71 | SOURCE_INSPECTED | B1 generation discards late response. |
| 72 | BROWSER_QA | Held D read released after cancel; late result discarded. |
| 73 | SOURCE_INSPECTED | Generation and envelope checked after E. |
| 74 | BROWSER_QA | Cancel removes Review. |
| 75 | SOURCE_INSPECTED | Clear/session invalidates proposal and flow. |
| 76 | TESTED | B2 native single-flight/replay tests. |
| 77 | SOURCE_INSPECTED | `opening` guard prevents duplicate open. |
| 78 | SOURCE_INSPECTED | No success claim in production stages. |
| 79 | SOURCE_INSPECTED | OPERATIONAL_FAILED is preparation copy. |
| 80 | BROWSER_QA | Remount requires fresh B2. |
| 81 | SOURCE_INSPECTED | UI labels do not enter compiler/D/E. |
| 82 | ADVERSARIAL_RUNTIME | E rejects restored/copied state. |
| 83 | SOURCE_INSPECTED | Provider adapter remains in server route. |
| 84 | SOURCE_INSPECTED | Deployment gate retained. |
| 85 | SOURCE_INSPECTED | Composition and limitations documented for AEI-G. |
| 86 | SOURCE_INSPECTED | No Phase 10F caller in coordinator. |
| 87 | SOURCE_INSPECTED | One local coordinator, no new state engine. |
| 88 | SOURCE_INSPECTED | No Surf port. |
| 89 | SOURCE_INSPECTED | `makoto-wallet.zip` deferred. |
| 90 | SOURCE_INSPECTED | `executionEnabled:false`, no wallet capability. |
| 91 | BROWSER_QA | Account switch during D and open Review blocks/invalidates. |
| 92 | SOURCE_INSPECTED | Chain mismatch blocks B2 at render; browser regression passes. |
| 93 | SOURCE_INSPECTED | Disconnect clears proposal and D currentness. |
| 94 | BROWSER_QA | Open Review closes on expiry. |
| 95 | BROWSER_QA | Same finite expiry check covers preparation. |
| 96 | TESTED | E validator rejects newer D registration; timer invokes it. |
| 97 | SOURCE_INSPECTED | Frozen Review payload; stale view closes. |
| 98 | DEFERRED_OUTSIDE_AEI_F | No final wallet handoff exists; future action requires fresh E and final policy/fee/simulation checks. |
| 99 | SOURCE_INSPECTED | No final action or executing callback is available. |
| 100 | BROWSER_QA | Remount presents fresh B2, no JSON authority. |
