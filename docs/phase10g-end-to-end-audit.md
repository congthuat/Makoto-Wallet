# Phase 10G — end-to-end regression and closeout readiness

Status: **PENDING REVIEW**. Classification: **READY_TO_CLOSE**. Phase 10 remains open. Audit started on clean `phase10-sequential-strategy` at `6b13f7b1524978485be590598c4a8f1f73745275`. No live transaction, push, or deployment occurred.

## Method and boundaries

Read the canonical state, roadmap, and architecture decisions; reviewed the Phase 10 diff from `acebcb6a6e47af6b15c4a6d076883cc769dcbe04`, all six Strategy modules and their tests, Phase 8 READ/QUOTE/PREPARE schemas, Phase 9 policy/final gates, and existing Send, Xylo Swap, and Direct CCTP wallet handlers. Traced Strategy API call sites and searched source for signing, provider, timer, retry, and arbitrary transaction authority. Added transaction-free integration regression using the actual 10A–10F APIs. Strategy remains an unwired domain API; the existing wallet handlers retain their separate review and signing flows.

| Layer | Audit result |
| --- | --- |
| 10A model | Versioned JSON-safe Strategy, explicit IDs and `dependsOn`, ACTION/WAIT_RECEIPT/REVALIDATE, bounded artifact references, and explicit confirmation remain intact. Duplicate, self, unknown, and cyclic dependencies are rejected. |
| 10B review | Evaluates one selected ACTION after Strategy/artifact/dependency checks and Phase 9 final policy. Returns wallet-review evidence, not a submission. A stopping Phase 9 decision now takes precedence over dependency reporting. Direct CCTP Agent handoff remains explicitly unsupported. |
| 10C receipt | The read-only Arc adapter acquires one receipt and its transaction; the pure verifier binds strategy, step, action, prepared step, hash, chain, account, and exact transaction. Only CONFIRMED emits dependency evidence. PENDING, REVERTED, UNAVAILABLE, MISMATCH, and INVALID_EVIDENCE remain distinct. CCTP confirmation is source transaction only. |
| 10D refresh | A confirmed prior receipt is required before bounded READ/QUOTE acquisition. Fresh account, chain, balances, allowance where needed, quote, fee, preparation, simulation, and Phase 9 policy are checked for the selected later ACTION. Changed/expired evidence stops; approval confirmation alone is not allowance proof. |
| 10E continuation | Uses `dependsOn` for eligibility and Strategy order only to present multiple ready branches. Fan-in requires all prerequisites. All modeled steps need bound evidence for STRATEGY_COMPLETE. NEXT_STEP_READY never invokes 10B. |
| 10F recovery | A JSON-safe attempt record binds strategy, step, action, account, chain, artifact, attempt ID, and known hash. A known or ambiguous submission cannot become blind retry. Rejection, proven pre-submission failure, pending/unavailable receipt, confirmation, revert, and expiry remain distinct. RETRY_ELIGIBLE requires a new explicit user-controlled 10B call. |

## Composed regression and safety findings

- **APPROVE → SWAP:** The integration test separately invokes 10E, 10B, 10C, 10D, 10E, and 10B. The approval reaches review, its simulated external submission is verified by 10C, and 10E requires fresh revalidation before reporting SWAP eligible. 10D refreshes allowance and quote. A separate 10B call reaches review for SWAP; nothing signs or submits. Wrong receipt hash or revalidation account fails progression.
- **SEND:** A single Send reaches 10E eligibility and separate 10B review. A separately supplied transaction observation yields 10C confirmation and evidence-backed STRATEGY_COMPLETE. No last-array-position shortcut is used.
- **Recovery/restart:** JSON-restored Strategy and known-hash record require separate receipt verification. Ambiguous submission is not retry eligible; rejection stops; pending waits; revert requires fresh work; expired quote requires requote. A source CCTP burn confirmation never proves destination delivery or permits a duplicate source burn.
- **Graph and policy:** Two independent confirmed 10C receipts are required for fan-in even when the child is the first array item. Phase 9 precedence remains `BLOCK > REQUOTE > REVALIDATE > REQUIRE_REVIEW > WARN > ALLOW`; ALLOW and RETRY_ELIGIBLE lead only toward explicit user review. Every state-changing ACTION retains `EXPLICIT_USER_CONFIRMATION`.
- **Provider and signer audit:** `acquireStrategyReceipt` uses a bounded read-only receipt/transaction lookup; `acquirePostReceiptEvidence` uses Phase 8 READ/QUOTE. The structural validator, selected-step evaluator, receipt verifier, post-receipt evaluator, continuation evaluator, and recovery evaluator are provider-free. No Phase 10 module owns a signer, wallet client writer, private key, arbitrary transaction entry point, polling timer, retry loop, or background runner. Exact `to`/`data`/`value` in 10C are observation checks against canonical prepared requests, not caller-supplied replay authority.
- **Reachability:** No product caller imports the Strategy APIs yet. They are exercised by focused and integrated domain tests and are **EXPECTED DOMAIN API NOT YET WIRED**, not dead parallel wallet implementation. Existing Send/Swap/Direct CCTP signer handlers continue using their own late deterministic gates; Phase 10 adds no alternate signing path. No Phase 11 planner or Phase 12 state machine appeared in the Phase 10 diff.

