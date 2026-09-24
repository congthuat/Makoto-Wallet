# Makoto Wallet — Project State

> Current execution pointer. Update after each completed sub-phase.

## Current
- **Major phase:** Phase 8 — Makoto Tool Layer
- **Sub-phase:** 8E — Schemas + Validation
- **Status:** NOT STARTED
- **Next:** 8E — Schemas + Validation
- **After 8D:** 8E — Schemas + Validation
- **Phase 8 branch:** phase8-tool-layer
- **Phase 8 base commit:** `7ae32e081e64126892721a46b39a0f460f146971`
- **Branch captured at setup:** phase7-astra-ledger-calm
- **HEAD captured at setup:** `4fad37b6f479c20a306741e4b08a0cb29a13a8f4`
- **Handoff branch:** phase7-astra-ledger-calm
- **Handoff implementation commit:** `3410ed350cbf34b19537f6743799aafb51058d10` (`feat(wallet): complete Ledger Calm and native wallet foundation`)
- **Verification:** frontend 1162/1162; focused 7J / Native Wallet 64/64; contracts 19/19; compile PASS; typecheck PASS; build PASS; lint 0 errors / 7 inherited warnings; git diff --check PASS.
- **Native Wallet:** post-7J adjunct scope completed and included in the handoff commit.
- **Known risks:** 7 inherited lint warnings and 26 dependency advisories remain disclosed; no dependency upgrade was included.
- **Last refresh:** 2026-09-22 16:42:55 +07:00

## Authority note
Phase 7J completion and handoff are user-confirmed. Branch/HEAD captured at setup above remain historical setup values, not the live HEAD.

If code/history/docs appear to contradict this pointer:
- do not guess;
- inspect the repository and existing Phase 7 artifacts;
- surface the conflict;
- do not advance the roadmap automatically.

## Before every coding session
1. Read docs/PROJECT_STATE.md.
2. Read docs/ROADMAP.md.
3. Read docs/ARCHITECTURE_DECISIONS.md.
4. Run git status --short, git branch --show-current, git rev-parse HEAD.
5. Inspect active sub-phase code/tests/docs before editing.
6. Work only inside the current sub-phase unless the user explicitly changes scope.

## Completion gate
Record files changed, checks actually run, exact results, unresolved risks, commit SHA, and next approved sub-phase.
Never claim tests passed if they were not run.

