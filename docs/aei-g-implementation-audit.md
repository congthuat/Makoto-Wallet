# AEI-G implementation audit — pending separate final review

**Final-review addendum (2026-09-27):** [The separate AEI-G adversarial review](aei-g-final-review-audit.md) reproduced two further scoped boundary defects and fixed them at `f1f0a52012c32e102106e9f4d07a8a6f44f19b3b`: falsy Planner proposal fields with a legacy draft exposed an action control, and an unopened Review control remained visible after operational evidence expired. The final G browser suite is 50/50, with 64 caller-rehashed mutations of a live C materialization in addition to the focused serializer property test. AEI-G is IMPLEMENTED / FINAL REVIEW PASSED / READY_TO_CLOSE, not COMPLETE; the milestone remains OPEN. The implementation counts and status below are historical.

**Status (2026-09-27): AEI_G_IMPLEMENTED_PENDING_FINAL_REVIEW.** Starting clean branch/HEAD: `phase12h-planner-strategy-integration` / `842234cabf8b37c9c4f3e79eb9966178ef3e2ad5`. Scoped implementation commit: `10c111121efd497503e83cdc1f7df7a69b4cdc1c`. AEI-A/B/B1/B2/C/D/E/F remain COMPLETE / CLOSED. AEI-G is **not COMPLETE**; the Agent Execution Integration milestone is **not CLOSED**. Phase 13 is NOT STARTED. This audit is implementation evidence for the later independent adversarial final review, not that review itself.

## Authority and provenance result

The production path is request → B1 retained proposal → B2 native-event/application confirmation → fixed-field evidence → AEI-B deterministic non-executable Strategy → AEI-A v2 exact binding → AEI-C semantic ACTION materialization → one independent ACTION → AEI-D current host account/Arc chain, Phase 8 reads/quote, unsigned preparation and actual Phase 9 policy → AEI-E guarded Phase 12 state/sidecar → fresh E Review eligibility → AEI-F frozen factual Review. B2 is parameter confirmation, not a transaction approval. Phase 9 ALLOW and PREPARED allow only a later, separate Review; they do not create an attempt, hash, receipt, submission, success or verified predecessor output. F has no final action. Phase 10F retains attempt, ambiguous submission, replacement and double-submission recovery authority.

AEI-G's new deterministic browser harness exercised a live B2 source, copied-source failure, AEI-A v1 downgrade, C cross-Strategy transplant, D caller-rehash rejection, E direct PREPARED proof forgery, a real multi-ACTION D→E root mapping and dependency stop, exact ACTION/goal/Strategy/account/chain/quote/preparation/policy continuity, newer D supersession, and inert F Review. The focused harness drove the same malformed corpus through B2, C, D, E and F without reaching host acquisition, then ran 64 fixed-seed object-key permutations and ordered-array controls. Existing A–F browser and focused suites supplied the narrower mutations, policy outcomes, currentness, persistence, technical-step and account/chain cases. These are local fixtures; they are not cryptographic authentication of the host, provider, user or wallet.

## Finding, failing regression and scoped fix

**AEI-G-01 — mixed Planner/legacy message exposed a legacy action control.** In the exported `AgentOperation` component, a message with both a Planner proposal and legacy draft failed the strict Planner-card guard but then rendered `ActionDraftCard`. The new browser regression first failed: the synthetic `planner-spoof` message had **one** action button although no B2 control. Production `useMakotoAgent` constructs Planner and legacy messages in separate branches, so the audit did **not** show that the current production request path naturally emits the mixed object; the component boundary was still unsafe for a hostile or future caller. The minimal fix makes any message carrying a proposal or proposal source that fails canonical Planner validation render an unavailable, non-actionable Planner state. It does not change valid B1/B2 or legacy-only draft flows. AEI-G browser then passed **43/43**; affected F **28/28** and B1/B2 browser scenarios passed. No other material defect was found in this implementation audit.

## Adversarial results and limits

