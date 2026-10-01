# Task execution claims

This design coordinates Node workers that open **the same SQLite file on one host**. It uses the documented [SQLite `BEGIN IMMEDIATE` transaction](https://www.sqlite.org/lang_transaction.html), [WAL single-writer behavior](https://www.sqlite.org/wal.html), [busy timeout](https://www.sqlite.org/c3ref/busy_timeout.html), and [unique indexes](https://www.sqlite.org/lang_createindex.html). It is a database-backed same-file claim, not a network distributed lock. The [Node 24 `node:sqlite` driver](https://nodejs.org/download/release/v24.16.0/docs/api/sqlite.html) opens the file with a finite 5,000 ms busy timeout and enables WAL plus foreign keys. `INSERT OR REPLACE` is avoided because [SQLite can delete a conflicting row](https://www.sqlite.org/lang_conflict.html).

## Claim and occurrence

Each process has an ephemeral random worker ID. `task_claims` has one row per task with `run_id`, `occurrence_key`, random `claim_token`, `worker_id`, `lease_until_ms`, and source. A scheduled occurrence key is deterministic from task type, task ID, and the persisted `nextRunAt` instant; a manual Run now uses a fresh UUID. `runs` has a unique `(task_id, occurrence_key)` index. Notifications link to `run_id` with a unique index.

In a short `BEGIN IMMEDIATE` transaction, a worker re-reads the task, confirms it is authenticated-owner-backed, active, and due, checks any existing claim, then inserts or reclaims the one run row and writes its token/lease. A second worker sees the unexpired claim and skips the scheduled attempt. It commits **before** Arc RPC, Surf, explorer, or optional language-provider calls. No database write transaction spans those network waits.

The normal lease is 120 seconds. While an external read is in progress, a conditional heartbeat extends it every third of the lease duration only for the same task/run/token. This matters because provider reads have different timeouts and optional price calls have no single overall task deadline. Completion opens another short transaction and checks the claim token before changing task state, run result, or notification. A stale worker loses the fence and discards its result. Task edit, pause, resume, and delete also check for an active claim transactionally.

Monitor result, previous condition state, `triggerCount`, run status, and an edge-triggered notification commit together. The unique notification/run link prevents two committed alerts for one occurrence. A successful daily automation similarly commits one notification for its run. Existing exact balance comparison, false-to-true monitor semantics, timezone schedule, and one-day catch-up policy remain unchanged.

## Crash and restart

A worker crash leaves a lease that can expire. Another worker can reclaim a scheduled occurrence and retry the **same** run row with an incremented attempt count. A retry can repeat a read-only provider call; the guaranteed invariant is one committed result and at most one notification for that occurrence, not one physical network request. Token fencing prevents the old worker from finalizing after the retry claims it. Startup does not mark another process's live claim failed or rewrite its due time. Expired manual claims are failed rather than automatically retried, because Run now was a one-time user request. Orphaned older RUNNING rows without claims are marked interrupted.

Legacy tasks with no authenticated `owner_address` are quarantined and never selected by the scheduler. Scheduler execution is backend-driven using persisted ownership and never needs or impersonates an active browser session. The scheduler holds no wallet signer and performs no blockchain write.

## Topology and proof boundary

| Deployment shape | Claim conclusion |
| --- | --- |
| One Node process, persistent local SQLite | Supported. |
| Multiple processes on one host, same SQLite file, working local locks | Supported by the atomic claim and multi-process test. All processes must also share the session secret and auth SQLite file for user-facing auth. |
| Different hosts using a network-mounted WAL SQLite file | Unsupported by SQLite WAL's same-host requirement. |
| Different hosts or containers with local/ephemeral files | Unsafe: same pathname does not mean same database. |
| Managed shared database/queue | Requires a real selected service, transaction semantics, session store, and adapter tests; none is configured in this repository. |

The public deployment topology is not documented, so this local claim proof does not establish public multi-host readiness. A shared managed datastore/queue may be required once the actual target is known. The waitlist's external Drizzle/Postgres schema is not a configured task store.

## Verification record

`node --test tests/claims.test.js` passed on 2026-09-30 using temporary SQLite files and independent Node worker processes. The tests did not open or migrate `backend/data/tasks.sqlite`.

| Check | Observed result |
| --- | --- |
| Same-file stress | 100 two-process races against 100 due occurrences: 50 daily automations and 50 balance monitors. Each monitor first completed a separate false observation, then the workers raced on the false-to-true observation. |
| Execution and persistence | 100 scheduled read executions, 100 successful scheduled runs, 0 duplicate executions, 0 duplicate run rows, 0 duplicate notifications, 0 worker errors, and 0 SQLite lock/busy errors. Each monitor ended with `triggerCount = 1` and one alert. |
| Database settings | The temporary file reported WAL mode and a 5,000 ms busy timeout. Claim and completion use short `BEGIN IMMEDIATE` transactions; the provider read is released only after the competing worker has attempted its claim. |
| Worker crash | After worker A was killed during its read, worker B could not claim before lease expiry. After expiry it reused the same run row (`attempt_count = 2`), committed one success and one notification, and removed the claim. |
| Heartbeat and stale token | A renewed lease kept a competing worker out during a long read. In a separate expired-lease race, the old worker's token could not finalize; the replacement committed the only monitor result and alert. |

The enforced persistence invariant is one committed result and at most one notification per occurrence. Crash recovery can repeat a read-only provider call. This evidence applies to processes sharing one SQLite file on a host with working local SQLite locks; it does not establish multi-host coordination or uninterrupted delivery when the backend is off.
