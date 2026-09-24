# Phase 9G — Robustness Audit + Closeout Readiness

Status: **PENDING REVIEW**. Classification: **READY_TO_CLOSE**. Phase 9 remains open. Audit base: `994ff3d8ab0daaa81fbbf72bd92937004dcf64f6` on `phase9-policy-risk`, initially clean.

## Method and production boundaries

Read `PROJECT_STATE`, `ROADMAP`, architecture decisions and the 9A threat register; traced imports, route selection, handler calls, wallet submission calls, tool schemas, tests and Phase 9 history from `3374cfa`. This is a transaction-free source and regression audit. GitNexus was stale and was not reindexed.

| Path | Observed runtime chain | Result |
| --- | --- | --- |
| Send | `WalletDashboard` → `SendFlow` validation/review → current account/verified Arc, fresh balance and fee, exact simulation and review snapshot check → explicit Continue → wallet adapter and signer → receipt/event evidence | Protected. Failed fresh fee cannot reuse the earlier estimate. User recipient remains arbitrary valid address; execution target is the configured asset or memo contract. |
| Xylo Swap, external and local | `SwapPanel` → `RealSwapFlow` → configured pair/router, bounded slippage and finite approval review if needed → approval receipt, fresh allowance/balance/output and a **new** swap review → exact simulation, `evaluateFinalWalletSwapPolicy`, verified Arc/account → explicit Continue, wallet adapter and signer → receipt/receive evidence | Protected. The same handler uses the external or local adapter. No automatic swap follows approval. |
| Direct CCTP | Local-wallet `SwapPanel` → `CctpBridgeFlow` → configured Arc USDC/Base Sepolia route and fee/balance/allowance review → finite approval receipt if needed, fresh burn review → fresh fee, balance, allowance, exact simulation and snapshot check → explicit Continue, wallet adapter and signer → separate source and destination evidence | Protected. Unavailable/changed final burn fee stops. An unresolved receipt or destination does not become success. |
| Agent | Intent → canonical READ/QUOTE/PREPARE and schema validation → `evaluatePolicy` → explanation and bounded optional Send/Swap handoff → one-time validated, account/ID/expiry-bound wallet hydration → independent wallet review and signer | Agent policy can suppress a handoff; it cannot submit. Direct CCTP preparation has no Agent wallet handoff. |

External-wallet Bridge selects the inherited Circle App Kit `UniversalBridgeFlow`, **not** Direct CCTP. A legacy Agent Bridge draft may open that flow, which performs its own fresh route review; it does not execute the canonical Direct CCTP prepared steps. Circle App Kit and Gateway are existing provider-managed capabilities outside the Phase 9C Direct CCTP policy claim. Their independent reviews and stated simulation limits remain; no Phase 9 claim of exact final-call simulation is made for them.

## Policy and authority findings

- **9B core:** `evaluatePolicy` consumes supplied evidence and explicit time; it makes no provider calls. It validates READ/QUOTE/PREPARE shapes, binds account/chain/quote/preparation and rejects execution-enabled preparation. Findings carry reason, decision and evidence path. Precedence is `BLOCK > REQUOTE > REVALIDATE > REQUIRE_REVIEW > WARN > ALLOW`; no observed downgrade. Invalid evaluation time throws as a programming error; missing/malformed action evidence returns a policy outcome.
- **9C controls:** Uses `viem/chains`, `assets.ts`, `swap.ts` and `cctp.ts` configuration. Send supports Arc USDC/EURC/cirBTC and user-selected recipient. Xylo supports only USDC↔EURC, configured router/pool and 0.5/1/3% slippage. Direct CCTP supports Arc→Base Sepolia USDC and configured messenger. Prepared targets, spender/token bindings, exact finite approvals and minimum output are checked. No new provider, asset, pair, route, destination or dependency appeared in the Phase 9 diff.
- **9D final gate:** Canonical `evaluateFinalPolicy` is pure and exact-step bound, but has no wallet production caller. Production Swap calls its wallet-format deterministic final policy immediately before submission. Send and Direct CCTP use their existing deterministic route-specific review/simulation checks plus the Phase 9D fee refresh helpers; they do **not** call `evaluateFinalPolicy`. This is an explicit architectural limit, not a claim that one shared function covers all signers. Each supported signer path still has a late stopping gate. Simulation failure or unavailability stops; exact target/data/request is bound by preparation and review snapshots. No new simulation TTL was introduced.
- **9E UX:** `PolicyResult` controls progress; translated text does not. BLOCK, REQUOTE and REVALIDATE stop; WARN is nonblocking only for WARN; ALLOW permits wallet review, never execution. EN/VI keys match. Notices have semantic alert/status roles, text labels and a disabled Continue on stopping decisions. Existing review dialogs retain keyboard/focus behavior and the Classic Makoto layout.
- **9F coverage:** The 97 focused tests exercise malformed inputs; account, chain, pair, token, route, target and spender substitution; excessive approval and slippage; quote/preparation tampering; handoff corruption/replay; stale balance, allowance, fee and simulation; provider failure; rejection, submission and unresolved receipt; policy precedence and EN/VI UX. These tests complement, rather than establish alone, the runtime call trace. Isolated funded Direct CCTP handler/browser execution remains untested.

