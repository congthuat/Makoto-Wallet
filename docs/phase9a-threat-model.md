# Phase 9A — Threat Model + Policy Inventory

Status: **pending user review**. This is an audit of the Phase 8 code at `3374cfa124de1aad003e04ee5a0d16836f5e4941`, not a policy implementation. Phase 9B has not started. No transaction was executed.

## Scope and trust boundaries

The current path is **user request → Agent plan → canonical READ / QUOTE / PREPARE → runtime validation → optional one-time handoff → wallet review and revalidation → wallet signer → provider / blockchain → receipt and activity evidence**. The Agent may propose an action and produce bounded, execution-disabled preparation data. Deterministic code and the wallet review decide whether a request is safe to present. The user wallet alone authorizes signing. A provider quote, simulation, submitted hash, and receipt each establish different facts.

| Boundary | Trusted for | Must not be treated as |
| --- | --- | --- |
| User / Agent (`frontend/lib/agent/tools.ts`, `canonicalIntegration.ts`) | Intent and explanation; supported capability routing | Signing authority, contract truth, or execution status |
| Canonical tools (`readTools.ts`, `quoteTools.ts`, `prepareTools.ts`) | Typed observations, route-bound quotes, bounded preparation | A live balance or quote after its observation/expiry; permission to submit |
| Runtime schemas (`toolSchemas.ts`) | Rejection of malformed, authority-bearing, or mismatched tool data | Proof that market, chain, or provider state remains unchanged |
| Handoff (`actions/handoff.ts`, `WalletDashboard.tsx`) | One-time, account/expiry/asset-bound data transfer for supported Send/Swap | Automatic approval, signing, or Direct CCTP wallet review |
| Wallet review (`transactionSafety.ts`, `transactionOrchestrator.ts`, flow components) | Exact request snapshot, visible warnings/blocks, caller-provided current context | An implicit fresh RPC read; final user consent |
| Wallet adapter (`hooks/useWalletAccount.tsx`, `useVerifiedWalletChain.tsx`) | Explicit local/external wallet submission after verified chain | Agent capability or guaranteed finality |
| RPC / provider / chain (`transactionReceipt.ts`, bridge modules) | Observed quote, simulation, receipt, destination evidence | A single universal status source; source receipt as destination success |

Local wallet existence, local wallet unlock, external connection, and App Lock are separate states. A locked local wallet may retain an address for reads but has no execution adapter. App Lock does not unlock the wallet. Local signer generation invalidates a stale submitter on lock/refresh/unmount; external wallet and verified chain can still change between observations (`walletAccount.ts`, `useWalletAccount.tsx`, `useAppLock.tsx`, `useVerifiedWalletChain.tsx`).

## Threat register

`Existing` describes code observed now; `residual` identifies the decision or evidence still needed. Phase references identify future roadmap ownership, not work done in 9A.

