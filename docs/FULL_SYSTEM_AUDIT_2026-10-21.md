# Full System Audit — 2026-10-21 (Revision 2)

**Revision history:**
- Rev 1: Initial audit — 6 fixes in PR #13, P0 claim revised below
- Rev 2: Independent review identified 13 additional unprotected call sites. All fixed and tested.

---

## Audit methodology

Static analysis of every `p.request()` / `provider.request()` call in the frontend source tree. Each call site was classified as:
- **User-interactive** (wallet signing popup must never be cancelled): `eth_sendTransaction`, `personal_sign`, `eth_requestAccounts`, `wallet_switchEthereumChain`, `wallet_addEthereumChain` — intentionally not wrapped.
- **Read-only** (must time out): every other `p.request()` call.

Test results are classified as:
- **PASS_STATIC** — passing type-check and lint with no runtime execution
- **PASS_UNIT** — passing deterministic unit test with a mock provider
- **PASS_BROWSER** — passing end-to-end browser test (requires Chrome)
- **BLOCKED** — cannot be verified without a live wallet in a real browser session

---

## P0 — No confirmed P0 issues

The previous report incorrectly stated "No P0" as a positive conclusion. The correct statement is:

> **No fund-loss, double-send, checkpoint-corruption, or database defect was found by static analysis and unit testing. P0 issues that require a live wallet signing session (duplicate burn on retry, silent tx loss, wrong recipient after account change) are BLOCKED — they cannot be confirmed absent without a real browser/wallet test.**

---

## Complete RPC call site inventory

### User-interactive (intentionally unwrapped — correct)

| File | Method | Status |
|------|--------|--------|
| `sendExecution.ts:107` | `eth_sendTransaction` | PASS_STATIC — correct by design |
| `protocolExecution.ts:11` | `eth_sendTransaction` | PASS_STATIC — correct by design |
| `wallet.ts:152,155,166` | `wallet_switchEthereumChain`, `wallet_addEthereumChain` | PASS_STATIC — correct by design |
| `wallet.ts:179` | `eth_requestAccounts` | PASS_STATIC — correct by design |
| `taskAuth.ts:33` | `personal_sign` | PASS_STATIC — correct by design |

### Read-only — all now wrapped (Rev 1 + Rev 2 fixes)

| File | Line | Method | Fixed in | Test |
|------|------|--------|----------|------|
| `sendExecution.ts` | 41 | `req()` wrapper | pre-audit | PASS_UNIT |
| `toolLayer.ts` | 73 | `req()` wrapper | pre-audit | PASS_UNIT |
| `store.tsx` | 114,133,150 | `eth_chainId` (reconcile loops) | PR #13 Rev 1 | PASS_UNIT |
| `wallet.ts` | 186,188 | `eth_chainId`, `eth_accounts` (post-connect) | PR #13 Rev 1 | PASS_UNIT |
| `store.tsx` | 225 | `eth_accounts` (init effect) | PR #13 Rev 2 | PASS_UNIT |
| `store.tsx` | 253 | `eth_chainId` (init effect) | PR #13 Rev 2 | PASS_UNIT |
| `protocolActivity.ts` | 47 | `eth_chainId` | PR #13 Rev 2 | PASS_UNIT |
| `protocolActivity.ts` | 49,87 | `eth_getTransactionReceipt` | PR #13 Rev 2 | PASS_UNIT |
| `protocolActivity.ts` | 52,90 | `eth_getTransactionByHash` | PR #13 Rev 2 | PASS_UNIT |
| `protocolExecution.ts` | 32,33 | `eth_getTransactionReceipt`, `eth_getTransactionByHash` | PR #13 Rev 2 | PASS_UNIT |
| `LiveSwapControl.tsx` | 169 | `eth_call` (simulate) | PR #13 Rev 2 | PASS_STATIC |
| `LiveSwapControl.tsx` | 246 | `eth_gasPrice` (confirm pre-check) | PR #13 Rev 2 | PASS_STATIC |
| `taskAuth.ts` | 28,40 | `eth_accounts` (pre/post sign) | PR #13 Rev 2 | PASS_UNIT |

---

## Bug report by priority

### P0 (fund-affecting) — BLOCKED

