# Analytics data checkpoint continuation audit — 2026-10-01

The current filesystem was treated as the checkpoint. Read the user attachment, AGENTS.md, docs/PROJECT_STATE.md, docs/ANALYTICS_PRODUCT_SCOPE.md, and docs/AGENT_HOME_UX.md. Inspected current Insights.tsx, analyticsPresentation.ts and its tests, analytics-ui.test.mjs, relevant store/API/explorer helpers and translations, backend/routes/arc.js and sentiment.js, existing audit JSON and recorded source hashes. No runtime, shared test, backend, or main documentation file was changed by this data audit.

## Recovery classification: I–Q

| Area | Checkpoint classification | Recorded implementation/evidence |
| --- | --- | --- |
| I. Card/data audit | COMPLETE | Network pulse, largest sampled transfers, recent transfers, and top USDC holding addresses are the four retained sections. Existing documented audit is consistent with runtime. |
| J. Fear & Greed | COMPLETE | Generic Surf crypto/Bitcoin card and its query are absent from Insights. Previous paid-provider failure is preserved as historical evidence; no paid endpoint was requested now. Backend route remains unchanged. |
| K. Localization | COMPLETE | Metric labels, list headers/subtitles, transfer kinds, source and observation copy resolve through the existing VI/EN translation system. Proper names and asset symbols remain unchanged. |
| L. Provenance | COMPLETE | Visible sources are Arc RPC / Arc Explorer, matching actual endpoints. Only successful uncached RPC observation time is shown as observation age. |
| M. Intro | COMPLETE | The checkpoint already removed experimental/preview copy. The coordinating continuation subsequently simplified its live/realtime phrasing to “Explore Arc onchain data and network activity.” / “Phân tích dữ liệu onchain của Arc và hoạt động mạng.” |
| N. Fake/demo audit | COMPLETE | Analytics reads independent public network/feed queries in every wallet mode. It does not consume demo portfolio holdings. No synthetic runtime transfer, balance, statistic, hash, or time fallback exists in its render/helper path. Test fixtures are explicitly marked as fixtures. |
| O. Large transfers | COMPLETE | Bounded actual Explorer events, nominal token-amount ranking, explorer evidence and explicit sample scope. Fresh independent row cross-check passed. |
| P. Recent transfers | COMPLETE | Actual Explorer USDC/EURC events, sorted block/log index, amount/asset/parties/time/block and explorer links. Fresh independent USDC/EURC cross-check passed. |
| Q. Top USDC holders | COMPLETE | Actual first ten indexed holding addresses match the raw descending balance list; decimal conversion verified. Contracts/bridges are included. Unproved circulating-ownership percentages remain absent. |

At recovery, Insights displayed 7 largest rows, 14 recent rows and 7 holder rows. The data helpers did not truncate or sort incoming lists. The coordinating layout continuation now uses 5 default rows and inline disclosure; that presentation work is recorded by the coordinating agent and does not change source collection or ordering.

## Exact visible-data classification and refresh

| Data | Classification | Source and meaning | Refresh/freshness truth |
| --- | --- | --- | --- |
| Latest block | VERIFIED_REAL | `/api/arc/network` → fixed `https://rpc.testnet.arc.network`, `eth_blockNumber`. | Uncached read; browser polls 12s. Observation time set after successful RPC response. |
| Estimated token transfer fee | DERIVED_FROM_VERIFIED_REAL | Same route, `eth_gasPrice × 65,000 / 10^18` native USDC units. Existing gas assumption is an estimate, not an execution quote or paid fee. | Same 12s observation cadence. |
| Network response time | DERIVED_FROM_VERIFIED_REAL | Backend elapsed milliseconds around parallel block/gas RPC requests; includes backend network round trip. | Same 12s cadence; neither block finality nor end-user wallet latency. |
| Transactions today | VERIFIED_REAL | `/api/arc/stats` → Explorer `/api/v2/stats`, `transactions_today`. | Backend cache 30s; browser poll 30s. No indexed-origin freshness timestamp in normalized response. |
| Total addresses | VERIFIED_REAL | Same route, `total_addresses`; address count is not unique people or active wallets. | Same 30s cache/poll. |
| Utilization | VERIFIED_REAL | Same route, `network_utilization_percentage`. | Same 30s cache/poll. |
| Transfer hash/log/block/time/asset/parties | VERIFIED_REAL | `/api/arc/feed` → Explorer verified USDC/EURC transfer endpoints. | Recent-source cache 10s; browser poll 15s. Transfer timestamps describe actual indexed transactions. |
| Transfer display amount and kind | DERIVED_FROM_VERIFIED_REAL | Raw integer / token decimal conversion; plain/contract transfer label follows real endpoint contract flags. | Same event evidence; display number rounding is presentational. |
| Largest transfer ranking | DERIVED_FROM_VERIFIED_REAL | Deduplicated bounded Explorer sample; three USDC pages + one EURC page plus up to eight additional USDC pages, ordered by nominal token amount, backend retains twelve. | Additional USDC sample cache 60s; feed poll 15s. Not a full-network maximum, USD comparison, or explicit threshold (`min=0`). |
| Recent transfer ordering | DERIVED_FROM_VERIFIED_REAL | Backend descending block then log index, retaining thirty. | Bounded sample; indexed data can trail RPC. |
| Top USDC address balance | DERIVED_FROM_VERIFIED_REAL | `/api/arc/holders` → Explorer USDC token holders + metadata; raw balance conversion uses current metadata decimals six. | Backend cache 120s; browser poll 120s. No indexed-origin observation timestamp in normalized response. |
| Top USDC address ranking | VERIFIED_REAL | First ten indexed entries; all addresses and descending raw balances cross-checked against raw holder endpoint. | Same 120s cache/poll. Addresses include contracts/bridges/system accounts and are not individual owners. |
| Missing/invalid/failed metrics | UNAVAILABLE | RPC failed/stale/future/wrong declared chain or invalid block observations withheld; missing/nonfinite/negative/ambiguous-zero Explorer fields omitted. Empty/failed optional lists omitted; concise localized unavailable copy remains. | No fake zero or list fallback. Guard uses the route's declared chain ID; backend declares its fixed Arc chain ID, rather than performing a separate live `eth_chainId` read. |