| Asset at risk / boundary | Threat | Existing mitigation | Residual risk and recommended owner |
| --- | --- | --- | --- |
| User intent / Agent → tool | Malformed or unsupported action; invented asset, pair, route, provider, or amount | `runAgentCapability` and `canonicalIntegration.ts` route supported actions; runtime request validation rejects unknown fields and unsupported values; cirBTC uses 8 decimals | Different legacy Agent planning capabilities remain outside canonical PREPARE. Tool Layer and 9B should define a shared decision vocabulary; 9F should test adversarial intent. |
| Account and chain / tool → handoff → review | Cross-account/chain reuse or stale wallet context | Quotes/preparations bind account and chain; `useMakotoAgent.ts` invalidates on context change; one-time handoff checks account/ID/expiry; wallet review revalidates caller context | Context still changes after reads. 9D should specify fresh observations at the final signing boundary; wallet adapter owns actual signer. |
| Funds / quote → preparation | Quote reuse, stale/expired quote, amount/route/provider mismatch | Canonical PREPARE requotes and compares quote identity, amount, route, provider, fee and balance evidence; fingerprint/expiry bind prepared steps; handoff expires | Provider or chain state can change after preparation. 9B defines decision semantics; 9D owns final revalidation. |
| Funds / prepared step → wallet | Arbitrary calldata, target substitution, malformed dependent step | `toolSchemas.ts` rejects execution authority and decodes only bounded known ERC-20 transfer/finite approval, Xylo swap, and CCTP burn shapes; dependent second step requires prior confirmation | Route-specific wallet flows must still independently check actual request. 9C owns target/token/spender rules; 9F tests crafted steps. |
| Token allowance / approval | Unlimited or wrong-spender approval, stale allowance, approval assumed to authorize next write | PREPARE encodes finite known-spender approval as data; Swap/CCTP wallet flows use finite approvals and wait for receipt, then reread allowance/balance/quote or fee and make a new review | Generic `assessTransaction` checks finite amount but does not itself verify token/spender against a route. 9C owns route-specific deterministic controls; 9D owns post-approval state gates. |
| Swap proceeds / quote → sign | Invalid slippage, output below minimum, stale quote | Xylo pair and UI slippage options are constrained; Agent uses fixed 0.5%; minimum output and live output are checked in flow; quote age/deadline apply | No central slippage decision exists across callers; pool output can change before inclusion. 9C policy, 9D revalidation, wallet review/user consent. |
| Funds / review → sign | Review-to-sign mismatch, stale simulation, changed fee/balance | Immutable review snapshot/fingerprint and submission guard; Send/Swap/CCTP flows reread and simulate around submission; verified chain checked before wallet write | `revalidateTransactionReview` trusts the current context supplied by its caller. Send may proceed if a fresh fee estimate becomes unavailable, based on its earlier estimate. Direct CCTP checks fee age but does not refetch fee immediately before burn. 9D should define fail/review semantics for these cases. |
| Funds / wallet → provider | Signer missing, locked, switched, user rejection, failed submission | Local locked state has no adapter; external wallet signs; flow catches rejections/failures; verified Arc chain gate | The wallet is final authority; policy cannot imply that a prepared or reviewed action was signed. 9E status contract, 9F failure tests. |
| Status / submission → receipt | Hash described as success; timeout described as failure; source receipt described as destination success | `transactionReceipt.ts` verifies receipt and events; submitted/unknown distinct from confirmed; `cctpBridge.ts`/`bridgeOperation.ts` separate source and destination | External Circle-managed execution has less independently inspectable final simulation/receipt evidence than Direct CCTP. 9E should make provenance and unresolved states explicit; 9F tests timeout/reorg-like uncertainty. |
| Funds / provider adapter | Provider-supplied target, route, fee, or status assumed authoritative | Canonical QUOTE binds provider and route; wallet-specific flows constrain supported routes; provider-managed Circle flows display a simulation limitation | Provider availability and provenance differ. 9B should consume typed evidence, 9C bind targets/routes, 9D handle stale/unavailable evidence. |

## Policy inputs and evidence quality

`AUTHORITATIVE` means direct deterministic or onchain observation **at the time observed**, not future truth. `DERIVED` is computed from such data. `PARTIAL` may omit needed fields or comes from a provider without independent confirmation. `UNAVAILABLE` means no current usable value.

| Input | Current source / quality |
| --- | --- |
| Account, wallet kind/lock, chain | Wallet adapter and verified `eth_chainId`: **AUTHORITATIVE at observation**; Agent session copy or stored handoff: **DERIVED/stale-able**. |
| Action, supported asset/pair/route, token decimals, configured target/spender | `assets.ts`, `swap.ts`, `cctp.ts`, `knownContracts.ts`, canonical schemas: **AUTHORITATIVE configuration**; provider route discovery: **PARTIAL/provider-derived**. |
| Recipient, amount, user slippage choice | User input after parsing/validation: **AUTHORITATIVE intent**, not sufficient safety evidence. Agent parsed amount: **DERIVED**. |
| Balance, allowance, receipt, event | Arc/Base RPC read with chain/block context: **AUTHORITATIVE at observation**; failed/missing RPC read: **UNAVAILABLE**, never assumed zero. |
| Quote output, fee, minimum output, approval need, expected receive | Xylo/Circle/RPC quote and calculations: **DERIVED**; absent gas or provider failure: **PARTIAL/UNAVAILABLE**. Swap/Bridge canonical gas is `not-estimated`. |
| Quote age/expiry, prepared step fingerprint, review snapshot | Deterministic time/binding calculations: **DERIVED**; expiry is not proof of unchanged market or allowance. |
| Simulation | RPC result for the exact call: **AUTHORITATIVE at simulation time**; unavailable or Circle-managed not-performed: **PARTIAL/UNAVAILABLE**. |
| Submitted hash, source receipt, destination confirmation | Hash: **PARTIAL submission evidence**; verified source receipt: **AUTHORITATIVE source evidence**; separately verified destination receipt/event: **AUTHORITATIVE destination evidence**. |

## Current flow control inventory

Classifications are per current path: **EXISTING**, **PARTIAL**, **MISSING**, **DUPLICATED**, **OUT_OF_SCOPE**. A duplicated control may be useful defense in depth but needs one policy definition.

