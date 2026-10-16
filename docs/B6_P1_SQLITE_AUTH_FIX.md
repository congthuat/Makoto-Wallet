# B6/P1 SQLite authentication correction — 2026-10-16

## Baseline and cause

PR #8 baseline: `642c63639059f30ca4851a19da7af7d810b44f17`.
[Linux CI 38880600184](https://github.com/congthuat/Makoto-Wallet/actions/runs/38880600184/job/116906131015)
recorded 99/100 backend tests: `SQLiteRateStore.increment` threw `database disk image is malformed`,
and the restart/replay test received 500 instead of the required 401. That runner used Ubuntu
24.04.5 and Node 24.21.0. On Windows Node 24.16.0, an immutable copy of the baseline passed
20 auth runs (9 tests each) and 5 full backend runs (100 tests each). The corruption was
**NOT REPRODUCED on Windows**; those passes do not invalidate the Linux failure.

The old implementation opened the same WAL database through `node:sqlite` and
`connect-sqlite3`. Actual Node module resolution selected the adapter's nested
`sqlite3@5.1.7` (SQLite 3.44.2), rather than the unused top-level `sqlite3@6.0.1`
(SQLite 3.52.0). Local Node 24.16.0 embeds SQLite 3.53.0.

[SQLite's official corruption guidance, sections 2.2–2.3](https://sqlite.org/howtocorrupt.html#multiple_copies_of_sqlite_linked_into_the_same_application)
explains the defect: independently linked SQLite copies do not share their process-global
POSIX lock bookkeeping. Same-process connections can bypass each other's writer locks;
closing a connection from one library can also invalidate another library's locks.
Windows uses different locking primitives. Different SQLite version numbers alone do not
prove incompatible database/WAL formats, and the historical WAL-reset bug is not claimed
as the established cause of this CI incident.

`backend/scripts/sqlite-locking-probe.cjs` isolates the mechanism in disposable files:
one connection holds `BEGIN IMMEDIATE` while a second attempts a writer transaction.
It compares built-in/built-in, legacy/legacy, both mixed directions, and separate files.
If locks are bypassed, it records both commits, surviving rows, and integrity checks.
The optional `sqlite_diagnostics` workflow-dispatch input installs the exact legacy driver
only in runner temporary storage. Inspect its Linux JSON output to distinguish observed
lock failure/data loss from a hypothesis; a Windows pass cannot establish Linux behavior.

## Runtime change and compatibility

- `SQLiteSessionStore` implements the Express Store get/set/destroy/touch contract on the
  existing auth `DatabaseSync` handle. `express-session`, SIWE, and `express-rate-limit`
  remain the maintained middleware. Unused native SQLite dependencies are removed.
- Path, `sessions(sid, expired, sess)`, challenge schema, rate-limit schema, signed-cookie
  format, secret, TTL, and atomic SQL are unchanged. No migration, copying, truncation,
  database replacement, or automatic corruption repair occurs. Valid old sessions and
  outstanding challenges survive restart with the same configured secret/origin.
- Initialization fails synchronously and closes its handle on error. `ready` remains an
  awaitable compatibility promise. Close is idempotent, cancels the owned cleanup timer,
  and closes one handle after HTTP requests have drained. There are no queued native
  SQLite worker-thread writes. SQLite owns WAL recovery/checkpointing.
- Session-read, rate-limit, nonce-read/consume, and explicit session-save failures before
  response completion return sanitized `503 TASK_AUTH_UNAVAILABLE`. The partially
  authenticated request session is discarded before sending that error, preventing an
  automatic save retry or authentication-cookie issuance. Nonces are never unconsumed
  to retry a failed authentication.
- Express can report an automatic end-of-response touch failure after a response has
  already completed. Such failures are logged by code only; an incomplete response is
  aborted. A completed response cannot retroactively become 503. Session validation
  already succeeded before that touch; verification still requires the explicit,
  awaited nonce-consume and rotated-session save. Background cleanup failures are also
  logged and never enable authentication or bypass rate limiting.

SIWE exact-message, wallet/session binding, domain, URI, scheme, chain, issued-at,
expiry, atomic one-use consumption, session rotation, origin/header checks, rate
thresholds, and cookie protections retain their existing behavior. Swap/Bridge and
frontend source are unchanged. No real wallet or blockchain transaction is used in QA.

## Regression and operational evidence

The final targeted group contains 25 tests, including nested fault cases; the full
backend contains 116. Coverage includes two independent auth instances, two actual
Node processes, concurrent same-nonce verification (exactly one 200, one 401), replay
401, restart persistence, concurrent 20/21 rate thresholds with exact persisted
counters, legacy data, repeated overlapping connections, integrity checks, WAL
checkpoint/recovery, corrupt startup, failed initialization, malformed session JSON,
and write/consume faults. Session store tests assert asynchronous single callbacks
and that touch cannot resurrect expired/destroyed sessions.

Final Windows validation passed 20 consecutive targeted runs (500/500 test
executions) and 5 full backend runs (580/580). Earlier 20 auth/store runs also
passed 420/420 and exercised 240 overlapping restart cycles. These local results
are recorded separately from Linux CI and do not establish the POSIX negative
control's result.

Racing cross-process final closes can leave harmless WAL/SHM sidecars. An initial
new test incorrectly required immediate removal and failed on Windows. Its corrected
assertion first reopens the same database, requires `integrity_check = ok` and a
TRUNCATE checkpoint `{busy:0, log:0, checkpointed:0}`, then closes and checks cleanup.
Original failure logs were preserved; no runtime workaround or file deletion hides it.

Local logs and result manifests are under `validation-qa/b6-p1-sqlite/`: immutable
baseline, fault-injection failures discovered during implementation, stability runs,
frontend checks, independent security reviews, and subsequent GitHub run metadata.
The workflow runs the targeted group 20 times and the full backend 3 times on Linux
Node 24, alongside the unchanged full frontend CI. Evaluate the checks on the exact
[PR #8 head](https://github.com/congthuat/Makoto-Wallet/pull/8/checks), not a previous rerun.

Frontend local verification: 533/533 tests, TypeScript, lint, and client/SSR build pass.
The 12 pre-existing lint warnings are unchanged; existing Vite import/chunk warnings
remain. After removing unused drivers, npm reports 9 backend vulnerabilities
(6 moderate, 2 high, 1 critical), compared with 17 before; frontend npm reports 25
(7 low, 8 moderate, 10 high). This change does not claim a clean dependency audit.

For an upgrade, stop **all** old backend workers before starting the new version;
do not mix the old and new adapters against one file during a rolling upgrade. Keep
the original database and any live WAL/SHM files together. Existing corruption needs
operator investigation and a consistent SQLite backup/restore, never automatic deletion.
Same-host workers must share the file and secret on a filesystem with working local
SQLite locks. This correction does not add multi-host/network-filesystem support.
