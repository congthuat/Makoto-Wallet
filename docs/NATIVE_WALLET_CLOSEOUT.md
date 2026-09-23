# Makoto Native Wallet — Phase 9 Closeout

Date: 2026-09-22
Scope: offline security QA, regression audit, and documentation only
Canonical project pointer: Phase 7J remains active; this closeout does not advance `docs/PROJECT_STATE.md`.

## Architecture

Makoto Native Wallet is a browser-local, non-custodial Arc Testnet wallet. Creation and import use a 12-word BIP-39 phrase with derivation path `m/44'/60'/0'/0/0`. Persistence contains a versioned encrypted keystore only: AES-256-GCM with authenticated metadata, a random 16-byte salt and 12-byte IV, and PBKDF2-HMAC-SHA256 with 600,000 iterations.

Read identity and transaction execution are separate contexts. The encrypted keystore reloads as locked. Unlock derives an account in memory and installs a guarded submitter inside one `LocalWalletRuntime`; it does not persist a password, phrase, private key, account object, signer, or execution adapter. Lock, provider unmount, App Lock gating, or a remote keystore lifecycle event invalidates the runtime generation and removes the submitter reference.

Local Send, Swap, and Direct CCTP share the same review, simulation, revalidation, explicit-confirmation, and receipt-verification boundaries used by the existing wallet flows. The Agent receives a data-only snapshot and prepare-only handoffs. It never receives or controls execution capability.

## Capability matrix

External-wallet entries assume a connected wallet and a supported network/provider. “Prepare” means data-only preparation for later human review; it never means signing.

| Capability | External wallet | Local wallet locked | Local wallet unlocked |
|---|---|---|---|
| Holdings | Read | Read by public address | Read |
| Receive | Supported | Supported | Supported |
| Send | Supported through external wallet confirmation | Blocked; routes to Unlock | Supported through guarded local execution |
| Swap | Supported through Xylo + external wallet confirmation | Public quote/review preparation may run; approval/swap submission is blocked | USDC ↔ EURC supported |
| Direct CCTP Bridge | Not selected by the UI | Public fee/review reads and submitted-operation monitoring only; approval/burn blocked | Arc Testnet → Base Sepolia USDC supported |
| Universal/App Kit Bridge | Supported path | Unsupported | Unsupported |
| Agent read/analyze | Supported | Public network/safety/onchain reads only; wallet-bound tools report unavailable | Supported |
| Agent prepare | Prepare-only | Blocked while the local wallet is locked | Prepare-only |
| Agent sign/approve/submit | Never | Never | Never |

## Token matrix

| Asset | Decimals | Holdings / Receive | Send | Swap | Direct CCTP Bridge |
|---|---:|---|---|---|---|
| USDC | 6 | Supported | Supported | USDC ↔ EURC | Supported, Arc Testnet → Base Sepolia only |
| EURC | 6 | Supported | Supported | EURC ↔ USDC | Unsupported |
| cirBTC | 8 | Supported | Supported | Unsupported | Unsupported |

Send uses the generic ERC-20 transfer path with asset-specific decimal parsing. Swap approvals and Direct CCTP approvals are finite and exact to the reviewed operation; no automatic or infinite approval path is enabled.

## Lifecycle and isolation

The authoritative lifecycle is `unavailable → locked → unlocking → unlocked`. Failed unlock returns to locked. Explicit lock returns to locked. Refresh reconstructs metadata only and returns to locked. Confirmed deletion removes the keystore and returns to unavailable.

Each browser tab owns a distinct runtime and submitter. Unlocking one tab cannot unlock another. `storage` events for keystore replacement/deletion and the metadata-only lock signal force other tabs to reload the locked/unavailable state. Unlock completion is generation-checked, so remote invalidation wins an in-flight unlock race. Previously captured adapters re-read the current runtime and cannot submit after invalidation.

App Lock wraps and unmounts the local-wallet provider while locked, destroying its runtime. App Lock session coordination may exchange an opaque request/grant identifier, never a Native Wallet password, phrase, key, account, signer, or submitter.

## Security boundaries

