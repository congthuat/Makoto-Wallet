# Makoto Wallet — Architecture Decisions

Durable decisions below remain in force unless the user explicitly changes them.

## ADR-001 — Non-custodial
Makoto remains non-custodial. Never store, transmit, log, or expose seed phrases/private keys.

## ADR-002 — Human signature boundary
The agent may read, plan, quote, simulate, and prepare. It does not sign. The connected user wallet is the final signing authority.

## ADR-003 — Deterministic Policy/Risk Engine
Safety is enforced by deterministic code, not only prompt/model judgment. Wrong chain, unsupported assets, unsafe approvals, expired quotes, reverts, bad spenders, or excessive slippage must follow explicit block/warn/requote rules.

## ADR-004 — Typed tool boundaries
Prefer READ, QUOTE, and PREPARE/WRITE tools with typed schemas. The agent must not invent arbitrary calldata when a supported tool exists.

## ADR-005 — Sequential dependent execution
Dependent writes run one at a time:
read -> quote/plan -> policy -> simulate -> review -> user sign -> verify receipt -> re-read/revalidate -> next step.

## ADR-006 — Truthful execution UI
Never show transaction success before verified receipt/state evidence. Distinguish prepared, awaiting signature, submitted, confirming, success, rejected, expired, and failed.

## ADR-007 — Memory is not blockchain truth
Memory may retain preferences/context. Balances, allowances, quotes, receipts, network state, and transaction status must be re-read from authoritative sources. Never store signing secrets in memory.

## ADR-008 — MCP is an integration boundary
MCP exposes stable capabilities. It does not replace the Policy/Risk Engine or wallet signing boundary.

## ADR-009 — Phase 7 scope freeze
During 7H–7J, do not pull Phase 8+ architecture work into Phase 7 unless required to fix an actual Phase 7 regression.

## ADR-010 — Vitael is reference material, not a clone target
Useful patterns may be adapted, but Makoto remains wallet + safety + agent orchestration rather than a requirement to build a proprietary lending/DEX protocol.

## ADR-011 — FLOP / Technocore
FLOP/Technocore remains planned Phase 17 integration. It is not required for core wallet operation and must not weaken the non-custodial boundary.

## ADR-012 — Source-of-truth order
1. `docs/PROJECT_STATE.md`
2. `docs/ROADMAP.md`
3. `docs/ARCHITECTURE_DECISIONS.md`
4. current code/tests/git state
5. legacy docs for history/component-specific context

If these conflict, surface the conflict instead of inventing behavior.
