# PR #8 review follow-ups — 2026-10-16

## Audited starting point

- Canonical workspace: `C:\Users\Admin\Downloads\Makotowallet.xyz\makoto-wallet`.
- PR #8 was OPEN, `mergedAt: null`, base `makoto-wallet`, head `fix/swap-bridge-approval-continuation-2026-10-15`.
- `git fetch origin` succeeded. Local HEAD and remote PR head were both `7a90602dee0b35a455017fb19297fe8597985c20`; divergence was `0 0`.
- There were no tracked local changes. Preexisting untracked QA directories/logs were preserved and excluded from this change.

## Verified defects and correction

1. Actual `SwapPage`/`BridgePage` initialized empty amount and default options; the old reload tests instead mounted `ContinuationPage` with amount `1`. Six real-page reload negative controls against the exact starting commit failed because `'' !== '2.345678'`.
2. CCTP called `upsertBridge` before `rememberWalletOutcome(hash)`. A separate negative control made Activity throw and observed no hash in the checkpoint at that call, despite the wallet already returning the burn hash. Swap already saved its hash first; its Activity exceptions still interrupted downstream receipt handling.
3. Further review identified an input-loss window during a second reload while post-approval quoting was pending, and CCTP `COMPLETED` restoring the idle stage instead of Done. The fixes retain resumable receipt evidence and the terminal stage.
4. The real Activity store persists from a React effect and catches storage errors. A successful Activity callback alone therefore cannot justify erasing the checkpoint at Done.

The existing strategy checkpoint now has an optional validated form snapshot: Swap amount/pair/slippage or CCTP amount/speed. It uses the existing account/protocol key and source-chain identity. Forms remount on account/chain/mode changes and initialize only from the matching connected Arc checkpoint, before mounting their controls. Malformed snapshots are discarded without discarding receipt evidence. Old checkpoints remain readable; absent historical options are not invented.

Stored reviews still restore as EXPIRED. Retained confirmed approval evidence can only start fresh wallet-context, allowance, balance, quote, gas, simulation and policy checks. A second reload during this continuation retains the snapshot and REVALIDATING receipt evidence. Every approval, Swap and CCTP burn still requires its own explicit wallet confirmation. Pending/unknown checkpoints offer read-only reconciliation; transport-unknown without a hash does not fabricate one or submit again.

Both controls preserve the returned hash before secondary Activity writes, isolate Activity/portfolio callback exceptions, and retain exact-checkpoint/generation guards against late asynchronous results. If checkpoint persistence itself fails, the mounted control retains the real returned hash in memory, locks resubmission, and displays EN/VI instructions to keep the hash. Persistent recovery cannot be promised when browser storage is unavailable.

Done checks that completed Activity exists in the canonical store and its existing localStorage record before clearing the temporary checkpoint/form. A missing projection is repaired first; another explicit Done observes durable history. Missing CCTP destination history requires fresh source receipt, official Circle and Base evidence before repair. Unavailable reads do not downgrade an already completed checkpoint. New Activity selectors tolerate malformed optional history without crashing the recovery control. No Activity/history deletion was added.

## Changed files

- `frontend/src/pages/SwapBridge.tsx`: scoped input restoration and form cleanup.
- `frontend/src/migrated/strategyController.ts` and its tests: optional validated snapshot, identity gate, read-only CCTP terminal recheck.
- `frontend/src/components/LiveSwapControl.tsx` and `LiveCctpControl.tsx`: hash-first persistence, exception isolation, fresh continuation and durable Done.
- `frontend/src/lib/protocolActivity.ts` and its tests: read-only durable completion lookup, not transaction-success evidence.
- `frontend/tests/protocol-completion.test.mjs`: 46 actual-page cases (40 new, six migrated from ContinuationPage), fixture fidelity and historical negative-control loading.
- `docs/LEGACY_PHASE_MIGRATION_AUDIT.md`: current evidence amendment only; no phase reclassification.

## Recorded validation

All commands were run from the repository root. Full raw logs are retained locally in this directory; the reproducible tests and this report are committed.

| Command | Result |
| --- | --- |
| `npm run test:completion --prefix frontend` | 125/125 PASS, 0 skipped |
| `npm run test:migration --prefix frontend` | 110/110 PASS |
| `npm run test:brain --prefix frontend` | 21/21 PASS |
| `npm run test:agent --prefix frontend` | 32/32 PASS |
| `npm run test:send --prefix frontend` | 31/31 PASS |
| `npm run test:tasks --prefix frontend` | 22/22 PASS |
| `npm run test:portfolio --prefix frontend` | 18/18 PASS |
| `npm run test:ux --prefix frontend` | 59/59 PASS |
| `npm run test:ui --prefix frontend` | 39/39 PASS |
| `npm run test:polish --prefix frontend` | 58/58 PASS |
| `npm run type-check --prefix frontend` | PASS |
| `npm run lint --prefix frontend` | PASS: 0 errors, 12 existing warnings |
| `npm run build --prefix frontend` | PASS: client and SSR |
| `npm test --prefix backend` | 100/100 PASS |
| `git diff --check` | PASS |

The new actual-page cases cover both approval reload boundaries, repeated reload during fresh quoting, nondefault `2.345678` / EURC→USDC / 1% / Standard inputs, pending approval/action, known-hash UNKNOWN, transport-unknown without hash, account/chain/protocol isolation, Activity/callback errors, failed hash checkpoint writes and read-only repair, silent Activity persistence failure, malformed history, completed-before-Done reload and Done-after-reload cleanup. EN/VI cases verify the changed notices and continuation surfaces. Existing late-wallet, stale-checkpoint, receipt, Circle/Base, finite approval and gas-ceiling tests remain enabled.

Negative-control evidence retained locally:

- `baseline-actual-pages.log`: first six actual-page reload regressions, 0/6 PASS against `7a90602dee0b35a455017fb19297fe8597985c20`.
- `baseline-bridge-hash-order.log`: `actual-page bridge Activity throw`, 0/1 PASS against the same commit; Activity observed `hash: undefined` instead of the returned hash.
- Set `MAKOTO_COMPLETION_BASELINE_REF` to that full SHA and run `node --test --test-name-pattern='actual-page bridge Activity throw' frontend/tests/protocol-completion.test.mjs` to reproduce the isolated hash-order negative control. Historical pages, both controls and strategy controller are supplied by read-only `git show`.

Lint warning locations match the prior PR evidence; none are in the changed controls/pages. The existing Vite/Circle dynamic-import warning appears in both baseline and final completion runs; build retains the existing large-chunk warning. These were not hidden or disabled.

## Scope and remaining QA

Browser completion tests mount the actual production pages/controls, strategy/policy and Activity merge helpers in an isolated extension-free browser. Wallet context, quote/preparation, simulation, wallet submission, receipt and Circle/Base reads are deterministic mocks, except existing captured-response adapter tests. This is not evidence of a real wallet dialog, live provider availability or live settlement. No real transaction was created, signed or broadcast.

Hosted checks must be assessed for the newly pushed commit through PR #8. A protected preview or access denial is a verification limitation, not an application PASS. Deployment Protection must remain unchanged. No merge, production push or manual production deployment is part of this work. Phase 13 implementation remains not started.
