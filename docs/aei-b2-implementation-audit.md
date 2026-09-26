# AEI-B2 implementation evidence — pending review

AEI-B2 implementation starts at clean `aa737e63dd097a46b6e4f0a8220461905b7126b1`. Runtime/UI/tests commit `53126f8a8a194b0dc6600f6c89f78ce58109b796` adds a distinct parameter confirmation control to the live B1 Planner card. B2 remains **IMPLEMENTED / PENDING REVIEW**, not complete. AEI-B is not complete; AEI-C and Phase 13 remain unstarted.

## Authority and identity

The control revalidates the exact B1 proposal and retained request source before rendering or accepting a click. Only the latest active Planner card has the control. It shows every goal, dependency and required parameter value. A complete fixed proposal requires a browser-trusted click on the connected owned control; a synthetic event, matching JSON or digest is insufficient. The module records the resulting source by object identity in a private WeakMap. The record is checked against a descriptor-safe source snapshot and revoked on control unmount or identity change. It is never serialized or persisted. This is an application authority boundary against public API and plain-data forgery, not cryptographic user authentication or protection against arbitrary malicious same-origin/XSS code.

The event and every `FIXED_USER_INPUT` field record bind request/session IDs, request/plan digests, proposal ID/digest, goal ID, field key and exact value; the event digest and evidence-set digest feed AEI-A v2. The existing public evidence factory still rejects caller-created structured events. AEI-B and AEI-A v2 recover the original live source reference through a separately checked descriptor before validating evidence; copies cannot reconstruct the capability. A successful AEI-B result is an `executionEnabled: false` Strategy skeleton. The UI discards that result after checking the positive path; no prepared Strategy or transaction state is created.

Dynamic/partial B1 fields have no confirmation control. The browser fixture covers an all-received dependent amount followed by a new fixed request/proposal; old live authority is revoked. A fresh natural-language request can supply a new fixed proposal and new confirmation, while B2 does not evaluate a percentage, output or receipt into a fixed number. The existing B1 proposal and Phase 11D tests cover those expression classes. A graph dependency remains an order edge, not output-value provenance.

## 60-condition acceptance record

This is a condition checklist, not a claim of 60 independent test functions. `B2 unit` means `plannerB2Confirmation.test.ts`; `provenance`, `compiler`, `binding`, `B1`, and `browser` refer to the focused suites and deterministic browser script. `inspection` means the production import/call path was checked for authority.

