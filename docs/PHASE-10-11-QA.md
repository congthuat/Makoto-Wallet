# Phase 10.1 + 10.2 live QA

Use testnet assets only. Connect the same Reown wallet throughout each case.

## A. Read

Open `/unified-balance`, connect, and refresh. Confirm available, pending, and per-chain USDC values match Circle Gateway and no placeholder balance appears.

## B. Arc deposit

Select Arc Testnet, enter a positive USDC amount, review, approve any wallet-requested authorization, and confirm the deposit. Verify the real transaction hash in ArcScan and refresh after Gateway indexing.

## C. Base Sepolia deposit

Select Base Sepolia and repeat the deposit. Confirm Makoto requests the network through the active connector and never uses a different injected account. Verify the hash in BaseScan.

## D. Spend on Arc

Enter a valid Arc recipient and amount, request an estimate, inspect every returned fee, then confirm. Verify the returned transaction result and Arc explorer link.

## E. Rejections and stale state

Reject approval, deposit, and spend prompts in turn. Confirm each reports cancellation and permits retry. Change account or network during review and confirm the operation stops or the wallet requests the required network.

## F. Responsive and localized UI

Repeat at 390 px and desktop widths in English and Vietnamese. Confirm controls remain reachable, hashes/addresses wrap, and pending/success/error states are legible.
# Phase 10.3 — Universal Bridge owner QA

Use only small testnet amounts accepted by the live Circle estimate. No CLI or private key is required.

## A. Base Sepolia → Arc Testnet

1. Connect a Reown wallet holding Base Sepolia USDC and ETH.
2. Open Swap & Bridge → Bridge USDC. Choose Base Sepolia, enter `0.10` USDC, keep Same connected wallet and Standard, then select Review Bridge.
3. Confirm the wallet network switch if requested. Expect a live itemized estimate, Base source gas in ETH, Forwarding Service enabled, and no Makoto custom fee.
4. Continue to wallet. Confirm approval only if requested, then burn. Expect the event-driven Approval/Burn/Attestation/Mint timeline and Completed only after Circle returns destination completion.
5. Verify the real source link on BaseScan. Verify an ArcScan destination link only when Circle returns a destination hash; otherwise expect “Destination confirmed by Circle Forwarding Service.” The Arc USDC balance should increase by the minted amount after Circle fees.

## B. Arc Testnet → Base Sepolia

Repeat A with Arc Testnet as source and a small Arc USDC balance. Expect Arc source gas to display as USDC. Standard is supported; Fast is disabled because Circle currently does not support Arc Testnet as a Fast source. Verify the real source transaction on ArcScan and destination evidence on BaseScan or through Circle Forwarding Service confirmation.

## C. Standard and Fast estimate

On Base Sepolia source, compare Standard and Fast reviews. Fast must show Circle's returned CCTP protocol fee; Standard must not invent one. Changing speed must discard the previous review and fetch a new estimate.

## D. Reject a wallet request

Reject the network switch, approval, or bridge request. Expect a cancellation message, no Completed state, no confirmed bridge activity, and an enabled retry path.

## E. Wrong network and account mutation

Begin with the wallet on the destination network. Review must request the source network and verify `eth_chainId`. Change accounts after review; Continue must block because the active provider account no longer matches the reviewed Makoto account.

## F. Destination completion

After burn confirmation, leave the browser open. Completed must appear only after the App Kit bridge call returns success. A destination explorer link must appear only for a real returned mint hash.

# Phase 10.4 — Smart Swap Router owner QA

## A. Smart and XyloNet modes

1. Open Swap & Bridge → Swap on Arc Testnet with USDC and EURC balances.
2. In Smart mode, quote both directions. Expect **Selected route: XyloNet StableSwap** and never a “Best route” claim.
3. Select XyloNet mode and repeat. The same live router contract quote must execute.
4. Open Advanced providers. Circle App Kit Swap must be visibly unavailable because its secret Kit Key cannot be used in the browser.

## B. Quote, approval, and slippage safety

