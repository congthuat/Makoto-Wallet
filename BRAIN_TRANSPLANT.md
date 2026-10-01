# Makoto Wallet — Brain Transplant

## Canonical product rule

The project in this archive is based on `makoto-wallet.zip` and keeps that project as the canonical product shell. Existing layout, navigation, components, pages, responsive behavior, themes, localization, public assets, backend routes, demo/watch/connected modes, and existing features remain present.

The donor project is `Makoto-Wallet-Current-Surf.zip`. Its agent/safety/planning architecture is treated as the source of the Makoto "brain".

## What is active in the canonical Vite app

A framework-neutral compatibility layer now lives in `frontend/src/brain/` and is wired into the existing UI without replacing the canonical UI system.

Active pieces:

- deterministic local intent parsing for Send / Swap / Bridge and core read requests;
- preparation routing with missing-field/conflict checks;
- prepare-only Agent boundary;
- Agent MAX rejection (MAX stays manual);
- deterministic policy/safety assessment;
- account/network/material-change review snapshots;
- 60-second review expiry and revalidation;
- one-time, account-bound Agent handoff stored in `sessionStorage` with a 5-minute TTL;
- transaction lifecycle state model that keeps wallet request, submission, confirmation, failure and unknown-result states separate;
- Send consumes Agent handoff and performs policy review/revalidation before a live, user-wallet ERC-20 transfer in connected mode; demo and watch modes retain the preview state;
- Swap consumes Agent handoff and adds safety review while still requiring a fresh live quote/simulation before any future wallet request;
- Bridge consumes Agent handoff and preserves the rule that source submission is not destination completion;
- existing target scenarios and UI remain as fallback so features from the canonical ZIP are not removed.

## Exact donor source retained

`brain-donor-reference/` contains the relevant donor source and architecture documents copied from `Makoto-Wallet-Current-Surf.zip`, including:

- `frontend/lib/agent/**`
- transaction safety/review/orchestrator/receipt modules
- swap planning / SAFE MAX / fee-envelope modules
- CCTP and Circle bridge modules
- Arc transaction lifecycle
- wallet safety / activity / indexer support
- architecture/security/QA documents

This source is intentionally outside `frontend/src`, so the Vite app does not accidentally compile Next.js/Wagmi/Circle-specific modules before their adapters are ported.

## Important boundary

The canonical ZIP originally had read-only wallet connectivity and preview transaction flows. Connected Send now has a separate, explicitly reviewed browser-wallet execution path. Makoto still cannot sign: `eth_sendTransaction` goes to the injected user wallet only after live preparation, deterministic policy review, and immediate revalidation. Swap and Bridge remain preview/preparation flows. See `docs/SEND_RUNTIME_AUDIT.md` for the current Send wiring and validation evidence.

The following donor protocol implementations are retained in `brain-donor-reference` but are not automatically activated in this archive:

- Wagmi/Next-specific write hooks;
- live Xylo quote/approval/swap execution;
- Circle App Kit Universal Bridge execution;
- Direct CCTP burn/mint execution;
- receipt/indexer adapters that depend on the donor runtime/provider stack;
- Vault contract writes.

Those pieces should be ported behind the existing brain review/revalidation boundary rather than by replacing the canonical UI.

## Safety invariants

1. Makoto remains non-custodial.
2. Agent is prepare-only and never signs.
3. User-connected wallet is the final signing authority.
4. No seed/private-key handling is introduced.
5. Review and wallet confirmation are separate states.
6. Material changes or expired reviews require re-review.
7. Quote/simulation/provider evidence must be live and truthful before execution.
8. Approval and protocol execution remain separate reviews.
9. Source-chain bridge submission is never treated as destination completion.
10. Unknown result is not success.

## Validation available in this archive

Run from `frontend/`:

```bash
npm run test:brain
```

The brain unit tests cover parsing, swap/bridge preparation, MAX blocking, review expiry/material-change invalidation, and one-time account-bound handoff behavior.

The archive's original validation note above described the transplant baseline. The later Send implementation was tested and built locally; results are recorded in `docs/SEND_RUNTIME_AUDIT.md`. No real Arc Testnet transaction was submitted during that validation.