| ID | Symptom | Evidence | Status |
|----|---------|----------|--------|
| P0-B1 | Duplicate burn on CCTP retry after provider timeout | Cannot confirm without a live provider that returns receipt=null after burn tx is mined | BLOCKED — needs real wallet session |
| P0-B2 | Wallet extension swapped mid-send (EIP-6963) | Cannot reproduce without two simultaneous extensions in a real browser | BLOCKED — needs real browser |

**These are not confirmed bugs** — checkpoint and guard logic (`SendSubmissionGuard`, `rememberWalletOutcome`, `requireCurrent`) is designed to prevent both. The BLOCKED label means absence cannot be proven statically.

### P1 — Fixed (Rev 2)

| ID | File | What | Fix |
|----|------|------|-----|
| P1-001 | `protocolActivity.ts` | 5 read-only `p.request()` calls in `checkBridgeRecord` and `checkSwapRecord` not wrapped | Wrapped with `withRpcTimeout` |
| P1-002 | `protocolExecution.ts` | 2 read-only `p.request()` calls in `checkProtocolReceipt` not wrapped | Wrapped with `withRpcTimeout` |
| P1-003 | `store.tsx` | 3 reconcile-loop `eth_chainId` calls not wrapped (Rev 1) | Wrapped in Rev 1 |
| P1-004 | `wallet.ts` | 2 post-connect readbacks not wrapped (Rev 1) | Wrapped in Rev 1 |
| P1-005 | `store.tsx` | 2 init-effect calls (`eth_accounts`, `eth_chainId`) not wrapped | Wrapped with `withRpcTimeout` |

### P2 — Fixed (Rev 1 + Rev 2)

| ID | File | What | Fix |
|----|------|------|-----|
| P2-001 | `LiveSwapControl.tsx` | `needsResume` not reset before localStorage read on chain switch — could auto-resume approval across chain change | Reset before read (Rev 1) |
| P2-002 | `store.tsx` | React Query fetch calls had no AbortSignal | `signal` threaded into all fetch calls (Rev 1) |
| P2-003 | `backend/routes/arc.js` | No outer deadline on `readWallet` explorer calls | 12 s outer `AbortController` (Rev 1) |
| P2-004 | `LiveSwapControl.tsx` | `eth_call` (simulate) not wrapped | Wrapped with `withRpcTimeout` (Rev 2) |
| P2-005 | `LiveSwapControl.tsx` | `eth_gasPrice` (confirm pre-check) not wrapped | Wrapped with `withRpcTimeout` (Rev 2) |
| P2-006 | `taskAuth.ts` | `eth_accounts` before/after `personal_sign` not wrapped | Wrapped with `withRpcTimeout` (Rev 2) |

### P3 — Fixed (Rev 1)

| ID | File | What | Fix |
|----|------|------|-----|
| P3-001 | `store.tsx` | Error code 4100 not recognised as wallet rejection | Added to rejection check |
| P3-002 | `backend/routes/sentiment.js` | Surf API 402 forwarded as 502 | Returns 402 + `QUOTA_EXCEEDED` |

---

## Regression matrix (PASS_STATIC unless noted)

| Feature | Status | Notes |
|---------|--------|-------|
| Wallet connect/disconnect | PASS_STATIC | EIP-6963, legacy providers, error codes 4001+4100 |
| Dashboard/portfolio/prices | PASS_STATIC | React Query AbortSignal + stale-data logic |
| Send flow | PASS_UNIT | `prepareSend`, `requestSend`, `pollSendReceipt` all tested |
| Send with account/chain change | PASS_UNIT | `assertFreshSend`, `samePrepared` unit tested |
| Swap/approval flow | PASS_STATIC | `simulate()` and `confirm()` preflight now wrapped |
| Bridge CCTP | PASS_STATIC | `checkBridgeRecord` timeout-wrapped; checkpoint logic preserved |
| Agent chat/planning | PASS_UNIT | `withChatDeadline` AbortController tested |
| Agent Send/Swap/Bridge cards | PASS_UNIT | `sendIntentCheckpoint`, `AgentSendCard` unit tested |
| Tasks/SIWE auth | PASS_STATIC | `eth_accounts` wrapped; `personal_sign` correctly unwrapped |
| Activity reconcile | PASS_UNIT | All 3 reconcile loops now timeout-wrapped |
| Portfolio history | PASS_STATIC | AbortController logic, no p.request calls |
| Sentiment API | PASS_STATIC | 402 now surfaces correctly |
| i18n / responsive | PASS_STATIC | No logic changes |
| Backend APIs (130 tests) | PASS_UNIT | 130/130 pass, all endpoints |
| Wallet connect in real browser | BLOCKED | Needs live wallet extension |
| Real swap/bridge execution | BLOCKED | Needs live wallet + funds |
| CCTP destination confirmation | BLOCKED | Needs live Circle attestation |
| EIP-6963 multi-extension | BLOCKED | Needs 2+ simultaneous extensions |