## State history
- Canonical roadmap/state/architecture memory initialized while Phase 7H is active.
- **Phase 7H COMPLETE** — branch `phase7-astra-ledger-calm`; implementation commit `947aeceda404ed1aac9e18b9a1099f2fac9084f6` (`feat(ui): complete Phase 7H Ledger Calm hardening`).
- Completed validation: frontend 1082/1082 PASS; contracts 19/19 PASS; typecheck PASS; production build PASS; git diff --check PASS; lint: 0 errors, 7 existing warnings.
- Activity accessibility/responsive validation PASS; Pay accessibility/responsive validation PASS. Chrome was used for browser QA because the previously documented headless runner could not launch.
- Connected Unified Balance state: environment-blocked / uncertified. Connected Vault state: environment-blocked / uncertified. These connected states were not tested.
- **Phase 7I COMPLETE** — branch `phase7-astra-ledger-calm`; implementation commit `b2fa432dd575b800f4eecff334f0a7b41c7224cf` (`fix: complete Phase 7I robustness audit`).
- Completed validation: frontend tests 1086/1086 PASS; repair gates 24/24 PASS; contract tests 19/19 PASS; contract compile PASS; frontend typecheck PASS; production build PASS; git diff --check PASS; lint: 0 errors, 7 existing warnings; no stale `.network` RPC references remain.
- Phase 7I robustness scope completed: preserved partial activity truthfulness; standardized the Arc RPC endpoint to `.io`; added stale async/account guards to Universal Bridge, Send, Swap, and CCTP; protected pending review/approval states from Back/reset races; added `phase7iRobustness.test.ts`.
- Remaining disclosed gaps: live connected-wallet/funded Arc Testnet browser QA remains environment-dependent; 7 baseline lint warnings remain; `frontend/next-env.d.ts` is a pre-existing unrelated unstaged modification and remains untouched.
- Next approved sub-phase: **7J — Final Visual Regression + Release Handoff**.
- **Phase 7J COMPLETE** — branch `phase7-astra-ledger-calm`; handoff commit `3410ed350cbf34b19537f6743799aafb51058d10` (`feat(wallet): complete Ledger Calm and native wallet foundation`).
- Completed validation: frontend 1162/1162 PASS; focused 7J / Native Wallet 64/64 PASS; contracts 19/19 PASS; compile PASS; typecheck PASS; production build PASS; git diff --check PASS; lint: 0 errors, 7 inherited warnings.
- Native Wallet was completed as a post-7J adjunct scope and included in the handoff commit. No live transaction was triggered during verification.
- At the Phase 7J handoff, the next approved sub-phase was **8A — Current-System Audit**.
- **Phase 8A COMPLETE** — read-only inventory/reuse audit on `phase8-tool-layer`; no product code changed or tests rerun. Existing READ capabilities are not yet a canonical Phase 8 tool layer; PREPARE capabilities remain bounded and execution-disabled, and Agent-owned execution is absent. Send, Xylo Swap, Direct CCTP, Circle App Kit Bridge, and Unified Balance already exist. Circle App Kit Swap is a candidate; x402 is an inactive dependency.
- **Phase 8B COMPLETE — Read Tools.** Added the canonical typed READ tool layer with 9 tools covering wallet identity/state, verified network, balances, activity/load status, allowances, receipt evidence, and bridge operation evidence. Account/chain context, provenance, freshness, partial/unavailable states, truthful receipt/bridge evidence, and local-wallet locked versus disconnected state are preserved. No signing or submission authority was added. Validation: 26/26 focused tests; 1188/1188 full frontend tests; typecheck PASS; lint 0 errors / 7 inherited warnings; production build PASS; git diff --check PASS. Implementation commit: `33a3d2b5939d75e8bc062566b61547bf8e7d957e`.
- **Phase 8C COMPLETE — Quote Tools.** Added the canonical typed `send.quote`, `swap.quote`, and `bridge.quote` layer, reusing Phase 8B READ tools and preserving account/chain/provider/amount/route binding, freshness/expiry, provenance, and truthful available/partial/unavailable/unsupported/expired states. Circle App Kit estimates remain unavailable in the current Agent path; Swap and Bridge gas remain unestimated. No prepare/write capability was added. Validation: 10/10 focused tests; 1198/1198 full frontend tests; typecheck PASS; lint 0 errors / 7 inherited warnings; production build PASS; git diff --check PASS. Implementation commit: `4a31a294653f03024689aa3bd934ec4d7b32dd56`. Next approved sub-phase: **8D — Prepare/Write Tools**; then 8E, 8F, and 8G.
- **Phase 8D COMPLETE — Prepare/Write Tools.** Added bounded data-only `send.prepare`, `swap.prepare`, and `bridge.prepare` tools that reuse canonical READ and QUOTE evidence, require fresh quote agreement, preserve account/chain/provider/amount/route binding, quote fingerprints, and expiry, and represent exact finite approval steps where required. Prepared actions remain immutable with `executionEnabled: false`; no generic arbitrary transaction or calldata input, signing, approval execution, submission, or broadcast authority was added. Known integration gaps: cirBTC Send, local-wallet Swap, and Direct CCTP do not yet have compatible Agent handoffs; these remain later Agent-integration work. Validation: 12/12 focused tests; 1210/1210 full frontend tests; typecheck PASS; lint 0 errors / 7 inherited warnings; production build PASS; git diff --check PASS. Implementation commit: `11d403517149dd18de6a60b5aa9770af3e0f17fb`. Next approved sub-phase: **8E — Schemas + Validation**; then 8F and 8G.