| Flow | Existing controls and source | Partial / missing / duplicated |
| --- | --- | --- |
| Send USDC, EURC, cirBTC | `wallet.ts` validates known asset, recipient/address, positive decimal-correct amount and balance; `assets.ts` defines 6/6/8 decimals; `SendFlow.tsx` checks account, verified Arc, fee/balance, simulates exact call, creates review snapshot, rereads balance/fee, re-simulates, submits through wallet, and waits for receipt; `transactionReceipt.ts` verifies transfer evidence. **EXISTING** | Fee can become unavailable before sign and earlier estimate remains usable (**PARTIAL**); fee is an adjacent gate rather than part of the generic intent fingerprint (**PARTIAL**). Amount/balance/account/chain checks repeat in Agent tools and UI (**DUPLICATED**). Self-send is allowed, with warning rather than rejection; that is current product behavior. |
| Xylo Swap USDC ↔ EURC | `swap.ts` restricts pair, quote age (45 s), deadline (300 s), 0.5/1/3% UI slippage and minimum output; `RealSwapFlow.tsx` checks balance/allowance, finite approval to Xylo router, fee, exact simulation, review snapshot, live output and minimum before wallet sign; approval receipt leads to fresh allowance/balance/quote and a new swap review; swap receipt and received token event are checked. **EXISTING** | Generic safety module does not enforce pair/spender/slippage itself (**PARTIAL**); market can move after simulation (**PARTIAL**). Agent fixed 0.5% and wallet UI selectable 0.5/1/3% require explicit policy ownership (**DUPLICATED**). cirBTC Swap **OUT_OF_SCOPE/unsupported**. |
| Direct CCTP Arc Testnet → Base Sepolia USDC | `cctp.ts` fixes domain, messenger and forwarding call; `CctpBridgeFlow.tsx` checks chain/account, balance, current fee and allowance, finite approval, burn target, fee age, exact simulation and snapshot; receipt after approval leads to a new burn review; `cctpBridge.ts`/`bridgeOperation.ts` separate source and destination proof. **EXISTING** | Fee not freshly refetched immediately before burn (**PARTIAL**). Agent has bounded READ/QUOTE/PREPARE but no wallet handoff (**MISSING as integration**, documented non-blocking Phase 8 limitation). Source confirmation is not destination confirmation. Other chains/tokens **OUT_OF_SCOPE**. |
| Circle App Kit Universal Bridge | `UniversalBridgeFlow.tsx` constrains supported App Kit routes, review/expiry/account, source balance and estimates; `circle/bridge.ts` provides fee estimates. **EXISTING** | Provider manages final execution and exact transaction is not independently simulated; review warns of this (**PARTIAL**). Canonical Agent PREPARE **UNAVAILABLE**. This is distinct from Direct CCTP. |
| Unified Balance / Gateway spend | `UnifiedBalancePage.tsx` binds review to account, recipient, amount, destination, forwarder and allocations; rereads balance and fee and requests review if fee changes; SDK performs execution. **EXISTING** | Provider-managed status and pending/available balance are distinct from Direct CCTP destination verification (**PARTIAL**). Canonical Agent PREPARE **UNAVAILABLE**. |

`transactionSafety.ts` contributes common account/chain/target/amount/balance/fee/finite-approval/expiry/simulation assessment, but route-specific invariants live in each caller. `transactionOrchestrator.ts` fingerprints the reviewed request, checks snapshot expiry/current supplied context, and prevents concurrent submission of one fingerprint. `TransactionSafetyReview.tsx` disables blocking or unknown reviews and shows warnings. These are **EXISTING** shared controls, with repeated route checks in flow components (**DUPLICATED**).

### Approval and target inventory

| Reachable action | Target / spender origin | Current check and residual |
| --- | --- | --- |
| Send | Configured USDC/EURC/cirBTC token; recipient is user-controlled; optional configured Arc memo target | Recipient/address and token are validated; recipient is not an arbitrary contract execution target. Generic target check is caller-supplied; 9C should bind asset, chain, target and calldata together. |
| Xylo Swap | Configured XYLO router/pool; approval spender is configured router | Finite exact approval, allowance read, post-approval receipt and new review. `transactionSafety.ts` only checks finite approval amount, not route-specific spender/token identity. |
| Direct CCTP | Configured USDC token and CCTP TokenMessengerV2; destination domain/recipient/hook encoded by `cctp.ts` | Finite approval for amount plus max fee, burn target/call constrained, source and destination verified separately. Fee and recipient must remain bound through 9C/9D. |
| Circle App Kit / Gateway | Provider SDK derives supported route and managed transaction | Review checks supported route/account/amount and describes simulation limits. Provider target/calldata are not canonical Agent prepared steps; 9C cannot claim independent target verification without adapter evidence. |