## Hidden claims / REMOVE_FROM_UI

- Fear & Greed: removed from normal Analytics because its generic crypto/Bitcoin metric is not an Arc-specific index. The old HTTP 502/PAID_BALANCE_ZERO response remains only historical audit evidence.
- Mixed-asset sampled volume: nominal USDC and EURC are not summed and shown as USD volume.
- Holder supply percentage/distribution: hidden. Arithmetic `balance / total_supply × 100` does not establish a circulating-ownership denominator; raw metadata reports `circulating_supply: null`.
- Raw feed `updatedAt` is not displayed as source freshness because the preserved backend regenerates it on cache hits. Stats/holders also have no reliable origin timestamp.
- Unsupported fields (total transactions, total blocks, gas tiers, holder count/supply) are not added just because normalized responses contain them.

## Fresh read-only evidence

`continuation-data-evidence.json` records the fresh audit completed at **2026-10-01T11:59:47.122Z** (18:59:47 Asia/Bangkok). The four existing local Arc routes and raw Explorer stats/token metadata/holder endpoints all returned HTTP 200. A first 15s feed-request timeout is preserved in `continuation-data-initial-evidence.json`; a subsequent read with the route's bounded multiple-page fetch allowed 60s and completed successfully. This is source availability timing, not invented data or a backend change.

- Fresh RPC: block **64,942,879**, gas price **25 gwei**, existing token-transfer estimate **0.001625 USDC**, measured backend round trip **226 ms**. These are recorded observations, not permanent product values.
- Normalized/raw Explorer stats agreed: **1,108,332** transactions today; **55,179,846** total addresses; utilization **3.6616812%**. Explorer indexing timing can lag the live RPC block.
- Feed returned **30** recent and **12** largest rows, with zero duplicate hash/log events in either list. Recent block/log ordering and largest nominal-token-amount ordering passed.
- Three recent USDC rows and three largest USDC rows independently matched real transaction/token-transfer endpoints for exact hash, log index, block, timestamp, parties, decimal-converted amount, asset contract and contract flags: **6/6**.
- `continuation-eurc-evidence.json` separately matched one recent EURC row across the same fields: **1/1**. Combined transaction cross-check: **7/7**. Transaction-scoped Explorer transfer results omit timestamp; the same recorded transaction detail supplies its exact timestamp. No timestamp was synthesized.
- USDC holder endpoint first ten address ranks matched the backend's ten entries, raw balances were descending, and all **10/10** decimal conversions matched. Current metadata decimals were **6** and circulating supply remained **null**. Balances are rounded JavaScript display numbers, not a new exact financial calculation.

The new audit scripts are isolated evidence collectors under this QA directory. They call only the existing read-only Arc routes and public Explorer GET endpoints. No sentiment/paid route, signer, transaction execution, database mutation, wallet signature, commit, push or deploy occurred.

## Preservation and tests

- All **26/26** recorded backend files have the same SHA-256 as `start-baseline/source-sha256.json`; backend Analytics source was not changed.
- Existing `analyticsPresentation.test.ts` focused data suite passed **14/14**, zero failures/skips. It tests source-value retention, invalid/stale/unavailable guards, exact source-data preservation, transfer kinds/deduplication, hidden volume/supply/share claims and localized observation age.
- Existing production-render Analytics tests cover full VI/EN lookup, missing/failed/malformed/partial sources, source links and read-only boundary. Their prior blanket “no buttons” assertion must allow the coordinating agent's presentational View more/Show less controls while still excluding execution actions/forms. The coordinating agent owns that update and complete suite/build validation.

## Material limits

The Explorer is an indexed data provider, not the RPC tip. Largest transfers are a bounded mixed USDC/EURC nominal-unit sample, not complete history or USD-volume ranking. Holder ranks refer to indexed addresses, not people; percentages remain intentionally absent. Real provider availability and indexing can vary. No transaction architecture change or paid API is needed for the authorized product polish.