Review a small quote at every slippage option. Confirm current output, minimum received, selected route, and quote freshness. When allowance is low, expect an exact-amount approval followed by swap. Reject either request and confirm the UI reports wallet rejection and permits retry. Let a quote age beyond 45 seconds, including during approval, and confirm no stale swap is submitted.

## C. Arc fee and MAX

For USDC input with sufficient allowance, select MAX. Expect the amount to reserve the live swap Arc gas estimate. If approval is required, MAX must ask for approval first rather than estimating swap gas against unapproved state. For EURC input, MAX may use the EURC balance only after allowance permits a real swap estimate, and review must still verify that the USDC balance covers Arc gas. If RPC gas estimation is unavailable, safe MAX and execution must fail closed.

When approval is required, the initial review must show a real Approval network fee and “Swap network fee: Estimated after approval.” Selecting Approve token must send only the exact approval. After its successful receipt, expect a fresh quote and a separate final review with real swap gas; no swap wallet request may appear until Continue to wallet is selected from that second review.

After allowance is sufficient, press MAX again. Expect “Calculating safe MAX…”, then a non-zero amount below the displayed USDC balance and a real “Reserved for Arc gas” value. No wallet prompt should appear. Change balance, account, or network and confirm the MAX result is invalidated. Get a fresh review and confirm a fee increase recalculates MAX rather than allowing an unsafe submission.

For final wallet-fee QA, confirm Review shows the maximum reserved Arc fee, then continue only far enough to inspect the wallet prompt. Makoto must re-estimate through both Arc RPC and the connected provider when available, submit the same explicit EIP-1559 envelope, and recalculate MAX before opening the wallet if that envelope no longer fits.

If allowance is insufficient, MAX must open **Approve for MAX** instead of leaving an error-only state. Confirm the review shows USDC, the XyloNet router, a finite approval equal to the current balance snapshot, and a real approval fee. Approval confirmation must send no swap. After its receipt, Amount should auto-fill from the existing SAFE MAX solver; the user must still select Get quote manually.

## D. Live completion and evidence

Execute a small testnet swap in each direction. Confirm pending stages remain legible, final success appears only after a successful receipt, both balances refresh, the activity record includes sold and received assets, and the ArcScan link matches the real transaction hash.
# Phase 10.5 — Live Activity + Arc indexer

- Primary history: server-side ArcScan ERC-20 token-transfer API, with input/cursor validation, a 10-second timeout, sanitized errors, cursor pagination, and `no-store` responses.
- Recent fallback: bounded Arc RPC USDC/EURC `Transfer` logs for the connected wallet as sender and recipient. RPC-only responses are marked partial.
- Canonical merge: transaction hash + log index + token address; on-chain data precedes matching local receipt enrichment.
- Classification: evidence-based Send, Receive, XyloNet Swap, CCTP Bridge, Makoto Vault Deposit, and Makoto Vault Withdraw.
- Refresh: panel open, manual Refresh, successful Makoto activity event, account/query-key change, window focus, visibility restore, and conservative 25-second polling only while the panel is open.
- UI: EN/VI labels, provider status, filters (All/Send/Receive/Swap/Bridge/Vault), loaded-record hash/address search, ArcScan links, and locally observed confirmation labels.
- Failure behavior: ArcScan outage falls back to recent RPC activity and `Partial history`; total provider outage retains validated local receipt activity and never presents a misleading clean empty state.

Automated coverage includes provider metadata, bounded RPC normalization, ArcScan parsing, unsupported-token rejection, swap grouping, evidence-only CCTP, Vault directions, stable ordering, cursor validation, local/on-chain collapse, corrupt cache rejection, all filters, hash/address search, and refresh wiring. Manual QA still requires comparing real wallet hashes and visual checks at 375, 390, 430, 768, and desktop widths in light/dark EN/VI modes.
# Phase 10.6 — Pre-sign simulation and transaction safety