`knownContracts.ts` also lists configured minter, Gateway and Vault addresses. Their presence in that registry does **not** mean every address is an execution target in the Send/Swap/Direct CCTP paths. No Agent-provided arbitrary `to`/calldata is accepted by canonical PREPARE. Existing approvals are finite; approval reuse assumes a fresh allowance observation before the next dependent write. An approval receipt alone does not authorize or trigger a Swap/CCTP burn.

### Simulation and revalidation sequence

| Flow | Review-time evidence | Before sign / after approval | Remaining change window |
| --- | --- | --- | --- |
| Send | Balance, fee estimate, exact simulation, reviewed request | Current account/chain, fresh balance, attempted fresh fee, exact simulation, snapshot match; receipt after submit | Fee-estimate failure can leave earlier fee evidence; chain state changes after simulation. |
| Xylo Swap | Quote/output, balance, allowance, fee, exact simulation | Fresh balance/allowance/output/minimum, fee, snapshot and exact simulation. Approval receipt → fresh allowance/balance/quote → separate swap review | Pool output/allowance can move after final check; transaction can revert or settle differently. |
| Direct CCTP | Fee quote, balance, allowance, gas, exact simulation | Fee age, fresh balance/allowance, snapshot and simulation. Approval receipt → fresh fee/balance/allowance → new burn review | Fee not refetched at final burn; provider/destination state can remain unresolved. |
| Circle App Kit Bridge / Gateway | SDK estimate and supported route/balance review | Expiry/account checks; Gateway fresh balance/fee and changed-fee review | SDK manages final transaction; exact final call simulation and destination proof vary by provider. |

## Failure and status coverage

| Failure mode | Current handling / gap |
| --- | --- |
| Wrong chain; wrong account | Canonical context binding and handoff checks; verified wallet chain and review revalidation. Context can change again after observation. |
| Unsupported token; pair; route | Asset registry, Xylo pair, Direct CCTP route, App Kit supported-route checks; canonical tools return unsupported/unavailable rather than fabricating a quote. |
| Malformed recipient; invalid amount | `wallet.ts` and canonical request parsing/validation reject malformed address, nonpositive or precision-invalid amount. |
| Insufficient balance; insufficient allowance | READ and wallet fresh checks; missing allowance leads to finite approval stage. Read failures remain unavailable/unknown, not zero. |
| Excessive allowance / approval | Current new approvals are finite and capped to requested amount; existing high allowance is observed, not automatically revoked. Global allowance policy is 9C work. |
| Quote unavailable; stale; expired | Typed quote states and age/expiry, PREPARE requote, handoff/review TTL. Requote/review semantics need 9B/9D ownership. |
| Invalid slippage | UI options and canonical Agent fixed value; swap helper computes minimum. Central cross-route rule absent. |
| Provider unavailable; simulation failure | Partial/unavailable evidence or blocked/review assessment; Circle-managed final simulation warning. Failure must not imply success. |
| User rejection; submission failure | Wallet flow catches and classifies; neither produces confirmed receipt. |
| Receipt timeout; destination unresolved | Submitted/unknown and source/destination states remain distinct; no automatic retry of uncertain CCTP burn. |

Status words must follow evidence: **PREPARED** means data-only plan; **SUBMITTED** means hash, not success; **CONFIRMED** requires verified chain receipt/effect; **SOURCE_CONFIRMED** is not **DESTINATION_CONFIRMED**; **UNRESOLVED** preserves uncertainty; **FAILED/REJECTED/EXPIRED** must describe the stage where they occurred. Canonical READ/QUOTE/PREPARE already preserve unavailable/partial/expired states. The Agent evidence panel displays attached canonical evidence. 9E owns a consistent user-facing contract across wallet and provider-managed flows.

## Provider ownership

| Provider / adapter | Current boundary |
| --- | --- |
| Arc RPC / viem public client | READ, quote inputs, simulation, receipt; no Agent signer. |
| Xylo router | Read quote and wallet-signed Swap; canonical Agent QUOTE/PREPARE supported for USDC/EURC. |
| Circle CCTP fee/status and Base RPC | Fee QUOTE, Direct CCTP source/destination evidence; wallet signs approval/burn; Agent PREPARE supported but handoff absent. |
| Circle App Kit Universal Bridge | SDK quote/review and provider-managed execution; canonical Agent PREPARE unsupported. |
| Circle Gateway / Unified Balance | SDK balance/estimate/spend and pending/available distinction; canonical Agent PREPARE unsupported. |
| Reown / WalletConnect / wagmi | External wallet connection, account and user-authorized submission; no Agent execution permission. |

