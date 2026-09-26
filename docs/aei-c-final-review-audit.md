# AEI-C final adversarial review — ready to close

**Baseline:** clean `bb73983608635fce3b08c573ae2f6773997f58c6` on `phase12h-planner-strategy-integration`. **Decision:** AEI-C IMPLEMENTED / FINAL REVIEW PASSED / READY_TO_CLOSE, not COMPLETE. AEI-D is NEXT / NOT STARTED; AEI-E/F/G and Phase 13 are NOT STARTED.

## Defect reproduced and fixed

The first new browser assertion failed: reordered fields of a confirmed semantic intent produced the same materialization digest but a different byte serialization of the descriptor. The producer copied `PlannerIntent` with object spread, preserving the caller's property insertion order. The scoped fix emits SEND, SWAP and BRIDGE parameters in a fixed field order after the authoritative upstream validation. Repeating the assertion now yields a byte-identical complete artifact. No semantic value, upstream authority or hash tuple changed. Runtime/test fix: `f9ab94fbc36c212becde67af7c6a02eeed2e317d`.

## Trust and artifact findings

The B2 control creates the source after an owned, browser-trusted confirmation of the exact retained B1 proposal. A module-private WeakMap stores its object identity, descriptor-safe snapshot, proposal digest and active bit. The predicate rejects copied JSON and source mutation; unmount or proposal/session identity change revokes it. AEI-C snapshots the closed input, extracts only the original `bindingSource.provenanceSource` descriptor value, checks the private live predicate and snapshot equality, validates the AEI-A v2 binding, then runs the same AEI-B compiler against that live source. The compiled result must equal the supplied result. Request/session/plan/proposal/evidence/goal/action/Strategy substitutions reject; serialized evidence and matching public digests alone cannot succeed. This is application interaction authority, not cryptographic human-origin proof or protection against arbitrary same-origin/XSS code.

The envelope carries exact B1 request/session/proposal, Planner plan, evidence-set, Strategy/binding and ordered ACTION lineage. Descriptors bind parent Strategy digest, binding digest, revision, goal/step IDs, static parameters and dependencies. The validator rematerializes from the *current live source* and compares the entire candidate to the canonical result. It rejects a descriptor transplanted from another Strategy and from the same ACTION ID under a changed Strategy revision. A complete old envelope fails under changed request, session, proposal, plan, evidence, Strategy revision or revoked source. A caller recomputed a valid action hash and outer hash for a changed amount; validation still rejected because the live upstream chain did not authorize that content. Digests are content identities, not independent authority.

Property insertion order is inert in validated data and artifacts. The compiler sorts goal IDs for Strategy step order; AEI-C retains that exact Strategy ACTION sequence. Dependency IDs are canonical sorted sets after upstream graph validation; evidence array order, requirements list order and descriptor array order remain checked. The revision hashes the exact v2 binding and Strategy content digests. Fresh `createdAt: 2` compilation retained semantic Strategy/ACTION IDs but changed binding, revision and set digest as approved. A caller edit to `createdAt` without a new binding rejected. No ambient clock, display label or metadata enters AEI-C; the bound host creation time is content provenance, not freshness evidence. Changed amount can produce a new revision only after fresh confirmation; other unconfirmed semantic mutations reject.

SEND carries exact Arc asset, amount, recipient and chain. SWAP carries only the supported Arc USDC/EURC direction, amount and chain; cirBTC cannot enter the upstream fixed Swap contract. BRIDGE carries only Arc Testnet USDC to Base Sepolia semantic intent and recipient. It claims no Direct CCTP Agent handoff, Circle App Kit canonical PREPARE or destination completion from a source receipt. A SWAP→SEND edge preserves order, never supplies a runtime amount; percentage, all-received, receipt-derived and remaining-balance semantics remain unresolved upstream. The complete fixed two-goal Strategy retains its exact goal/action mapping and edge.

Each action has seven *unsatisfied* downstream requirement declarations: account context, live read, quote, policy evaluation, preparation, explicit review and supported wallet handoff. They are neither Phase 9 decisions nor evidence that the requirement is met. AEI-C has no account field or connected-wallet/local-storage lookup. Import tracing found only deterministic validators, canonical hashing, React's B2 control definition and local asset/swap capability helpers; the imported swap module defines operational functions but AEI-C calls only its pure asset-pair predicate through `validatePlannerIntent`. No import initializer or AEI-C call performs fetch, RPC, tool acquisition, Phase 9, preparation, wallet operation, submission, receipt or retry. AEI-D receives the validated envelope, semantic action, exact lineage and requirements without UI-text reconstruction; it must separately bind account and operational evidence.

The public boundary returns typed `REJECTED` outcomes for hostile input without an escaping exception. A mutation of previously trusted field evidence may be classified as `MISSING_PARAMETER_EVIDENCE` or `BINDING_MISMATCH` before its unsupported asset/chain value is considered: live provenance fails first. This is intentional fail-closed precedence, not acceptance of an unsupported route. The validator rejects malformed, extended, mutated and caller-rehashed artifacts against current live provenance.

## Fifty-criterion classification

