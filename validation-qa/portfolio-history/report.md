# Real portfolio history verification — 2026-10-01

Implemented and verified in the canonical local Makoto runtime. Home and Portfolio
now render the existing chart style from backend-persisted real wallet snapshots.
No runtime history fixtures, copied-backward points, seeded history, or fake
prices were inserted. No commit, push, deployment, wallet signature, or blockchain
transaction was performed.

## Requested 38-item report

| # | Item | Result |
| --- | --- | --- |
| 1 | Previous empty-state cause | Home and Dashboard rendered the localized empty state because Makoto had no persisted portfolio observations. The former store series multiplied current holdings by asset price history; the CoinGecko adapter intentionally supplied empty price-history arrays. That could not represent historical wallet balances. |
| 2 | Existing chart code | `frontend/src/components/wallet/charts.tsx` already contained lightweight SVG Sparkline/AreaChart components. Reused their styling and SVG rendering, adding actual timestamp geometry and tooltip selection. No chart dependency was added. |
| 3 | Existing mock/demo data | Disconnected sample-mode `DEMO_BALANCES` and `DEMO_ACTIVITY` remain explicitly sample-only. The former reconstructed portfolio series was removed. No random/seeded/mock portfolio series was found supplying the connected chart; sample/watch/disconnected modes cannot collect history. ShareCard also uses recorded 1D points. |
| 4 | Database used | Dedicated `backend/data/portfolio-history.sqlite`, configurable with `PORTFOLIO_HISTORY_DB_PATH`; existing `node:sqlite` persistence conventions, WAL, 5,000 ms busy timeout and transactional idempotent schema. Task/auth tables were not changed. |
| 5 | New history schema | `portfolio_history`: UUID `id`, `owner_key`, normalized `wallet_address`, integer `chain_id`, UTC `captured_at`/epoch `captured_at_ms`, unrounded REAL `total_usd`, `asset_payload_json`, `price_provider`, `price_status`, UTC `price_observed_at`, `balance_observed_at`, `created_at`. Unique owner/address/chain/capture-time key plus scope/time and retention indexes. Asset payload retains contract identity, raw balance/decimals, display balance, price, USD value and provider metadata. |
| 6 | Snapshot source of truth | Server reads the same Arc explorer wallet helper and normalized CoinGecko adapter as the current UI. Both valuations use `shared/portfolioValuation.mjs`. POST accepts only wallet address and chain ID, rejecting caller totals/prices/balances/timestamps. Successful capture returns exact observations to the UI caches. All six live stored totals recomputed exactly from their asset inputs. |
| 7 | Snapshot cadence | First complete fresh connected portfolio immediately; then at least 300,000 ms between successful captures for the same owner/address/chain. Driven by existing 20-second wallet polling and active visible app usage. Failed attempts are bounded; no independent permanent background collector or early balance-change bypass. |
| 8 | Dedupe behavior | In-flight request sharing plus SQLite transaction/latest-row checks enforce cadence, including competing services using the same file. No per-render rows or short-interval duplicates. Identical values after five minutes are retained as genuine new observations. |
| 9 | Retention policy | 366 days raw retention and at most 105,409 rows per owner/address/chain dataset. Cleanup on history access/capture, no new scheduler. Display responses select at most 2,048 exact rows using first/min/max/last chronological buckets; raw values are never averaged or replaced by synthetic points. |
| 10 | Wallet isolation | Owner + lowercase address + chain scopes every query/write. Frontend scope guards and separate query keys hide the old dataset immediately on account change; stale responses are ignored. Tests cover A/B/A retrieval and independent browser tenants. Local ownership is an opaque HttpOnly SameSite=Strict browser capability, with exact loopback-origin/peer/header checks; nonlocal/production requires the existing verified matching wallet session. No mandatory Home SIWE flow was introduced. |
| 11 | Chain isolation | New captures and current frontend support Arc Testnet `5042002` only. GET accepts another positive chain ID as a separate dataset, normally empty; Testnet points never appear in Mainnet/other-chain results. Unknown/disconnected frontend chain cannot expose or capture history. |
| 12 | Price freshness rule | Only valid positive CoinGecko prices with normalized `FRESH` status, verified provider asset/source identities and observation age at most five minutes; all three known asset prices are required even for zero holdings. Balance observation age is at most 30 seconds. Missing/STALE/UNAVAILABLE/partial/failed/non-finite inputs produce no row. Current display can still use its existing last-known-good STALE behavior. |
| 13 | First snapshot behavior | Exactly one real point persisted. Live VI displayed “Đang bắt đầu ghi lịch sử số dư.”; EN displayed “Starting to record balance history.” No earlier copied point or fabricated line. Reload retained the one-point state without a premature duplicate. |
| 14 | 2+ snapshot chart behavior | Second live observation, 303.471 seconds after the first, replaced the starting state with the real chart. X uses elapsed capture timestamps; Y uses unrounded recorded USD totals. Tooltip selects only actual stored observations, with local browser date/time, currency and keyboard navigation. Current 24h market-price move remains separate. |
| 15 | 1D | Rolling trailing 24-hour UTC capture filter. Boundary tests and live range button passed; only actual selected points returned. |
| 16 | 1W | Rolling trailing seven-day UTC capture filter. Boundary tests and live range button passed. |
| 17 | 1M | Rolling trailing 30-day UTC capture filter. Boundary tests and live range button passed. |
| 18 | 1Y | Rolling trailing 365-day UTC capture filter. Boundary tests and live range button passed. |
| 19 | ALL | All retained real observations, within the 366-day retention policy. Tests and live range button passed. Today's short dataset truthfully appears in all five ranges; older range boundaries use isolated test observations. |
| 20 | VI result | Home and Portfolio charts, range controls, one-point copy, loading/error/retry copy, caption and local tooltip work in VI. Live blocked-history QA displayed “Không thể tải lịch sử số dư.” while the current total stayed available; restoring the request restored the chart. |
| 21 | EN result | Home and Portfolio charts, ranges, one-point copy and tooltip verified in EN; localized loading/error copy is covered by the shared dictionary/state path. VI → EN → VI updates the visible interface. |
| 22 | Dark result | Existing green SVG styling remains legible inside both cards, with scoped dark tooltip/line colors. All three widths and both languages passed. |
| 23 | Light result | Scoped darker green chart line/area and white tooltip with dark text preserve contrast. Final light-mode mobile tooltip was visually inspected after the contrast fix. All three widths and both languages passed. |
| 24 | 1440 result | Four language/theme combinations × Home and Portfolio passed: contained charts, five controls, 0px document/card overflow, chips/actions unobscured. |
| 25 | 1280 result | Same eight Home/Portfolio surface checks passed with contained charts and 0px document/card overflow. |
| 26 | 390 result | Same eight surface checks passed; readable charts/tooltip and no horizontal scrolling or chip/action overlap. Home uses 80px chart height; Portfolio uses 170px. Total responsive matrix: 12 combinations / 24 surface checks. |
| 27 | Reload persistence | Multiple real browser reloads retained the first point and then the growing chart. History is backed by SQLite, not React memory or localStorage. |
| 28 | Backend restart persistence | Canonical local runner/backend restarted, same browser tenant recovered the existing real point, and subsequent captures appended after the interval. Automated close/reopen test independently verifies SQLite durability. Services remain available locally. |
| 29 | Files added | Nine implementation/test files plus feature documentation, this report and QA evidence. Exact paths below. |
| 30 | Files modified | Two additive backend reader exports/provenance changes, existing frontend store/chart/card/localization/styles/test script, and Project State documentation. Exact paths below. Generated client/SSR build outputs and TypeScript incremental metadata were regenerated. This workspace has no Git metadata, so no exact repository diff is claimed. |
| 31 | Tests added | 46 backend history/service/API/ownership/range/invalid-input tests and 17 frontend valuation/scope/state/request/render/geometry tests: 63 focused tests. Synthetic observations use isolated temporary test databases only. |
| 32 | Exact test totals | Frontend Brain 17/17; Agent 11/11; Tasks/auth 10/10; migration 82/82; portfolio 17/17; backend full suite 97/97 (46 new + 51 existing). Total **234/234 passed**, zero failures/skips. |
| 33 | Type-check | Frontend `npm.cmd run type-check` passed. |
| 34 | Lint | Frontend passed with 0 errors and 12 inherited warnings. Changed backend files passed with 0 errors and two inherited `eqeqeq` warnings in the existing prices adapter, using the frontend's installed ESLint runner/config. No new dependency was installed to repair the incomplete standalone backend lint setup. |
| 35 | Build | Final Vite client and SSR builds passed. Existing mixed static/dynamic import notices for Dashboard/Insights and the existing 551.24 kB Circle `/next` chunk warning remain; no new chart package or dependency expansion. |
| 36 | Browser console | Clean final reload: **0 console errors**. The intentional blocked-history test emitted expected failed-request errors, then blocking was removed and the clean restored state was checked separately; see `console.json`. |
| 37 | No fake/backfilled history | Confirmed. Runtime SQLite read-only inspection found only six fresh observations collected during actual app use, starting at `2026-10-01T07:55:29.613Z`; every value exactly recomputes. No pre-start dates, manual rows, mock history, copied-backward values, unavailable-price zeros, or fixture writes in the runtime history DB. |
| 38 | Remaining limitation | Collection requires a connected confirmed wallet, Arc Testnet, active visible app and complete fresh sources. History starts when recording starts; ALL is retained history. Clearing/changing the local browser capability/profile loses access to its prior tenant. Local access proves browser possession, not private-key control; public deployment and multi-host storage were not verified. Actual wallet-extension account/network switching was not performed; immediate frontend scoping and backend A/B/chain isolation were verified with focused tests. No functional blocker remains for the requested local history implementation. |

