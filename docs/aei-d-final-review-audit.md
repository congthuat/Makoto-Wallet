# AEI-D final adversarial review

**Decision:** IMPLEMENTED / FINAL REVIEW PASSED / READY_TO_CLOSE, **not COMPLETE**. Baseline branch `phase12h-planner-strategy-integration`, HEAD `0f101fc4ff05ffaf32625d92e2ac528f212e706d`, clean index/worktree. This review did not start AEI-E, connect a production UI caller, call live providers/RPC/models/wallets, push or deploy.

## Authority trace

| Transition | Entering proof and validator | Leaving proof | Authority gained |
| --- | --- | --- | --- |
| B2 / AEI-B / AEI-C to D | Retained private B2 live source; `validateStrategyMaterialization` reruns v2 binding and compiler checks against exact Strategy and ACTION | Exact `SEMANTIC_ONLY` descriptor, revision and digest | Semantic identity only |
| Selected ACTION to account | Host `current()` supplies `WalletReadContext` and `AgentContextSnapshot`; `accountOf` checks connected address, wallet kind, Arc chain and snapshot age | Account digest/revision bound to descriptor | Current read identity, not signer authority |
| Account to reads | `runReadTool`, `validateReadResult`, account/chain and live balance/allowance checks | Action/account/chain-bound read wrappers | Operational observation, not receipt truth |
| Reads to quote | Exact SEND or SWAP `QuoteRequest`; `runQuoteTool` and `validateQuoteResult`; Xylo or Arc RPC route and explicit expiry | Preflight quote wrapper | Current quote evidence, not provider cryptographic proof |
| Quote to preparation | Deterministic preflight; `runPrepareTool` reacquires quote and balance; observation callbacks capture values used; result and fingerprint validated; post-prepare reads agree | Refreshed quote and unsigned prepared steps bound to all prior evidence | Prepared data only |
| Preparation to Phase 9 | Exact action/account/chain, wallet/network reads, refreshed quote and prepared result passed to `evaluatePolicy` | Actual evaluator decision and full findings | Policy evidence only |
| Policy to D envelope | Content digests, immutable snapshot, private WeakMap registration and live validator | `OPERATIONAL_ONLY`, `executionEnabled: false`, `executionAuthority: FORBIDDEN` | Later review eligibility only for nonstopping outcomes |

The same trace was exercised for SEND and SWAP with deterministic local services. No transition grants transaction approval, wallet consent, signing, submission, receipt, completion, retry or dependent-action continuation. The host/provider ports are application trust boundaries. Arbitrary compromised same-origin code or a malicious host is outside their guarantee; digests do not cryptographically attest RPC data or a human.

## Findings and scoped fix

The live validator previously rechecked only account context and AEI-C provenance. A review-eligible SWAP envelope could validate after its quote expired while a retained account snapshot was still within its 30-second window. A browser regression using a near-expiry Xylo quote failed first (`true` where `false` was required). The validator now checks current quote validity, prepared expiry and policy observation time for `ORCHESTRATED` and `REVIEW_REQUIRED`. The new browser matrix passes **104/104**. Historical stop envelopes remain inspectable; this check governs live progression eligibility.

Account address and Arc chain originate from host-owned wallet read context and matching Agent snapshot, never AEI-D request fields. `contextRevision` includes wallet/connector observations and snapshot timestamp; account digest also binds kind, account and chain. Host `current()` is sampled initially, after reads, after first quote, after preparation, after post-prepare reads, after policy and at later envelope validation. A different account, chain or disconnect invalidates the current result. A host that reuses an identical stale snapshot within its allowed 30 seconds cannot prove an intervening switch-and-back; the host must maintain truthful current observations. This is an explicit application-host limitation, not claimed cryptographic account authentication.

Read and quote JSON cannot be passed into `orchestrate`; D calls Phase 8 tools through host ports, validates/copies their results, binds exact ACTION/account/chain/materialization and registers only the final envelope privately. Fake read/quote/prepared/policy JSON or a caller-recomputed digest cannot enter through public D inputs or register an envelope. A malicious host service can lie about external data; downstream wallet review must refresh and simulate. SWAP quotes are Xylo USDC/EURC only; cirBTC and unsupported pairs fail upstream. SEND fee is an estimate, and SWAP gas stays `not-estimated`. Phase 9 is intentionally **after** preparation; earlier checks are deterministic preflight, not an ALLOW decision.

The observation callbacks accept no replacement data and run only on the actual reacquired quote and balance. Their return values are ignored. A thrown callback prevents a successful prepared result; missing or mismatched observations fail D. The callback quote can precede PREPARE's expected/live equality check, but D accepts it only after PREPARE returns `PREPARED` and the fingerprint and schema match. The preflight quote is retained separately; the internally refreshed quote is bound to prepared and policy evidence. Requote and revalidation stop the current attempt; a new invocation must reacquire quote, reads, preparation and policy. No old prepared step is promoted.

Phase 9 precedence in `policyEngine.ts` is **BLOCK > REQUOTE > REVALIDATE > REQUIRE_REVIEW > WARN > ALLOW**. BLOCK, REQUOTE and REVALIDATE are stopping outcomes; REQUIRE_REVIEW remains explicit; WARN remains in findings/warnings; ALLOW only permits later review. The Xylo approval step is exact finite input amount to the canonical spender, followed by a separately reviewable swap step with `requiresConfirmedPriorStep`; neither step is submitted. Direct CCTP returns typed handoff/unsupported outcomes, Circle App Kit Agent PREPARE stays unsupported, and source receipt never means destination completion. Dependency edges block a selected dependent ACTION even if its predecessor was prepared or got ALLOW. A runtime-output-dependent amount remains unsupported upstream.

