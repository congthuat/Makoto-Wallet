# Agent Send handoff and task safety audit — 2026-10-13

Production base: `69981de75182410e7811b87c59c8cec508ef1c8a` (`origin/makoto-wallet`, verified by fetch). Work is isolated on `fix/agent-send-handoff-task-parser-2026-10-13`. This maintenance fix does not advance a migration phase; Phase 13 remains not started.

## Send root cause and repair

At the production base, `Agent.tsx` writes an account-bound `BrainHandoff` and a `sendDraft` with `review: true`. `Send.tsx` consumes them, but its `wantReview` effect calls `setStage('review')` directly. Only manual `startReview()` calls `prepareSend()` and creates `PreparedSend` plus `BrainReviewSnapshot`. Consequently, handoff could show an actionable Confirm button with no prepared request, unavailable fee/total, and a silently returning `confirmSend()`.

`Send.tsx` now declares one stabilized `startReview()` callback before the one-shot handoff effect. Manual Review and handoff invoke this same live preparation path. A synchronous in-flight guard prevents duplicate preparation from the two handoff channels. Input/account/chain changes and unmount invalidate pending preparation; stale results cannot reinstall a review. Preparation failure retains the form and existing localized safe error. Connected Confirm is also disabled if either required prepared snapshot is missing.

`prepareSend`, deterministic Policy/Risk assessment, confirm-time fresh preparation, exact request comparison, submission guard, wallet request, cancellation classification, and receipt evidence remain the current implementations. Agent parameter review and handoff do not call `eth_sendTransaction`. Only an explicit Confirm click reaches the wallet request; no signer is held by the Agent. Swap/Bridge production code is unchanged.

## Task parser reproduction

All five requested Vietnamese portfolio phrases passed **before** source changes through `taskIntentMode()` and `parseIntent()`: automation → `SCHEDULED_AUTOMATION`, `DAILY`, `07:00`, `PORTFOLIO_SUMMARY`, with no missing fields. The original portfolio-summary failure could not be reproduced from this production base. No portfolio-recognition or frontend-routing source change was made.

The investigation found a separate backend financial-write guard defect: `\d\b` recognized only a single-digit Send amount. `Gửi 10 USDC mỗi ngày lúc 08:00` and its English counterpart returned missing action rather than the explicit write blocker; a mixed Send-plus-summary request could become a read-only summary candidate. The smallest correction is `\d+\b` in `backend/lib/taskDefinitions.js`. All four required Send/Swap/Bridge phrases now return no candidate and `TASK_WRITE_REQUIRES_USER` / `PREPARE_ONLY`. Regressions include single-digit, multi-digit, decimal and mixed summary/write requests. The task engine continues to execute read/summary actions only.

## Recorded validation

Local environment: Node `v24.16.0`, npm `11.13.0`, Windows, existing Chrome executable. Both locked `npm ci` installations passed. Dependency declarations and lockfiles are unchanged; only a frontend test script was added. Existing CI now invokes the Send browser regressions. The harness discovers an existing Chrome/Chromium or accepts `MAKOTO_CHROME_PATH`, never downloads a browser/package, and fails explicitly if unavailable. GitHub's [Ubuntu runner inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md#browsers-and-drivers) lists Chrome/Chromium.

| Command / check | Recorded result |
| --- | --- |
| `npm ci --prefix frontend` | PASS |
| `npm ci --prefix backend` | PASS |
| `npm run test:brain --prefix frontend` | 17/17 PASS |
| `npm run test:agent --prefix frontend` | 31/31 PASS |
| `npm run test:tasks --prefix frontend` | 12/12 PASS |
| `npm run test:portfolio --prefix frontend` | 18/18 PASS |
| `npm run test:ux --prefix frontend` | 59/59 PASS |
| `npm run test:migration --prefix frontend` | 82/82 PASS; existing Swap/CCTP/Bridge boundaries covered |
| `npm run test:ui --prefix frontend` | 30/30 PASS |
| `npm run test:polish --prefix frontend` | 58/58 PASS |
| `npm run test:send --prefix frontend` | 15/15 PASS, zero skips |
| `npm test --prefix backend` | 99/99 PASS |
| `npm run type-check --prefix frontend` | PASS |
| `npm run lint --prefix frontend` | PASS, 0 errors / 12 existing warnings |
| `npm run build --prefix frontend` | Client and SSR PASS; existing mixed-import and chunk-size notices |
| `git diff --check` | PASS |

The Send browser suite runs actual Agent, Send, Swap and Bridge components in React StrictMode, replacing only wallet context and provider with explicit test fixtures. It exercises the exact Vietnamese Send input through Agent parameter confirmation and actual Continue, both handoff channels, one-time preparation, manual parity, held/failed preparation, real preparation calculations from mock RPC inputs, stale amount/account/chain/recipient rejection, and explicit mocked wallet cancellation. The mock provider always rejects `eth_sendTransaction` with code `4001`; cancellation shows `USER_REJECTED`, no hash, no local Send record, and no receipt request. Fixture fee/total (`0.0048` / `1.0048 USDC`) are test outputs, not observed network values.

Regression sensitivity was recorded without replacing working source: `MAKOTO_SEND_BASELINE_REF=69981de75182410e7811b87c59c8cec508ef1c8a` loads historical Send through read-only `git show`. The actual Agent test fails at `Agent cont() must not expose Confirm before PreparedSend exists`; current source passes. The new backend financial-write regression also failed before the one-character guard change and passed afterward.

## Real-wallet QA and publication boundary

Real-wallet cancellation QA is **PASS**, separate from the mocked regression. The user's Chrome session loaded the local fix at `http://localhost:5173`; the user completed the wallet connection. The exact input `Gửi 1 USDC cho 0x1951f95962442b6b6be2671e4d39bc88ff6cbe71` reached Agent parameter review. Confirmation of those parameters opened no wallet notification. Continue automatically ran Send live preparation and displayed **0.002961 USDC maximum fee**, **1.002961 USDC total**, the exact recipient and all four completed live checks. These are observed live review values, not fixture outputs. No wallet notification existed before the explicit Confirm click.

The explicit connected Confirm click revalidated the request and reached the real wallet rejection path. The app displayed `Đã hủy yêu cầu trong ví` (Wallet request cancelled) and `Wallet rejected; nothing was submitted.` This is the current `USER_REJECTED` result branch. The result had no transaction hash, submitted/confirmed state or explorer transaction link (observed link count: zero). No transaction was signed or broadcast during QA. The browser connector blocks extension pages, so the wallet's final controls remain user-operated; no alternate access or workaround was used.

The initial development startup issue was observed as a Vite `504 Outdated Optimize Dep` response; restarting with an isolated `VITE_CACHE_DIR` restored the app without source changes. Agent's injected-provider read-only preflight was initially slow and then completed; its lack of an application-level read timeout is existing source behavior and was not changed by this focused fix. Display data from the separate backend was not substituted for this preflight or Send preparation.

Local backend startup also reports an existing Surf schema-sync `401`; it is not treated as successful provider evidence. The deterministic fixture suites do not depend on that service.

The required automated validation and real-wallet cancellation QA have passed, satisfying the user's commit/push/PR condition. Publication is limited to the fix branch and a PR into `makoto-wallet`. Production, `v0.3.0`, dependencies, phases, and unrelated product code remain unchanged. No merge, force push or deployment is authorized.
