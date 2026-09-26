# AEI-B final adversarial review — passed, ready for separate closeout

**Baseline:** clean `b5fc95bfcc4c3bfcf33f532e583eb3f6c46710b9` on `phase12h-planner-strategy-integration`. AEI-A, B1 and B2 are closed; AEI-B entered final review. Scoped fixes and regression coverage are committed at `abef28f79adc1e447b6c4c61d70d6b6a8c5b4a68`. AEI-C and Phase 13 are not started. This review covers the current production proposal → confirmation → evidence → compiler → v2 binding path. It does not create transaction authority.

## Exact production chain and authority

| Transition | Identity entering and validation | Identity leaving | Authority gained and limit |
| --- | --- | --- | --- |
| Agent request → B1 | `useMakotoAgent` retains accepted text/locale, session UUID and request generation; `runPlannerProposal` validates the request, allocates server request/proposal IDs, validates 11B classification, 11C plan and 11D resolution, and freezes the checked plan before resolution. | Closed B1 proposal with request/session IDs, request/plan/proposal digests, goal IDs/kinds/edges, exact parameter candidates and status. | Proposal display only. Provider values are `UNVERIFIED_PROVIDER`; IDs/digests are correlation and integrity, not authentication. |
| B1 response → active card | `acceptPlannerProposalResponse` recomputes the request digest from retained text/locale and session; `createPlannerProposalHostSource` retains the exact source; `validatePlannerProposalHostPair` checks the displayed pair. Request generation and wallet/session changes remove stale proposals. | Active immutable proposal and host source. | Visible review only. Legacy draft and wallet Review cannot substitute. |
| Card → B2 runtime source | `PlannerParameterConfirmControl` revalidates the pair and complete fixed set. Its owned button requires a real browser-dispatched native click with matching target/path/identity. `buildSource` reconstructs and validates the exact plan and intents. | Source object registered in a private WeakMap with its descriptor-safe snapshot and proposal digest. | Application-level parameter confirmation, revoked on identity/lifecycle change. No cryptographic human authentication or XSS guarantee. |
| Source → field evidence | `createPlannerParameterEvidence` requires live WeakMap membership and matches the event's request/session/plan/proposal IDs/digests and complete sorted goal/key/value set to validated intents. `validatePlannerParameterEvidence` recomputes against that same live source. | Canonically ordered `FIXED_USER_INPUT` field records, event digest and evidence-set digest. | Evidence JSON alone is inert. Copying JSON, matching public digests or provider trust flags cannot register the source. |
| Evidence → AEI-B skeleton | `compilePlannerStrategy` snapshots closed v2 input, validates plan, one-to-one goal-keyed intents and live-source evidence, and checks request/session continuity. It derives Strategy and ACTION IDs from canonical semantic tuples. | Valid Phase 10 ACTION-only skeleton with explicit goal-step map and `executionEnabled: false`. | No quote, preparation, policy, wallet, signer, submission, receipt or retry permission. The production UI checks this result and discards it. |
| Skeleton → AEI-A v2 | `createPlannerStrategyBindingV2` validates the live evidence again; AEI-A v1 structural binding checks plan, intents, Strategy content/order, goal mapping and dependency edges. V2 additionally binds the exact evidence-set digest. | V2 binding to the exact skeleton and evidence. | Provenance only. V1 cannot satisfy AEI-B's v2 evidence gate. Later AEI-C must bind any real revision/artifact separately. |

## Review findings and scoped fixes

1. **Object insertion order rejected equivalent evidence and v2 bindings.** A browser regression first reproduced that reordering object keys, without changing a value or digest, failed both validators. Descriptor-safe snapshots now compare closed objects in code-point key order while preserving canonical evidence-array order; the v2 goal-step mapping array is sorted by goal ID. Duplicate, missing, extra and altered records still reject. Evidence hashes were already based on fixed-order field tuples; no digest format changed.
2. **Remaining-balance language could become fixed.** A mocked provider's numeric `10` was accepted for “Send my remaining balance, about 10 USDC” because the amount appeared in text but the dynamic detector missed “remaining balance.” Failing B1 pipeline and standalone proposal regressions preceded the fix. Both 11D resolution and B1 proposal classification now mark it dynamic/unresolved. A new fixed request/proposal and fresh confirmation are required; the original request cannot compile a fixed amount.

