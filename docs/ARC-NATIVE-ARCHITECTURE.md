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

The live Unified Balance route adapts only the active Reown connector's EIP-1193 provider through Circle App Kit. It recognizes Circle Gateway's Arc Testnet domain 26, Gateway Wallet `0x0077777d7EBA4688BDeF3E311b846F25870A19B9`, and Gateway Minter `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B`. Gateway is permissionless: no Circle API key, entity secret, or application private key is used. Balance, pending state, source-chain breakdown, fee estimates, and transaction results come from the SDK. Deposits support Arc Testnet and Base Sepolia; automatic-allocation spends target Arc Testnet. App Kit swap/bridge actions remain configuration-required. Existing CCTP V2 remains the working bridge fallback.

## Swap and activity

The router compares only current, available, positive real quotes, selects the greatest output, then lowest fee, with a deterministic provider tie-break. Activity is normalized by chain, wallet, transaction hash, and log index; verified on-chain records replace optimistic records.

## Batch Pay and smart wallets

Batch Pay validates USDC recipients, duplicates, totals, balance, and a 20-recipient limit and produces exact ERC-20 transfer calldata. Execution remains unavailable until Arc publishes/verifies the `Multicall3From` address and ABI; standard Multicall3 is not substituted because it changes caller semantics. ERC-4337 is a provider interface only and cannot claim sponsorship unless the connected provider reports it.

## Security and unsupported roadmap features

No private keys or entity secrets belong in the frontend. Provider failures degrade to unavailable states. Privacy, post-quantum claims, USYC consumer support, fake indexer data, simulated smart accounts, and unverified sponsored gas remain unsupported.