`ADVERSARIAL_RUNTIME` means the live synthetic B2 browser matrix exercised AEI-C with genuine in-process confirmation authority. `TESTED` means focused upstream/unit regression. `SOURCE_INSPECTED` means the closed type/import/call graph was reviewed; it is used for absence-of-operation claims, not as sole proof of live provenance. **NOT_PROVEN: 0** for material trust, provenance and authority guarantees.

| # | Class | Evidence | # | Class | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | ADVERSARIAL_RUNTIME | SEND | 26 | ADVERSARIAL_RUNTIME | chain substitution rejects |
| 2 | ADVERSARIAL_RUNTIME | SWAP | 27 | ADVERSARIAL_RUNTIME | missing amount rejects |
| 3 | ADVERSARIAL_RUNTIME | BRIDGE | 28 | ADVERSARIAL_RUNTIME | duplicate ACTION rejects |
| 4 | ADVERSARIAL_RUNTIME | two actions and edge | 29 | ADVERSARIAL_RUNTIME | duplicate map rejects |
| 5 | ADVERSARIAL_RUNTIME | Strategy ID | 30 | ADVERSARIAL_RUNTIME | unknown edge rejects; upstream cycle tests |
| 6 | ADVERSARIAL_RUNTIME | Strategy digest | 31 | SOURCE_INSPECTED | no quote call |
| 7 | ADVERSARIAL_RUNTIME | v2 revalidation/tamper | 32 | SOURCE_INSPECTED | no provider call |
| 8 | ADVERSARIAL_RUNTIME | v2 digest | 33 | SOURCE_INSPECTED | no RPC call |
| 9 | ADVERSARIAL_RUNTIME | step IDs | 34 | SOURCE_INSPECTED | no policy result/call |
| 10 | ADVERSARIAL_RUNTIME | goal IDs | 35 | SOURCE_INSPECTED | no preparation call |
| 11 | ADVERSARIAL_RUNTIME | exact mapping | 36 | SOURCE_INSPECTED | no calldata field |
| 12 | ADVERSARIAL_RUNTIME | exact intents and byte order | 37 | SOURCE_INSPECTED | no wallet client |
| 13 | ADVERSARIAL_RUNTIME | dependency edge | 38 | SOURCE_INSPECTED | no signer |
| 14 | ADVERSARIAL_RUNTIME | repeated digest/revision | 39 | SOURCE_INSPECTED | no submission call |
| 15 | ADVERSARIAL_RUNTIME | reordered objects/artifacts | 40 | SOURCE_INSPECTED | no retry/resubmit call |
| 16 | ADVERSARIAL_RUNTIME | fresh amount/revision | 41 | SOURCE_INSPECTED | no account source/field |
| 17 | ADVERSARIAL_RUNTIME | recipient substitution rejects | 42 | ADVERSARIAL_RUNTIME | exact unsatisfied list; mutation rejects |
| 18 | ADVERSARIAL_RUNTIME | chain substitution rejects | 43 | ADVERSARIAL_RUNTIME | cross-Strategy and same-ID revision transplant |
| 19 | ADVERSARIAL_RUNTIME | dependency substitution rejects | 44 | TESTED | loose Agent draft cannot pass closed input |
| 20 | ADVERSARIAL_RUNTIME | Strategy/revision reuse rejects | 45 | TESTED | wallet draft cannot pass closed input |
| 21 | ADVERSARIAL_RUNTIME | v1 rejects | 46 | TESTED | dynamic evidence/compilation regressions |
| 22 | ADVERSARIAL_RUNTIME | malformed v2 rejects | 47 | TESTED | PlannerIntent pair/asset tests and live tamper |
| 23 | ADVERSARIAL_RUNTIME | enabled rejects | 48 | SOURCE_INSPECTED | Bridge is semantic only; handoff requirement unsatisfied |
| 24 | ADVERSARIAL_RUNTIME | unsupported action rejects | 49 | SOURCE_INSPECTED | no App Kit PREPARE claim/call |
| 25 | ADVERSARIAL_RUNTIME | unsupported asset rejects | 50 | ADVERSARIAL_RUNTIME | complete lineage/requirements asserted |

## Verification and limitations

Sequential results: AEI-C live adversarial matrix **135/135**; AEI-B final browser matrix **91/91**; AEI-C focused **4/4**; AEI-B **9/9**; B2 **5/5**; provenance **8/8**; AEI-A **15/15**; B1 **26/26**; selected Phase 11 Planner **55/55**; Strategy **62/62**; Agent regressions **301/301**; full frontend **1528/1528**. No authoritative separate Phase 12 aggregate command exists in this worktree; Phase 12 is covered by full frontend and the available focused Agent/state tests. Typecheck **PASS**; lint **0 errors / 7 inherited warnings**; normal Turbopack build **PASS** in an isolated source copy with local lockfile dependencies; root contract compile **PASS** (`Nothing to compile`); diff checks **PASS**. Browser tests use a local synthetic fixture. No live provider/model, RPC, wallet or transaction call, push or deployment occurred. The worktree `node_modules` junction was untouched.

The application-level B2 authority does not protect against full same-origin compromise. Direct CCTP Agent handoff, Circle App Kit canonical PREPARE and dynamic output-derived amounts remain unsupported. The paid Planner proposal route remains **DEPLOYMENT_GATED_BY_AUTH_AND_RATE_LIMIT** pending server-side authentication and distributed rate limiting. AEI-D/E/F/G and Phase 13 are not started.
