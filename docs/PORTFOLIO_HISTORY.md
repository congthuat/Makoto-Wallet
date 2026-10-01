# Real portfolio balance history

Makoto records observations from the time this feature starts. It never seeds,
backfills, randomizes, or reconstructs earlier wallet balances. A price history
multiplied by today's holdings is not a historical wallet balance.

## Source of truth

The snapshot backend reads the same Arc Testnet explorer wallet source used by
`/api/arc/wallet` and the same normalized CoinGecko adapter used by `/api/prices`.
The shared `shared/portfolioValuation.mjs` function supplies both the current
frontend total and snapshot valuation. Existing JavaScript display-number
conventions remain; stored totals are not rounded to the UI's two decimals.
Asset balances, contract identity, decimals, price, USD value, and price
provenance are retained so a stored total can be explained and recomputed.

The write API accepts a wallet address and chain ID, not caller-supplied totals,
balances, prices, or timestamps. The backend obtains and validates observations.
The capture response includes those wallet and price observations; the frontend
updates its corresponding caches with them so the displayed capture total uses
the same inputs.

Only complete, finite, nonnegative portfolios can be recorded. Required verified
assets must have valid metadata and balances. Every positive verified holding
must have a valid positive CoinGecko price with `FRESH` status and a current
observation. Failed balance reads, unknown chains, partial valuations, and
unavailable or stale prices do not create a point. The recording policy requires
all three known asset prices to be fresh, including zero holdings, so a provider
outage cannot create a zero-total point. The existing current-total display can still use last-known-good
`STALE` prices; those values are deliberately excluded from new history.

## Persistence and collection

A dedicated `backend/data/portfolio-history.sqlite` database (override:
`PORTFOLIO_HISTORY_DB_PATH`) uses the project's `node:sqlite`, WAL, 5,000 ms busy
timeout, and transactional idempotent schema conventions. It does not alter task
ownership tables. `portfolio_history` contains:

| Column | Representation |
| --- | --- |
| `id` | UUID text primary key |
| `owner_key` | Browser capability hash, or verified wallet owner key |
| `wallet_address`, `chain_id` | Lowercase address text and chain integer |
| `captured_at`, `captured_at_ms` | UTC ISO text and epoch milliseconds |
| `total_usd` | SQLite REAL using the existing unrounded valuation number |
| `asset_payload_json` | Exact observed asset inputs, values, raw units and price metadata |
| `price_provider`, `price_status` | `COINGECKO`, `FRESH` |
| `price_observed_at`, `balance_observed_at`, `created_at` | UTC ISO text |

A unique owner/address/chain/capture-millisecond key prevents duplicate instants.
The scope/time index supports ranges; a capture-time index supports retention.

Collection starts immediately when a connected, confirmed wallet on supported
Arc Testnet has a complete fresh portfolio. Further successful captures are at
least five minutes apart for the same history owner, normalized wallet address,
and chain ID. Collection is driven by active app usage and its existing wallet
polls; there is no permanent background collector. Concurrent requests are
bounded, and SQLite transactions enforce the interval across processes sharing
the file. Identical values are allowed after the interval because they are new
real observations of time progression. There is no early balance-change bypass.

Raw retention is bounded to 366 days, enough for the one-year range. A per-dataset
row cap of 105,409 also bounds unexpected high-frequency growth. Cleanup runs during
history access/capture, with no additional scheduler. `ALL` means all retained
recorded observations, not unlimited lifetime history. No averages or synthetic
points replace deleted history.

## Access and isolation

Home connection currently does not authenticate wallet ownership; SIWE is an
explicit Tasks action. History does not request a signature or impose a new
Home login. In nonproduction loopback development, an opaque server-issued
HttpOnly, SameSite=Strict browser cookie scopes the local history tenant. Only
the token's hash is used for ownership in SQLite. Exact configured loopback
frontend origin, a loopback backend peer, and the Makoto request header are
required. The Vite proxy alone is not proof of browser origin.

Within that browser tenant, all reads and writes are additionally scoped by the
normalized wallet address and chain ID. New captures and the current frontend
support Arc Testnet only; a query for another positive chain ID returns its
isolated dataset, normally empty. Another browser profile
cannot enumerate this browser's history merely by supplying the same wallet.
This local model proves browser access, not control of a wallet's private key.
Clearing the history cookie loses access to that browser tenant; the SQLite data
remains until retention cleanup. History is not stored authoritatively in
localStorage, and browser cookies are not historical-value storage.

Nonlocal/production access must use the existing verified wallet session and
match its wallet address. It fails closed without that proof. Public deployment
and multi-host SQLite operation are not claimed as verified by local QA.

Wallet changes, account confirmation loss, disconnects, or chain changes hide
the preceding dataset immediately. Arc Testnet data cannot be reused as Arc
Mainnet data. The current supported history chain is Arc Testnet (`5042002`).

## API, ranges, and UI

- `POST /api/portfolio/snapshot`: server-authoritative capture for an address and
  chain. Invalid observations do not produce rows.
- `GET /api/portfolio/history`: owner/address/chain-scoped recorded snapshots;
  ranges are `1d`, `1w`, `1m`, `1y`, and `all`.
- Range windows use UTC capture instants: trailing 1, 7, 30, and 365 days, or all
  retained data. A range does not extend the recorded time span or prepend a
  value. Responses contain at most 2,048 exact recorded points. For longer
  datasets, chronological buckets retain first, minimum, maximum, and last
  observations, preserving extremes without averaging or inventing values.
  `totalSnapshots`, `rangeSnapshots`, and `downsampled` explain the display
  selection; the raw retained database observations are unchanged.

No snapshots show “No balance history yet” / “Chưa có lịch sử số dư.” One point
shows “Starting to record balance history” / “Đang bắt đầu ghi lịch sử số dư.”
Two or more actual points in the selected range show the existing SVG chart,
with real capture times on X and total USD on Y. Loading and backend failures
have separate localized states and retry. The tooltip formats date/time in the
browser's timezone. Persistence stores UTC instants, never localized strings.

The existing Home 24h figure remains a market-price move for current holdings.
It is independent of the recorded portfolio history and must not be presented
as history performance. Existing chips, actions, CoinGecko attribution, themes,
and localization are preserved.

## Verification boundaries

Automated tests use isolated temporary databases and controlled observations.
Those fixtures are never inserted into the normal runtime history database.
Live local QA uses read-only observations for the currently connected wallet.
No signature, blockchain transaction, commit, push, or deployment is required.
The dated QA report records exact checks and any remaining limitations.
