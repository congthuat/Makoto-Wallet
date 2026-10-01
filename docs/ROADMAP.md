# Approved architecture roadmap

Architecture sequence is fixed. Historical completion in an older app is separate from migration status in Makotowallet.xyz. See `PROJECT_STATE.md`, `LEGACY_PHASE_MIGRATION_AUDIT.md`, and `PHASE_8_12_MIGRATION_CLOSEOUT.md` for the current scoped Phase 8–12 closeout and external Universal Bridge blocker. Do not silently rename, skip, merge, or expand these phases.

## Phase 8 — Makoto Tool Layer

8A current-system audit → 8B read tools → 8C quote tools → 8D prepare/write tools returning bounded unsigned transactions → 8E schemas + validation → 8F agent integration → 8G regression + closeout.

## Phase 9 — Policy & Risk Engine

9A threat model + policy inventory → 9B core deterministic policy engine → 9C chain/contract/token/approval/slippage controls → 9D simulation + expiry + revalidation gate → 9E block/warn/review UX contract → 9F adversarial + failure-path tests → 9G robustness audit + closeout.

## Phase 10 — Sequential Strategy Engine

10A strategy/step model → 10B single-step execution → 10C receipt verification → 10D state re-read/requote/revalidation after receipt → 10E controlled multi-step continuation → 10F interruption/rejection/expiry/retry/recovery → 10G end-to-end regression + closeout.

## Phase 11 — Intent Planner

11A intent schema → 11B classify information/action/strategy → 11C structured plan generation → 11D parameter resolution + validation → 11E replanning after changed state/failure → 11F planner tests + closeout.

## Phase 12 — Agent State Machine

12A state definitions → 12B legal transitions + guards → 12C session/state persistence boundaries → 12D error/expired/rejected/failed states → 12E recovery/resume → 12F UI wiring + truthful status surfaces → 12G robustness audit + closeout.

**Agent Core milestone:** after Phase 12 and its closeout evidence.

## Phase 13 — Makoto MCP — NOT STARTED

13A MCP boundary/protocol design → 13B server shell/transport/lifecycle → 13C read tools → 13D quote tools → 13E prepare/write tools → 13F auth/security/abuse boundaries → 13G Makoto Agent integration → 13H security/compatibility audit + closeout.

## Later phases

- Phase 14 — Agent Memory
- Phase 15 — Activity / Indexer Intelligence
- Phase 16 — Verifiable Agent Actions
- Phase 17 — FLOP / Technocore Integration
