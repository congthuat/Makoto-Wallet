# Makoto Wallet — Canonical Roadmap

This is the canonical roadmap for Makoto Wallet / Makoto Agent.

## Rules
- Work only on the current sub-phase in `docs/PROJECT_STATE.md`.
- Do not invent, rename, skip, merge, or expand phases unless the user explicitly changes the roadmap.
- New ideas go to backlog notes; they do not silently expand the active phase.
- Do not pull Phase 8+ work into Phase 7H–7J.

## Phase 7 — Ledger Calm
- **7H — ACTIVE:** continue the already-defined 7H scope only. Inspect current code/tests/docs before editing.
- **7I — Robustness Audit:** edge cases, race conditions, state ownership, truthfulness, failure handling, regression.
- **7J — Final Visual Regression + Release Handoff:** responsive, EN/VI, light/dark, final UI regression, build/release readiness.

Exit: `7H -> 7I -> 7J -> Phase 7 complete -> 8A`

## Phase 8 — Makoto Tool Layer
- **8A** current-system audit
- **8B** read tools
- **8C** quote tools
- **8D** prepare/write tools returning bounded unsigned transactions
- **8E** schemas + validation
- **8F** agent integration
- **8G** regression + closeout

## Phase 9 — Policy & Risk Engine
- **9A** threat model + policy inventory
- **9B** core deterministic policy engine
- **9C** chain/contract/token/approval/slippage controls
- **9D** simulation + expiry + revalidation gate
- **9E** block/warn/review UX contract
- **9F** adversarial + failure-path tests
- **9G** robustness audit + closeout

## Phase 10 — Sequential Strategy Engine
- **10A** strategy/step model
- **10B** single-step execution
- **10C** receipt verification
- **10D** state re-read/requote/revalidation after receipt
- **10E** controlled multi-step continuation
- **10F** interruption/rejection/expiry/retry/recovery
- **10G** end-to-end regression + closeout

## Phase 11 — Intent Planner
- **11A** intent schema
- **11B** classify information/action/strategy
- **11C** structured plan generation
- **11D** parameter resolution + validation
- **11E** replanning after changed state/failure
- **11F** planner tests + closeout

## Phase 12 — Agent State Machine
- **12A** state definitions
- **12B** legal transitions + guards
- **12C** session/state persistence boundaries
- **12D** error/expired/rejected/failed states
- **12E** recovery/resume
- **12F** UI wiring + truthful status surfaces
- **12G** robustness audit + closeout

**Agent Core milestone:** after Phase 12 the core agentic-wallet execution architecture is complete.

## Phase 13 — Makoto MCP
- **13A** MCP boundary/protocol design
- **13B** server shell/transport/lifecycle
- **13C** read tools
- **13D** quote tools
- **13E** prepare/write tools
- **13F** auth/security/abuse boundaries
- **13G** Makoto Agent integration
- **13H** security/compatibility audit + closeout

## Phase 14 — Agent Memory
- **14A** memory model/data classes
- **14B** session memory
- **14C** long-term preferences/durable context
- **14D** retrieval/relevance controls
- **14E** privacy/secret-exclusion/trust boundaries
- **14F** update/correction/forgetting behavior
- **14G** tests + closeout

## Phase 15 — Activity / Indexer Intelligence
- **15A** event/activity model
- **15B** RPC/indexing ingestion
- **15C** normalized SEND/RECEIVE/SWAP/BRIDGE/VAULT/APPROVAL activity
- **15D** persistence/checkpointing
- **15E** agent query surfaces
- **15F** reorg/RPC failure/recovery
- **15G** validation + closeout

## Phase 16 — Verifiable Agent Actions
- **16A** action IDs/lifecycle
- **16B** intent/plan records
- **16C** tool-call/simulation trace
- **16D** user approval + receipt binding
- **16E** audit/activity UI
- **16F** export/proof format
- **16G** security/integrity review + closeout

## Phase 17 — FLOP / Technocore Integration
Optional ecosystem integration after Agent Core is stable. It does not change Makoto's non-custodial trust model.
- **17A** integration architecture/boundaries
- **17B** Technocore DID adapter
- **17C** FLOP compute/inference adapter
- **17D** signed work/action receipts
- **17E** agent orchestration integration
- **17F** end-to-end tests/failure isolation
- **17G** release handoff

## Architecture direction
`User Intent -> Agent -> Planner -> Tool Layer -> Policy/Risk Engine -> Simulation -> Review -> User Wallet Signature -> Blockchain -> Receipt -> Re-read State -> Next Step/Done`

The LLM may propose and plan. It is never the final authority for transaction safety or wallet signing.
