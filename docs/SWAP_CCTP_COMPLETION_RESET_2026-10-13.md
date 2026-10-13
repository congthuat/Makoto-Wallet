# Swap and CCTP completion reset — 2026-10-13

Scope: post-success UI acknowledgement only, based on production `makoto-wallet` at `f4ef86390f1f25569b9a9f12069d3838782ab2d8`. Work is isolated on `fix/swap-cctp-completion-reset-2026-10-13`. This is not a migration or phase closeout; Phase 13 remains unstarted.

## Audited cause and change

- `LiveSwapControl.tsx` allowed `confirmed` to render its start/quote button. `SwapPage` retained the completed amount because it had no completion callback.
- `LiveCctpControl.tsx` included `destination-confirmed` in both conditions permitting its start/quote button. `BridgePage` likewise retained its amount and live quote.
- Each control now offers **Done / Hoàn tất** only at its final confirmed stage. Existing confirmation messages and transaction hashes remain visible until that click.
- The synchronous Done handlers require the terminal stage and no active operation. They clear local quote, prepared action, review, reviewed input, hashes and errors, and save a fresh IDLE strategy checkpoint. Parent `onComplete` callbacks clear only the amount; CCTP also clears the parent's live quote through its existing callback.
- Strategy checkpoints (`mk.strategy.v1:<protocol>:<account>`) are distinct from Activity/history. Done does not upsert or delete Activity. CCTP Activity retains both its source hash and destination hash.
- Arc source confirmation, approval continuation, attestation, forwarding and Base destination pending states remain in progress. CCTP becomes acknowledgeable only after the existing destination verification reports `destination-confirmed`.
- Failed/rejected retries, explicit wallet reviews, finite approvals, gas/quote/policy/contract logic, receipt evidence, and Circle destination verification are unchanged. No page reload is used.

## Recorded validation

All frontend test scripts were run with Node 24.16.0 and the existing locked dependencies. Browser tests used isolated, extension-free headless Chrome profiles with loopback fixture servers. Quotes, wallet submission, receipts and Circle/Base reads are explicitly mocked; these are UI regression results, not live blockchain execution evidence.

| Command (`npm run … --prefix frontend`) | Result |
| --- | --- |
| `test:brain` | 17/17 PASS |
| `test:agent` | 31/31 PASS |
| `test:send` | 15/15 PASS |
| `test:completion` | 14/14 PASS |
| `test:tasks` | 12/12 PASS |
| `test:portfolio` | 18/18 PASS |
| `test:ux` | 59/59 PASS |
| `test:migration` | 82/82 PASS |
| `test:ui` | 30/30 PASS |
| `test:polish` | 58/58 PASS |
| `type-check` | PASS |
| `lint` | PASS: 0 errors; 12 existing warnings |
| `build` | PASS: client and SSR builds; existing import/chunk warnings |

Total: **336 tests passed; 0 skipped**. `git diff --check` passed. Browser fixtures also emit an existing transitive dependency dynamic-import warning; it does not affect the results.

The completion suite mounts the actual Swap/Bridge pages and controls in React StrictMode, using the actual strategy controller and Activity merge helpers. It covers:

1. EN and VI terminal acknowledgement, no terminal quote button, and hashes/amount retained before Done.
2. Parent amount and local quote/review/error/hash reset, clean IDLE checkpoint, and clean remount after Done.
3. Existing and completed Activity serialization unchanged after acknowledgement and remount, including CCTP source and destination evidence.
4. No provider, wallet, quote or status call from Done; entering a new amount requires an explicit new quote and explicit wallet confirmation.
5. Source pending/confirmed, approval confirmed, attestation pending/available, forwarding pending, and destination pending retain their normal continuation states.
6. Swap and CCTP failed/rejected retries remain available.

Negative control: `MAKOTO_COMPLETION_BASELINE_REF=f4ef86390f1f25569b9a9f12069d3838782ab2d8` loads the historical parent and controls through read-only `git show`. All four EN/VI terminal cases fail on the unwanted new-quote button against that production code. Current code passes all 14 cases.

The existing 15 Send browser assertions are unchanged. Their Vite/Chrome lifecycle was extracted into `tests/browser-harness.mjs` for reuse, and the suite passed after extraction. Send runtime, backend, protocol execution modules, policy, Circle adapters and dependency lockfiles have no changes in this fix.

## Publication boundary

The temporary branch-specific Vercel deployment guards used for the initial PR publication were removed at the user's request. Both `vercel.json` and `frontend/vercel.json` now match the production base; no deployment configuration change remains in the PR. Swap/CCTP completion code and tests are unchanged by this cleanup. All frontend validation was repeated after removal.

No real wallet request, signature, blockchain transaction, merge or production deployment was performed for this QA. Normal Vercel preview automation may run when the cleanup is pushed. The fix is for review in a PR targeting `makoto-wallet`.
