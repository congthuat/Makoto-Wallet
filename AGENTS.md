# Makotowallet.xyz working rules

## Hotfix Arc RPC — 2026-10-16 DEPLOYED

- PR #10 merged → `makoto-wallet` @ `4d12743`
- Railway deploy `b199811d` SUCCESS, source branch switched to `makoto-wallet`
- `/api/arc/network`: chainId 5042002, blockNumber 67513233, latency 111ms
- SQLite post-deploy integrity_check: ok (all 3 DBs)
- makotowallet.xyz: HTTP 200
- Volume cleanup needed (run manually): `railway volume files delete --volume makoto-backend-volume /pf.js /backup.js /preflight.js`
- Backup files on volume: `/data/bak-2026-10-16-14-18-45-*.sqlite` (safe to delete after confirming stability)

- This directory is the only canonical development codebase. Treat `brain-donor-reference/`, transplant material, and old phase documents as evidence and logic references. Current runtime wins when they disagree.
- Preserve the current Surf-derived UI, EN/VI, themes, responsive behavior, and Vite/React plus Express architecture unless the user explicitly approves a change. Do not restore Ledger Calm UI or copy donor UI. Adapt framework-specific donor logic behind current boundaries.
- Audit before implementation. Make the smallest justified change, reuse a safe current implementation before replacing it, and cite code or observed behavior. Do not guess or claim PASS without recorded evidence.
- Never silently invent, rename, merge, skip, or expand an approved phase. Architecture phase order and migration status are separate. Phase 13 is not started.
- Do not commit, push, or deploy unless explicitly requested. Do not create, submit, or sign a transaction for QA without explicit user authorization.
- Preserve noncustodial control: the Agent only reads, quotes, and prepares; it never holds a signer or signs. The user's wallet is the final signing authority. Policy/Risk decisions must be deterministic.
- Preparation, wallet request, blockchain submission, and confirmation are distinct. UNKNOWN, PENDING, FAILED, and CONFIRMED are distinct. Require receipt and state evidence before reporting success. Never fabricate a balance, quote, simulation, route, hash, receipt, or completion, including when a provider fails.
- Before broad migration, use `docs/LEGACY_PHASE_MIGRATION_AUDIT.md` and update its evidence when implementation changes. Keep live Send protections and status truth intact.
