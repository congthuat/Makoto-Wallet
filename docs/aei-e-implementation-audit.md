# AEI-E implementation audit

**Status:** IMPLEMENTED / PENDING REVIEW, NOT COMPLETE. Resumed from `733c1dabfb4319297cb6057fdf88cc6642efbd92` with inherited uncommitted AEI-E work. Runtime, tests and browser fixture were committed at `597156a`. AEI-A/B/B1/B2/C/D remain COMPLETE / CLOSED. AEI-F/G and Phase 13 have not started.

## Authority and state trace

`integrateAeiDOperationalState` consumes the exact privately registered AEI-D envelope and retained live source, revalidates both before the one reducer edge, and binds the existing `PLAN_READY` session/plan to the selected Strategy ACTION, goal, Arc account and chain. The private one-use `AEI_E_PREPARED` proof allows only `PLAN_READY → TRANSACTION/PREPARED`. A public caller's JSON, copied envelope, matching digest, or copied proof cannot mint that edge. The existing Phase 12 v2 state validator, reducer, transaction binder, recovery, and persistence rules remain the lifecycle authority.

For a review-eligible SEND or SWAP, the adapter validates a separate prepared Strategy overlay and binds quote fingerprint, prepared tool and technical step index. A finite Xylo approval uses a distinct derived APPROVE step; the swap remains a later step requiring confirmed approval and fresh validation. PREPARED is unsigned and unsubmitted, with no attempt ID, hash or receipt. BLOCK, REQUOTE, REVALIDATE, handoff, unsupported and operational failures leave the v2 state at PLAN_READY with exact typed sidecar facts. WARN and REQUIRE_REVIEW remain explicit; ALLOW permits only later Review eligibility. B2 parameter confirmation is not transaction approval.

The sidecar binds the state ID, Strategy/ACTION/goal, skeleton and overlay digests, materialization and D revisions/digests, account/chain, read/quote/preparation/policy lineage, technical step, warnings and review requirements. `validateAeiEReviewEligibility` and `evaluateAeiECurrentness` require the private live integration, latest ACTION lineage, exact state/sidecar identity and fresh AEI-D validation at the time of the check. A saved issuance label is not current authority. Account or chain change, disconnect/reconnect, quote/preparation expiry, newer quote/policy lineage, or loss of D registration revokes current eligibility without rewriting historical facts.

`storeAeiEHistoricalState` writes bounded `{ state, sidecar }` records together under an additive scoped key. Restore validates the entire closed composite and returns `HISTORICAL` only. JSON restore cannot recreate the private AEI-D or AEI-E registration, and caller rehashing cannot regain live Review. The original `makoto.agent.state.v2` storage contract is unchanged. Phase 10F alone owns wallet attempts, ambiguous submission, retry and duplicate transaction safety. AEI-E has no signer, submitter, receipt poller or dependent ACTION runner. Direct CCTP remains handoff required; Circle App Kit Agent PREPARE remains unsupported; source confirmation is not destination completion.

## Verification

Local deterministic checks after resumption:

| Gate | Result |
| --- | --- |
| AEI-E focused | 4/4 pass |
| AEI-E browser/adversarial | 69/69 pass |
| Phase 12 transition/state/presentation | 32/32 pass |
| Phase 12 persistence/recovery | 22/22 pass |
| Phase 10F receipt/recovery/continuation | 30/30 pass |
| AEI-D focused/browser | 3/3 and 104/104 pass |
| AEI-C focused/browser | 4/4 and 135/135 pass |
| AEI-B final browser | 91/91 pass |
| B2 / provenance | 5/5 and 8/8 pass |
| AEI-B / AEI-A / B1 focused | 24/24, 23/23, 3/3 pass |
| B1/B2 browser | 8 named scenarios pass |
| Planner / Strategy / Phase 9 | 33/33, 25/25, 20/20 pass |
| Agent and Tool Layer | 46/46 pass |
| Full frontend | 1535/1535 pass |
| Typecheck | pass |
| Lint | 0 errors, 7 inherited warnings |
| Isolated local dependency Turbopack build | pass |
| Root contract compile | pass |
| `git diff --check` | pass |

The browser fixture used local deterministic services. No live model, provider, RPC or wallet call occurred in tests. The inherited `node_modules` junction was left untouched; the production build used a clean source copy and local lockfile installation. Source inspection of AEI-E runtime and persistence found no fetch/RPC, quote/prepare reacquisition, wallet request, signing, submission, receipt polling, retry or resubmit path. No push or deployment occurred.

## Approved 80 criteria

`TESTED` means focused runtime tests, `ADVERSARIAL_RUNTIME` means the deterministic browser matrix, and `SOURCE_INSPECTED` means code and upstream boundary inspection. These classifications are evidence types, not a claim of live chain verification. Material authority/currentness/restore criteria marked `NOT_PROVEN`: **0**.

