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

# Phase 10.7 unified transaction review

`frontend/lib/transactionOrchestrator.ts` is the single boundary between transaction preparation and a wallet request. It freezes a data-only review snapshot containing the structured intent, safety assessment, reviewed fingerprint, preparation and expiry timestamps, and a normalized JSON-safe transaction request. Providers, connectors, signers, callbacks, and secrets are deliberately excluded.

The material-change policy is centralized in `revalidateTransactionReview`. Account, chain, target, calldata, value, recipient, asset amounts, approvals, route metadata, slippage, minimum receive, quote expiry, and gas envelope changes invalidate the review. Cosmetic identifiers and target labels do not. Immediately before a wallet request, callers must re-read live safety context, re-simulate where the flow supports simulation, revalidate the snapshot, then submit the exact normalized request. Expired, changed, blocked, or unknown reviews return to review without opening the wallet.

`ReviewSubmissionGuard` permits one in-flight request per reviewed fingerprint and always releases after success, wallet cancellation, or error. Receipt confirmation remains a separate post-wallet lifecycle stage. A future Agent may prepare the same data-only intent, but it cannot sign or bypass review, revalidation, the wallet, or receipt verification.

The final Phase 10.7 migration routes Smart Swap, exact token approvals, Circle App Kit Universal Bridge, CCTP Direct, and Makoto Vault deposit/withdrawal through protocol-specific intent adapters in `transactionFlowReview.ts`. Xylo and Circle expiry timestamps remain authoritative. Circle App Kit snapshots explicitly mark final calldata as SDK-managed; direct EVM writes bind exact calldata. Approvals remain finite and never auto-submit the next swap, bridge, or Vault action. Existing receipt-gated Activity refresh remains unchanged.
# Phase 10.8 — Makoto Agent read-only foundation

Makoto Agent is a provider-independent, deterministic application layer under `frontend/lib/agent`. The React page assembles one immutable `AgentContextSnapshot` from existing Makoto hooks: the connected account and verified chain, Arc USDC/EURC balances, Phase 10.5 Activity state, and the connected owner's aggregate Makoto Vault state. The snapshot is data-only and excludes providers, clients, signers, secrets, API keys, and private goal plaintext.

The read-only registry exposes wallet overview, recent Activity with type/limit filters, evidence-bound Activity explanation, Vault summary, network status, and truthful safety-capability descriptions. Missing data remains unavailable rather than becoming zero, and Activity provider partial/outage state is preserved in responses. The narrow English/Vietnamese parser is local and deterministic; no external model, SDK, API key, or wallet context leaves the application.

Recognized send, swap, bridge, Vault-deposit, and Vault-withdraw requests may become immutable `AgentActionDraft` values. These drafts contain only parsed data, explicitly set `executionEnabled: false`, and have no execution method. Phase 10.8 does not produce or submit a `TransactionIntent` and cannot call wallet write, signing, approval, or network-switch APIs. A later phase may explicitly convert a user-approved draft into the existing Phase 10.7 `TransactionIntent` and shared review/revalidation pipeline; it must not duplicate or bypass that pipeline.

# Phase 10.9 — Makoto Agent safe action handoff

Phase 10.9 adds a deterministic, provider-free application layer under `frontend/lib/agent/actions`. `AgentActionDraft` remains data-only. Parsing natural language creates only a draft; the first consent boundary is the explicit **Prepare safely** action. Central validation rejects missing or malformed fields, zero/negative amounts, partial or zero addresses, unsupported assets/networks, and all Agent MAX requests. Manual SAFE MAX is unchanged.

An approved draft becomes an `AgentPreparedAction` and a structured handoff to the existing Send, Smart Swap/XyloNet, recommended Universal Bridge/Circle, or Makoto Vault flow. Protocol adapters—not the parser—materialize the exact `TransactionIntent`. The existing shared orchestration then owns simulation, finite approval, `TransactionSafetyAssessment`, fingerprinted `TransactionReviewSnapshot`, expiry, and final `revalidateTransactionReview` immediately before the wallet request. Approval and the following swap/deposit are separate reviews; a confirmed approval invalidates the old protocol review and never opens the next wallet request automatically. Agent bridge handoffs never silently select CCTP Direct.

The second consent boundary is **Continue to wallet** in the shared review. Only that action may open the wallet, under `ReviewSubmissionGuard`. Wallet rejection is cancellation, is never retried automatically, and creates no Activity success. Success text and Activity refresh remain gated by `confirmThenRefresh` and confirmed receipt/provider evidence. Conversations are not persisted and no external LLM is used. **Makoto Agent never signs transactions.**

Final action consumption uses a single account-bound, timestamped `AgentActionHandoff` stored only in `sessionStorage` when a route transition is required. The payload expires after five minutes and is removed before validation, so malformed, stale, replayed, or account-mutated handoffs fail closed. Send and Smart Swap open their existing dashboard flows; Bridge opens the existing Universal Bridge in its recommended mode and automatically begins the real Circle estimate without selecting CCTP Direct. Vault actions first consume the handoff on the real Vault dashboard, require selection from currently loaded owner goals, mask private goal names, bind the exact `jarId`, and then open the existing deposit or full-withdraw review.

Only Agent-origin flows may write a minimal one-time `AgentActionResult`. Confirmed results use the final receipt/provider values already produced by the transaction flow. Wallet rejection, failure/revert, and unknown receipt remain distinct non-success states. Reading the result removes it immediately; the origin marker is informational and never affects safety assessment, revalidation, signing, or Activity.

Conversation state exists only in React memory and is cleared on refresh or with Clear conversation. It is not written to storage, cookies, analytics, or a server.
