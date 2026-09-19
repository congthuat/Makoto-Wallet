# Makoto Wallet — Project State

> Current execution pointer. Update after each completed sub-phase.

## Current
- **Major phase:** Phase 7 — Ledger Calm
- **Sub-phase:** 7I
- **Status:** ACTIVE
- **Next:** 7J
- **After Phase 7:** 8A
- **Branch captured at setup:** phase7-astra-ledger-calm
- **HEAD captured at setup:** `4fad37b6f479c20a306741e4b08a0cb29a13a8f4`
- **Last refresh:** 2026-09-19 13:26:26 +07:00

## Authority note
Sub-phase 7I is user-confirmed. Branch/HEAD captured at setup above remain historical setup values, not the live HEAD.

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
- Next approved sub-phase: **7I — Robustness Audit**.
