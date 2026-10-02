# Makoto Wallet — Arc Testnet Production Preview — 2026-10-02

**Release candidate document only.** This cleanup creates no Git tag or GitHub release.

Production app: [makotowallet.xyz](https://makotowallet.xyz)

Production checkpoint at start of cleanup: `c4076bd7c291f2cd0c481b983c332ea4fc41a6f7`

## Highlights

- Natural-language wallet interaction with deterministic reads, planning, Policy/Risk and explicit transaction review.
- Connected-wallet Send, USDC/EURC Swap and a scoped Circle CCTP v2 integration.
- Recorded portfolio history, owner-scoped monitoring and daily summaries, and read-only Arc Analytics.
- English, Vietnamese, Chinese, Japanese and Korean UI; light/dark themes and responsive desktop/mobile layouts.

## Security model

Makoto is non-custodial. The connected wallet remains the final signer; the Agent never receives private keys, seed phrases or custodial signing authority. Deterministic Policy/Risk, review and fresh revalidation govern wallet requests. Preparation, a wallet request and blockchain confirmation are separate steps. `USER_REJECTED`, `UNKNOWN`, `PENDING` and `CONFIRMED` remain distinct; confirmation requires receipt/evidence reconciliation.

## Agent

Makoto Agent supports conversation, deterministic wallet/portfolio/network reads, and Send/Swap/Bridge planning and handoff. The backend-only Responses-compatible LLM provides conversation and explanations. It cannot authorize writes, create authoritative balances or quotes, bypass Policy/Risk, or mark a transaction confirmed. Home answers supported read requests inline and hands deeper workflows to Agent. See [Agent integration](../LLM_AGENT_INTEGRATION.md) and [Home/wallet UX](../AGENT_HOME_UX.md).

## Wallet / portfolio

EIP-6963 discovery and compatible injected providers support individual OKX, MetaMask and Rabby selection, plus other actually discovered providers. A public-address watch-only mode is available. Arc Testnet balances cover USDC, EURC and cirBTC; CoinGecko supplies normalized pricing with explicit stale/unavailable states.

Portfolio history uses server-authoritative SQLite observations and `1D / 1W / 1M / 1Y / ALL` ranges. Production history requires an explicit SIWE wallet verification action; signing that ownership message costs no gas and is not a blockchain transaction. Recording begins with actual observations, and a chart requires at least two. No history is reconstructed or backfilled. See [portfolio history](../PORTFOLIO_HISTORY.md).

## Send / Receive

Connected Send prepares reviewed ERC-20 transfers for USDC, EURC and cirBTC on Arc Testnet, with user wallet confirmation. Receive presents the wallet address and QR code through the shared receive flow. Activity uses transaction evidence to distinguish pending, unknown, failed and confirmed states.

## Swap

The connected Xylo flow supports USDC ↔ EURC with fresh quotes, bounded approval where required, simulation, review and user-controlled wallet signing. Unsupported assets are excluded from this connected execution path.

## Circle CCTP

Current write scope is **USDC only, Arc Testnet (5042002) → Base Sepolia (84532)**. The implementation uses pinned official Circle adapter/provider packages. The flow separates quote, finite approval when necessary, preparation, simulation, review, wallet handoff, source receipt, CCTP evidence and destination receipt/evidence.

Implementation tests and a prior live read-only quote check exist. Current evidence does **not** establish a real live approval/burn plus destination transaction completion. EURC/cirBTC CCTP execution and Universal Bridge are outside the supported write scope. See [Circle CCTP v2 integration](../CIRCLE_CCTP_V2_INTEGRATION.md).

## Tasks

Owner-scoped balance threshold monitors and daily scheduled summaries persist in the backend and can run after the browser closes while the backend remains available. Current scheduled jobs are read-only and notify-only; financial actions remain `PREPARE_ONLY`. The scheduler has no wallet signer. Its SQLite claims coordinate workers sharing one file on one host; they are not a multi-host distributed lock. See [task engine](../TASK_AUTOMATION_ENGINE.md) and [claim boundaries](../TASK_EXECUTION_CLAIMS.md).

## Analytics

Analytics presents read-only Arc RPC and Explorer observations: network telemetry, bounded transfer samples and indexed USDC holding addresses. Source and unavailable states remain explicit. These samples do not establish complete network rankings, beneficial ownership or mixed-asset USD volume. See [Analytics scope](../ANALYTICS_PRODUCT_SCOPE.md).

## Quality / verification

The following are **prior checkpoint records**, not fresh production verification performed by this documentation cleanup:

- [Final frontend validation](../../validation-qa/timezone-receive-analytics/continuation-final-validation-summary.md) records 291 passing tests plus type-check, lint, client and SSR builds, with inherited warnings documented.
- [Browser coverage](../../validation-qa/timezone-receive-analytics/continuation-browser-summary.md) records local read-only responsive and scroll checks using actual Arc sources alongside separately classified fixture cases.
- [Portfolio history QA](../../validation-qa/portfolio-history/report.md) records local persisted real observations and isolated temporary-database tests. It does not establish production storage topology or actual extension account-switching coverage.
- [Wallet UX QA](../../validation-qa/agent-wallet-ux/resume-report.md) uses isolated provider fixtures; it does not prove operation of a user's actual installed extension. CCTP recovery/receipt tests use fixtures and do not prove real chain completion.

This cleanup changes public documentation and evidence organization only. It does not deploy or perform wallet signatures or blockchain writes.

## Known limitations

- Wallet operation targets Arc Testnet; testnet assets have no intended real-world monetary value.
- No independent professional security audit is claimed. This is not mainnet-ready financial software.
- No unattended or autonomous transaction signing/execution is supported.
- CCTP writes are limited to USDC Arc Testnet → Base Sepolia; no real live destination completion is claimed by current evidence.
- History starts when actual recording begins, depends on complete fresh observations and active app usage, and has no backfill.
- SQLite task coordination does not establish multi-host distributed scheduling readiness; backend availability and persistent storage remain required.

## Live app

[Makoto Wallet](https://makotowallet.xyz)

## Repository

[congthuat/Makoto-Wallet](https://github.com/congthuat/Makoto-Wallet) · [Documentation index](../README.md) · [Security policy](../../SECURITY.md)

Historical PenguJar releases are predecessor/history records and should not be deleted automatically. This candidate does not edit or replace those releases.

Suggested future release tag: `v0.3.0`

**SUGGESTION ONLY — NOT CREATED BY THIS CLEANUP.**
