# Makoto Wallet frontend

The Makoto Wallet web app is a Next.js 16 application using React, TypeScript, wagmi, viem, and TanStack Query. Product and contract documentation lives in the [root README](../README.md).

## Public configuration

Copy `.env.example` to `.env.local` only when overriding checked-in public defaults:

```dotenv
NEXT_PUBLIC_PENGUJAR_ADDRESS=0x2d2C30ACe5d1f057C6eC2e2E8219A43355Dd226a
NEXT_PUBLIC_ARC_RPC_URL=https://rpc.testnet.arc.io
```

Never place `PRIVATE_KEY`, wallet secrets, or authenticated RPC credentials in this directory or in a `NEXT_PUBLIC_*` variable.

`NEXT_PUBLIC_ARC_RPC_URL` is the optional primary public endpoint override. When it is absent, `https://rpc.testnet.arc.io` is canonical. Client reads, local-wallet submission, and recent wallet Activity use the same ordered, de-duplicated fallback list from `lib/config.ts`. Jar Activity has a separate documented endpoint table only because each provider has a different safe `eth_getLogs` block-range limit; it still uses approved `.arc.io` Arc Testnet endpoints.

Wallet connection and transaction signing remain isolated to the selected wallet execution adapter. Never put authenticated RPC credentials in `NEXT_PUBLIC_*` variables.

## Wallet capability boundary

Makoto has two signing paths. External Wallet uses Reown AppKit, injected wallets, or WalletConnect; the selected external wallet remains the signer and custody authority. Native Wallet uses a browser-local encrypted keystore created or imported from a 12-word BIP-39 phrase; unlock is explicit and a reload returns it to Locked.

| Capability | External Wallet | Makoto Native Wallet |
| --- | --- | --- |
| Receive | Yes | Yes |
| Send | Yes, after external-wallet confirmation | Yes, while unlocked |
| USDC ↔ EURC swap | Yes, through the external execution path | Yes, local swap |
| Direct CCTP bridge | External-wallet bridge path | Arc Testnet → Base Sepolia, USDC only |
| Universal/App Kit Local Bridge | External-wallet-only | Not supported |
| Base-source Local Bridge | External-wallet path where supported | Not supported |
| cirBTC holdings / Send / Receive | Supported where held by the wallet | Supported where held by the wallet |
| cirBTC swap / bridge | Not supported | Not supported |

Native Wallet signing material is encrypted at rest in browser-local storage and the unlocked signer is memory-only. There is no auto-sign or auto-unlock, and approvals are finite where required. The Agent can read, analyze, and prepare transaction information only; it cannot sign, submit, or execute.

For the detailed Native Wallet boundary and verification record, see [docs/NATIVE_WALLET_CLOSEOUT.md](../docs/NATIVE_WALLET_CLOSEOUT.md).

## Commands

```bash
npm ci
npm run dev
npm run lint
npm run typecheck
npm run build
npm start
```

## Routes

- `/` — connected-wallet dashboard or public owner lookup
- `/jars/{jarId}` — canonical public jar page; no wallet is required for state or Activity

The app supports English/Vietnamese and System/Light/Dark preferences. Preferences use same-site cookies so the server and first client render remain deterministic.

## Transaction boundary

Reads use the fixed Arc Testnet chain, verified PenguJarV3 address, and public RPC fallback. Writes are requested only after explicit review and the applicable signer’s confirmation.

- `createJar(name, targetAmount, unlockTime, 0)`
- `depositToJar(jarId, amount)` for the owner
- `contributeToJar(jarId, amount)` for any eligible wallet
- `withdrawJar(jarId)` for the owner after unlock

The contract remains the final authority for ownership and lifecycle rules.

## Unified transaction review

Makoto transaction integrations prepare an immutable review snapshot through `lib/transactionOrchestrator.ts`. The snapshot binds the human review to a normalized request and expires after a bounded interval. Before opening the wallet, integrations must refresh their live checks, re-simulate the exact request where supported, call `revalidateTransactionReview`, and submit only the reviewed request under `ReviewSubmissionGuard`.

The orchestrator is intentionally data-only. It contains no provider, signer, secret, custody, automatic execution, or Agent capability. Wallet confirmation and successful receipt verification remain mandatory.

## Release status

- Frontend package: `0.2.0-beta.1`.
- Root contracts package: `0.2.0-planning`.
- Arc Testnet only; no mainnet-support claim.