The earlier B2 review's fabricated `{ isTrusted: true }` handler defect and owned native-click fix remain part of the trusted baseline; this review did not reopen its closed scope. The private registry is an application authority boundary against ordinary public-API forgery. Fully malicious same-origin/XSS code can alter application behavior and is outside this guarantee.

**Determinism and revision:** identical complete input produces identical Strategy ID, step IDs, content and binding. `createdAt` is explicit host metadata: changing it leaves Strategy and step IDs/mapping unchanged, but changes the bound skeleton content digest; it never changes `executionEnabled`. A new confirmation event can preserve semantic Strategy IDs while changing the v2 evidence/binding digest. No Strategy is materialized or mutated in place. A future AEI-C revision contract must preserve this binding when attaching real artifacts.

**Canonical evidence order:** evidence items are generated in sorted goal/key order; a different evidence array order fails exact set validation. Plain object property insertion order is semantically inert after the scoped fix. Missing, duplicated or extra items and changed origin/value/identity fail. The v2 binding covers request/session, plan digest, validated intents digest, evidence-set digest, skeleton content digest, one-to-one goal/action map and dependency edges. Its digest is local integrity, not a signature.

**Supported semantics:** SEND uses a registered asset and Arc Testnet; SWAP uses only the Xylo USDC↔EURC pair on Arc; BRIDGE represents Arc USDC → Base Sepolia USDC with an explicit recipient. BRIDGE compilation is a semantic non-executable skeleton, not a claim of a current Agent wallet handoff. cirBTC is rejected for SWAP and BRIDGE by the existing intent validator. Dynamic output/receipt/percentage/max/remaining-balance amounts remain nonfixed despite numeric provider previews. A graph edge denotes order, never a value derived from an earlier output.

## Fifty-case acceptance matrix

`BROWSER` means deterministic `aei-b-final-browser.mjs` or the existing B2 browser script; `NODE` means focused B1/AEI-B/AEI-A tests; `INSPECTION` means production call-path/schema inspection. This is a case matrix, not a claim of 50 independent test functions. The new end-to-end browser script contains 91 passing assertions, including additional malformed-input and binding mutations.

| # | Adversarial case | Evidence | Result |
| --- | --- | --- | --- |
| 1 | Fixed SEND compiles | BROWSER | PASS |
| 2 | Fixed SWAP compiles | BROWSER | PASS |
| 3 | Fixed BRIDGE compiles | BROWSER | PASS, semantic skeleton only |
| 4 | Execution disabled for all | BROWSER | PASS |
| 5 | Unconfirmed proposal | BROWSER, NODE | REJECTED |
| 6 | Fake B2 JSON | NODE, BROWSER copied source | REJECTED |
| 7 | Provider self-trust | NODE closed schema | REJECTED |
| 8 | Evidence copied across request | BROWSER compiler mutation | REJECTED |
| 9 | Evidence copied across session | BROWSER compiler mutation | REJECTED |
| 10 | Evidence copied across plan | BROWSER compiler mutation | REJECTED |
| 11 | Evidence copied across proposal | BROWSER compiler mutation | REJECTED |
| 12 | Evidence copied across goal | BROWSER compiler mutation | REJECTED |
| 13 | Changed amount | BROWSER compiler mutation | REJECTED |
| 14 | Changed recipient | BROWSER compiler mutation | REJECTED |
| 15 | Changed asset | BROWSER compiler mutation | REJECTED |
| 16 | Changed chain | BROWSER compiler mutation | REJECTED |
| 17 | Changed dependency | BROWSER compiler mutation | REJECTED |
| 18 | Missing evidence | BROWSER | REJECTED |
| 19 | Duplicate evidence | BROWSER | REJECTED |
| 20 | Extra evidence | BROWSER | REJECTED |
| 21 | Wrong origin | BROWSER | REJECTED |
| 22 | AEI-A v1 downgrade | BROWSER, NODE | REJECTED |
| 23 | Malformed v2 binding | BROWSER | REJECTED |
| 24 | Exact evidence-set digest | BROWSER | PASS |
| 25 | Deterministic goal→ACTION map | BROWSER, NODE | PASS |
| 26 | Multi-goal separation | BROWSER | PASS; two distinct steps and eight fields |
| 27 | Output-dependent second goal | B2 BROWSER, NODE | UNRESOLVED |
| 28 | Percentage dynamic | NODE | UNRESOLVED |
| 29 | All-received dynamic | B2 BROWSER, NODE | UNRESOLVED |
| 30 | Receipt-derived dynamic | NODE | UNRESOLVED |
| 31 | Explicit dynamic→fixed replacement | B2 BROWSER | Fresh proposal required |
| 32 | Old dynamic evidence | B2 BROWSER, NODE | REJECTED |
| 33 | Replan reuses evidence | B2 BROWSER, NODE | REJECTED |
| 34 | Refresh restores JSON authority | B2 BROWSER | REJECTED |
| 35 | Remount restores authority | B2 BROWSER | REJECTED |
| 36 | Legacy Agent draft | B2 BROWSER, NODE | REJECTED |
| 37 | Wallet Review | B2 BROWSER, INSPECTION | REJECTED |
| 38 | Malformed plan | BROWSER, NODE | REJECTED |
| 39 | Malformed goal | BROWSER, NODE | REJECTED |
| 40 | Unsupported goal | NODE plan/intent validators | REJECTED |
| 41 | Unsupported asset/chain | BROWSER, NODE | REJECTED |
| 42 | Provider plan mutation/substitution | NODE B1 pipeline | REJECTED or frozen original preserved |
| 43 | Strategy content mutation | BROWSER v2 validator | REJECTED |
| 44 | Goal mapping mutation | BROWSER v2 validator | REJECTED |
| 45 | Dependency mutation | BROWSER, NODE binding | REJECTED |
| 46 | Preparation authority | INSPECTION; schema and call search | ABSENT |
| 47 | Phase 9 authority | INSPECTION; schema and call search | ABSENT |
| 48 | Wallet authority | INSPECTION; schema and call search | ABSENT |
| 49 | Signing/submission authority | INSPECTION; schema and call search | ABSENT |
| 50 | Retry/resubmit authority | INSPECTION; schema and call search | ABSENT |

