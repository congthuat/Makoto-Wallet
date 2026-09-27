# AEI-F production Agent orchestration — implementation audit

Status: **IMPLEMENTED / PENDING REVIEW, not COMPLETE.** Starting HEAD `0102574947a45a3e8ffd7ea111a524d713ca9a58`, branch `phase12h-planner-strategy-integration`.

## Production path and authority

`MakotoAgentPage` remains the entry. `useMakotoAgent` posts Planner mode requests to the existing `/api/planner-proposal` B1 route and pairs accepted proposal IDs with the exact request, locale and session. It rejects stale replies with a generation counter; duplicate in-flight submits for the same text/session are ignored. Account, chain, locale, mode, new input, new request and clear invalidate the current proposal. The route and model remain server-side. The missing server authentication and distributed rate limit remain a deployment gate.

The mounted `PlannerProposalCard` owns one `createProductionAgentFlow` instance. Its native `PlannerParameterConfirmControl` stays mounted after confirmation; it hides its button but retains the private live B2 source until cancellation, replacement, context change or unmount. The coordinator retains that exact source, creates fixed-field evidence, calls the AEI-B compiler with `executionEnabled:false` and AEI-A v2 binding, and passes the exact compilation/source to AEI-C. It selects one dependency-free ACTION from the materialized graph. Preparation, policy ALLOW, WARN and REQUIRE_REVIEW never count as predecessor completion. A runtime-output-dependent successor remains blocked. No successor is automatically run.

For that ACTION, AEI-D owns all read, quote, preparation and policy acquisition through read-only host ports. The page captures one observed snapshot for D's same-observation context revision and supplies the current wallet read context on each check. D's exact envelope and retained AEI-C input enter AEI-E with an exact Phase 12 PLAN_READY session/plan. AEI-E alone maps PREPARED and its sidecar. The coordinator compares its generation and live B2 source after each asynchronous D/E/Review stage. A late result after cancellation, replacement or unmount cannot update the current card. D/E's own private registries and validators enforce freshness and newer same-ACTION supersession.

Opening transaction Review is a **second user action** after B2. `validateAeiEReviewEligibility` runs on the exact in-memory E result immediately before the immutable `ReviewPresentation` is created. The presentation is closed-schema data with account, chain, request/session, Strategy/ACTION/goal, D/E/materialization revisions, quote/preparation/policy digests, quote fingerprint and expiry, exact technical step, asset/amount/recipient/route, swap output/minimum/finite approval spender, warnings, Review requirements and truthful fee text. Its issuer checks D/E identities and schema. An open view revalidates every second; expiry, changed wallet observation or newer D registration closes it. There is **no final action or execution callback**. Any future downstream handoff must independently recheck E, account/chain, payload and final policy/fee/simulation. Review display and B2 parameter confirmation grant no transaction approval.

SEND reaches inert Review for the exact transfer. Xylo USDC↔EURC SWAP reaches a separate finite approval Review when required; the swap step remains dependent and is not submitted or made active by a prepared approval. cirBTC swap remains unsupported by D. Direct CCTP yields a typed handoff/unsupported stop with no Agent Review; Circle App Kit canonical Agent PREPARE remains unsupported. The Agent makes no source or destination completion claim. Errors from reads, quote, preparation or provenance are pre-execution failures, never transaction failures. The UI uses stage labels only, not Phase 12 authority.

## Existing Review component safety audit

| Component | Execution callback present? | Wallet capability in caller? | Safe for AEI-F direct use? | AEI-F adapter |
| --- | --- | --- | --- | --- |
| `TransactionSafetyReview` | Required `onContinue` callback | Caller supplies it | No; the callback slot can execute | Dedicated inert Review view |
| `SendFlow` | `onContinue` calls submit | `submitReviewed` and `writeContractAsync` | No | Not mounted |
| `RealSwapFlow` | Approval and swap callbacks submit | `submitReviewed` and `writeContractAsync` | No | Not mounted |
| AEI-F `ReviewPresentation` view | None | None | Yes for factual display | Data-only, no final action |

Phase 10F retains attempt, ambiguity, retry/resubmit and duplicate-submission authority. AEI-F contains no signer, wallet client, wallet writer, submission, receipt polling, retry or resubmit. A source inspection test checks these imports/calls. The host and same-origin runtime remain application trust boundaries rather than cryptographic attestation.

## Verification

