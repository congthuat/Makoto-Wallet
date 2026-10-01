# Official Circle CCTP v2 integration

**Checkpoint:** 2026-10-01. This documents the verified implementation for the connected-wallet test route **Arc Testnet (5042002) → Base Sepolia (84532), USDC only**. It does not authorize a live wallet write.

## Sources and pinned dependencies

- `@circle-fin/adapter-viem-v2@1.18.0`, using its `/next` export for a single immutable prepared EVM transaction.
- `@circle-fin/provider-cctp-v2@1.14.0`, using official route metadata, `supportsRoute`, `getMaxFee`, `burn`, and `fetchAttestation`.
- Circle’s [CCTP documentation](https://developers.circle.com/cctp) describes CCTP’s USDC burn/mint and Fast/Standard transfer modes. Circle’s [USDC contract address reference](https://developers.circle.com/stablecoins/usdc-contract-addresses) lists Arc Testnet USDC `0x3600000000000000000000000000000000000000` and Base Sepolia USDC `0x036CbD53842c5426634e7929541ec2318f3dCF7e`.
- Installed package exports, declarations, runtime metadata, and implementation were inspected locally. Version-pinned source archives: [adapter 1.18.0](https://registry.npmjs.org/@circle-fin/adapter-viem-v2/-/adapter-viem-v2-1.18.0.tgz) and [CCTP provider 1.14.0](https://registry.npmjs.org/@circle-fin/provider-cctp-v2/-/provider-cctp-v2-1.14.0.tgz).

The provider's installed chain registry reports Arc domain 26 and Base Sepolia domain 6, Arc USDC `0x3600000000000000000000000000000000000000`, shared v2 TokenMessenger `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA`, shared v2 MessageTransmitter `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275`, and the Circle Testnet custom bridge `0xC5567a5E3370d4DBfB0540025078e283e36A363d`. Runtime route checks require all of these values to agree with Makoto's pinned configuration and require `supportsRoute(..., 'USDC', true)` to pass. Any conflict makes the route unavailable.

## Architecture and authority

`frontend/src/protocols/circle/cctpAdapter.ts` is the Circle boundary. It returns only Makoto quote and prepared-action data; Circle provider, adapter, prepared transaction, and execution capability stay module-private. The Tool Layer reads wallet context, USDC balance, allowance and native gas balance, obtains the Circle quote, and requests bounded approval or burn preparation. Policy/Risk checks account, Arc chain, USDC, official spender, amount, route, fee arithmetic, quote freshness, simulation result, and affordability. The existing `LiveCctpControl` supplies distinct approval/burn review, immediate re-preparation, review invalidation, and the existing Strategy Controller's receipt-gated progression. There is no second strategy machine and no `kit.bridge()` path.

The adapter is constructed from the currently connected EIP-1193 provider with address context supplied from `eth_accounts`; chain switching is configured to throw. It does not request accounts during read/prepare and does not use a private key, mnemonic, seed phrase, or custodial signer. Agent-facing tools receive quote/read/prepare data only; no Circle execute capability is registered with the Agent.

## Quote and fee meaning

Makoto passes the requested six-decimal USDC amount and official `FAST` or `SLOW` transfer speed to `getMaxFee`. The returned provider fee and forwarding fee are retained separately; `maxFee = providerFee + forwarderFee`. In this route's provider semantics, the amount is the gross amount debited/burned, and the maximum expected delivery floor is `amount - maxFee`; Policy requires this arithmetic and rejects a fee at least as large as the amount. The review labels gross amount, maximum Circle fee, speed, and receive floor separately. Quotes expire after 45 seconds. A still-valid reviewed quote is reused during immediate re-preparation to avoid changing review data solely because a fee read fluctuated; once expired it is requoted and any material fee change requires a fresh review.

The UI's Fast maps to provider `FAST`, whose prepared custom-burn finality threshold is checked as 1000. Standard maps to provider `SLOW`, checked as 2000. These values are checked against the provider's published types/source and the actual prepared calldata. The adapter rejects mismatches. No undocumented mode fallback is used.

## Prepared request and identity checks

The normalized request exposes `{ chainId, account, request: { from, to, data, value, gas, gasPrice }, kind, quoteId, cctp, gasEstimate, preparedAt, expiresAt, executionEnabled: false }`. CCTP semantics include USDC, gross amount, receive floor, destination chain/domain, recipient, verified spender, provider fee, forwarding fee, max fee, speed, and, for a burn, finality threshold. An approval also includes its exact approval amount. `value` is zero for both supported calls. No unsupported SDK field or request-hash claim is invented.

The SDK has no cryptographic prepared-request identity. A private WeakMap holds the SDK `/next` prepared transaction and one-use execution flag. Immediately before wallet handoff, Makoto re-prepares, re-simulates, reruns Policy/Risk and compares chain, account/from, `to`, calldata, value, action kind, quote fingerprint and all material CCTP semantics (asset, amount, spender, destination chain/domain, recipient, fees/maxFee, speed, approval cap, finality threshold). Any difference invalidates review. Gas estimate changes are tracked separately, rerun affordability and Policy/Risk, and require the updated maximum fee to be reviewed. Only the fresh, structurally matching captured request can execute, once.

## Approval and burn

The adapter inspects Circle's provider approval semantics. The provider approval method increments allowance; it is not substituted for Makoto's exact final allowance. When allowance is insufficient, Makoto uses one finite ERC-20 `approve(officialCircleBridge, grossAmount)` call. It verifies the token, spender, current allowance, required allowance, and decoded approval amount. Sufficient allowance skips approval. Approval receipt success is followed by a fresh allowance read; only `allowance >= required` lets the existing strategy advance to a fresh quote and separate burn review. Failure, unknown receipt, or wallet rejection does not continue.

Circle `provider.burn()` is used to prepare the official route call, not to execute it. With current Arc Testnet route metadata it returns the published `bridgeWithPreapprovalAndHook` custom-bridge call to `0xC5567a5E3370d4DBfB0540025078e283e36A363d`, rather than a direct TokenMessenger deposit call. The adapter decodes and checks target, zero native value, amount, max fee, fee, fee recipient, token, destination domain, recipient, destination caller, hook data and finality threshold. It then passes that exact call through `/next`'s raw single-transaction `prepare`, `estimate`, `simulate`, and captured `execute` boundary. It does not call high-level Bridge Kit or provider `bridge()`.

Simulation uses `/next`'s read-only call. A failed or unavailable simulation blocks wallet execution. Preparation and simulation do not request a wallet transaction or signature. The wallet call occurs only after explicit review and fresh equality checks. A rejected wallet request is recorded as `USER_REJECTED`, has no hash or Activity record, and cannot be retried through the consumed prepared capability.

## Receipts, status, and recovery

Approval requires a successful source receipt plus verified allowance. A burn requires a successful Arc receipt whose transaction sender, target, calldata, and official v2 MessageTransmitter `MessageSent` log match the reviewed call. Only then is the run source-confirmed. Circle `fetchAttestation` is bound to the burn hash and its message is checked for source/destination domains, TokenMessenger, MessageTransmitter, burn token, custom bridge message sender, recipient, amount, maximum fee, executed fee and finality. The message hash is computed from the returned message bytes. Attestation, forwarding and destination-pending/failure states remain separate.

An IRIS/forwarder hash is evidence to query Base, not destination completion. Makoto's Base Sepolia read checks that hash's transaction receipt and the matching USDC Transfer to the reviewed recipient for at least the reviewed receive floor. Only this destination receipt and Transfer evidence completes the strategy. Missing RPC/provider data remains pending, unknown, or unavailable; no hash or success is synthesized.

Recovery persists account-bound hash and receipt bindings only. On reload, review and wallet authority expire; a request with no hash becomes unknown and cannot be blindly resubmitted. Hashed approval/burn operations are recovered from chain receipt, allowance, and Circle status. A confirmed approval resumes at allowance reread/requote. A confirmed source burn resumes Circle/Base reconciliation. Submission has a one-in-flight guard and the prepared Circle capability is one-use.

## Unsupported scope and readiness

This write adapter accepts only USDC and the exact Arc Testnet → Base Sepolia route. EURC and cirBTC remain unavailable for CCTPx writes, and Universal Bridge remains partial/disabled. No high-level fallback is used if Circle preparation, metadata, simulation, or status is unavailable.

Automated connected EIP-1193 tests cover sufficient and insufficient allowance, exact approval, exact captured burn, pre-sign simulation, request mutation, gas-only change, simulation failure, wallet rejection and one-use duplicate protection. Targeted strategy tests cover persisted CCTP checkpoints. In an isolated browser with serialized mock state, reload restored the approval-submitted, approval-confirmed, burn-submitted, source-confirmed/attestation-pending, and destination-pending UI states; the saved hash remained available for evidence checks and no wallet prompt was opened. These are recovery-state fixtures, not receipts or proof of real chain transitions. Rendered approval review used a rejecting mock wallet and submitted no transaction. The rendered Flow A attempt was blocked because the dummy wallet allowance in the mock differed from the public Arc RPC's allowance, so Flow A browser evidence is limited to the automated intercepted-RPC test. A live read-only Circle quote was obtained; there has been no wallet signature, approval, burn, or destination transaction. The implementation is ready for the user's separate authorization and manual wallet review.
