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

## Batch Pay and smart wallets

Batch Pay validates USDC recipients, duplicates, totals, balance, and a 20-recipient limit and produces exact ERC-20 transfer calldata. Execution remains unavailable until Arc publishes/verifies the `Multicall3From` address and ABI; standard Multicall3 is not substituted because it changes caller semantics. ERC-4337 is a provider interface only and cannot claim sponsorship unless the connected provider reports it.

## Security and unsupported roadmap features

No private keys or entity secrets belong in the frontend. Provider failures degrade to unavailable states. Privacy, post-quantum claims, USYC consumer support, fake indexer data, simulated smart accounts, and unverified sponsored gas remain unsupported.
