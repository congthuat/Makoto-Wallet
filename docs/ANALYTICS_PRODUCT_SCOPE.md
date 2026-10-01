# Analytics product scope

Analytics remains a secondary footer destination. It reads public Arc Testnet data and exposes explorer links; it has no signer or transaction execution. Normal runtime never fills missing responses with demo values. Invalid rows are omitted; failed or empty sources receive concise localized unavailable text.

## Sources and refresh

| Visible data | Existing route and primary provider | Meaning and refresh |
| --- | --- | --- |
| Block height | `/api/arc/network`; `https://rpc.testnet.arc.network`, `eth_blockNumber` | Observed RPC block; browser polls every 12 seconds. |
| Estimated token transfer fee | Same route, `eth_gasPrice` | Gas price × existing 65,000-gas assumption, divided by native USDC's 10^18 units. Estimate only; neither a transaction quote nor actual paid fee. |
| RPC response time | Same route | Backend elapsed time for the parallel block/gas reads, including its network round trip. |
| Transactions today, total addresses, utilization | `/api/arc/stats`; `https://explorer.testnet.arc.io/api/v2/stats` | Explorer-indexed aggregates; 30-second backend cache and browser poll. Backend defaults missing fields to zero, so presentation conservatively withholds ambiguous zero/default values. |
| Recent transfers | `/api/arc/feed`; Explorer USDC and EURC token-transfer endpoints | Up to three USDC pages and one EURC page; 10-second backend cache, 15-second browser poll. UI shows validated bounded rows with actual asset, amount, address, block, time and transaction link. |
| Largest sampled transfers | Same feed plus up to eight additional USDC pages | Additional 60-second cache; backend deduplicates hash/log index and ranks nominal token amounts, retaining 12. The UI shows seven. Default `min=0`: there is no hidden USD threshold. This bounded USDC/EURC sample is not a complete network ranking or USD comparison. |
| Top USDC balances | `/api/arc/holders`; Explorer `/tokens/0x3600000000000000000000000000000000000000/holders` plus token metadata | First ten indexed addresses; UI shows seven valid rows, including contracts and bridges. 120-second backend cache and browser poll. Raw balances use the metadata decimals (currently six). Addresses are not individual owners. |

Source labels say **Arc RPC** or **Arc Explorer**, matching the actual endpoints. RPC `updatedAt` is set after the successful real read and supports observation age; failed, wrong-chain or over-60-second observations are withheld. Stats and holder responses contain no origin timestamp. Feed `updatedAt` is regenerated on a cache hit and is not source freshness; it is deliberately not displayed as an updated age. Transfer times describe the actual indexed transaction, not refresh time. No timestamp is invented.

## Hidden and unavailable data

- The previous Fear & Greed card used `/api/sentiment` and Surf's generic crypto/Bitcoin index, cached for ten minutes. It is not Arc-specific and returned HTTP 502 because its upstream reported insufficient paid balance during the audit. Analytics no longer mounts the card or requests that endpoint; the backend route is preserved.
- The former feed USD total summed nominal USDC and EURC units without conversion. It is hidden rather than presented as dollar volume.
- Holder percentages and supply distribution are hidden. The backend formula is `balance / total_supply × 100` in the same decimal units, but the native USDC interface's supply has not been verified as a circulating-ownership denominator. Explorer metadata reported no circulating supply. Ranked balances remain useful without this claim.
- Missing, nonfinite, negative, malformed-address/hash/time, or invalid-source values are withheld. No placeholder zero or cached demo list is substituted. Legitimate zero aggregate values are also withheld while the preserved backend defaulting makes them ambiguous.

## Verification boundary

The 2026-10-01 audit observed HTTP 200 from the real network, stats, feed and holder routes and cross-checked raw Explorer stats/token metadata. Evidence is under `validation-qa/timezone-receive-analytics/`. Tests additionally use clearly identified malformed/unavailable fixtures; these are not chain observations. SIWE, task storage/scheduling, wallet selection, prices/history, Send, Receive, Swap, Bridge, CCTP, Policy and Strategy modules are outside this polish scope and remain unchanged.