- Shared model: strict `TransactionIntent` and structured `TransactionSafetyAssessment` suitable for human review or a future programmatic caller.
- Registry: exact repository-configured Arc token, XyloNet, Arc Memo, Makoto Vault, Circle CCTP, and Circle Gateway targets only.
- Blocking policy: wrong chain/account, invalid recipient/amount, insufficient amount or converted fee balance, expired quote, simulation revert, unlimited approval, expected-target drift, or fingerprint drift.
- Fingerprint: deterministic Keccak-256 of material request fields, including exact calldata, asset amounts, minimum receive/slippage metadata, approval, and fee envelope.
- Simulation: exact read-only contract simulation or gas estimation remains required before writes. Errors are sanitized; simulation is never presented as transaction success.
- Review UI: compact structured status/checks plus responsive advanced target, simulation, and shortened-fingerprint details. Send and Arc Memo use the shared engine directly; existing Swap, Circle Bridge/CCTP, and Vault review paths retain their exact simulations, finite approvals, request snapshots, fee checks, and receipt gates while consuming the same registry/model boundary incrementally.
- Security Center: capability disclosure only—no scores, stored transaction details, scam-detection claim, or audit claim.
- Receipt rule: only a successful receipt may create Confirmed UI, Activity refresh, or final balance refresh.
- Scope: Phase 10.6 does not include an AI agent.

# Phase 10.7 — Unified transaction review orchestration

- Prepare: verify the review snapshot is immutable, JSON serializable, provider-free, and shows the current assessment/fingerprint.
- Expiry: leave a review open for more than 60 seconds; continuing must require a fresh review and must not open the wallet.
- Material changes: change account, chain, amount, recipient, target, calldata, quote, route, slippage, minimum receive, approval, or gas envelope; each must invalidate the prior review.
- Non-material changes: changing a UI-only label must not alter the fingerprint.
- Final pipeline: immediately before the wallet request, verify live account/network/balance/allowance/quote and exact-request simulation are refreshed, then submit only the reviewed request.
- Double submit: click Continue repeatedly; only one wallet request may be active for the fingerprint.
- Wallet cancellation: reject the request; show the existing friendly error, create no Activity, and allow a deliberate retry.
- Receipt: success is shown only after a successful receipt. Submitted-but-unknown remains distinct and warns before retry.
- Flows: manually exercise Send, Arc Memo, Smart Swap approval and swap, Universal Bridge, CCTP Direct approval and bridge, and Makoto Vault deposit/withdrawal on Arc Testnet.
- Languages/layout: verify English and Vietnamese copy and mobile/desktop review layouts.
- Scope: no Agent, chat UI, LLM API, automatic execution, session key, custody, or wallet bypass is included.

Final migration automation covers swap account/route/expiry/minimum mutations, exact finite approval behavior, Circle-managed estimate truthfulness, CCTP fee/total-burn changes, Vault target changes, duplicate submission, cancellation release, and receipt-only success. SAFE MAX regression coverage remains part of the complete frontend suite.

Manual QA may stop at wallet confirmation and cancel. No additional testnet funds need to be spent. Verify long-address/fee layouts at 375, 390, 430, 768, and desktop widths in EN/VI and light/dark themes.
# Phase 10.8 — Makoto Agent read-only QA

- Confirm `/agent` loads while disconnected and a balance question asks the user to connect.
- On Arc Testnet, compare Agent USDC/EURC balances with Dashboard, recent swaps/bridges with Activity, and Vault totals with Makoto Vault.
- Confirm partial Activity state is disclosed and missing values say unavailable rather than zero.
- Verify English and Vietnamese balance, network, history, Vault, safety, and explanation prompts.
- Ask for send, swap, bridge, Vault deposit, and Vault withdrawal. Confirm a preview-only `AgentActionDraft` appears, missing fields are named, and there is no Execute button or wallet popup.
- On the wrong network, ask for network status. Confirm the current/required chain is explained and no network switch is requested.
- Clear the conversation and refresh; confirm chat messages are not persisted.
- Verify light/dark themes and widths 375, 390, 430, 768, and desktop. Check wrapping for messages, addresses, and hashes; keyboard submit; accessible input label; focus return; and `aria-live` updates.
- Confirm Security Center describes Agent capabilities and limitations without a score or audit claim.