Security keyword search (`privateKey`, `mnemonic`, `seed`, `password`, `signer`, `walletClient`, `sendTransaction`, `writeContract`, `approve`, `broadcast`, `unlock`) found inert approval data/parser/forbidden-key matches in Agent code and real submission/unlock paths in wallet adapters and flow components. The matches do not establish an exploit. No path was found for canonical Agent tools to obtain a seed/private key, unlock a wallet, sign, approve, submit, or broadcast. `AGENT_EXECUTION_POLICY` remains `EXECUTION_FORBIDDEN`.

## Policy decisions and ownership for later phases

The existing `assessTransaction` assessment is `ready | review | blocked | unknown`; canonical tools also distinguish available, partial, unavailable, unsupported and expired evidence. 9B should define deterministic semantics for **proceed**, **warn**, **block**, **require user review**, **requote**, and **revalidate** (names may follow existing conventions). A missing balance or simulation should remain unknown/partial, not become a safe zero or a successful result. The policy engine should return reasons/evidence, not a signer or transaction executor.

| Owner | Decision boundary |
| --- | --- |
| Agent | Parse/propose supported intent and explain evidence; never assert final safety or success. |
| Tool Layer | Validate schema, bind account/chain/route/provider/quote, preserve provenance/freshness and execution-disabled preparation. |
| Deterministic policy (9B–9D) | Assess supported chain/asset/contract/spender, amount/balance/fee/allowance/slippage, quote/simulation freshness and dependent-write preconditions. |
| Wallet review | Show exact request, warnings, unknowns and user choice; create/revalidate snapshot. |
| Signer/user wallet | Final authorization and submission, one dependent step at a time. |
| Provider | Supply bounded observations/estimates and, where applicable, managed execution with explicit provenance. |
| Blockchain receipt | Establish source confirmation and separately destination/effect evidence. |

Candidate consolidation: account/chain/amount/balance checks repeat across Agent, canonical tools, `transactionSafety.ts`, and each wallet flow; target/spender/finite-approval checks split between `toolSchemas.ts`, `transactionSafety.ts`, `transactionFlowReview.ts`, Swap/CCTP; quote expiry and review expiry have separate clocks; fee and simulation failures use flow-specific fallback decisions. Preserve flow-level checks as defense in depth while giving the shared policy one explicit rule and evidence vocabulary. No refactor occurs in 9A.

**Phase 9 required:** 9B common deterministic decision/evidence model; 9C chain, route, contract, token, approval and slippage controls; 9D simulation, expiry and final revalidation decisions; 9E truthful block/warn/review/status UX; 9F adversarial and failure-path tests; 9G audit/closeout. This audit does not set new spend caps or invent token/pair/route support. Direct CCTP Agent handoff, Circle App Kit canonical PREPARE, and gas estimates are existing Phase 8 limitations to preserve and classify, not silently claim as working.

**Future/backlog:** MCP, Memory, Indexer intelligence, Verifiable Actions, FLOP/Technocore, and new routes/providers. None is implemented or promoted by this audit.

## Audit evidence and verification

Primary files inspected: `frontend/lib/agent/{tools,canonicalIntegration,readTools,quoteTools,prepareTools,toolSchemas,quoteProviders}.ts`, `frontend/lib/agent/actions/handoff.ts`, `frontend/hooks/{useMakotoAgent,useWalletAccount,useVerifiedWalletChain,useAppLock}.tsx`, `frontend/lib/{transactionSafety,transactionOrchestrator,transactionFlowReview,transactionReceipt,wallet,walletSafety,assets,knownContracts,swap,swapApprovalFlow,cctp,cctpBridge,bridgeOperation}.ts`, `frontend/components/{WalletDashboard,SendFlow,RealSwapFlow,CctpBridgeFlow,UniversalBridgeFlow,UnifiedBalancePage,TransactionSafetyReview}.tsx`, `frontend/lib/circle/{bridge,unifiedBalance}.ts`, and the corresponding Agent, transaction, Swap and CCTP tests. Phase 8 test/build numbers in `PROJECT_STATE.md` are inherited baseline evidence; 9A makes no claim of rerunning them. No production code, UI, signer, execution semantics, or provider architecture was changed.