## Bugs found and fixed

1. A recovery record with non-submitted event and an explicitly present `submittedHash: undefined` passed validation. The record validator now requires hash-field presence exactly for SUBMITTED, preserving the JSON-safe schema. Restart regression covers this.
2. 10B reported `DEPENDENCY_NOT_SATISFIED` for a dependent ACTION even when its current Phase 9 final policy was stopping. It now returns `POLICY_STOP` first, preserving the stronger decision without changing wallet access. Integrated failed-simulation regression covers this.

## Limitations and roadmap acceptance

| Item | Classification | Evidence or reason |
| --- | --- | --- |
| No Strategy UI or product caller | NON_BLOCKING_LIMITATION | Phase 10 roadmap names an engine; domain APIs and separate wallet review boundaries are implemented and tested. Production Strategy UX is not claimed. |
| No automatic run-to-completion engine | NON_BLOCKING_LIMITATION | Deliberate safety boundary; dependent writes require separate calls and user confirmation. |
| Direct CCTP Agent wallet handoff unsupported | NON_BLOCKING_LIMITATION | 10B/10E/10F report the boundary truthfully. The independent local-wallet Direct CCTP flow remains separate. |
| CCTP destination confirmation separate | NON_BLOCKING_LIMITATION | 10C proves only source transaction; destination status remains with the existing bridge flow. |
| Existing Phase 9 limits | NON_BLOCKING_LIMITATION | Circle App Kit canonical PREPARE and Agent Direct CCTP handoff remain unsupported; canonical Swap/Bridge gas estimates are unavailable. Send/Bridge wallet signers use their existing late gates rather than the generic final-policy helper. |
| No funded/live Strategy transaction QA | NON_BLOCKING_LIMITATION | This is a transaction-free domain audit; no live execution claim is made. |
| Branch not pushed | NON_BLOCKING_LIMITATION | Awaiting user review; no remote integration claim is made. |

| Roadmap sub-phase | Assessment | Evidence |
| --- | --- | --- |
| 10A — strategy/step model | SATISFIED | Structural validator, graph invariants, JSON-safe model, tests. |
| 10B — single-step execution | SATISFIED | One selected ACTION, bound canonical artifacts, Phase 9 policy, review-only handoff, regression fix. |
| 10C — receipt verification | SATISFIED | Bounded acquisition, pure exact-transaction verifier, typed receipt outcomes. |
| 10D — state re-read/requote/revalidation after receipt | SATISFIED | Fresh READ/QUOTE and final-policy evidence for selected later ACTION. |
| 10E — controlled multi-step continuation | SATISFIED | Evidence-backed graph traversal, deterministic branching/fan-in, no automatic execution. |
| 10F — interruption/rejection/expiry/retry/recovery | SATISFIED | Bound JSON attempt, known/unknown submission safety, expiry and user-controlled retry semantics. |
| 10G — end-to-end regression + closeout | SATISFIED for audit readiness | Integrated tests, source/security review, limitation classification, full regression. Repository status remains PENDING REVIEW; Phase 10 is not closed. |

## Verification and decision

Focused 10G integration **4/4 PASS**; all Phase 10 Strategy tests **58/58 PASS**; selected Phase 8 Tool Layer **46/46 PASS**; selected Phase 9 policy/final-gate **28/28 PASS**; full frontend **1333/1333 PASS**; typecheck **PASS**; lint **0 errors / 7 inherited warnings**; production build **PASS**; root contract compile **PASS**; staged `git diff --check` **PASS**. No live transaction was performed.

**READY_TO_CLOSE:** 10A–10F compose under separate calls, no signing or automatic submission/retry path was found, receipts and fresh state remain authoritative, Phase 9 stops remain visible, and remaining limits are non-blocking for this domain-engine scope. This is a review recommendation only; Phase 10 remains open.