## Compact-list continuation — 2026-10-01

The source audit and original evidence above remain preserved. The recovered checkpoint displayed seven largest transfers, fourteen recent transfers and seven holders. Current presentation shows **five rows per list**, because recent-transfer rows include amount, type, parties, block and age. **View more / Xem thêm** expands only that card to all currently validated fetched rows; **Show less / Thu gọn** returns to five. Short lists have no disclosure button. Each button exposes its controlled list and expanded state, supports keyboard activation, and retains the existing focus treatment. Expansion state survives ordinary polling while the card remains mounted. No route, inner scrollbar, fabricated pagination, fetch limit, sorting or backend ranking change was introduced.

Desktop cards use natural independent heights without empty filler; mobile cards stack with the same five-row defaults. The intro now reads “Explore Arc onchain data and network activity.” / “Phân tích dữ liệu onchain của Arc và hoạt động mạng.” This avoids implying that all providers share one realtime freshness guarantee. The subtle read-only statement remains; disclosure controls only change visible rows and explorer links remain the only external actions.

Live expanded-list QA reproduced native scroll anchoring moving the document by 54px when polling replaced a transfer row. Analytics now disables anchoring only within its page subtree. The existing global scroll-to-top effect still depends only on navigation; no polling, scheduler or data semantics changed.

Fresh read-only continuation evidence records HTTP 200 from all four existing Arc routes and the raw Explorer aggregates, token metadata and holder page. Seven sampled USDC/EURC transfer events matched raw hash, log index, block, timestamp, parties, asset, amount and contract flags. All ten indexed USDC holder addresses and decimal-converted balances matched raw descending Explorer order; metadata decimals were six and circulating supply was null. The observed feed retained thirty recent and twelve largest rows, and the holders route retained ten. These are observation counts, not newly imposed collection limits. The original temporary feed client timeout and successful follow-up evidence are both preserved.

| Classification | Data |
| --- | --- |
| VERIFIED_REAL | Observed Arc block; Explorer aggregate counts/utilization; indexed transfer identities, times and addresses; indexed holder addresses/raw balances. |
| DERIVED_FROM_VERIFIED_REAL | Existing estimated fee/gas assumption, backend RPC read duration, token-unit conversion, contract-transfer kind, bounded-sample nominal-amount ranking and relative ages. |
| UNAVAILABLE | Failed, stale RPC, missing, ambiguous zero/default, or malformed fields are withheld or shown with localized unavailable text. |
| REMOVE_FROM_UI | Generic Fear & Greed, mixed nominal USDC/EURC “USD volume,” and unsupported supply/holder-percentage claims remain hidden. |

The ranking describes indexed address balances, including contracts and system accounts, and the large-transfer list describes a bounded Explorer sample. Neither proves individual beneficial ownership, a complete network maximum, or USD equivalence between USDC and EURC. Backend routes and collection are unchanged.

Final automated validation passed **291/291** frontend tests and type-check/lint/client/SSR gates. Analytics, Receive and Settings passed the twelve requested width/language/theme configurations each; preserved Home/Tasks evidence completes the 60-case product matrix. Five-row defaults, independent keyboard disclosure, source-order preservation, both themes, desktop card balance, mobile stacking, no horizontal overflow/inner scroll trap, and footer reachability are recorded in [continuation-browser-summary.md](../validation-qa/timezone-receive-analytics/continuation-browser-summary.md). The 36 default/expanded Analytics and Settings scroll holds exceeded fifteen seconds with zero drift and final console/page errors were zero. Earlier failed attempts remain separate audit history.

Twelve additional targeted expanded-list checks waited for a successful real feed response and its render, holding Y=650 for 19.027–31.783 seconds with zero drift. This specifically verifies the scoped native anchoring fix during row replacement, beyond merely observing a polling request start. These repeats are separate from the unique 60-case matrix.