## Real runtime observations

Wallet: `0x16299b74c616994eaecb9b20e37d369d5d62586b`; chain: `5042002`.
The inspection below read the normal SQLite file without writing or seeding it.
Prices changed naturally during QA, so the initial example `$368.24` was not
treated as a fixed expected total.

| Captured at (UTC) | Unrounded total USD | UI rounding | Recomputed exactly |
| --- | --- | --- | --- |
| 2026-10-01T07:55:29.613Z | 368.216908863536 | $368.22 | Yes |
| 2026-10-01T08:00:33.084Z | 368.1413069159122 | $368.14 | Yes |
| 2026-10-01T08:05:40.429Z | 368.1413069159122 | $368.14 | Yes |
| 2026-10-01T08:10:56.544Z | 368.1720457583425 | $368.17 | Yes |
| 2026-10-01T08:16:00.406Z | 368.114135073923 | $368.11 | Yes |
| 2026-10-01T08:21:15.356Z | 368.1061185741436 | $368.11 | Yes |

First observed inputs: EURC `161.584986 × 1.13`, USDC
`127.1841989187879 × 0.999863`, cirBTC `0.0007 × 83513`, sorted/reduced by
the shared canonical valuation. Raw native USDC retains 18 decimals; verified
ERC20 balances retain their six/eight decimal units. The exact saved total was
`368.216908863536`. The local Bangkok tooltip showed the first two capture times
as 14:55 / 15:00 on October 1, with $368.22 / $368.14. Storage remains UTC.

