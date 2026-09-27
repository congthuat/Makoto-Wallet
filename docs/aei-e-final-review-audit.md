# AEI-E final adversarial review

**Decision:** IMPLEMENTED / FINAL REVIEW PASSED / READY_TO_CLOSE, **not COMPLETE**. Baseline was clean `d8f0d9cc46ec03c21a61b38b8c1c042342432ec2` on `phase12h-planner-strategy-integration`. AEI-F is NEXT / NOT STARTED; AEI-G and Phase 13 are NOT STARTED.

## Authority trace and proof

For SEND and Xylo SWAP, the retained live B2/AEI-C input and exact registered AEI-D envelope enter `integrateAeiDOperationalState`. `validateAeiDOperationalEnvelope` verifies private object registration, envelope digest, live materialization source, current host account/chain, current quote/preparation expiry, and now the latest envelope for the selected ACTION. AEI-E checks the Phase 12 PLAN_READY session/plan, ACTION/goal, execution-forbidden flags, policy and preparation lineage. It derives an unsigned overlay and `AgentTransactionBinding` for the first technical step. A private `WeakMap` holds an empty frozen proof object bound to the from/to state IDs, exact D envelope and derived Strategy. Only the integration function creates that object. The reducer deletes the proof before checking its binding; replay, copy and JSON reconstruction cannot find the WeakMap entry. A failed transition or exception cannot return a registered PREPARED result. The accepted state and sidecar are registered by object identity only after the reducer accepts its single edge.

SEND maps to its SEND step. A Xylo finite approval maps to a separate derived APPROVE step at index 0; the SWAP step at index 1 remains gated by a future confirmed approval and fresh evidence. Neither mapping creates a wallet attempt, hash, receipt, submission time, signer, confirmation, user approval, or dependent-action completion. The reducer's other edges and Phase 10F remain independently guarded. A direct reducer call with a caller proof, sidecar, structural state or serialized data cannot mint authoritative PREPARED. Proof reuse is prevented by delete-before-validation; the public test and browser matrix exercise forged and duplicate entry attempts. The private proof itself is deliberately inaccessible through production exports, so a direct test holding the genuine proof is a source-inspected invariant rather than a claimed black-box runtime test.

## Material finding and fix

The prior AEI-E `latestOperationalDigest` advanced only when AEI-E integrated a D result. A newer D orchestration for the same ACTION, left unmapped by E, did not revoke an older E review result. A new deterministic browser regression failed with the old result still eligible. The scoped fix makes AEI-D's live registration track the latest envelope object per session/Strategy/ACTION/account/chain and checks it before and after its asynchronous host observation. Thus a newer ALLOW, BLOCK, REQUOTE, REVALIDATE or changed preparation/policy envelope supersedes the earlier one without requiring E to map it. This is runtime object identity, not cryptographic proof or digest self-authentication. The regression then passed. A fresh review call is instantaneous evidence; AEI-F must call `validateAeiEReviewEligibility` at the actual later Review boundary and must not cache its boolean. A subsequent switch, expiry or newer orchestration requires another check.

## State, currentness and history

AEI-E's live eligibility requires its private result registration, exact immutable state/sidecar identity, latest E lineage and fresh D validation. The D validator checks current host account/Arc chain, materialization source and quote/preparation expiry. Account/chain switch, disconnect, changed observation on reconnect, quote/preparation expiry, or newer D lineage yields stale eligibility. Same-account reconnect with an indistinguishable reused host observation is not detectible; the host must report truthful current observations. Policy and quote/preparation mutations require a new D envelope and therefore supersede old authority. Mixed quote, preparation and policy lineages cannot pass D/E bindings. The validator's result grants no durable capability.

BLOCK, REQUOTE, REVALIDATE, handoff, unsupported and read/quote/preparation failure keep Phase 12 at PLAN_READY with a typed sidecar; no transaction `FAILED`, `EXPIRED`, bridging or automatic retry is inferred. REQUIRE_REVIEW and WARN facts are retained. ALLOW permits only possible later Review after fresh checks. B2 confirms Planner parameters only, never a transaction. Direct CCTP remains `HANDOFF_REQUIRED` or unsupported; Circle App Kit canonical Agent PREPARE is unsupported. A source receipt cannot establish destination completion.

The additive storage record contains bounded `{state, sidecar}` snapshots with `HISTORICAL` currentness. Restore parses closed schemas and exact account/chain/session/state bindings; it never calls D, populates a proof or live registry, starts a transition, or invokes a wallet. Legacy v2 state history remains separately readable and gains no AEI-E authority. Fake currentness fields, copied sidecars and recomputed public digests cannot register a live result. Saved PREPARED, WARN, REQUIRE_REVIEW and stop outcomes remain descriptive history only. Technical step ID/index/kind and prepared reference bind approval separately from swap. PREPARED and policy ALLOW cannot satisfy a dependent ACTION or provide a verified runtime output.

## Verification and limits

The deterministic AEI-E browser matrix passed **70/70** after the fix, including the new failing-first unmapped-supersession case. AEI-D browser passed **104/104**, AEI-C **135/135**, AEI-B final browser **91/91**, and eight B1/B2 browser scenarios passed. Sequential focused counts: AEI-E **4/4**, Phase 12 **32/32**, persistence/recovery **22/22**, Phase 10F **30/30**, D **3/3**, C **4/4**, B2 **5/5**, provenance **8/8**, AEI-B **9/9**, AEI-A **15/15**, B1 **16/16**, selected Planner **19/19**, Strategy **28/28**, Phase 9 **20/20**, and Agent Tools **46/46**. Full frontend passed **1535/1535**. Typecheck, isolated offline-lockfile Turbopack production build, root Hardhat compile (`Nothing to compile`) and `git diff --check` passed. Lint passed with zero errors and seven inherited warnings after removing an unused AEI-E browser variable. No live model, RPC, provider or wallet calls were made by the local fixture. The production AEI-E path has no read/quote/prepare invocation, wallet call, signer, submission, receipt poller, retry or resubmit; D owns the earlier operational read/quote/prepare acquisition. The application host and same-origin runtime remain trust boundaries. No cryptographic attestation of host data or human approval is claimed.

The 80 approved criteria are classified below using the implementation audit's case numbers. `A` means adversarial deterministic browser runtime, `T` focused runtime, `S` source and import-path inspection. An `S` classification is not represented as a direct runtime attack. Material authority/currentness/restore criteria with no examination: **0**. This does not claim a live chain test, a wallet Review implementation or AEI-F readiness to deploy.

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
| 38 | ADVERSARIAL_RUNTIME | D latest-object supersession and C revision binding | 78 | TESTED | hostile boundary inputs |
| 39 | ADVERSARIAL_RUNTIME | new D policy lineage revokes; digest bound | 79 | TESTED | currentness requires registry |
| 40 | ADVERSARIAL_RUNTIME | new preparation lineage revokes; digest bound | 80 | SOURCE_INSPECTED | no UI/Phase 13 edits |