The D envelope retains ACTION, account, chain, read/quote/prepared/policy digests, decision, warnings, requirements and whole dependency graph for AEI-E/F. AEI-E must still define the guarded Phase 12 edge and AEI-F must still compose explicit transaction Review and later receipt/revalidation. D imports no signer, wallet execution adapter, Phase 12 transition or Phase 10F retry authority. Its `PrepareResult` has unsigned calldata as data only. No secret/provider client is serialized by the bounded evidence copier.

## 64 implementation criteria, reclassified

**A** = adversarial runtime browser; **T** = focused/runtime test; **S** = source inspected, with upstream test where stated. These are review evidence classifications, not claims of live chain verification. No material authority/trust criterion is unexamined; external host truth and future AEI-E/F consumers remain separate contracts.

| # | Classification and evidence | # | Classification and evidence |
| --- | --- | --- | --- |
| 1 | A: SEND | 33 | A/S: unsigned steps |
| 2 | A: SWAP | 34 | A/S: no submission port |
| 3 | A: BRIDGE typed capability | 35 | A/T: exact finite approval |
| 4 | A: unsupported handoff | 36 | A: approval identity/order |
| 5 | A/T: live AEI-C | 37 | S: no approval submit |
| 6 | A: ACTION digest | 38 | S: no action submit |
| 7 | A: host account/chain | 39 | S: no signer call |
| 8 | A: wrong account | 40 | S: no receipt poll |
| 9 | A: account switch | 41 | S: no retry/resubmit |
| 10 | A: chain switch | 42 | T/S: cirBTC rejected upstream |
| 11 | A: Phase 8 reads | 43 | A/T: Xylo pair/slippage |
| 12 | A/S: no foreign read input | 44 | A/S: CCTP handoff stop |
| 13 | A: changed live read | 45 | A/T: App Kit PREPARE unsupported |
| 14 | A: Xylo quote path | 46 | S: no destination claim |
| 15 | A/T: quote amount | 47 | A: unknown gas |
| 16 | A/T: quote pair | 48 | A/T: fee estimate boundary |
| 17 | A: account/chain quote | 49 | A: dependency graph |
| 18 | A/S: no foreign quote input | 50 | A/T: order not value |
| 19 | A: expired quote | 51 | T: dynamic value blocked upstream |
| 20 | A: changed quote stop | 52 | A/T: descriptor transplant |
| 21 | A: fresh quote/prep link | 53 | A/T: fake account refused |
| 22 | A/S: Phase 9 inputs | 54 | A/S: fake/foreign read cannot enter |
| 23 | T/S: BLOCK mapping | 55 | A/S: fake/foreign quote cannot enter |
| 24 | A/T: REQUOTE stop | 56 | A/S: fake policy cannot enter |
| 25 | A/T: REVALIDATE stop | 57 | A/S: fake prepared cannot enter |
| 26 | A/T: review requirement | 58 | S: bounded data copy, no clients |
| 27 | A/T: WARN retained | 59 | A/S: AEI-E facts present |
| 28 | A/S: ALLOW no wallet | 60 | A/S: AEI-F lineage present |
| 29 | A/S: preflight ordering | 61 | A: forbidden envelope |
| 30 | A/S: prepared binding | 62 | A: digest nonauthority |
| 31 | A: refreshed quote/reads/policy | 63 | A: late context rejection |
| 32 | A/S: transplant refused | 64 | T/S: Phase 12 guard unchanged |

Runtime-specific gaps in the original implementation audit were strengthened by the new expired-envelope regression. Fake externally supplied intermediate evidence is structurally excluded by the public API and private registration; a hostile host itself is outside this model. Source-only absence checks above are direct import/call-path inspections, not proof about future AEI-E/F code.

## Verification

Sequential, local-only checks after the fix: AEI-D browser **104/104**; AEI-D focused **3/3**; AEI-C focused **4/4** and browser **135/135**; AEI-B final browser **91/91**; AEI-B **9/9**; B2 **5/5** plus B1/B2 browser scenarios; provenance **8/8**; AEI-A **15/15**; B1 **26/26**; selected Planner **52/52**; Strategy **62/62**; Phase 9 **28/28**; focused Phase 12 **54/54**; Agent/Tool Layer **54/54**; full frontend **1531/1531**. Typecheck passed; lint had **0 errors / 7 inherited warnings**; normal Turbopack production build passed from an isolated local-lockfile source copy; root Hardhat compile passed (`Nothing to compile`). No live external calls.

The inherited `node_modules` junction was accidentally disturbed during test-copy setup and was restored to its original target; the target's packages were reinstalled from its lockfile. Both worktrees' tracked status was checked afterward. The temporary isolated copy's `npm test` cannot run its git-dependent tests outside a repository, so the authoritative full suite was rerun successfully in the actual worktree. This environment repair changed no tracked code outside the scoped review.

**Handoff:** AEI-D is READY_TO_CLOSE but NOT COMPLETE. AEI-E is NEXT / NOT STARTED. AEI-F/G and Phase 13 are NOT STARTED. **DEPLOYMENT_GATED_BY_AUTH_AND_RATE_LIMIT** remains unresolved. The post-AEI-G canonical UI/UX reference is `makoto-wallet.zip`, superseding “Bản thử nghiệm 1” and older Surf references; no UI integration was performed.
