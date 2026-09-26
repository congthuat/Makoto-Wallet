# AEI-D — Tool and Policy Orchestration Boundary

**Status:** DESIGN APPROVED / NEXT / NOT STARTED. AEI-A/B/B1/B2/C are COMPLETE / CLOSED. AEI-E/F/G and Phase 13 are NOT STARTED. This is a design contract, not a runtime implementation or a claim that the Agent can execute a Strategy.

## Decision and audited fit

AEI-D consumes one **currently validated** AEI-C `SEMANTIC_ONLY` envelope and selects one exact ACTION descriptor. It binds current approved wallet read context, obtains the required Phase 8 reads and quote, coordinates unsigned preparation where the canonical route supports it, evaluates existing Phase 9 policy, and emits one provenance-bound **execution-forbidden** operational record. The whole Strategy envelope and dependency graph remain attached; an ACTION record is not a free-standing permission. No loose descriptor, reconstructed UI text, legacy Agent/wallet draft, B1 proposal alone, caller-built materialization or historical JSON is an input substitute. The input contract must call `validateStrategyMaterialization(candidate, retainedLiveInput)`; a digest match alone is insufficient. The retained live B2 source and AEI-B/v2 chain must still validate at acquisition and at any promotion to later review.

The current Tool Layer is `agent/readTools.ts`, `agent/quoteTools.ts`, `agent/prepareTools.ts`, with schemas in `agent/toolSchemas.ts`. `WalletReadContext` is a read identity; `WalletExecutionAdapter` is a separate signing/submission capability and must never enter AEI-D. `AgentContextSnapshot` carries account, wallet kind/status, verified chain and observation time, but a caller-made snapshot is not authentication. Phase 9 `evaluatePolicy` is a pure assessment of **already obtained** quote and preparation; it reports `MISSING_EVIDENCE/BLOCK` without preparation. `runPrepareTool` itself refreshes the quote and reads before returning `executionEnabled: false` steps. Therefore AEI-D must use this order: validate live AEI-C → acquire/revalidate wallet context → obtain required reads/quote → deterministic schema/context/freshness preflight → call existing `prepareTools` only for supported routes → validate the returned preparation and refreshed quote lineage → invoke `evaluatePolicy` with the actual preparation → stop or emit a review-required operational record. **No pre-preparation Phase 9 ALLOW is claimed.** A later final gate may use `evaluateFinalPolicy` only with its required current reads, fee and exact simulation evidence; that helper currently has no shared production wallet caller. No D result bypasses the route's late wallet review and safety gate.

## Authority and provenance contracts

| Record | Minimum closed binding and validation | Meaning |
| --- | --- | --- |
| `AEIDAccountContextV1` | Current `WalletReadContext` and trusted host observation; account address, external/local kind, connected/unlocked status, observed provider/connector chain, verified Arc chain, acquisition source, observation time, context revision/digest; exact AEI-C request/session and selected ACTION correlation. Re-read `wallet.state` and `network.verified` from the same host-owned `AgentContextSnapshot`; reject disagreement. | Operational identity only. Digest is correlation/integrity, not user authentication or signing authority. Do not infer from display text, storage, earlier attempt or legacy draft. |
| `AEIDReadEvidenceV1` | Exact AEI-C envelope digest/revision, descriptor digest, account-context digest, chain, `ReadToolId` and version, request tuple, canonical `ReadResult` including source, captured/observed time and freshness, result digest. | Required wallet/network/balance and route-specific allowance observations. Snapshot/unknown/persisted evidence cannot masquerade as a live balance or allowance. |
| `AEIDQuoteEvidenceV1` | Same parent/action/account/chain bindings; exact `QuoteRequest`, provider/route, status, quoted/observed/expiry times, `quoteFingerprint` and canonical result digest. | Operational quote only. `AVAILABLE` and current is required for preparation. `PARTIAL`, unavailable or expired has no preparation authority. |
| `AEIDPolicyEvidenceV1` | Same parent/action/account and exact read/quote/preparation digests; policy evaluator/version, observation time, full `PolicyResult`, digest. | Phase 9 decision, never approval to sign. Caller-supplied policy JSON is rejected; recompute with canonical evidence. |
| `AEIDPreparedEvidenceV1` | Same parent/action/account/chain and exact request/read/quote lineage; existing `PrepareResult`, refreshed quote fingerprint, tool/version, ordered steps, `preparedAt`/`expiresAt` and content digest. The enclosing D record adds the subsequent policy-evidence digest and operational revision. | Unsigned, unsubmitted prepared data only. The Phase 8 preparation and later policy check must both validate. Caller-supplied calldata or a fingerprint from another action/account cannot attach. |