## Decision and limits

**AEI-B final review PASSED; IMPLEMENTED / FINAL REVIEW PASSED / READY_TO_CLOSE, not COMPLETE.** The two scoped defects above were reproduced with failing tests, fixed, and verified. No material AEI-B defect remains within this review's application trust boundary. Separate AEI-B closeout is NEXT; AEI-C is NEXT / NOT STARTED after that closeout. AEI-B1 and B2 remain closed; Phase 13 is NOT STARTED.

### Sequential verification at the reviewed code

1. New end-to-end browser adversarial script: **91/91 assertions PASS**. The 50-case acceptance matrix above maps to this script, B2 browser coverage, Node tests and source inspection; it is not 50 separate test functions.
2. B2 browser QA: **PASS** at EN desktop 1440px and VI mobile 390px, including keyboard control, unmount revocation propagated into the compiler, and **zero axe accessibility violations**.
3. Focused Node suites: B2 **5/5**, provenance **8/8**, AEI-B **9/9**, AEI-A **15/15**, B1 **26/26**, Phase 11 Planner **58/58**, Strategy **62/62**, selected Phase 12 **46/46**, Agent regressions **301/301**, EN/VI fixtures **31/31** — all PASS.
4. Full frontend `npm test`: **1524/1524 PASS**. `npm run typecheck`: **PASS**. `npm run lint`: **PASS**, zero errors and seven inherited warnings.
5. Normal Next.js Turbopack production build: **PASS** in an isolated clean source copy with local lockfile dependencies because this worktree's inherited `node_modules` junction prevents an in-place build. Root `npm run compile`: **PASS**, nothing to compile. `git diff --check` and staged diff check: **PASS**.
6. Final repeated B2 browser QA: **PASS** at EN 1440px and VI 390px with zero axe violations. All provider and browser data in these checks were mocked. No live model/provider call, wallet or transaction operation, push or deployment occurred.

**Limits and handoff:** This is application-level confirmation, not proof against fully compromised same-origin/XSS code. Language-based dynamic detection remains conservative and may leave uncertain values unresolved; the reviewed remaining-balance case cannot be promoted by a numeric provider preview. BRIDGE remains a semantic non-executable skeleton without a current Agent wallet handoff. AEI-C must define and verify later artifact/revision binding before materialization; the current UI discards the compiled skeleton. **DEPLOYMENT_GATED_BY_AUTH_AND_RATE_LIMIT** remains unresolved because the paid provider-backed Planner route lacks server-side account authentication and distributed rate limiting. Its session UUID is correlation/isolation identity, not access control. The later post-AEI-G Surf UI/deployment plan remains deferred.