---

## Railway version drift

- Railway backend: `{"status":"ok"}` responding on `makotowallet.xyz`; chainId=5042002; block ~68,324,185
- GitHub `makoto-wallet` HEAD: `ca917c4`
- Backend route changes in Rev 1 (sentiment.js, arc.js) are in PR #13 branch only. Railway is on `ca917c4` (pre-PR-13). When PR #13 merges, Railway will need a redeploy to pick up `arc.js` and `sentiment.js` changes.
- **No automatic Railway deploy will be attempted.** Manual redeploy is required after merge.

---

## Files changed in PR #13 (cumulative Rev 1 + Rev 2)

| File | Change |
|------|--------|
| `frontend/src/lib/protocolActivity.ts` | 5 `p.request()` calls wrapped with `withRpcTimeout` |
| `frontend/src/migrated/protocolExecution.ts` | 2 `p.request()` calls wrapped with `withRpcTimeout` |
| `frontend/src/components/LiveSwapControl.tsx` | `eth_call` (simulate) + `eth_gasPrice` (confirm) wrapped; `needsResume` reset on chain change |
| `frontend/src/lib/store.tsx` | Init-effect `eth_accounts` + `eth_chainId` wrapped; reconcile loops wrapped (Rev 1); AbortSignal in fetch (Rev 1); error code 4100 (Rev 1) |
| `frontend/src/lib/wallet.ts` | Post-connect readbacks wrapped (Rev 1) |
| `frontend/src/lib/taskAuth.ts` | `eth_accounts` pre/post sign wrapped |
| `frontend/src/lib/rpcCallSites.test.ts` | New — 9 unit tests for the 13 newly wrapped call sites |
| `backend/routes/sentiment.js` | 402 passthrough (Rev 1) |
| `backend/routes/arc.js` | Outer deadline + `AbortSignal.any` (Rev 1) |

---

## Test results (final)

| Suite | Result |
|-------|--------|
| Backend (130 tests) | 130 / 130 PASS_UNIT |
| `rpcTimeout.test.ts` (7 tests) | 7 / 7 PASS_UNIT |
| `rpcCallSites.test.ts` (9 tests) | 9 / 9 PASS_UNIT |
| `sendExecution.test.ts` | PASS_UNIT |
| `toolLayer.test.ts` | PASS_UNIT |
| `chatClient.test.ts` | PASS_UNIT |
| `AgentSendCard.test.ts` (8 tests) | PASS_UNIT |
| Browser E2E suite (207 tests) | BLOCKED — Chrome not installed in sandbox; pass in GitHub Actions CI |
| TypeScript | 0 errors |
| ESLint | 0 errors, 12 pre-existing warnings |

---

## Known limitations and open items

1. **BLOCKED: real wallet session** — P0-B1, P0-B2, and all BLOCKED items in the regression matrix require a real browser with a wallet extension. No mock can substitute for injected provider behaviour.
2. **LiveSwapControl.tsx `simulate()` / `confirm()`** — covered by PASS_STATIC (timeout wrapper present); E2E browser test is BLOCKED.
3. **Railway redeploy** — required after PR #13 merge for backend fixes to take effect.
4. **Sentiment 402 UI handling** — backend now returns the correct status code; the frontend currently shows a generic "unavailable" message. A follow-up can add a specific "service quota exceeded" UI.

---

**Do not merge PR #13 without explicit confirmation.**