| Area | Result and evidence |
| --- | --- |
| B1/B2 bypass and escalation | Copied B2 source, fake flags and old mounted source have no live confirmation; B2 browser and G browser. B1 accepted proposal remains an unconfirmed candidate. |
| A/C downgrade and transplant | v1 binding is rejected by C; old C materialization fails under a new Strategy and loses live source after remount; G browser plus C/B/A suites. |
| D fake evidence and rehash | Caller-built envelope with a recomputed digest is unregistered; malformed objects cannot start host reads; G focused/browser and D suite. |
| E direct PREPARED and restore | Fake reducer proof and copied MAPPED result do not create Review eligibility. E persistence restores `HISTORICAL` only; G/E tests and E source. |
| F Review bypass | PREPARED, B2 and cached labels do not open Review. Fresh E validation is invoked on Review click; opening is single-use and Review has no action button. G/F browser. |
| Cross-ACTION/dependency | A multi-ACTION Strategy's dependent ACTION stays `DEPENDENCY_BLOCKED` while root is PREPARED/REVIEW_REQUIRED; no runtime output is inferred. G/D/E browser. |
| Account/chain, request/session and cancellation | Pre-B2 switch, during-D switch, post-E and open-Review invalidation, old B1/session and late async cancellation/remount are covered by G/F/E/D/B1 browser suites. A same-account reconnect with indistinguishable host observation remains a host trust limit. |
| Expiry and TOCTOU | D validates quote/preparation freshness; E rechecks D registration/latest lineage; F rechecks E at Review click and while visible. G browser expires both clocks; D/E/F suites separately cover quote/preparation expiry and newer orchestration. Review→future wallet handoff has no implementation. |
| Phase 9 precedence | `BLOCK > REQUOTE > REVALIDATE > REQUIRE_REVIEW > WARN > ALLOW` holds in Phase 9 tests and D/E/F mapping. A newer D result revokes old E eligibility without rewriting historical PREPARED. |
| Xylo and unsupported paths | Finite exact USDC↔EURC approval is a distinct unsigned step; no approval or swap auto-submit. cirBTC Swap is rejected. Direct CCTP is typed handoff/unsupported, Circle App Kit canonical Agent PREPARE unsupported. Source receipt is not destination completion. G/F and D/E browser plus source inspection. |
| Gas, simulation and copy | Swap gas is displayed as not estimated; no final execution simulation is claimed by AEI Review. Review says no transaction submitted. Fee/simulation authority belongs to a future handoff where required. |
| Legacy/mock boundary | Mixed Planner/draft collision fixed and failing-first tested. Canonical Planner failure has no automatic legacy route in `useMakotoAgent`; no demo quote or prepared data registers D/E authority. Valid legacy-only mode remains a separate product path. |
| Duplicate/reentrant/hostile/property | G focused 3/3 covers hostile objects across live boundaries, 64 key-order permutations with meaningful array order retained, and reentrant cancellation/duplicate untrusted B2. G browser covers single-use Review and B2; existing E/D tests cover private registration. |
| Persistence and public digests | Saved v2/E state remains historical; copied/rehashed public digests cannot enter B2 WeakMap, D/E private registries or F live Review. G/E focused/browser. |

## Reachability, public route and trust review

Targeted source/import inspection of the AEI coordinator, B2/C/D modules and its `MakotoAgentPage` Review found no signer, wallet client, `wallet.request`, `personal_sign`, `signMessage`, `signTypedData`, `sendTransaction`, `eth_sendTransaction`, `writeContract`, `useWriteContract`, receipt poller, retry or resubmit call reachable from the canonical Review. Existing wallet-capable legacy code remains elsewhere on the page/application; the mixed-message fix prevents a Planner payload from falling into its draft card. `agentTransition.ts` contains separately guarded historical Phase 12 receipt/recovery cases, but the AEI-E mapping enters only unsigned PREPARED and mints no attempt ID, hash, receipt, confirmation count or submission timestamp. No Phase 10F ownership changed.