Policy and canonical Agent files have no secret, signer, wallet-client, submit, broadcast or unlock authority. Keyword hits in `toolSchemas.ts` are forbidden-field names. Provider/RPC reads occur in adapters and wallet handlers, outside pure policy evaluation. `walletFinalGate.ts` accepts an injected fee loader, but performs no network call itself. Handoffs reject extra execution fields and are consumed before validation to prevent replay. Receipt and bridge operation state keep PREPARED, SUBMITTED, source confirmation and destination confirmation distinct; rejection, requote and revalidation are not reported as execution failure. The local locked state is distinct from external disconnection. Harmless repeated checks remain in wallet handlers as defense in depth; target/spender/slippage constants come from existing route configuration.

No product bug requiring a Phase 9G fix was found. The generic final-policy helper has no production caller and several wallet outcomes are mapped from existing gates; both are recorded above to prevent an inflated claim about shared-engine reachability. No alternate Send, Xylo or Direct CCTP signer path bypassing the observed late gates was found.

## Limitations

| Limitation | Classification | Reason |
| --- | --- | --- |
| Funded connected-wallet QA not performed | NON_BLOCKING_LIMITATION | Live signing/chain behavior cannot be certified by this transaction-free audit; source gates and regression are present. |
| Isolated Direct CCTP handler/browser QA not performed | NON_BLOCKING_LIMITATION | Source trace and unit/integration checks cover its stopping gates; no funded browser claim is made. |
| Agent-triggered Direct CCTP wallet handoff unsupported | NON_BLOCKING_LIMITATION | Canonical evidence is data-only; no partial Direct CCTP execution path exists. Independent local wallet flow remains available. |
| Circle App Kit canonical PREPARE unsupported | NON_BLOCKING_LIMITATION | Existing provider-managed Bridge is outside the bounded canonical PREPARE scope. |
| Swap gas estimate limitation in canonical Agent evidence | NON_BLOCKING_LIMITATION | Wallet Swap obtains its own fee envelope before signing; canonical preparation does not misstate gas as known. |
| Bridge gas estimate limitation in canonical Agent evidence | NON_BLOCKING_LIMITATION | Direct wallet review obtains its own gas envelope; canonical preparation does not misstate gas as known. |
| GitNexus index stale | NON_BLOCKING_LIMITATION | Source, imports, tests and git history were used directly; index was not modified. |

## Roadmap acceptance

| Sub-phase | Assessment | Evidence |
| --- | --- | --- |
| 9A | SATISFIED | Threat register and control/ownership inventory in `phase9a-threat-model.md`. |
| 9B | SATISFIED | Pure structured policy with explicit time and precedence; focused tests. |
| 9C | SATISFIED | Capability-specific route, token, target, spender, approval and slippage checks. |
| 9D | SATISFIED | Pure canonical final decision plus late production wallet gates; limits above are documented. |
| 9E | SATISFIED | Machine-controlled localized notice/review behavior. |
| 9F | SATISFIED | Adversarial/failure coverage and full regression. |
| 9G | SATISFIED | This audit classifies Phase 9 READY_TO_CLOSE; its repository status remains PENDING REVIEW and Phase 9 remains open. |

## Verification

`npm run compile`: PASS, nothing to compile. Focused Phase 9/adjacent suite: **97/97 PASS**. Full frontend: **1275/1275 PASS**. Frontend typecheck: **PASS** after the production build; the first parallel attempt collided with Next-generated `routes.js` while the build was writing `.next/types`. Lint: **0 errors, 7 inherited warnings**; the new browser script also passed a quiet lint rerun. Production `next build`: **PASS**. Existing Send browser fixture: **324/324 PASS**. Existing Swap/Bridge fixture: **672/672 PASS**. The new policy browser script checked **72/72** BLOCK/REQUOTE/REVALIDATE Send/Swap combinations across EN/VI, light/dark and 390/900/1440 widths, plus **12/12** axe dialog audits with zero violations. Staged `git diff --check`: **PASS**. No live transaction, push, deployment, Phase 10 work or feature expansion occurred.
