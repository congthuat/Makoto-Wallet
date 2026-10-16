# Swap and Bridge approval continuation — 2026-10-15

Base: `1b53de4324cb707c0f50cd2da3774af4dcdbab35` (`origin/makoto-wallet`). Branch: `fix/swap-bridge-approval-continuation-2026-10-15`. The previous local branch had the same tree as this production baseline. Four unrelated untracked QA directories were preserved and excluded from this change. No open PR existed at the initial audit.

The attached PR-kit script was read as reference, not executed. Its basic continuation/gas diagnosis matched this runtime, but the implementation also needed existing account/chain/input/checkpoint guards, real policy assertions, pending-state recovery, and preservation of approval history. No donor UI or protocol address was copied or changed. The GitNexus registry pointed to an older repository at `C:/Users/Admin/Projects/Makoto-Wallet`; canonical source and executed tests in this workspace were used as evidence.

## Verified causes and changes

| Area | Baseline evidence | Resulting behavior |
| --- | --- | --- |
| Swap | `LiveSwapControl.confirm()` and `checkAgain()` stopped at `approval-confirmed`; the restore effect ignored `REVALIDATING`. | A shared read-only `prepareReview()` rechecks wallet/allowance/balance, obtains a new quote, simulates and evaluates policy after verified approval and on restored `REVALIDATING`. Only the explicit confirm handler requests the swap. |
| Bridge | Approval receipt mapped to `source-confirmed`; `checkAgain()` fell through `REVALIDATING` to `source-unknown`; restoration ignored it. | `approval-confirmed` is separate from a source burn. Recovery prepares a fresh burn review after allowance evidence without requesting a burn signature. |
| Gas | `cctpGasEstimateChanged()` compared gas limit, unit price and maximum fee exactly. | Valid fresh total maximum cost at or below the displayed ceiling can proceed after the user's click. Increased cost, material fee/route/call changes or expired review require another review. Missing, nonpositive or internally inconsistent gas estimates fail closed. Existing simulation and affordability checks remain. |
| Swap quote | `revalidateReview()` accepted changed output when it remained above the old minimum. | Changes to output, minimum receive, input amount, asset pair, slippage or provider invalidate the review. |
| Evidence | Preparing the dependent action cleared the active approval hash/binding; late wallet responses could be discarded after account/chain change. | Optional `approvalReceipt` retains history without granting authority. Late returned hash/rejection/unknown is recorded under the unchanged original checkpoint; no old response changes the new account UI. Actual submitted action Activity is retained. A stale Swap Done cannot replace a newer checkpoint. |

Implementation: [Swap control](../../frontend/src/components/LiveSwapControl.tsx), [CCTP control](../../frontend/src/components/LiveCctpControl.tsx), [policy](../../frontend/src/migrated/policy.ts), [strategy controller](../../frontend/src/migrated/strategyController.ts), [Circle adapter](../../frontend/src/protocols/circle/cctpAdapter.ts), and [EN/VI error translations](../../frontend/src/lib/i18n-extra.ts). Regression coverage is in the corresponding policy/strategy/adapter tests and [browser completion tests](../../frontend/tests/protocol-completion.test.mjs).

## Recorded local verification

Windows, Node `v24.16.0`, npm `11.13.0`. Commands cover every test/build step in `.github/workflows/ci.yml`.

| Check | Result |
| --- | --- |
| `test:completion` | 85/85 passed; actual controls, strategy, policy, finite approval validation and gas/material comparisons, with explicit mocked wallet/RPC/receipts/Circle/Base responses |
| `test:migration` | 106/106 passed |
| `test:brain` | 21/21 passed |
| `test:agent` | 32/32 passed |
| `test:send` | 31/31 passed |
| `test:tasks` | 22/22 passed |
| `test:portfolio` | 18/18 passed |
| `test:ux` | 59/59 passed |
| `test:ui` | 39/39 passed |
| `test:polish` | 58/58 passed |
| Backend `npm test --prefix backend` | 100/100 passed |
| Frontend `type-check` | Exit 0 |
| Frontend `lint` | Exit 0; 0 errors, 12 existing warnings in unchanged files |
| Frontend `build` | Client and SSR build exit 0; module chunking/large chunk warnings |
| `node --check frontend/tests/protocol-completion.test.mjs` | Exit 0 |
| `git diff --check` | Exit 0 |

Frontend scripts above run with `npm run <script> --prefix frontend`; the recorded completion execution invoked that script's exact `node --test tests/protocol-completion.test.mjs` target from `frontend/`. Build used `BACKEND_PORT=3001`, `BASE_PATH=""`, matching CI.

Negative control: the new Swap approval, Bridge approval and decreased-gas regressions were run with `MAKOTO_COMPLETION_BASELINE_REF=1b53de4324cb707c0f50cd2da3774af4dcdbab35`. All three failed at their intended behavior assertions (0 passed, 3 expected failures), demonstrating the original defects. Current completion passed all 85 tests. Detailed local command logs are retained alongside this report but are not part of the source patch; GitHub Actions provides fresh-install CI evidence for the PR.

The completion suite covers both approval/no-approval flows, explicit second-action rejection, finite approval amount, ten rapid confirm clicks producing one request, decreased/equal/increased gas, changed Swap output and Circle fees, expired review, actual full-page reload during confirmed/pending approval and pending actions, insufficient allowance, stale quote/account/chain/input/checkpoint/unmount responses, late wallet hash/rejection/unknown, and existing Circle attestation/Base destination recovery cases. StrictMode is enabled in the browser fixture. No test opens a wallet extension, signs, broadcasts, or uses a real signer.

## Boundaries and remaining manual verification

No real Swap, approval or CCTP burn was created, signed or broadcast. Live RPC/provider availability, wallet extension dialogs, real attestation timing and real destination settlement remain unverified by these mocked tests. Those require separate user-authorized testnet QA. Pending and unknown outcomes remain recovery-only; no automatic signing, retry or duplicate submission was added. Existing receipt, Circle attestation and destination evidence remain necessary for completion. This bug fix changes no architecture phase status; Phase 13 implementation remains not started. Production is not merged or manually deployed by this work.