| # | Condition | Evidence |
| --- | --- | --- |
| 1 | Valid B1 proposal in UI | Browser EN/VI and B2 unit. |
| 2 | Invalid proposal rejected | B1 validation tests. |
| 3 | Extra field rejected | B2 unit and B1 validation tests. |
| 4 | Symbol field rejected | B2 unit and B1 validation tests. |
| 5 | Getter/proxy fails closed | B2 unit and provenance tests. |
| 6 | SEND fields visible | Browser `planner-send`. |
| 7 | SWAP fields visible | Browser `planner-swap`. |
| 8 | BRIDGE fields visible | Browser `planner-bridge`. |
| 9 | Unconfirmed cannot mint | B2 unit and provenance tests. |
| 10 | Unconfirmed cannot compile | Compiler tests. |
| 11 | SEND fixed field evidence | Browser live-source fixture: four exact records. |
| 12 | SWAP fixed field evidence | Browser `planner-swap` confirmed state requires evidence and compilation. |
| 13 | BRIDGE fixed field evidence | Browser `planner-bridge` confirmed state requires evidence and compilation. |
| 14 | Complete fixed input passes AEI-B | Browser live-source fixture. |
| 15 | Execution remains disabled | Browser checks `executionEnabled: false`. |
| 16 | Fake confirmation object fails | B2 unit. |
| 17 | Matching digest alone fails | B2 unit and provenance tests. |
| 18 | Provider trusted flag fails | B2 unit/B1 closed schema. |
| 19 | Provider fixed-origin flag fails | Provenance provider test. |
| 20 | Plain evidence JSON fails | B2 unit and browser copied-source check. |
| 21 | No production test bypass | B2 unit export audit. |
| 22 | Changed amount invalidates | Browser live-source mutation. |
| 23 | Changed recipient invalidates | Browser live-source mutation. |
| 24 | Changed asset invalidates | Browser live-source mutation. |
| 25 | Changed chain invalidates | Browser live-source mutation. |
| 26 | Changed goal invalidates | Browser live-source mutation. |
| 27 | Changed dependency invalidates | Browser live-source mutation. |
| 28 | Changed plan invalidates | Browser live-source mutation. |
| 29 | Changed proposal invalidates | Browser live-source mutation. |
| 30 | Replan invalidates | B1 changed-digest test and browser unmount revocation. |
| 31 | Dynamic 50% stays nonfixed | B1 pipeline/provenance tests. |
| 32 | All received stays nonfixed | B1 tests and browser `planner-dynamic`. |
| 33 | Receipt-derived stays nonfixed | B1 pipeline/provenance tests. |
| 34 | Prior output stays nonfixed | B1 pipeline/provenance tests. |
| 35 | Dynamic-to-fixed replacement is fresh | Browser dynamic → new fixed fixture; new request/proposal IDs. |
| 36 | Old dynamic provenance not reused | B1 request/proposal digest checks and browser revocation. |
| 37 | Missing evidence blocks compiler | Compiler tests. |
| 38 | Duplicate evidence rejected | Provenance tests. |
| 39 | Wrong request evidence rejected | Provenance and B2 unit. |
| 40 | Wrong session evidence rejected | Provenance and B2 unit. |
| 41 | Wrong goal evidence rejected | Provenance and B2 unit. |
| 42 | Wrong proposal evidence rejected | B2 unit and browser mutation. |
| 43 | AEI-A v2 digest exact | Browser equality with evidence-set digest. |
| 44 | AEI-A v1 cannot bypass | Provenance/compiler tests. |
| 45 | No wallet invocation | B2 production-path inspection/browser handoff check. |
| 46 | No preparation | B2 production-path inspection. |
| 47 | No Phase 9 execution | B2 production-path inspection. |
| 48 | No signing | B2 production-path inspection. |
| 49 | No submission | B2 production-path inspection. |
| 50 | No retry/resubmit | B2 production-path inspection. |
| 51 | Legacy draft cannot mint | B1 spoof fixture and distinct B2 control. |
| 52 | Wallet Review cannot mint | Separate `ActionDraftCard` path inspection. |
| 53 | Stale B1 proposal cannot confirm | Active-card gate and B1 generation tests. |
| 54 | Previous session cannot confirm | Host-pair check, active-card gate, B1 session tests. |
| 55 | Multi-goal IDs stay separate | Browser two-goal fixed proposal and B1 graph tests. |
| 56 | Dynamic dependent goal unresolved | Browser `planner-dynamic` and B1 tests. |
| 57 | EN strings render | Browser EN 1440px, no raw keys. |
| 58 | VI strings render | Browser VI 390px, no raw keys. |
| 59 | Keyboard confirmation works | Browser focus + Enter in both locales. |
| 60 | State accessible | Semantic button/status, browser axe zero violations. |

## Verification and limits

Sequential focused results: B2 unit 5/5, provenance 8/8, AEI-B 9/9, AEI-A 15/15, B1 24/24, Phase 11 Planner 58/58, Strategy 62/62, selected Phase 12 54/54, Agent 301/301, EN/VI fixtures 31/31. Full frontend 1522/1522; typecheck PASS; lint 0 errors / 7 inherited warnings; normal Turbopack build PASS in an isolated source copy with local `npm ci` dependencies; root contract compile PASS (nothing to compile); diff checks PASS. Deterministic browser QA passed at EN 1440px and VI 390px, plus fixed SEND/SWAP/BRIDGE, dynamic refusal, exact evidence-set/binding digest, copied JSON refusal, ten field/identity mutations and revocation. Accessibility audit found zero violations. No live provider/model call occurred.

The B1 paid provider route remains **DEPLOYMENT_GATED_BY_AUTH_AND_RATE_LIMIT**: it has no server-side account authentication or distributed rate limiting. B2 confirmation is only intended parameter evidence. It is distinct from prepared transaction review and wallet signature, and adds no quote, materialization, Phase 9 decision, wallet invocation, signing, submission, receipt claim, retry or resubmission. Browser same-origin compromise remains outside this application-level authority guarantee.
