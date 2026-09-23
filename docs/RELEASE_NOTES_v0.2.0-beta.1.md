# Makoto Wallet Public Beta 0.2

Makoto Wallet Public Beta 0.2 is an Arc Testnet wallet experience with external-wallet and browser-local Native Wallet paths, explicit transaction review, local security controls, and PenguJar Activity.

## What's new

### Wallet onboarding

- External wallet onboarding through Reown AppKit, including email OTP, Google, injected wallets, and WalletConnect.
- Native Wallet Create or Import from a 12-word BIP-39 recovery phrase.
- Native Wallet secrets are kept in a browser-local encrypted keystore. The user explicitly unlocks and locks it; a reload returns the wallet to Locked.
- The local signer exists only in memory while unlocked. Makoto never auto-signs or auto-unlocks.

### Transaction Safety

- A review screen before supported write actions.
- Account, network, amount, recipient, quote, and input-change checks where applicable.
- Full recipient and transaction details before wallet confirmation.
- Finite approvals where an approval is required.
- Confirmed states only after a successful transaction receipt.
- External wallets remain the signing authority. The Native Wallet signer is available only after explicit local unlock.

### Security Center and App Lock

- Wallet, network, custody, privacy, and Public Beta information.
- PenguJar protection summaries and actionable alerts.
- Optional six-digit local App Lock with inactivity auto-lock, failed-attempt cooldown, and explicit cross-tab locking.
- Optional **Keep unlocked for this browser session** convenience for reloads and other live Makoto tabs.

App Lock does not change wallet custody or protect wallet private keys. Native Wallet lock state is separate and reloads locked.

### Holdings, Receive, Send, and Swap

- Holdings and balance views for USDC, EURC, and cirBTC where supported by the selected wallet path.
- Receive is available for supported assets and wallet types.
- Local Send is available while the Native Wallet is unlocked; cirBTC can be sent and received, but is not swappable or bridgeable in this release.
- USDC ↔ EURC local swap with live quote/review handling.
- External-wallet USDC ↔ EURC swap remains available through the external execution path.

### Bridge

- Native Wallet Direct CCTP Local Bridge from Arc Testnet to Base Sepolia for USDC only.
- Universal/App Kit Local Bridge is not supported.
- Base-source Local Bridge is not supported.
- External-wallet bridge flows retain their external-wallet signing boundary.

### Agent boundary

- Agent surfaces can read, analyze, and prepare transaction information.
- The Agent cannot sign, submit, auto-unlock, or execute transactions.

### PenguJar Savings

- Create, Deposit, Contribute, and Withdraw flows.
- SAFE and SHIELDED protection modes.
- PUBLIC and PRIVATE metadata modes.
- Guardian protection and Recovery Wallet support.
- Verified Activity with bounded requests, incremental refresh, deduplication, and RPC failover.

## Quality and reliability

- Receipt-confirmed transaction feedback and explicit pending/success/error states.
- Improved Activity performance and provider reliability.
- Accessible transaction-modal focus behavior.
- English and Vietnamese product copy.
- Responsive desktop and mobile layouts.
- Light and Dark themes.
- 19/19 required contract tests passing.
- 1162/1162 complete frontend tests passing.
- 64/64 focused Native Wallet and Phase 7J tests passing.
- Typecheck and production build passing; lint has 0 errors and 7 inherited warnings.
- EN/VI × light/dark checks at 1440, 900, and 390 px showed no horizontal overflow.
- axe reported 0 violations on the audited disconnected surface; one gradient color-contrast check remained incomplete and was visually reviewed.
- No live transaction was triggered during this verification.

## Dependency caveat

The current frontend audit reports 26 advisories: 7 low, 9 moderate, 10 high, and 0 critical. The high findings are concentrated in the Circle App Kit dependency tree. The direct packages include `@circle-fin/app-kit@1.12.1` and `@circle-fin/adapter-viem-v2@1.16.0`. This is a release caveat requiring a dedicated, regression-tested dependency upgrade; no dependency upgrade is included in this release.

## Versioning

- Frontend package: `0.2.0-beta.1`.
- Root contracts package: `0.2.0-planning`.
- The planning package version is not being renamed or promoted as the frontend release version.

## Beta notice

Makoto Wallet Public Beta 0.2 is Arc Testnet-only software for testing and demonstration. Testnet assets have no intended real-world monetary value. This release makes no mainnet-support claim.

Makoto Wallet and PenguJar have not undergone an independent professional security audit and are not mainnet-ready financial software.