`/api/planner-proposal` limits the body to **8,192 bytes** before JSON parsing, returns no-store responses and imports model/provider clients from server-side modules. The final isolated `.next/static` scan found no literal `OPENAI_API_KEY`, `OPENAI_BASE_URL` or `OPENAI_MODEL` references; source inspection found no provider secret passed into the client AEI Review payload. This is a bounded source/bundle check, not proof against a compromised deployment. The route still lacks server-side account authentication and distributed rate limiting; a client session UUID is only correlation. Paid-provider abuse/cost exposure remains, so **DEPLOYMENT_GATED_BY_AUTH_AND_RATE_LIMIT** is unchanged.

B2 native-event and WeakMap registration is application-level parameter evidence, not cryptographic user identity. D/E private registries depend on truthful host account observation, clock and provider results. A malicious same-origin script or host can violate those assumptions; an indistinguishable same-account reconnect cannot be detected independently. A future wallet handoff must obtain its own current authoritative evidence. Criterion 98 remains **DEFERRED_OUTSIDE_AEI_PREEXECUTION_MILESTONE / unproven** because no such handoff exists. It must freshly check E, exact prepared artifact and technical step, account/chain, quote/preparation freshness, final policy, required fee/gas and simulation evidence, then obtain explicit user transaction Review before wallet authority. AEI-G added none of this execution path.

## Verification

All checks were local and deterministic; no live model, provider, RPC or wallet transaction call was made. Sequential results after the scoped fix:

| Gate | Exact result |
| --- | --- |
| AEI-G focused/adversarial/property | **3/3 pass**; 64 deterministic permutations inside one test |
| AEI-G browser | **43/43 pass**; includes failing-first mixed-message regression |
| AEI-F focused/browser | **3/3**, **28/28** pass |
| AEI-E focused/browser | **4/4**, **70/70** pass |
| AEI-D focused/browser | **3/3**, **104/104** pass |
| AEI-C focused/browser | **4/4**, **135/135** pass |
| AEI-B focused/final browser | **9/9**, **91/91** pass |
| B2 focused; B1 focused/browser | **5/5**; **26/26**; eight B1/B2 browser scenarios pass |
| AEI-A; provenance | **15/15**; **8/8** pass |
| Planner; Strategy | **58/58**; **62/62** pass |
| Phase 9; Phase 10F; Phase 12; persistence/recovery | **28/28**; **30/30**; **32/32**; **22/22** pass |
| Agent/Tool; Agent UI | **247/247**; **36/36** pass |
| Full frontend | **1541/1541** pass |
| Typecheck | PASS |
| Lint | **0 errors / 7 inherited warnings** |
| Isolated offline-lockfile normal Turbopack build | PASS; **10/10** static pages generated |
| Root Hardhat compile | PASS; `Nothing to compile` |
| `git diff --check` | PASS on scoped implementation; repeat at final handoff |

The isolated build copied frontend source outside the worktree, excluding the inherited `node_modules` junction and `.next`, then used the local lockfile with `npm ci --offline`. It did not retarget or remove the inherited junction. Contract compile ran after frontend suites/build.

## 140-gate classification

`TESTED` means focused Node assertions; `ADVERSARIAL_RUNTIME` means deterministic boundary attacks in G or earlier D/E/C/B browser fixtures; `BROWSER_QA` means production-component browser interaction; `PROPERTY_TESTED` means fixed-seed permutation; `SOURCE_INSPECTED` means source/import/status inspection, not a claim that every permutation ran in a browser. `DEFERRED_OUTSIDE_AEI` is the absent final wallet handoff. The matrix inherits exact narrower evidence from the closed A–F final audits where indicated. It does not assert that a static inspection is a runtime proof.

**Classification totals:** TESTED 18, BROWSER_QA 42, ADVERSARIAL_RUNTIME 44, PROPERTY_TESTED 1, SOURCE_INSPECTED 34, DEFERRED_OUTSIDE_AEI 1; **NOT_PROVEN 0 for current AEI-owned gates**. Criterion 98 is the explicit future handoff deferral.

