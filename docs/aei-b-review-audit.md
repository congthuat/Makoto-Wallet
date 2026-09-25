# AEI-B adversarial review — pending review, not ready to close

Review baseline: `08b4b8562e70d522abf48891d517044e72aab939` on `phase12h-planner-strategy-integration`. The reviewed code remains a pure, non-executable compiler. Review fix/tests: `e88fdd4269271ff95cf4d185119dda999ad56608`.

## Material blocker: a dynamic downstream amount can appear RESOLVED

With a mocked Phase 11D provider, each of these requests returned `RESOLVED` with a fixed `SEND` amount of `10`, after a `SWAP 10 USDC to EURC` goal:

- "then send 50% of actual output EURC"
- "then send the amount from the receipt in EURC"

The plan had `send.dependsOn = [swap]`, and the supplied intents matched the plan ID, goal IDs, kinds, and supported asset/chain fields. `compilePlannerStrategy` returned `COMPILED` for both. No live provider or RPC was called in the reproduction. Phase 11D's current dynamic-amount detection catches `all` and `half` forms, but these two phrases escaped it; its global text check also accepted `10` for the downstream goal because it appeared in the earlier swap request. The AEI-B input has no original request text or independently authenticated parameter-origin evidence. Its validators can prove that `10` is a valid fixed decimal, not that the user fixed the downstream amount at `10`. An AEI-B-only heuristic cannot make that semantic guarantee. Closeout is blocked pending an explicit, reviewed Phase 11 resolution/provenance contract that distinguishes independently fixed amounts from execution-output-derived values. AEI-C is not started.

## Bounded review fix and authority findings

Invalid `sourceChainId` and `destinationChainId` previously returned generic `INVALID_INTENT` because the rejection mapper checked lowercase `chainId` only. The focused failing test reproduced this; the mapper now returns `UNSUPPORTED_CHAIN` for both. Expanded tests cover graph branching, identity changes, `createdAt`, retained-input substitution, and nested runtime mutation.

Phase 10 requires `createdAt` as structural data. The compiler accepts only a nonnegative safe integer. It does not use it in Strategy or step IDs, but AEI-A includes it in the exact skeleton digest. Phase 10 continuation, step, and policy code do not use it for freshness, eligibility, expiry, or execution permission; tests compare continuation results at `0` and `Number.MAX_SAFE_INTEGER`. The skeleton has only ACTION IDs, kinds, `EXPLICIT_USER_CONFIRMATION`, and dependencies. No prepared reference, quote, account, policy, receipt, writer, signer, model, RPC client, timer, randomness, storage write, retry, or polling path enters AEI-B. Phase 10B still requires separately acquired preparation and policy evidence; Direct CCTP still lacks an Agent wallet handoff.

AEI-A validation rejects a substituted binding when checked against separately retained authoritative inputs. The compiler is a creator: its caller must supply and retain trusted request/session and resolved inputs. A wholly coordinated replacement of those inputs cannot be authenticated from a single plain-data compiler input. The blocker above shows why a `RESOLVED` status alone cannot prove natural-language parameter origin.

## Acceptance matrix

`PASS` refers to exercised tests and source audit. `BLOCKED` prevents AEI-B closeout. `BOUNDARY` is a guarantee supplied only when the caller retains authoritative inputs for AEI-A revalidation.

| # | Check | Result |
| --- | --- | --- |
| 1 | Valid SEND | PASS |
| 2 | Valid SWAP | PASS |
| 3 | Valid BRIDGE skeleton | PASS; no Agent wallet handoff |
| 4 | Fixed multi-goal order edge | PASS |
| 5 | Stable Strategy ID | PASS |
| 6 | Stable step IDs | PASS |
| 7 | Stable skeleton digest | PASS |
| 8 | Object insertion order | PASS |
| 9 | Equivalent goal order | PASS |
| 10 | Changed amount | PASS |
| 11 | Changed recipient | PASS |
| 12 | Changed asset | PASS |
| 13 | Changed chain | PASS; unsupported routes reject typed |
| 14 | Changed dependency graph | PASS |
| 15 | Unresolved parameter | PASS |
| 16 | Unsupported goal | PASS |
| 17 | Duplicate goal | PASS |
| 18 | Unknown dependency | PASS |
| 19 | Cycle | PASS |
| 20 | Dynamic prior-output value | BLOCKED: 11D can return `RESOLVED`, then AEI-B compiles |
| 21 | No account invented | PASS |
| 22 | No quote invented | PASS |
| 23 | No preparation artifact | PASS |
| 24 | No calldata/target | PASS |
| 25 | Exact goal/action mapping | PASS |
| 26 | Exact skeleton digest binding | PASS |
| 27 | Cross-plan resolved-intent substitution | BOUNDARY: mismatched plan ID rejects; coordinated semantic substitution needs trusted origin |
| 28 | Cross-request/session substitution | BOUNDARY: IDs change and retained-source AEI-A validation rejects; creation alone cannot authenticate caller IDs |
| 29 | Unexpected field | PASS |
| 30 | Symbol field | PASS |
| 31 | Throwing getter | PASS |
| 32 | Hostile proxy | PASS |
| 33 | Mutation / TOCTOU | PASS for descriptor snapshot and retained-source comparison |
| 34 | Caller timestamp authority | PASS: structural only; no freshness or execution effect |
| 35 | Non-executable result | PASS |
| 36 | No signer/submission/retry authority | PASS |

Verification after bounded fix: AEI-B 17/17; AEI-A 15/15; Planner 90/90; Strategy 62/62; Phase 12 54/54; full frontend 1491/1491; typecheck PASS; lint 0 errors / 7 inherited warnings; normal Turbopack production build PASS at `e88fdd4` using local dependencies; root contract compile PASS (nothing to compile); `git diff --check` PASS. These checks do not waive the reproduced semantic blocker.
