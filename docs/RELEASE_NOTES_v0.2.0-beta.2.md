# Makoto Wallet Public Beta 0.2.0-beta.2

This prerelease continues from `v0.2.0-beta.1` at `f17cb1f` and is based on the verified application changes through commit `3dd496a`.

## Changes since beta.1

- Added Makoto Pay service surfaces and the mobile top-up demo flow.
- Added Arc-native wallet and provider foundations, live Circle unified balance, and Universal Bridge integration.
- Added Smart Arc swap routing with follow-up fixes for gas estimation, exact approvals, MAX handling, fee envelopes, and post-approval review.
- Added live Arc activity indexing with bounded provider/fallback behavior.
- Added the pre-sign transaction safety engine and unified transaction-review orchestration.
- Added the read-only Makoto Agent foundation, safe action handoffs, swap/bridge planning, session context, and research/on-chain intelligence.
- Continued dashboard, activity, mobile layout, App Lock, localization, and Ledger Calm product-polish work.

## Validation

- Contract compile: passed.
- Contract tests: 19 passed.
- Frontend tests: 716 passed.
- TypeScript, ESLint, and production build: passed.
- Read-only PenguJarV3 Arc Testnet validation: passed; no transactions were sent.

## Beta notice

Makoto Wallet Public Beta 0.2.0-beta.2 is Arc Testnet-only software for testing and demonstration. Testnet assets have no intended real-world monetary value.

Makoto Wallet and PenguJar have not undergone an independent professional security audit and are not mainnet-ready financial software.