- The phrase and password exist only transiently in the active tab during onboarding/unlock and are cleared from component state after use.
- The encrypted keystore is the only Native Wallet secret-bearing persistent record. Its public address, derivation path, cipher/KDF parameters, IV, salt, creation time, and ciphertext are authenticated as AES-GCM additional data.
- No Native Wallet secret is written to `sessionStorage`, a URL/query parameter, analytics, the clipboard, console logging, cross-tab messages, or application network requests.
- Public activity, contacts, suggestions, and `BridgeOperation` records are non-authoritative browser caches and contain no signing capability.
- The local viem wallet client signs inside the active tab only after explicit review and confirmation. Circle adapters never receive local private material.
- Universal/App Kit Bridge stays on the external-wallet branch. Local wallets route only to the Direct CCTP component.
- The Agent context contains wallet kind/status, public address, verified network, balances, activity, and supported safety facts. Its capability registry is `READ_ONLY` or `PREPARE_ONLY`, with `EXECUTION_FORBIDDEN`.
- Receipt and state evidence remain authoritative. Submitted/unknown/reverted/source-confirmed/destination-confirmed are distinct states; success is not inferred from a transaction hash alone.

## Activity and operation identity

Send and Swap reconcile to one logical activity record per transaction hash. Swap stores receipt-derived actual output only when log evidence is present.

Direct CCTP persists one logical `BridgeOperation` per stable intent while preserving separate approval, burn, and forward/mint child transactions. Quote, gas, fee, and review-fingerprint refreshes do not change an unsubmitted logical operation ID. A submitted operation is never replaced by a new transaction-free draft. Destination confirmation requires a successful Base receipt, the expected Base chain, exact recipient/token/amount transfer evidence, and a successful destination balance re-read.

## Live validation already completed

These public testnet validations predate this closeout and were not repeated:

- Send: local Makoto wallet USDC send confirmed and reconciled to Activity.
- Swap: 0.01 USDC → 0.00814 EURC through XyloNet StableSwap with finite approval and receipt-derived output.
- Direct CCTP: operation `2ce176bc-8710-440e-8e2c-2058fa992770`, Arc Testnet → Base Sepolia, 0.01 USDC received, 0.054501 USDC forwarding fee, 0.064501 USDC total source debit, final state `destination-confirmed`.
  - Approval: `0x8a9ba90352c510ecc127f56760f37fa30e73c9a651f2c800b86afe328e46112d`
  - Burn: `0x8a1f1fd79bf5815e9ec40f487d4a68b94f66fd12171c62f9f611437cfdb737e6`
  - Base forward: `0x811c88d5405a68ce32157895ac36e2e925b485a1b75c5637ce13a92673890024`

Phase 9 broadcast no transaction.

## Verification snapshot

- Focused Native Wallet/security/regression selection: 384/384 passed.
- Full frontend suite: 1162/1162 passed.
- TypeScript: passed.
- ESLint: 0 errors and 7 pre-existing warnings.
- Production build: passed; static generation completed 10/10 and dynamic routes compiled.
- Browser QA: disconnected/import, locked/unlock, holdings, Receive, Swap, Direct CCTP, Activity, Agent, and security surfaces inspected without entering credentials or submitting a transaction. EN/VI, light/dark, and 1440/900/390 widths showed no document-level horizontal overflow; axe reported zero violations. Gradient-backed text remained an automated contrast “incomplete” and was visually reviewed.
- GitNexus persisted taint analysis: zero findings, with its documented closure/property/implicit-flow limitations; absence is not proof of safety.
- `npm audit --omit=dev`: 26 advisories (7 low, 9 moderate, 10 high, 0 critical). The high findings are in the `@circle-fin/app-kit` production dependency tree, including transitive `axios@1.16.0` and `toml@3.0.0`. npm proposes an App Kit semver-major remediation; it was not applied during this no-capability phase and requires a dedicated compatibility review.

## Known limitations

- Universal/App Kit Bridge is unsupported for the local wallet.
- Base-source local Bridge and a Base local signer are unsupported.
- Direct CCTP supports USDC only; EURC and cirBTC Bridge are unsupported.
- cirBTC Swap is intentionally rejected at the Swap boundary.
- The Agent cannot approve, sign, submit, or auto-execute any action.
- JavaScript cannot guarantee physical zeroization of strings, objects, closures, or garbage-collected memory.
- Encrypted browser storage remains exposed to a compromised same-origin runtime, malicious extension, or compromised browser profile.
- The Native Wallet is currently scoped to Arc Testnet and the documented supported routes.
- Browser storage is local to one browser profile/device and is not a backup. Recovery depends on the user-held phrase.
- Public operation/activity caches are not blockchain truth and must be reconciled against RPC, Circle, and receipt evidence.
- The unresolved App Kit dependency advisories remain a release risk for the external-wallet provider surface, although the local signer is not passed into that tree.

## Future work

Future work requires separate scope approval: evaluate a compatible App Kit dependency upgrade and rerun the full provider regression suite; continue hardening browser-runtime/XSS defenses; and reassess currently unsupported assets, source chains, or local Universal Bridge only if explicitly promoted. None of those items is implemented by this closeout.
