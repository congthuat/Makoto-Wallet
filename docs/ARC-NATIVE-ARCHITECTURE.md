# Makoto Wallet Arc-native architecture

## Status boundary

Makoto keeps its external and embedded wallet flows, XyloNet swap, CCTP V2 bridge, Arc Memo, and PenguJar V3. New provider-backed capabilities fail closed when configuration or verified infrastructure is absent.

```text
Makoto UI
  |-- transaction review -> Arc lifecycle -> wallet / Arc RPC -> verified receipt
  |-- swap router -> XyloNet | Arc App Kit (when configured)
  |-- bridge -> existing CCTP V2 | Arc App Kit (when configured)
  |-- unified balance -> Circle App Kit -> permissionless Circle Gateway
  |-- activity -> indexer adapter | direct logs | verified receipts | local pending
  |-- batch planner -> Multicall3From (disabled until official address is verified)
  `-- smart-wallet interface -> provider (configuration required)
```

## Arc transaction lifecycle and fees

Transactions use Preparing, Awaiting signature, Submitted, Pending, Final success/reverted, and Dropped/not found. Receipt polling never automatically resubmits. Arc native fee amounts use 18-decimal gas accounting and are converted to user-facing USDC separately from 6-decimal ERC-20 transfer amounts.

## Circle App Kit, Gateway, and bridge

The live Unified Balance route adapts only the active Reown connector's EIP-1193 provider through Circle App Kit. It recognizes Circle Gateway's Arc Testnet domain 26, Gateway Wallet `0x0077777d7EBA4688BDeF3E311b846F25870A19B9`, and Gateway Minter `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B`. Gateway is permissionless: no Circle API key, entity secret, or application private key is used. Balance, pending state, source-chain breakdown, fee estimates, and transaction results come from the SDK. Deposits support Arc Testnet and Base Sepolia; automatic-allocation spends target Arc Testnet. Existing CCTP V2 remains the working bridge fallback.

Circle App Kit 1.12.1 exposes Arc Testnet swap types and `estimateSwap`/`swap`, but its Stablecoin Service route requires a secret Kit Key. Circle explicitly forbids placing Kit Keys in client-side code. Makoto therefore does not construct or expose a Circle browser execution path, a `NEXT_PUBLIC_CIRCLE_KIT_KEY`, or a custodial server wallet. `KIT_KEY` is documented as a server-only placeholder for a future non-custodial architecture review.

## Swap and activity

The provider-neutral router compares only current, available, positive real quotes, selects the greatest output, then lowest fee, with a deterministic provider tie-break. Smart mode currently selects the only browser-executable route, XyloNet; it says **Selected route**, never **Best route**, until at least two comparable live routes exist. XyloNet mode pins that provider. Advanced comparison shows Circle as unavailable with the Kit Key reason.

Swap review estimates real swap gas immediately when allowance is sufficient. When approval is required, the first review estimates only the real exact-approval gas and explains that swap gas follows approval. A successful approval never auto-submits the swap: Makoto re-reads allowance and balances, discards the old quote, obtains a fresh XyloNet quote, estimates swap gas against the now-approved state, and opens a second final review. Arc native gas remains 18-decimal accounting and is explicitly converted to six-decimal USDC display units. USDC MAX uses a real swap estimate only when allowance already permits it; otherwise approval must happen first. EURC input still requires enough USDC for approval and swap gas. If the relevant gas cannot be estimated safely, that stage fails closed. XyloNet retains exact approvals, quote expiry, slippage minimum output, wallet-rejection handling, verified receipt activity, and ArcScan evidence.

USDC MAX uses a bounded solver outside React. Arc Testnet supports `eth_estimateGas` state overrides, so estimation may temporarily override only the connected account's native gas balance; token balances and allowance are never overridden, and the override is never used for execution. The solver obtains a real quote and gas estimate, derives `balance - real fee`, iterates to base-unit convergence, and performs a final safety estimate. If a provider rejects state overrides, it uses bounded downward backoff only to obtain the first real estimate, then converges from real fees. Balance, account, or chain changes invalidate the result, and normal review estimates again before submission.

Swap review prepares an explicit EIP-1559 maximum-fee envelope. It uses the greater of the Arc public RPC and connected wallet-provider gas estimates; if wallet estimation is unavailable, it applies 10% deterministic headroom to public gas units. SAFE MAX reserves the envelope in USDC6, final execution rebuilds and revalidates it, and the same `gas`, `maxFeePerGas`, and `maxPriorityFeePerGas` fields are submitted. No fixed USDC reserve is used.

If exact allowance is too small for MAX, Makoto offers a separate **Approve for MAX** review. It estimates the real approval fee and caps allowance at the current USDC balance snapshot—never `MaxUint256`. Execution re-verifies account, Arc, balance, and allowance, submits only the finite approval when still needed, refreshes balance and allowance after confirmation, then invokes the existing SAFE MAX solver and fills Amount. It never submits a swap; the user must still request a normal quote and confirm the normal swap review.

## Batch Pay and smart wallets

Batch Pay validates USDC recipients, duplicates, totals, balance, and a 20-recipient limit and produces exact ERC-20 transfer calldata. Execution remains unavailable until Arc publishes/verifies the `Multicall3From` address and ABI; standard Multicall3 is not substituted because it changes caller semantics. ERC-4337 is a provider interface only and cannot claim sponsorship unless the connected provider reports it.

## Security and unsupported roadmap features

No private keys or entity secrets belong in the frontend. Provider failures degrade to unavailable states. Privacy, post-quantum claims, USYC consumer support, fake indexer data, simulated smart accounts, and unverified sponsored gas remain unsupported.
# Phase 10.5 live Activity indexing

Makoto Activity uses three layers. The server-only `/api/wallet-activity` route queries ArcScan token transfers as the primary historical provider, then merges a bounded recent Arc RPC scan of USDC and EURC `Transfer` logs. RPC queries cover only the latest 10,000 blocks, query the wallet independently as sender and recipient, and never claim to represent complete history.

Provider payload parsing and classification stay outside React. Records are normalized into `WalletActivity`, grouped for verified XyloNet USDC/EURC swaps, and deduplicated by transaction hash + log index + token address. Ordering is confirmed timestamp descending, then block number descending, then log index descending. ArcScan records are inserted before overlapping RPC records, so indexed evidence wins.

Special classifications require evidence: Xylo swaps require the router send and opposite-asset pool receive in one transaction; CCTP requires the supported USDC burn transfer plus the verified CCTP method (RPC also verifies transaction destination and selector); Vault Deposit/Withdraw requires the configured PenguJar contract counterparty. Other supported transfers remain Send or Receive.

`makoto-wallet:activity:v3` remains a validated, wallet-and-chain-scoped cache. It provides immediate enrichment after a successful receipt and continuity during provider outages, but is never treated as the ledger. Canonical on-chain records replace matching local records deterministically. ArcScan failure with working RPC returns valid recent records with `partial: true`; failure of both providers preserves validated local receipt activity and displays an explicit provider warning.
# Phase 10.6 pre-sign transaction safety

Makoto now defines a strict `TransactionIntent` boundary for supported writes. It contains only normalized material fields: action kind, Arc chain and account, exact target/calldata/value, asset deltas, finite approval, prepared fee envelope, quote expiry, and safe JSON metadata. Provider objects, credentials, and private data are excluded.

`assessTransaction(intent, context)` returns a programmatic `TransactionSafetyAssessment` with `ready`, `review`, `blocked`, or `unknown` status; deterministic checks/findings; a reviewed fingerprint; target classification; and simulation time. The engine never claims scam detection, formal auditing, “safe,” or “no risk.” An unknown expected integration target is blocked because it differs from Makoto configuration, not because it is declared malicious.

The known-contract registry is built exclusively from repository constants for Arc Testnet USDC/EURC, XyloNet Router/StablePool, Arc Transaction Memo, the configured Makoto Vault, Circle CCTP, and configured Circle Gateway contracts. Request fingerprints cover chain, account, target, calldata, value, recipient, asset amounts, minimum receive, approval, gas envelope, quote expiry, and safe metadata such as slippage. The exact rebuilt intent must match immediately before the wallet request.

Read-only simulation remains flow-owned so it can simulate the exact ABI call with current state. Simulation success is only a pre-sign check: it cannot create completion, Activity, or balances. Only a successful receipt can do so. Arc raw gas remains 18-decimal data; only the existing converted USDC6 maximum enters token-balance checks. Expected-change records explicitly distinguish exact, estimated, minimum, and maximum amounts.

The structured engine is the future Agent integration boundary. Phase 10.6 includes no AI agent, chat UI, LLM API, automatic execution, signer, session key, or custody. Any future Agent must submit the same intent through this engine and the normal wallet/receipt pipeline.