Architecture boundary: `AgentContextSnapshot` → deterministic read-only tool → grounded response. Action language stops at a data-only `AgentActionDraft`. Phase 10.8 does **not** allow Makoto Agent to execute transactions. Future conversion to `TransactionIntent` must enter the existing Phase 10.7 review, safety assessment, expiry/fingerprint revalidation, wallet confirmation, and receipt-confirmation path.

# Phase 10.9 — Makoto Agent safe actions QA

- Confirm Send, Swap, Universal Bridge, Vault deposit, and Vault withdrawal phrases in EN/VI create a draft only. Parsing must not open a wallet or request a network switch.
- Confirm missing amount/recipient/destination, malformed or zero recipient, non-positive amount, unsupported asset, and ambiguous Vault goal block preparation. Agent MAX must say to use the manual flow; manual SAFE MAX remains unchanged.
- Select **Prepare safely** and verify the supported manual protocol adapter is preselected. Preparation may load balance, allowance, live quote/estimate, fee, and simulation, but must not open the wallet.
- Verify the prepared action enters the shared `TransactionIntent` → `TransactionSafetyAssessment` → `TransactionReviewSnapshot` presentation with Details, Transaction safety, Expected changes, and Wallet confirmation.
- Expire or mutate account, chain, recipient, amount, target, calldata, route, minimum receive, slippage, approval, or fee envelope. **Continue to wallet** must block with an expired/changed-review message.
- If finite approval is required, cancel it and verify no swap/deposit follows. After a confirmed approval, verify a fresh quote, allowance, gas, simulation, and new review are required, plus a second explicit Continue.
- Rapidly activate Continue twice and verify one wallet request. Reject it and verify cancellation only: no retry, success message, or Activity success row.
- Verify pending and reverted transactions are not success. Only confirmed evidence may append an Agent result and refresh canonical Activity.
- Check light/dark layouts at 375, 390, 430, 768, and desktop; keyboard reachability, focus movement, `aria-live` preparation status, disabled-control explanation, and long-address/hash wrapping.

Architecture boundary: natural language → data-only `AgentActionDraft` → explicit Prepare safely → protocol-owned `TransactionIntent` and shared review → explicit Continue to wallet → final revalidation → wallet → confirmed evidence → Activity. No external LLM is used. **Makoto Agent never signs transactions.**

Final consumption checks:

- Confirm the URL contains only an opaque handoff identifier. Inspect session storage: the temporary handoff is account-bound and timestamped, contains no provider/signer/conversation, and disappears immediately on consumption.
- Bridge must open the existing Universal Bridge tab, prefill amount and route, retain Standard unless explicitly supplied, load a real Circle estimate, and never open Advanced/CCTP Direct automatically.
- Vault deposit and withdrawal must show the loaded-goal selector. Private goals display only non-sensitive identifiers/balance/privacy state. Removing or changing the selected goal before route consumption must invalidate the handoff.
- Confirm the deposit handoff opens the existing exact-allowance review. A confirmed approval stops at the independent Continue control; it never auto-deposits.
- Confirm Vault withdrawal truthfully reviews the contract-supported full balance of the selected goal; Agent text cannot create a partial-withdraw path that the contract does not support.
- Return to `/agent` after confirmed, cancelled, failed/reverted, and unknown outcomes. Confirm the minimal one-time result is factual, account-bound, and removed after display. Non-Agent transactions must produce no Agent result.

Smart Swap pre-wallet revalidation regression:

- A fresh gas estimate inside the reviewed maximum fee envelope proceeds with the explicit reviewed caps; estimates above that envelope require Review again.
- Account, chain, router, calldata, amount, route, slippage, minimum receive, recipient, allowance, and quote expiry remain material and exact.
- After a finite approval confirms, the newly prepared swap review is retained and the swap still requires its own wallet confirmation.
- Freeze the reviewed Xylo calldata, minimum receive, recipient, and deadline. Waiting before Continue must not rebuild any of them.
- Treat the latest pool output as a read-only safety check: output at or above the reviewed minimum may continue; output below it or an expired deadline requires a fresh quote with a specific visible reason.
