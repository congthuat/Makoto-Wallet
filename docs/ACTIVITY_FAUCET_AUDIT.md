# Activity and Faucet audit — 2026-09-29

Scope: Activity/transaction details and the Arc Testnet Faucet page. Connected Send execution, Agent signing authority, Swap, Bridge, and later phases were not changed. The user reported a successful real USDC Send before this work; this audit did not submit another transaction.

## Sources inspected

`README.md`, `BRAIN_TRANSPLANT.md`, the three transplant JSON files, `docs/SEND_RUNTIME_AUDIT.md`, the current frontend/backend runtime, and the donor reference were inspected. `AGENTS.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE_DECISIONS.md`, and `CLAUDE.md`/`.claude/` do not exist in this checkout. No cirBTC faucet URL was found in the historical project or donor docs. The current `frontend/src/lib/wallet.ts` already supplied the Circle faucet URL; the stale Faucet page only listed USDC/EURC. Circle's [public Testnet Faucet](https://faucet.circle.com/) currently lists USDC, EURC, cirBTC, and Arc Testnet. This is the canonical provider evidence for cirBTC. The public site requires the user to select the asset and network and submit the request there; opening it is not receipt evidence.

## Activity status evidence

| Semantic state | Current behavior |
| --- | --- |
| SUBMITTED | Transient Send result state after the wallet returns a hash. The local Activity record is immediately PENDING while waiting for a receipt. The Activity chip also supports a submitted label if a record uses it later. |
| PENDING | A hash exists, but final receipt evidence has not been established. |
| CONFIRMED | Stored as `completed`. The Activity chip says “Confirmed” in English and “Hoàn thành” in Vietnamese. It requires a successful matching receipt or a matching explorer transfer log. |
| FAILED | Deterministic failed receipt, or demo sample. |
| UNKNOWN | Missing or ambiguous final evidence after polling. Stored and displayed separately from PENDING. No success is inferred from timeout. |
| USER_REJECTED | The Send screen reports wallet cancellation. There is no hash, so no Activity item is created. |

The connected wallet checks pending/unknown local hashes after reload and every 20 seconds using `checkSendReceipt`. Only a confirmed or failed receipt updates the local result; temporary RPC errors leave the previous state intact. `mergeSendRecord` prevents stale updates from replacing a proven completed or failed result. Explorer transfer activity is treated as included evidence; a local Send record is deduplicated only when hash, direction, token, recipient, and amount match. The detail modal follows the latest Activity item rather than retaining a stale clicked snapshot. Confirmation count is only shown when both transaction block and current network block are available; the inclusion block counts as confirmation one.

Transaction labels, status text, hash-copy feedback, and dates now follow EN/VI. Dates use `Intl.DateTimeFormat` with `en-US` or `vi-VN`; addresses and hashes wrap inside the detail modal. Arc Testnet, asset symbols, block numbers, addresses, hashes, and ArcScan retain their canonical spelling. Clipboard success is reported only after the browser accepts the write.

## Faucet assets and wiring

The canonical frontend registry is `frontend/src/lib/wallet.ts` (`TOKENS`, `ARC`). The existing `TokenIcon` uses each registry glyph/color; there is no separate bitmap icon. The backend explorer adapter is `backend/routes/arc.js`.

| Asset | Arc Testnet contract | Decimals | Icon | Provider and URL | Classification |
| --- | --- | ---: | --- | --- | --- |
| USDC | `0x3600000000000000000000000000000000000000` | 6 | `$`, blue | Circle, `https://faucet.circle.com` | A — active external action and live balance |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` | 6 | `€`, violet | Circle, `https://faucet.circle.com` | A — active external action and live balance |
| cirBTC | `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF` | 8 | `₿`, orange | Circle, `https://faucet.circle.com` | A — active external action and live balance |

The display names are USD Coin, Euro Coin, and Circle Wrapped Bitcoin. The addresses match Circle's [USDC](https://developers.circle.com/stablecoins/usdc-contract-addresses), [EURC](https://developers.circle.com/stablecoins/eurc-contract-addresses), and [cirBTC](https://developers.circle.com/assets/cirbtc-contract-addresses) Arc Testnet listings. The decimals and glyphs are reused from the project's Send registry. All three use Circle's public faucet at this checkpoint; no second provider is implied.

The Faucet renders all three registry assets and looks up each balance by verified contract address. Demo mode shows an em dash instead of sample balances. Connected/watch mode uses the live Arc explorer wallet query; missing or failed data shows an em dash and recoverable error. The backend now rejects missing/malformed core explorer balances rather than returning a fabricated zero. The Refresh button refetches the wallet query for all three, shows a loading state, and reports failure. The Circle site opens in a new tab. Its asset-specific buttons identify which asset the user intends to request, while instructions explicitly tell them to select that asset and Arc Testnet on the site. The page does not claim faucet success. Copy clarifies that only USDC pays Arc Testnet gas.

## Validation

- `npm run test:brain`: 17 tests passed, 0 failed. Activity tests cover UNKNOWN/PENDING separation, proven-result retention, and locale date formatting. Faucet metadata test covers the three canonical assets, icons, contract addresses, decimals, and provider URL. Existing Send tests passed.
- `npm run type-check`: passed.
- `npm run lint`: passed with 14 existing warnings, 0 errors.
- `npm run build`: client and SSR passed, with two existing chunking notices.
- Isolated agent-browser QA: Faucet at 1280 EN/light, 1440 VI/dark, and 390 EN/light and VI/dark; Activity and detail at 1280 EN/light, 1440 VI/dark, and 390 EN/light and VI/dark. No page horizontal overflow at these widths. Long QA hash/address wrapped at 390. Pending, failed, EURC, cirBTC, and UNKNOWN detail states were inspected; UNKNOWN stayed distinct after reload. An isolated mocked wallet response changed USDC, EURC, and cirBTC balances, and Refresh fetched them together. A failed wallet read displayed unavailable balances and recovered on refresh. The cirBTC action opened `https://faucet.circle.com/` in a new tab; no request was submitted there. No QA record was added to a user browser.
- The ArcScan href for a QA hash was checked. With an isolated mocked clipboard writer, clicking Copy hash passed the exact 66-character hash. The headless browser denied operating-system clipboard readback, so actual clipboard persistence was not independently verified. No real faucet request or new Send was made. The user's previously confirmed real USDC transaction was not available in this isolated QA browser, so its post-change appearance was not independently rechecked. Connected wallet interoperability remains evidenced by the user's earlier live checkpoint and the unchanged Send execution path, not by a new live transaction in this audit.