| # | Gate | Classification | Evidence boundary |
| --- | --- | --- | --- |
| 1 | B1 canonical proposal | TESTED | G/B1/B2 browser and focused |
| 2 | B2 canonical native confirmation | BROWSER_QA | G/B1/B2 browser and focused |
| 3 | copied B2 lacks authority | ADVERSARIAL_RUNTIME | G/B1/B2 browser and focused |
| 4 | B2 differs from transaction approval | TESTED | G/B1/B2 browser and focused |
| 5 | stale B1 discarded | BROWSER_QA | G/B1/B2 browser and focused |
| 6 | account switch revokes B2 | BROWSER_QA | G/B1/B2 browser and focused |
| 7 | chain switch revokes B2 | BROWSER_QA | G/B1/B2 browser and focused |
| 8 | AEI-B canonical compiler | TESTED | G/C/B/A browser and focused |
| 9 | compiled execution disabled | TESTED | G/C/B/A browser and focused |
| 10 | exact AEI-A v2 binding | ADVERSARIAL_RUNTIME | G/C/B/A browser and focused |
| 11 | v1 downgrade rejected | ADVERSARIAL_RUNTIME | G/C/B/A browser and focused |
| 12 | AEI-C canonical materialization | ADVERSARIAL_RUNTIME | G/C/B/A browser and focused |
| 13 | descriptor transplant rejected | ADVERSARIAL_RUNTIME | G/C/B/A browser and focused |
| 14 | key-order identity stable | PROPERTY_TESTED | G focused fixed-seed 64 permutations |
| 15 | AEI-D canonical orchestration | ADVERSARIAL_RUNTIME | G/D/E browser and Phase 9 focused |
| 16 | fake read rejected | ADVERSARIAL_RUNTIME | G/D/E browser and Phase 9 focused |
| 17 | fake quote rejected | ADVERSARIAL_RUNTIME | G/D/E browser and Phase 9 focused |
| 18 | quote freshness enforced | ADVERSARIAL_RUNTIME | G/D/E browser and Phase 9 focused |
| 19 | fake preparation rejected | ADVERSARIAL_RUNTIME | G/D/E browser and Phase 9 focused |
| 20 | actual Phase 9 evaluator required | TESTED | G/D/E browser and Phase 9 focused |
| 21 | BLOCK preserved | ADVERSARIAL_RUNTIME | G/D/E browser and Phase 9 focused |
| 22 | REQUOTE preserved | ADVERSARIAL_RUNTIME | G/D/E browser and Phase 9 focused |
| 23 | REVALIDATE preserved | ADVERSARIAL_RUNTIME | G/D/E browser and Phase 9 focused |
| 24 | REQUIRE_REVIEW preserved | ADVERSARIAL_RUNTIME | G/D/E browser and Phase 9 focused |
| 25 | WARN preserved | ADVERSARIAL_RUNTIME | G/D/E browser and Phase 9 focused |
| 26 | ALLOW is not approval | ADVERSARIAL_RUNTIME | G/D/E browser and Phase 9 focused |
| 27 | AEI-E canonical mapping | ADVERSARIAL_RUNTIME | G/E browser and focused reducer/restore |
| 28 | direct PREPARED mint rejected | ADVERSARIAL_RUNTIME | G/E browser and focused reducer/restore |
| 29 | restored PREPARED historical only | ADVERSARIAL_RUNTIME | G/E browser and focused reducer/restore |
| 30 | latest D orchestration enforced | ADVERSARIAL_RUNTIME | G/E browser and focused reducer/restore |
| 31 | AEI-F canonical composition | BROWSER_QA | G/E browser and focused reducer/restore |
| 32 | fresh E Review eligibility required | BROWSER_QA | G/E browser and focused reducer/restore |
| 33 | PREPARED alone insufficient | ADVERSARIAL_RUNTIME | G/E browser and focused reducer/restore |
| 34 | cached eligibility insufficient | ADVERSARIAL_RUNTIME | G/E browser and focused reducer/restore |
| 35 | Review inert | BROWSER_QA | G/F browser; E fresh validator |
| 36 | Review has no signer | TESTED | G/F browser; E fresh validator |
| 37 | Review has no wallet client | TESTED | G/F browser; E fresh validator |
| 38 | Review has no submit callback | TESTED | G/F browser; E fresh validator |
| 39 | Review immutable | ADVERSARIAL_RUNTIME | G/F browser; E fresh validator |
| 40 | older Review superseded | BROWSER_QA | G/F browser; E fresh validator |
| 41 | account switch invalidates Review | BROWSER_QA | G/F browser; E fresh validator |
| 42 | chain switch invalidates Review | BROWSER_QA | G/F browser; E fresh validator |
| 43 | quote expiry invalidates Review | BROWSER_QA | G/F browser; E fresh validator |
| 44 | preparation expiry invalidates Review | BROWSER_QA | G/F browser; E fresh validator |
| 45 | refresh restores no active Review | BROWSER_QA | G/F browser; E fresh validator |
| 46 | remount restores no authority | BROWSER_QA | G/F browser; E fresh validator |
| 47 | cancellation defeats late activation | BROWSER_QA | G/F browser; E fresh validator |
| 48 | stale request discarded | ADVERSARIAL_RUNTIME | G/F browser; E fresh validator |
| 49 | stale session discarded | ADVERSARIAL_RUNTIME | G/F browser; E fresh validator |
| 50 | duplicate B2 safe | BROWSER_QA | G/F browser; E fresh validator |
| 51 | duplicate Review-open safe | BROWSER_QA | G/F browser; E fresh validator |
| 52 | SEND facts truthful | BROWSER_QA | G/F browser; E fresh validator |
| 53 | SWAP facts truthful | BROWSER_QA | G/F browser; E fresh validator |
| 54 | finite approval exact | BROWSER_QA | G/F/D/E browser; route and policy source |
| 55 | approval separately reviewed | BROWSER_QA | G/F/D/E browser; route and policy source |
| 56 | swap separately reviewed | TESTED | G/F/D/E browser; route and policy source |
| 57 | no approval auto-submit | BROWSER_QA | G/F/D/E browser; route and policy source |
| 58 | no swap auto-submit | BROWSER_QA | G/F/D/E browser; route and policy source |
| 59 | PREPARED predecessor not complete | ADVERSARIAL_RUNTIME | G/F/D/E browser; route and policy source |
| 60 | ALLOW predecessor not complete | ADVERSARIAL_RUNTIME | G/F/D/E browser; route and policy source |
| 61 | runtime output not inferred | ADVERSARIAL_RUNTIME | G/F/D/E browser; route and policy source |
| 62 | cirBTC Swap rejected | BROWSER_QA | G/F/D/E browser; route and policy source |
| 63 | Direct CCTP truthful stop | BROWSER_QA | G/F/D/E browser; route and policy source |
| 64 | Circle App Kit truthful stop | SOURCE_INSPECTED | G/F/D/E browser; route and policy source |
| 65 | source receipt not destination completion | TESTED | G/F/D/E browser; route and policy source |
| 66 | unknown gas stays unknown | BROWSER_QA | G/F/D/E browser; route and policy source |
| 67 | no guessed fee | TESTED | G/F/D/E browser; route and policy source |
| 68 | no invented simulation | TESTED | G/F/D/E browser; route and policy source |
| 69 | no legacy execution fallback | BROWSER_QA | G/E/C browser and focused boundary attacks |
| 70 | no mock quote authority | ADVERSARIAL_RUNTIME | G/E/C browser and focused boundary attacks |
| 71 | persistence history only | ADVERSARIAL_RUNTIME | G/E/C browser and focused boundary attacks |
| 72 | caller rehash lacks authority | ADVERSARIAL_RUNTIME | G/E/C browser and focused boundary attacks |
| 73 | cross-Strategy transplant fails | ADVERSARIAL_RUNTIME | G/E/C browser and focused boundary attacks |
| 74 | cross-ACTION transplant fails | ADVERSARIAL_RUNTIME | G/E/C browser and focused boundary attacks |
| 75 | cross-account transplant fails | ADVERSARIAL_RUNTIME | G/E/C browser and focused boundary attacks |
| 76 | cross-chain transplant fails | ADVERSARIAL_RUNTIME | G/E/C browser and focused boundary attacks |
| 77 | cross-session transplant fails | ADVERSARIAL_RUNTIME | G/E/C browser and focused boundary attacks |
| 78 | technical-step transplant fails | ADVERSARIAL_RUNTIME | G/E/C browser and focused boundary attacks |
| 79 | no AEI wallet signature | SOURCE_INSPECTED | AEI import graph; G/F/E source and browser |
| 80 | no AEI transaction submission | SOURCE_INSPECTED | AEI import graph; G/F/E source and browser |
| 81 | no AEI receipt polling | SOURCE_INSPECTED | AEI import graph; G/F/E source and browser |
| 82 | no AEI retry | SOURCE_INSPECTED | AEI import graph; G/F/E source and browser |
| 83 | no AEI resubmit | SOURCE_INSPECTED | AEI import graph; G/F/E source and browser |
| 84 | no Phase 10F duplication | SOURCE_INSPECTED | AEI import graph; G/F/E source and browser |
| 85 | no hash minted | SOURCE_INSPECTED | AEI import graph; G/F/E source and browser |
| 86 | no attempt minted | SOURCE_INSPECTED | AEI import graph; G/F/E source and browser |
| 87 | no receipt minted | SOURCE_INSPECTED | AEI import graph; G/F/E source and browser |
| 88 | no dependent auto-execution | BROWSER_QA | AEI import graph; G/F/E source and browser |
| 89 | no false success copy | BROWSER_QA | AEI import graph; G/F/E source and browser |
| 90 | no false safe/verified copy | BROWSER_QA | AEI import graph; G/F/E source and browser |
| 91 | server secrets absent from client | SOURCE_INSPECTED | Planner route, static bundle, host trust inspection |
| 92 | B1 request body bounded | SOURCE_INSPECTED | Planner route, static bundle, host trust inspection |
| 93 | auth deployment gate documented | SOURCE_INSPECTED | Planner route, static bundle, host trust inspection |
| 94 | distributed rate-limit gate documented | SOURCE_INSPECTED | Planner route, static bundle, host trust inspection |
| 95 | provider abuse exposure documented | SOURCE_INSPECTED | Planner route, static bundle, host trust inspection |
| 96 | host trust limits documented | SOURCE_INSPECTED | Planner route, static bundle, host trust inspection |
| 97 | same-origin/XSS limit documented | SOURCE_INSPECTED | Planner route, static bundle, host trust inspection |
| 98 | final handoff intentionally unproven/deferred | DEFERRED_OUTSIDE_AEI | No final wallet handoff; AEI-F criterion 98 |
| 99 | future handoff checks preserved | SOURCE_INSPECTED | Planner route, static bundle, host trust inspection |
| 100 | no UI redesign in G | SOURCE_INSPECTED | G/E/C browser and focused boundary attacks |
| 101 | `makoto-wallet.zip` reference retained | SOURCE_INSPECTED | G/E/C browser and focused boundary attacks |
| 102 | Phase 13 untouched | SOURCE_INSPECTED | G/E/C browser and focused boundary attacks |
| 103 | full regressions exact result | TESTED | Verification table; git/status and scope inspection |
| 104 | typecheck exact result | TESTED | Verification table; git/status and scope inspection |
| 105 | lint exact result | TESTED | Verification table; git/status and scope inspection |
| 106 | production build exact result | TESTED | Verification table; git/status and scope inspection |
| 107 | root compile exact result | TESTED | Verification table; git/status and scope inspection |
| 108 | diff check exact result | TESTED | Verification table; git/status and scope inspection |
| 109 | worktree clean after commits | SOURCE_INSPECTED | Verification table; git/status and scope inspection |
| 110 | index clean after commits | SOURCE_INSPECTED | Verification table; git/status and scope inspection |
| 111 | no push | SOURCE_INSPECTED | Verification table; git/status and scope inspection |
| 112 | no deployment | SOURCE_INSPECTED | Verification table; git/status and scope inspection |
| 113 | deployment gate remains | SOURCE_INSPECTED | Verification table; git/status and scope inspection |
| 114 | closeout-readiness decision evidenced | SOURCE_INSPECTED | Verification table; git/status and scope inspection |
| 115 | canonical integration sequence retained | SOURCE_INSPECTED | Verification table; git/status and scope inspection |
| 116 | post-AEI UI port sequence retained | SOURCE_INSPECTED | Verification table; git/status and scope inspection |
| 117 | auth/rate hardening before deploy | SOURCE_INSPECTED | Verification table; git/status and scope inspection |
| 118 | full QA before deploy | SOURCE_INSPECTED | Verification table; git/status and scope inspection |
| 119 | deploy before Phase 13 | SOURCE_INSPECTED | Verification table; git/status and scope inspection |
| 120 | execution remains forbidden | SOURCE_INSPECTED | Verification table; git/status and scope inspection |
| 121 | account switch before B2 safe | BROWSER_QA | G/F browser account, chain and race fixtures |
| 122 | chain switch before B2 safe | BROWSER_QA | G/F browser account, chain and race fixtures |
| 123 | switch between B2 and D safe | BROWSER_QA | G/F browser account, chain and race fixtures |
| 124 | switch during D safe | BROWSER_QA | G/F browser account, chain and race fixtures |
| 125 | switch after E safe | BROWSER_QA | G/F browser account, chain and race fixtures |
| 126 | switch with Review open safe | BROWSER_QA | G/F browser account, chain and race fixtures |
| 127 | late B1 result ignored | BROWSER_QA | G/F browser account, chain and race fixtures |
| 128 | late D result ignored | BROWSER_QA | G/F browser account, chain and race fixtures |
| 129 | late E result ignored | BROWSER_QA | G/F browser account, chain and race fixtures |
| 130 | cancellation at every await safe | BROWSER_QA | G/F browser account, chain and race fixtures |
| 131 | hostile getter/Proxy guarded | ADVERSARIAL_RUNTIME | G focused/browser hostile and duplicate fixtures |
| 132 | symbol/extra keys guarded | ADVERSARIAL_RUNTIME | G focused/browser hostile and duplicate fixtures |
| 133 | primitive/null/array guarded | ADVERSARIAL_RUNTIME | G focused/browser hostile and duplicate fixtures |
| 134 | poisoned prototype/cycle guarded | ADVERSARIAL_RUNTIME | G focused/browser hostile and duplicate fixtures |
| 135 | malformed IDs/digests guarded | ADVERSARIAL_RUNTIME | G focused/browser hostile and duplicate fixtures |
| 136 | duplicate D/E registration safe | ADVERSARIAL_RUNTIME | G focused/browser hostile and duplicate fixtures |
| 137 | nested callback safe | ADVERSARIAL_RUNTIME | G focused/browser hostile and duplicate fixtures |
| 138 | Review never durable capability | BROWSER_QA | G/F browser account, chain and race fixtures |
| 139 | legacy draft isolation proven | BROWSER_QA | G/F browser account, chain and race fixtures |
| 140 | no prototype Surf authority imported | SOURCE_INSPECTED | G source inspection |

## Decision and next boundary

The one reproduced material boundary defect has a scoped, passing fix. AEI-G is **IMPLEMENTED / PENDING FINAL REVIEW**, with zero currently identified unexamined AEI-owned authority, provenance or currentness gates. The independent final adversarial review may challenge these classifications and must precede docs-only G closeout and final milestone integration review. The milestone is still OPEN. Criterion 98 is deferred, not proven; no wallet execution or final handoff was added. `makoto-wallet.zip` remains the canonical deferred UI/UX source. No push, deployment, auth/rate-limit implementation, Phase 13 work, receipt lifecycle, retry/resubmit or dependent-action auto execution occurred.