These are proposed **AEI-D wrapper contracts**, not existing runtime types. Use bounded descriptor-safe snapshots for plain inputs and exact versioned, domain-separated canonical digests. Bigint tool data needs an explicit lossless decimal encoding; JSON's implicit conversion is forbidden. Use the existing `validateReadResult`, `validateQuoteResult`, `validatePrepareResult`, `quoteFingerprint` and AEI-C validator. Distinguish content identity from acquisition authority: a caller can calculate a digest, but cannot thereby mint live account, provider, tool or policy evidence. Do not persist a live capability or replay a historical artifact as current.

Any account switch A→B, chain switch, disconnect, lock/reconnect, proposal/session/replan change, materialization revision change, quote expiry/change, material balance or allowance change, changed policy input, preparation expiry or altered prepared step invalidates the affected operational record. Old records become historical. Obtain a new host observation, fresh reads and quote, new preparation and policy decision as required. A new quote revision cannot reuse preparation from the old quote. At every async boundary recheck account/chain/session/action identity and reject a late result from the previous context. Never silently fall back to another wallet.

## Route acquisition and policy

For every route, acquire `wallet.state`, `network.verified` and `assets.balances` through approved Phase 8 ports. SEND uses `send.quote` for balance and fee-aware affordability, then `send.prepare`; it must not treat a token balance or raw Arc gas units as a complete fee assessment. SWAP uses live balance and `token.allowance` for the Xylo router, `swap.quote` for Arc USDC↔EURC with a reviewed supported slippage choice, then `swap.prepare`. cirBTC and same-token pairs remain unsupported. `SwapQuoteData.fee` is `not-estimated`; no guessed swap/approval gas estimate may become authority. If an exact finite approval is needed, preparation returns an approval step followed by a swap step with `requiresConfirmedPriorStep`; neither step is submitted here. A confirmed approval would require fresh allowance/quote/policy and separate later review before the swap.

The AEI-C BRIDGE intent represents Arc Testnet USDC → Base Sepolia USDC. Existing `bridge.quote`/`bridge.prepare` describe Direct CCTP forwarding only and the prepare tool requires the recipient to equal the account. Its data-only preparation has **no current Agent wallet handoff** (`strategyStep.ts` returns `NO_WALLET_HANDOFF`). Circle App Kit external-wallet Bridge is a separate provider-managed flow; `bridge.prepare` returns `UNSUPPORTED` for `circle-app-kit-cctp`. AEI-D must return typed `HANDOFF_REQUIRED`/`UNSUPPORTED_ACTION` for a selected BRIDGE that cannot reach a canonical later review path; it must not manufacture an executable prepared artifact or route conversion. A source-chain receipt never proves destination completion. Protocol/forwarding fee evidence is not a gas estimate; bridge source gas remains `not-estimated` in the canonical quote.

`QuoteResult` contains provider, route, exact asset/amount/account/chain/recipient or pair, observed/quoted/expiry times, validity and status. `local-max-age` must pass the existing tool validator and configured product limit; `observation-only` is not an indefinite executable quote. Reject a quote for another amount, pair, account, chain or ACTION even if its route name matches. On expiry return `REQUOTE_REQUIRED`; on changed balances/allowance/context return `REVALIDATION_REQUIRED` or a stronger policy stop. No mock/reference price is a canonical quote.

After supported preparation, invoke the existing `evaluatePolicy` with the exact wallet/network read results, quote, preparation, action, account, chain and explicit observation time. Preserve its precedence **BLOCK > REQUOTE > REVALIDATE > REQUIRE_REVIEW > WARN > ALLOW** and its full findings. `BLOCK` stops; `REQUOTE` discards the old quote and dependent preparation; `REVALIDATE` reacquires affected context/reads; `REQUIRE_REVIEW` and `WARN` remain visible in the later review contract; `ALLOW` permits only the next approved review boundary. If policy changes after a new quote or preparation, bind a new policy record. The Phase 9 final evaluator needs current wallet/network/balance/allowance/quote/fee/simulation and exact prepared step; missing evidence fails closed. D may coordinate this evidence when available, but must not claim final-policy coverage merely because baseline policy passed. A user wallet and route-specific late gate remain final transaction authorities outside D.