| # | Classification | Evidence | # | Classification | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | ADVERSARIAL_RUNTIME | SEND PREPARED | 41 | ADVERSARIAL_RUNTIME | fresh quote lineage |
| 2 | ADVERSARIAL_RUNTIME | SWAP approval PREPARED | 42 | ADVERSARIAL_RUNTIME | old quote history |
| 3 | ADVERSARIAL_RUNTIME | Bridge handoff | 43 | SOURCE_INSPECTED | no Planner/provider call |
| 4 | SOURCE_INSPECTED | D unsupported route retained | 44 | SOURCE_INSPECTED | IDs from registered D |
| 5 | SOURCE_INSPECTED | D and Strategy validators | 45 | ADVERSARIAL_RUNTIME | distinct ACTION records |
| 6 | ADVERSARIAL_RUNTIME | ACTION/goal sidecar | 46 | ADVERSARIAL_RUNTIME | dependency blocked |
| 7 | ADVERSARIAL_RUNTIME | account binding/switch | 47 | ADVERSARIAL_RUNTIME | ALLOW predecessor blocked |
| 8 | ADVERSARIAL_RUNTIME | Arc chain/switch | 48 | SOURCE_INSPECTED | D/C runtime output boundary |
| 9 | ADVERSARIAL_RUNTIME | C revision/digest | 49 | SOURCE_INSPECTED | no continuation call |
| 10 | ADVERSARIAL_RUNTIME | D revision/digest | 50 | SOURCE_INSPECTED | B2 only upstream input |
| 11 | ADVERSARIAL_RUNTIME | overlay/index | 51 | TESTED | side effect scan |
| 12 | ADVERSARIAL_RUNTIME | policy lineage | 52 | TESTED | side effect scan |
| 13 | SOURCE_INSPECTED | BLOCK outcome mapping | 53 | TESTED | side effect scan |
| 14 | ADVERSARIAL_RUNTIME | REQUOTE PLAN_READY | 54 | TESTED | side effect scan |
| 15 | ADVERSARIAL_RUNTIME | REVALIDATE PLAN_READY | 55 | TESTED | side effect scan |
| 16 | ADVERSARIAL_RUNTIME | REQUIRE_REVIEW | 56 | SOURCE_INSPECTED | 10F remains separate |
| 17 | ADVERSARIAL_RUNTIME | warning retained | 57 | ADVERSARIAL_RUNTIME | no hash |
| 18 | ADVERSARIAL_RUNTIME | ALLOW PREPARED only | 58 | ADVERSARIAL_RUNTIME | operational failure PLAN_READY |
| 19 | ADVERSARIAL_RUNTIME | no approval field | 59 | ADVERSARIAL_RUNTIME | approval no attempt/hash |
| 20 | SOURCE_INSPECTED | v2 PREPARED schema | 60 | SOURCE_INSPECTED | swap later step |
| 21 | ADVERSARIAL_RUNTIME | no submitted state | 61 | ADVERSARIAL_RUNTIME | Bridge PLAN_READY |
| 22 | ADVERSARIAL_RUNTIME | no hash | 62 | TESTED | existing CCTP scope tests |
| 23 | ADVERSARIAL_RUNTIME | no receipt | 63 | SOURCE_INSPECTED | exported exact integration result |
| 24 | ADVERSARIAL_RUNTIME | copied D rejected | 64 | ADVERSARIAL_RUNTIME | restored Review denied |
| 25 | SOURCE_INSPECTED | D live validator | 65 | ADVERSARIAL_RUNTIME | forbidden flags |
| 26 | ADVERSARIAL_RUNTIME | quote expiry | 66 | TESTED | private proof guard |
| 27 | ADVERSARIAL_RUNTIME | prepared expiry and D validator | 67 | TESTED | loose reducer proof denied |
| 28 | ADVERSARIAL_RUNTIME | account switch | 68 | TESTED | direct edge denied |
| 29 | ADVERSARIAL_RUNTIME | chain switch | 69 | ADVERSARIAL_RUNTIME | PREPARED no attempt |
| 30 | ADVERSARIAL_RUNTIME | disconnect/reconnect | 70 | SOURCE_INSPECTED | 10F attempt ownership |
| 31 | ADVERSARIAL_RUNTIME | restored HISTORICAL | 71 | ADVERSARIAL_RUNTIME | exact state ID |
| 32 | ADVERSARIAL_RUNTIME | restore Review denied | 72 | ADVERSARIAL_RUNTIME | composite persistence |
| 33 | TESTED | caller rehash denied | 73 | TESTED | legacy state cannot store sidecar |
| 34 | SOURCE_INSPECTED | D Strategy registration | 74 | ADVERSARIAL_RUNTIME | wrong plan/session |
| 35 | ADVERSARIAL_RUNTIME | action/goal binding | 75 | SOURCE_INSPECTED | prepared binder and tool schema |
| 36 | ADVERSARIAL_RUNTIME | account transplant denied | 76 | ADVERSARIAL_RUNTIME | approval first, swap gated |
| 37 | ADVERSARIAL_RUNTIME | chain transplant denied | 77 | SOURCE_INSPECTED | typed unsupported overlay |
| 38 | SOURCE_INSPECTED | D/C revisions privately bound | 78 | TESTED | hostile boundary inputs |
| 39 | SOURCE_INSPECTED | D policy digest validation | 79 | TESTED | currentness requires registry |
| 40 | SOURCE_INSPECTED | D prepared digest validation | 80 | SOURCE_INSPECTED | no UI/Phase 13 edits |

## Remaining limits

The host wallet read context and service ports are application trust boundaries; they are not cryptographic account authentication or proof that an external provider is honest. AEI-F must separately perform final transaction Review and wallet handoff, and AEI-G must perform final adversarial review. Deployment stays **DEPLOYMENT_GATED_BY_AUTH_AND_RATE_LIMIT**. The canonical deferred visual/UX reference is `makoto-wallet.zip` after AEI-G.
