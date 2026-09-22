# Makoto Wallet Public Beta — Final Audit

## Scope

This Phase 7J handoff review covers the Arc Testnet frontend, PenguJar integration and tests, external-wallet and Native Wallet onboarding, supported transaction construction and review, receipt handling, Activity APIs and RPC failover, browser-local storage, App Lock, Security Center, responsive overlays, accessibility, localization, themes, dependencies, release documentation, and configuration consistency.

The Native Wallet is a post-7J adjunct to the release surface. Its detailed implementation and verification record is documented in [NATIVE_WALLET_CLOSEOUT.md](NATIVE_WALLET_CLOSEOUT.md); this audit records the boundary and current verified result without duplicating that closeout.

This was a project-level application audit. It was not an independent professional smart-contract or product security audit.

## Architecture and capability boundary

- Next.js 16 and React 19 frontend using wagmi, viem, Reown AppKit, and TanStack Query.
- External wallets retain authentication, custody, and signing control through AppKit, injected wallets, and WalletConnect.
- Native Wallet Create/Import uses a 12-word BIP-39 phrase and a browser-local encrypted keystore. Unlock is explicit; reload returns Locked. The local signer is memory-only while unlocked.
- Supported local capabilities are Receive, Send while unlocked, USDC ↔ EURC local swap, and Direct CCTP Arc Testnet → Base Sepolia USDC-only bridge.
- Universal/App Kit Local Bridge and Base-source Local Bridge are not supported. cirBTC holdings, Send, and Receive are supported; cirBTC swap and bridge are not supported.
- Agent surfaces are read/analyze/prepare only. The Agent cannot sign, submit, auto-unlock, or execute transactions.
- Transaction Safety Review separates Makoto validation from wallet confirmation. Confirmed UI requires a successful receipt; secondary refresh runs afterward and cannot reverse confirmation.
- PenguJar Activity uses a constrained same-origin endpoint, fixed contract address, indexed Jar filtering, provider-specific ranges, failover, deduplication, incremental refresh, and rate limiting.
- App Lock is a browser-local UI gate using a salted PBKDF2-SHA-256 PIN verifier. It includes cross-tab explicit locking and an optional ephemeral browser-session unlock convenience. It is separate from wallet authentication and PRIVATE metadata encryption.

## Automated validation

Latest Phase 7J handoff validation was verified against the current working tree:

| Check | Result |
| --- | --- |
| Contract compile (`npm run compile`) | PASS — Nothing to compile |
| Required contract tests (`npm test`) | PASS — 19/19 |
| Complete frontend tests (`npm test`) | PASS — 1162/1162 |
| Native Wallet / Phase 7J focused tests | PASS — 64/64 |
| TypeScript (`npm run typecheck`) | PASS |
| Production build (`npm run build`) | PASS |
| ESLint (`npm run lint`) | PASS — 0 errors, 7 inherited warnings |
| Whitespace validation (`git diff --check`) | PASS |
| Browser matrix | PASS — EN/VI × light/dark × 1440, 900, and 390 px; no horizontal overflow |
| Accessibility smoke check | PASS — 0 axe violations on the audited disconnected surface; one gradient incomplete check was visually reviewed |
| Live transaction execution | NOT RUN — no live transaction was triggered |

## Dependency audit

The current frontend audit reports 26 advisories: 7 low, 9 moderate, 10 high, and 0 critical. High findings are concentrated in the Circle App Kit dependency tree. Direct packages include `@circle-fin/app-kit@1.12.1` and `@circle-fin/adapter-viem-v2@1.16.0`.

This is a release caveat requiring a dedicated, regression-tested dependency upgrade. No package upgrade was performed for this handoff, and the advisories remain unresolved.

## Security model

- Makoto is non-custodial application code. External wallet providers control external-wallet authentication and signing.
- Native Wallet material is stored only as ciphertext in the browser-local encrypted keystore; the unlocked signer is memory-only. No plaintext seed phrase, private key, or signing secret is written to browser persistence, URLs, network requests, or logs.
- Every supported write requires explicit review and signing authority. Exact/finite approvals are used where required; no automatic signing or automatic unlock is available.
- A reverted receipt cannot produce confirmed UI. Background refresh failure is isolated after confirmation.
- The Agent cannot sign, submit, or execute transactions.
- App Lock stores a random salt, KDF parameters, verifier, and local settings—not the raw PIN. Its optional browser-session convenience stores only ephemeral authenticated-session state and exchanges no PIN or PIN-derived secret between tabs.
- Contacts, Recent recipients, optimistic Activity, and App Lock settings are browser-local. PRIVATE PenguJar metadata retains separate wallet-signature-derived encryption. Arc Memo and normal on-chain addresses, balances, and timing are public.
- React rendering is used for user-controlled strings; no unsafe HTML rendering path was found. External new-tab links use safe `rel` attributes.
- No tracked `.env` or `.env.local`, private key, mnemonic, or signing secret was found. Environment examples contain placeholders and public network configuration only.

## Known limitations and release caveats

- Arc Testnet Public Beta only; it is not mainnet-ready and testnet assets have no intended real-world monetary value.
- Makoto Wallet and PenguJar have not undergone an independent professional security audit.
- App Lock protects access through the normal UI on the current browser. Browser storage and a compromised device or extension remain outside its protection boundary.
- Browser-local Contacts, Recents, Native Wallet keystore, and PRIVATE metadata do not synchronize across devices.
- Universal/App Kit Local Bridge and Base-source Local Bridge are unsupported. Native Direct CCTP is Arc Testnet → Base Sepolia and USDC-only.
- cirBTC is not supported for swap or bridge in this release.
- Activity and quotes depend on third-party Arc services. Failover and isolated error states reduce impact but cannot guarantee provider availability.
- CCTP Arc burn confirmation and Base Sepolia destination finalization are distinct; destination completion is shown only after destination data is found.
- Dependency advisories listed above remain unresolved pending a dedicated, regression-tested toolchain/dependency update.
- Connected-wallet browser QA is environment-dependent; no live transaction was submitted in this audit.

## Manual QA

Read-only browser QA covered the current connected and disconnected product surfaces: Overview, Activity, Agent, Settings, Help, Send, Receive, Swap, and Bridge. It verified English/Vietnamese, light/dark, responsive widths, hydrated Security Center state, Activity replacement after loading, and the Agent “Read & prepare only” boundary. The focused Native Wallet and Phase 7J test coverage is recorded in [NATIVE_WALLET_CLOSEOUT.md](NATIVE_WALLET_CLOSEOUT.md).

## Release recommendation

**READY FOR SCOPED HANDOFF / PUBLIC BETA DOCUMENTATION REFRESH**

The verified checks above show no newly identified P0 or P1 release blocker in the audited surfaces. This document intentionally does not advance `docs/PROJECT_STATE.md`; the canonical pointer remains Phase 7J ACTIVE until the scoped implementation and documentation changes are committed and handed off. Phase 8A has not started.