## Output, failures and later handoff

Proposed `AEIDOperationalEnvelopeV1` has closed fields: `version`, `stage: OPERATIONAL_ONLY`, `executionEnabled: false`, `executionAuthority: FORBIDDEN`, exact AEI-C envelope/digest/revision and v2 provenance, account-context binding, selected ACTION step/goal/descriptor digest, complete dependency graph, ordered operational records for that selected ACTION, operational revision/digest, unmet requirements, and `status`. It does **not** pre-populate independent or dependent ACTIONs with stale account/quote data. An `AEIDActionRecordV1` holds the exact semantic descriptor, read and quote bindings, policy evidence, optional validated prepared evidence, explicit review/warning/handoff facts and outcome. The record cannot contain a signer, wallet client, transaction attempt, hash, receipt, retry or resubmit capability. Existing `PrepareResult` may contain unsigned target/calldata; AEI-D wraps it as evidence, never as a transaction request to send.

Typed outcomes include `ORCHESTRATED` (eligible only for later review), `BLOCKED_BY_POLICY`, `REQUOTE_REQUIRED`, `REVALIDATION_REQUIRED`, `REVIEW_REQUIRED`, `UNSUPPORTED_ACTION`, `UNSUPPORTED_ACCOUNT_CONTEXT`, `READ_FAILED`, `QUOTE_FAILED`, `QUOTE_STALE`, `PREPARATION_FAILED`, `HANDOFF_REQUIRED`, `PROVENANCE_MISMATCH`, and `INVALID_MATERIALIZATION`. `WARN` and `REQUIRE_REVIEW` are retained as policy findings and review requirements, never swallowed by an `ORCHESTRATED` label. No partial success, guessed quote, fallback route, or promotion of `UNAVAILABLE` to `AVAILABLE`. All public inputs—including fake context, malformed/hostile Proxy or getter, transplanted descriptor, duplicate ACTION, wrong-account read/quote, fake policy result and foreign prepared data—must fail with a typed outcome without an uncontrolled exception.

For A=SWAP and B=SEND with B depending on A, D can acquire evidence for A only when that ACTION is eligible; it cannot submit A, wait for its receipt or advance to B. An order edge does not derive B's amount. Runtime-output-dependent B remains upstream unresolved. After a later verified A receipt, Phase 10D/10E and AEI-F must cause a new B context/read/quote/policy/preparation/review cycle; D never reuses A's quote or automatically executes B.

AEI-E later consumes D's exact operational provenance and typed outcome to govern Phase 12 `PLAN_READY → PREPARED` and related truthful blocked/requote/revalidation/review states. The present `agentTransition.ts` still denies that transition with `MISSING_CANONICAL_STRATEGY_BINDING`; D must not mutate AgentState or claim that guard is resolved. AEI-F later composes production Agent request/UI, separate wallet Review, signing/submission, Phase 10F attempt, 10C receipt and continuation. D does not own conversation lifecycle, signer, automatic next step or retry. Phase 10F recovery remains the authority for ambiguous submission; a D record cannot override it.

## Ownership and deployment

| Boundary | Owns | Does not own |
| --- | --- | --- |
| AEI-D | Current account-context binding; Phase 8 read/quote acquisition; freshness and requote/revalidation control; existing Phase 9 invocation; supported unsigned preparation coordination; exact operational provenance for one ACTION. | Wallet signature, transaction submission, receipt lifecycle, retry/resubmit, Phase 12 state authority or full Agent composition. |
| AEI-E | Phase 12 state integration with exact Strategy/action/account/artifact bindings. | New quote/provider authority or signing. |
| AEI-F | Production Agent composition, review and wallet handoff under existing safety boundaries. | Policy override or automatic dependent write. |
| AEI-G | Adversarial integration audit and final closeout readiness. | New execution authority by documentation. |

