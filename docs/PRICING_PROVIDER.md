# Portfolio pricing provider

Makoto’s canonical portfolio price route is `GET /api/prices`. It is a server-side adapter around CoinGecko’s `simple/price` endpoint. The browser receives normalized asset records only; `COINGECKO_API_KEY` is never included in frontend code, query strings, or response payloads.

## Official references

- [CoinGecko Simple Price](https://docs.coingecko.com/reference/simple-price) — one combined request, `vs_currencies=usd`, `include_last_updated_at=true`, and `include_24hr_change=true`.
- [CoinGecko Coins List](https://docs.coingecko.com/reference/coins-list) — source for verifying IDs before hardcoding them.
- [CoinGecko authentication](https://docs.coingecko.com/reference/authentication) — Demo and Pro hosts and headers.
- [CoinGecko API key setup](https://docs.coingecko.com/docs/setting-up-your-api-key) — server-side key configuration.
- [CoinGecko attribution guide](https://brand.coingecko.com/resources/attribution-guide) — the UI attribution link.

## Configuration

Set these variables in `backend/.env` (never in `frontend/.env` or a `VITE_` variable):

```dotenv
COINGECKO_API_KEY=
COINGECKO_API_MODE=demo
```

`demo` uses `https://api.coingecko.com/api/v3` with the `x-cg-demo-api-key` header. `pro` uses `https://pro-api.coingecko.com/api/v3` with the `x-cg-pro-api-key` header. Query-string authentication is not used. Missing or invalid configuration produces `COINGECKO_CONFIG_REQUIRED` records and never triggers a provider request.

## Verified mappings and response contract

The official `/coins/list` response verified these IDs:

| Makoto key | CoinGecko ID | Source label | Policy |
| --- | --- | --- | --- |
| `USDC` | `usd-coin` | `DIRECT_USDC` | Direct CoinGecko USD price |
| `EURC` | `euro-coin` | `DIRECT_EURC` | Direct CoinGecko USD price |
| `BTC` (cirBTC holding) | `circle-wrapped-btc` | `DIRECT_CIRBTC` | Direct cirBTC price only |

The adapter does not silently substitute Bitcoin for cirBTC. A BTC-backed derived price would require a separately verified backing and conversion rule; none is assumed here. Each returned record includes `provider`, `providerAssetId`, `source`, `status`, `observedAt`, and, when supplied, `providerUpdatedAt`. Price records include `price`, `change24h`, and an empty `history` array because this endpoint does not provide historical points. `change7d` is intentionally absent rather than fabricated.

## Caching and failure behavior

- One combined request is shared by concurrent callers.
- A successful response is fresh for five minutes (`PRICE_TTL_MS = 300000`).
- After expiry, a provider failure is retried once and then cooled down for one minute.
- If a previous response exists, its positive prices are returned with `status: STALE` and a `staleReason` code.
- Without a last-known-good response, assets are returned as `status: UNAVAILABLE` with a semantic error code.
- Non-finite, zero, negative, malformed, or missing values are never turned into a price.

Provider errors are normalized without exposing upstream bodies: `401/403` → `COINGECKO_AUTH_ERROR`, `429` → `COINGECKO_RATE_LIMITED`, `5xx`/network → `COINGECKO_UNAVAILABLE`, and malformed payloads → `COINGECKO_MALFORMED_RESPONSE`.

## Surf role after migration

Surf remains installed for existing server routes and task/sentiment functionality. It is no longer imported by or required for the canonical portfolio `/api/prices` route, and it is not a pricing fallback.

## Attribution and current verification

Home and Portfolio totals show a linked “Data provided by CoinGecko” attribution. The configured Demo credential was able to verify the asset list and mappings. At the time of this migration, enriched multi-asset `/simple/price` calls returned intermittent provider `401`/`429` responses, so live price restoration remains dependent on a healthy CoinGecko credential/rate limit. The route and focused tests preserve truthful unavailable/stale behavior while that provider condition is unresolved.
