# Makoto Wallet Public Beta — Final Audit

## Scope

This Phase 10 review covered the Arc Testnet frontend, PenguJar V3 integration and tests, wallet onboarding, supported transaction construction and review, receipt handling, Activity APIs and RPC failover, browser-local storage, App Lock, Security Center, responsive overlays, accessibility, localization, themes, dependencies, release documentation, and configuration consistency.

This was a project-level application audit. It was not an independent professional smart-contract or product security audit.

## Architecture

- Next.js 16 and React 19 frontend using wagmi, viem, Reown AppKit, and TanStack Query.
- Reown Email/Google embedded wallets plus injected and WalletConnect external wallets; wallet providers retain signing and custody control.
- Fixed Arc Testnet assets and integrations for USDC, EURC, Arc Memo, XyloNet StableSwap, Circle CCTP V2, and PenguJar V3.
- Transaction Safety Review separates Makoto validation from wallet confirmation. Confirmed UI requires a successful receipt; secondary refresh runs afterward and cannot reverse confirmation.
- PenguJar Activity uses a constrained same-origin endpoint, fixed contract address, indexed Jar filtering, provider-specific ranges, failover, deduplication, incremental refresh, and rate limiting.
- App Lock is a browser-local UI gate using a salted PBKDF2-SHA-256 PIN verifier. It includes cross-tab explicit locking and an optional ephemeral browser-session unlock convenience. It is separate from wallet authentication and PRIVATE metadata encryption.

## Automated validation

Latest Public Beta 0.2 preparation validation executed on 2026-08-21 after the Phase 10 audit and App Lock follow-up fixes:

| Check | Result |
| --- | --- |
| Contract compile (`npm run compile`) | PASS |
| Required contract tests (`npm test`) | PASS — 19/19 |
| Complete Hardhat tests (`npx hardhat test`) | PASS — 85/85 |
| Frontend tests (`npm test`) | PASS — 265/265 |
| TypeScript (`npm run typecheck`) | PASS |
| ESLint (`npm run lint`) | PASS |
| Production build (`npm run build`) | PASS |
| Whitespace validation (`git diff --check`) | PASS |
| Read-only Arc Jar #9 Activity check | PASS — creation plus 0.01 USDC deposit retrieved |

Dependency audit results were reviewed without automatic upgrades:

- Frontend: 2 transitive advisories (1 high, 1 moderate) through `@coinbase/cdp-sdk` / `axios`; no direct axios use was found in Makoto application code.
- Contract workspace: 45 advisories (24 high, 8 moderate, 13 low), predominantly transitive development/Hardhat tooling. Suggested broad remediations include major Hardhat/toolbox upgrades.

No dependency was upgraded during the final stabilization phase because the reported paths are transitive/tooling-oriented and the available broad upgrades carry material regression risk. Reassess them in a dedicated dependency-maintenance change.

## Security model

- Makoto is non-custodial application code and does not store raw wallet private keys. Reown and external wallet providers control authentication and signing.
- Every supported write still requires explicit wallet confirmation. Exact approvals are used where required; no automatic signing or transaction submission was added.
- A reverted receipt cannot produce confirmed UI. Background refresh failure is isolated after confirmation.
- App Lock stores a random salt, KDF parameters, verifier, and local settings—not the raw PIN. Its optional browser-session convenience stores only ephemeral authenticated-session state and exchanges no PIN or PIN-derived secret between tabs. It gates the normal Makoto UI only and is not wallet authentication or private-key encryption.
- Contacts, Recent recipients, optimistic Activity, and App Lock settings are browser-local. PRIVATE PenguJar metadata retains separate wallet-signature-derived encryption. Arc Memo and normal on-chain addresses, balances, and timing are public.
- React rendering is used for user-controlled strings; no unsafe HTML rendering path was found. External new-tab links use safe `rel` attributes.
- No tracked `.env` or `.env.local`, private key, mnemonic, or signing secret was found. Environment examples contain placeholders and public network configuration only.

## Known limitations

- Arc Testnet Public Beta only; it is not mainnet-ready and testnet assets have no intended real-world monetary value.
- Makoto Wallet and PenguJar have not undergone an independent professional security audit.
- App Lock protects access through the normal UI on the current browser. Browser storage and a compromised device or extension remain outside its protection boundary.
- Browser-local Contacts, Recents, and PRIVATE metadata do not synchronize across devices. Reset intentionally preserves encrypted PRIVATE metadata and wallet-provider credentials.
- Activity and quotes depend on third-party Arc services. Failover and isolated error states reduce impact but cannot guarantee provider availability.
- CCTP Arc burn confirmation and Base Sepolia destination finalization are distinct; destination completion is shown only after destination data is found.
- Dependency advisories listed above remain unresolved pending a dedicated, regression-tested toolchain/dependency update.

## Manual QA

Manual QA was reported complete for the core release flows. The reported coverage includes:

- Email OTP and Google onboarding, first-time ready state, injected wallets, and WalletConnect/mobile.
- USDC/EURC Send and Receive, full-address review, Contacts/Recents, Memo, cancellation, and verified receipts.
- Both swap directions, quote expiry, slippage/minimum output, exact approval, and account/network mutation.
- CCTP fee review, exact approval, Arc receipt, and Base Sepolia finalization check.
- Create, deposit, contribute, SAFE/SHIELDED withdrawal, Guardian freeze/change, and owner recovery.
- Jar Activity success/retry and provider-unavailable isolation.
- App Lock setup, wrong/correct PIN, cooldown, manual/automatic/reload/two-tab lock, change/disable/reset, and browser password-manager behavior.
- English/Vietnamese, light/dark/system themes, disconnected/wrong-network states, keyboard focus, and 320–1920 px plus short-height layouts.

## Release recommendation

**READY FOR PUBLIC BETA 0.2 PRE-RELEASE VERIFICATION**

No P0 or P1 finding was identified. Phase 10 and the reported core-flow manual QA are complete. The remaining release step is to verify the intended commit, branch, tag availability, repository cleanliness, and final release metadata before creating `v0.2.0-beta.1`.