Provider credentials and privileged quote clients remain server-side; browser input and provider output are untrusted until canonical schemas and provenance checks accept them. The browser can hold read-only wallet context, never a server secret in a D artifact. The paid Planner proposal route still lacks server-side account authentication and distributed rate limiting; session UUID is correlation only. **DEPLOYMENT_GATED_BY_AUTH_AND_RATE_LIMIT** remains unresolved. Provider-backed quote routes require their own secret handling and abuse controls before public use. The approved post-AEI-G “Bản thử nghiệm 1” Surf visual/UX port, canonical-branch integration, full QA, deployment and Phase 13 remain deferred.

## Implementation acceptance criteria

These are future implementation gates, not tests run or runtime behavior implemented. Each criterion must be checked with the exact retained source and current account where applicable.

| # | Criterion | # | Criterion |
| --- | --- | --- | --- |
| 1 | Valid fixed SEND has a bounded operational result. | 33 | Prepared data remains unsigned. |
| 2 | Valid supported SWAP has a bounded operational result. | 34 | Prepared data remains unsubmitted. |
| 3 | BRIDGE reports only the supported data-only capability. | 35 | Exact finite approval amount is preserved. |
| 4 | Unsupported Bridge handoff has a typed outcome. | 36 | Approval step binds the same ACTION/account/quote. |
| 5 | Exact live AEI-C envelope is required. | 37 | No automatic approval submission occurs. |
| 6 | Exact ACTION ID and descriptor digest are retained. | 38 | No automatic action submission occurs. |
| 7 | Current host-owned account/chain is bound. | 39 | No wallet signature occurs. |
| 8 | Wrong account is rejected. | 40 | No receipt polling occurs. |
| 9 | Account change invalidates old records. | 41 | No retry or resubmit occurs. |
| 10 | Chain change invalidates old records. | 42 | cirBTC Swap remains unsupported. |
| 11 | Required Phase 8 reads bind exact ACTION/context. | 43 | Xylo pair and slippage limits hold. |
| 12 | Read from another ACTION is rejected. | 44 | Direct CCTP Agent handoff remains unavailable. |
| 13 | Stale balance/allowance requires revalidation. | 45 | Circle App Kit canonical PREPARE remains unsupported. |
| 14 | SWAP quote comes from canonical Xylo provider. | 46 | CCTP source receipt is not destination completion. |
| 15 | Quote binds exact amount. | 47 | Unknown gas remains unknown. |
| 16 | Quote binds exact asset pair. | 48 | No guessed fee gains authority. |
| 17 | Quote binds exact account and chain. | 49 | Multi-goal dependency graph is preserved. |
| 18 | Foreign/modified quote is rejected. | 50 | Order dependency never supplies a runtime value. |
| 19 | Expired quote cannot prepare. | 51 | Dynamic prior-output amount remains blocked. |
| 20 | Requote creates new provenance. | 52 | Descriptor transplant is rejected. |
| 21 | Old quote cannot validate new preparation. | 53 | Fake account context is rejected. |
| 22 | Phase 9 sees exact quote/preparation/context. | 54 | Fake or foreign read is rejected. |
| 23 | BLOCK stops before review. | 55 | Fake or foreign quote is rejected. |
| 24 | REQUOTE stops stale continuation. | 56 | Fake policy result is rejected. |
| 25 | REVALIDATE reacquires affected evidence. | 57 | Fake prepared artifact is rejected. |
| 26 | REQUIRE_REVIEW remains explicit. | 58 | Server secrets never serialize to client artifacts. |
| 27 | WARN remains explicit. | 59 | AEI-E receives sufficient state facts without reconstruction. |
| 28 | ALLOW never signs or submits. | 60 | AEI-F receives full lineage without Planner rerun. |
| 29 | Preparation runs only after schema/freshness preflight. | 61 | Whole D envelope remains execution-forbidden. |
| 30 | Prepared content binds exact AEI-C/action/account. | 62 | No caller digest alone authenticates tool evidence. |
| 31 | D record binds prepared data, reads, refreshed quote and subsequent policy. | 63 | Late async result after context change is rejected. |
| 32 | Cross-Strategy/account preparation transplant fails. | 64 | Phase 12 guard remains denied until AEI-E proof. |
