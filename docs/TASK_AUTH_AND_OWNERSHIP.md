# Task authentication and ownership

See [public task security research](PUBLIC_TASK_SECURITY_RESEARCH.md) for the official sources, package choices, and deployment gate.

## Trust boundary

Makoto uses [ERC-4361 SIWE](https://eips.ethereum.org/EIPS/eip-4361) through `siwe@3.0.0` for task management. The browser's connected EIP-1193 wallet explicitly signs a **message** after the user selects Verify wallet. This costs no gas and submits no transaction. The server never receives a seed phrase or private key. A SIWE session proves address control for authentication; it cannot sign Send, Swap, Bridge, approvals, or any blockchain transaction. The background task engine remains read/notify and prepare-only.

The browser requests a challenge from `POST /api/auth/nonce` with its expected address and Arc Testnet chain ID `5042002`. The server constructs the exact SIWE message with the configured scheme/domain/URI, canonical address, version 1, 128-bit random one-time nonce, issued-at, and five-minute expiration. It stores the challenge in persistent SQLite, linked to the pre-auth browser session. The browser signs the returned text with `personal_sign` only after a user click, then posts the unmodified message and signature to `POST /api/auth/verify`. The server uses the SIWE library to parse and verify the signature and checks the stored message bytes, session binding, nonce, domain, URI, address, chain, issuance and expiry. An atomic conditional SQLite update consumes the nonce. A successful verification regenerates the Express session ID before storing the canonical lowercase address.

`GET /api/auth/session` returns only `{ authenticated, address }` with `Cache-Control: no-store`. `POST /api/auth/logout` destroys the server session and clears the cookie. No signature becomes a bearer credential in localStorage. Contract-wallet ERC-1271 authentication is not claimed: it needs provider-backed validation and separate tests.

## Sessions, origin, and abuse limits

`express-session@1.19.0` provides an opaque HttpOnly, SameSite=Strict cookie with a 12-hour maximum age. HTTPS origins use a Secure `__Host-` cookie. The session is stored by `connect-sqlite3@0.9.18` in `TASK_AUTH_DB_PATH`; nonce and rate-limit rows use the same persistent local SQLite file. A multi-process same-host setup must share that file, `TASK_DB_PATH`, and the same high-entropy `TASK_SESSION_SECRET`. Production must set `PUBLIC_APP_ORIGIN` to its exact HTTPS origin and configure `TASK_TRUST_PROXY_HOPS` only for a known trusted proxy. Local development defaults to `http://localhost:5173` and a temporary process secret; restart invalidates those temporary sessions.

Every auth or task mutation checks that the browser `Origin` exactly equals `PUBLIC_APP_ORIGIN` and requires `X-Makoto-Request: 1`. SameSite=Strict provides another CSRF boundary. Requests with a missing or foreign Origin are rejected, even if CORS allows a request to reach Express. `express-rate-limit@8.7.0` covers nonce, verification, and task mutations with SQLite-backed counters shared by same-file workers. A storage failure fails closed. Read endpoints still require a session.

## Owner-scoped task API

`/api/tasks` list, get, runs, notifications, parse, create, edit, pause, resume, delete, and run-now all require an authenticated session. Creation writes `owner_address` from that session, with the task account and chain validated by the existing typed task schema. A body-supplied `account`, `ownerAddress`, or `walletAddress` cannot override it. Task, run, and notification reads use owner-scoped SQL, and ID-scoped changes must select/update under `owner_address = session.address`. A foreign task ID returns a safe not-found response. The Agent's task proposal uses the same protected create route and has no independent ownership or signing authority.

The frontend fetches tasks only when an EIP-1193 account has been rechecked and matches the session address. On `accountsChanged`, it hides and clears task data until the current wallet verifies. It never rewrites the server session identity from a wallet event. A chain switch alone does not replace the authenticated identity, although creating or editing Arc tasks still follows the existing Arc task-chain validation. Logout revokes task access without disconnecting the wallet extension.

## Legacy rows

Read-only inspection on 2026-09-30 found that the default local `tasks.sqlite` still has the pre-auth schema and two task rows. An isolated migration test verifies that opening such a database adds `owner_address` with `NULL` for those rows. They then remain invisible to owner APIs and ineligible for scheduler execution; no connected wallet silently acquires them. The default database was not opened for migration during this continuation, and its existing backup was left untouched. Recreate a desired task after explicit wallet verification; any future claim flow must provide separate user review and matching account evidence.

## Operational boundary

The repository has no documented public instance topology. Same-host SQLite coordination and a persistent session store are local verification targets. Separate hosts with separate files do not share identities, sessions, nonces, tasks, or claims; SQLite WAL is not supported as a shared network-filesystem coordination mechanism. Public multi-host deployment needs a selected and tested shared datastore and matching session/claim adapter. An earlier screenshot or history may have exposed environment secrets; rotate affected keys through their providers. This document does not record their values.

## Verification record — 2026-09-30

The focused offline SIWE suite passed **9/9** and the two-wallet ownership suite passed **2/2**. It covers valid and invalid signatures, server challenge field tampering, nonce replay and expiry, persistent session expiry and logout, wrong Origin and missing custom header, explicit A-to-B re-verification, HTTPS cookie flags, and nonce/verify counters shared across independent SQLite connections. The ownership suite covers create, list, get, edit, pause, resume, delete, run-now, run and notification isolation, forged ownership fields, and the shared task-mutation limit. The frontend task/auth helper suite passed **10/10**, including explicit-only message signing and aborting when the wallet changes during signing. All wallet keys in these tests are public deterministic fixtures; no user's wallet was signed.

Isolated browser QA used real auth/task routes with temporary SQLite and offline wallet fixtures on ports 5175/3003. All 13 auth-flow checkpoints passed: wallet connection caused no signature, explicit Verify signed the server message once for A, switching to B immediately hid A's task and alert without signing, explicit B verification showed an empty list and 404 for A's GET and Run now, and logout restored the gate with API 401. A's UI task CRUD and Run now passed; browser errors and blockchain write-method calls were zero. The QA-only fixture files are in the sibling `validation-qa` directory. Those services and temporary databases were cleaned up. **READY FOR USER-AUTHORIZED SIWE TEST** means a user may separately choose to sign with a real wallet; that proof has not been performed here.