Local deterministic browser fixtures made no live model, provider, RPC or wallet call. The isolated build copied source without the inherited `node_modules` junction and used the local lockfile with `npm ci --offline`.

| Gate | Result |
| --- | --- |
| AEI-F focused | 3/3 pass |
| AEI-F browser | 25/25 pass; SEND, SWAP approval, bridge stop, account switch, expiry, cancel, remount, late D, mobile overflow and accessibility |
| B1/B2 browser | 8 scenarios pass |
| AEI-B browser | 91/91 pass |
| AEI-C browser | 135/135 pass |
| AEI-D browser | 104/104 pass (with `PHASE7G_PORT=3187`) |
| AEI-E browser | 70/70 pass (with `PHASE7G_PORT=3187`) |
| Full frontend | 1538/1538 pass |
| Typecheck | pass |
| Lint | 0 errors, 7 inherited warnings |
| Isolated offline Turbopack build | pass; Next.js 16.3.3 Turbopack compiled and generated 10/10 static pages |
| Root Hardhat compile | pass, `Nothing to compile` |
| Diff check | pass |

## The 100 design criteria

Evidence classes: **BROWSER_QA** means exercised in the deterministic production/closed-boundary browser matrix; **ADVERSARIAL_RUNTIME** means the focused hostile-input or closed-boundary adversarial fixtures; **TESTED** means frontend unit/regression coverage; **SOURCE_INSPECTED** means bounded code and wiring inspection; **NOT_PROVEN** means the criterion remains unexercised or deferred. A source classification is not a claim that every permutation has been browser-tested.

Classification totals: **25 BROWSER_QA, 5 ADVERSARIAL_RUNTIME, 18 TESTED, 51 SOURCE_INSPECTED, 1 NOT_PROVEN**. The sole NOT_PROVEN criterion is the deliberately unavailable final downstream handoff (98); there is no exposed final action.

| # | Classification | Evidence or limit |
| --- | --- | --- |
| 1 | SOURCE_INSPECTED | Live page supplies one coordinator to current Agent card. |
| 2 | SOURCE_INSPECTED | Existing `/api/planner-proposal` fetch. |
| 3 | SOURCE_INSPECTED | No parser in Planner path. |
| 4 | SOURCE_INSPECTED | B1 request/session/locale pair and generation. |
| 5 | TESTED | B1 proposal host-pair validator. |
| 6 | SOURCE_INSPECTED | B1 generation recheck after response. |
| 7 | BROWSER_QA | Confirmation before preparation. |
| 8 | BROWSER_QA | Native B2 control. |
| 9 | ADVERSARIAL_RUNTIME | Copied source rejected by B2/AEI-B tests. |
| 10 | BROWSER_QA | Control stays mounted through Review. |
| 11 | BROWSER_QA | Cancel revokes and closes Review. |
| 12 | SOURCE_INSPECTED | Composer edit removes proposal/card. |
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
| 30 | BROWSER_QA | Account switch stales open Review; D checks host. |
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
| 92 | SOURCE_INSPECTED | Chain/context mismatch rejected by D and B1 invalidation. |
| 93 | SOURCE_INSPECTED | Disconnect clears proposal and D currentness. |
| 94 | BROWSER_QA | Open Review closes on expiry. |
| 95 | BROWSER_QA | Same finite expiry check covers preparation. |
| 96 | TESTED | E validator rejects newer D registration; timer invokes it. |
| 97 | SOURCE_INSPECTED | Frozen Review payload; stale view closes. |
| 98 | NOT_PROVEN | No downstream final handoff exists; future final action must add a fresh E guard. |
| 99 | SOURCE_INSPECTED | No final action or executing callback is available. |
| 100 | BROWSER_QA | Remount presents fresh B2, no JSON authority. |

Criterion 98 is a deliberate **deferred final-action boundary**, not permission to execute without a guard. No material current Review or wallet authority criterion is claimed from a persisted or copied artifact. The current view has no final execution action. AEI-G must scrutinize same-account reconnect observation, late D/E cancellation, full Review payload display, and final downstream handoff before any execution connection.

**DEPLOYMENT_GATED_BY_AUTH_AND_RATE_LIMIT** remains unresolved. `makoto-wallet.zip` remains the canonical deferred post-AEI-G UI/UX reference. No push, deployment, live provider/model/RPC/wallet call, wallet signature, transaction submission, receipt polling, retry/resubmit or dependent-action auto execution occurred.