The running visible app may append additional fresh real snapshots after this
report's read-only checkpoint; the chart is expected to keep progressing.

## Files

Added implementation/test files:

- `backend/lib/portfolioHistory.js`
- `backend/routes/portfolio.js` (auto-discovered by the existing Surf server route convention)
- `backend/tests/portfolio.test.js`
- `shared/portfolioValuation.mjs`
- `shared/portfolioValuation.d.mts`
- `frontend/src/lib/portfolioHistory.ts`
- `frontend/src/lib/portfolioHistory.test.ts`
- `frontend/src/lib/chartGeometry.ts`
- `frontend/src/components/wallet/PortfolioHistoryChart.tsx`

Modified source/documentation:

- `backend/routes/arc.js`
- `backend/routes/prices.js`
- `frontend/src/lib/store.tsx`
- `frontend/src/lib/wallet.ts`
- `frontend/src/components/wallet/charts.tsx`
- `frontend/src/components/ShareCard.tsx`
- `frontend/src/pages/Home.tsx`
- `frontend/src/pages/Dashboard.tsx`
- `frontend/src/lib/i18n-extra.ts`
- `frontend/src/index.css`
- `frontend/package.json`
- `docs/PROJECT_STATE.md`

Added documentation: [PORTFOLIO_HISTORY.md](../../docs/PORTFOLIO_HISTORY.md) and this
report. Added runtime data is the feature's dedicated SQLite file/WAL state;
historical values are not a source-code fixture. CoinGecko key/mode, price mappings,
cache/fallback behavior, attribution and transaction/auth implementation modules
were preserved. No Send, Swap, CCTP, Bridge, Policy/Risk, Strategy Controller,
Activity truth, Agent, Tasks, SIWE or Automation code was edited.

## Evidence

- [Final connected Home, VI dark](final-home-card-vi-dark.png)
- [First real snapshot / starting state](first-real-snapshot.png)
- [Home, 1440 EN dark](real-chart-1440-en-dark.png)
- [Portfolio, 1440 EN dark](real-portfolio-1440-en-dark.png)
- [Final mobile light tooltip, VI](real-tooltip-390-vi-light.png)
- [Truthful history error state](history-error-vi.png)
- [24 responsive measurements summary](matrix.json)
- [Five live ranges](ranges.json)
- [Six real rows and complete recomputation evidence](live-observations.json)
- [Clean final browser console](console.json)

Earlier `real-portfolio-390-*-light.png` captures precede the final contrast fix;
the final tooltip screenshot and matrix are the post-fix evidence.

REAL PORTFOLIO HISTORY VERIFIED — CHART USES PERSISTED WALLET DATA
