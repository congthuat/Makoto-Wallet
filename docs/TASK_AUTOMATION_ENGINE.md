# Task monitoring and automation engine

## Runtime audit

| Existing piece | Before this work | Decision |
| --- | --- | --- |
| `frontend/src/lib/store.tsx` task list and `mk.tasks.v3` | Local demo: four seeded rows and browser-only status | Replace its task data source with the backend API; old sample rows are not migrated as live jobs. |
| `Tasks.tsx`, Home task card, Agent task proposal | UI only or local demo | Keep the current surfaces and connect them to the canonical task API. |
| `scenarios.ts` fixed task proposals | Local demo and obsolete for live Tasks | Do not use a fixed example to create a background job. |
| Settings transaction-alert toggle and App notification popover | Activity-derived browser UI | Keep Activity alerts and add persisted task notifications. |
| `@surf-ai/sdk/server` `/api/cron` | Active *admin* cron facility with JSON handler paths and bearer authentication | Do not use it for user prompts. It cannot enforce Makoto's typed task, account, notification, and wallet authority boundaries. |
| Backend task persistence, condition checks, run history | Missing | Add one Makoto task engine and SQLite store. |

The backend's `arc/wallet` response is for display: it converts balances to JavaScript numbers, and its helper can turn malformed values into zero. Task thresholds use exact integer units from read-only Arc RPC calls instead. The browser Tool Layer has exact ERC-20 reads but needs an injected wallet and therefore cannot run while the browser is closed.

## Architecture and libraries

```text
Home / Agent / Tasks review
  -> /api/tasks (typed parser and CRUD)
  -> SQLite tasks, runs, notifications
  -> backend tick and timezone-aware next-run calculation
  -> allowlisted Arc READ calls and optional market prices
  -> deterministic condition or summary result
  -> persistent in-app notification
  -> Tasks page and header popover
```

The bundled SDK already includes Croner, but its `/api/cron` handler runner is unsuitable for user-defined jobs. The task engine declares **Croner 9.1.0** directly and uses its timezone-aware `nextRun` calculation for daily schedules. `node-cron` was considered, but Croner is already compatible with this runtime and exposes the next occurrence directly. Scheduling state, missed-run policy, task safety and SQLite transactions remain Makoto code. Persistence uses Node's built-in `node:sqlite` on the observed Node 24 runtime; the existing Drizzle/Postgres schema is for a waitlist and depends on an externally unavailable provider. The local SQLite file is a development store, not a remote service.

References: [Croner documentation](https://github.com/Hexagon/croner), [Node SQLite documentation](https://nodejs.org/api/sqlite.html).

## Typed definitions and state

Two task types are accepted: `CONDITION_MONITOR` and `SCHEDULED_AUTOMATION`. A monitor's only condition is an allowlisted `TOKEN_BALANCE` asset (`USDC`, `EURC`, `cirBTC`), operator (`LT`, `LTE`, `GT`, `GTE`), exact decimal threshold and check interval. A schedule is a daily local `HH:mm` plus one allowlisted action: `PORTFOLIO_SUMMARY`, `ACTIVITY_SUMMARY` or `BALANCE_CHECK`. No task record can contain executable code, arbitrary URLs, calldata, signer, keys or authorization headers.

Each stored task has `id`, `type`, `title`, `description`, `status`, `authority`, `createdAt`, `updatedAt`, `account`, immutable authenticated `ownerAddress`, `chainId`, `timezone`, `sourceIntent`, `locale`, `condition` or `schedule`, `nextRunAt`, `lastRunAt`, `lastResult`, `lastError`, `triggerCount`, `createdBy`, and the monitor's previous condition state. The account and owner are normalized to a 20-byte address and the chain is Arc Testnet (`5042002`). The definition is revalidated on create and edit; clients cannot supply arbitrary runtime state. Identical definitions are rejected per owner rather than silently duplicated. Pre-auth rows with no verified owner remain quarantined.

Current jobs have `NOTIFY_ONLY` authority and `ACTIVE` or `PAUSED` operational status. A monitor trigger increments `triggerCount` and records a result; it remains active for future crossings. A failed read is recorded as a failed *run*, not a zero balance or a successful task. The task remains eligible for the next check. Each run records task ID, start/end, source, status, safe result metadata and error code.

## Monitors and read evidence

The backend checks `eth_chainId`, the token contract code/decimals/symbol and `balanceOf` through allowlisted RPC methods. It compares raw `BigInt` token units against a threshold converted at the verified asset precision (USDC/EURC 6; cirBTC 8). Arc exposes native USDC at 18 decimals and an ERC-20 interface at 6 decimals over the same asset; the monitor uses the ERC-20 interface, matching Makoto's exact browser Tool Layer. A missing or invalid read produces `TASK_DATA_UNAVAILABLE` or a provider/network error and never silently becomes zero.

Monitor notifications are edge-triggered: false to true triggers; true to true does not; true to false rearms; a later false to true can trigger again. On the first check after creation or restart, a currently true condition may notify as a **current observation**. The engine does not claim a historical crossing time while it was offline. The default check interval is two minutes, configurable per task within validated bounds. A single backend scheduler tick discovers due jobs; it does not create one timer per task.

Incoming/outgoing Activity monitoring and balance-changed events are not enabled. The existing explorer endpoint only provides a recent transfer page and browser-local protocol records are unavailable to backend jobs. Reliable event monitoring needs a persisted indexed cursor and a defensible backfill boundary. The daily Activity summary reports recent *explorer-indexed* transfers and marks incomplete or unavailable data; it does not claim complete wallet history.

## Daily schedules and summaries

The browser captures the IANA timezone at creation. A daily time is interpreted in that stored timezone, including daylight saving changes; it is never advanced by a fixed 24-hour interval. Croner calculates the next instant. A paused task has no due run; resume and definition edits calculate a fresh next occurrence.

On backend startup, monitors are checked from the current state. For a daily schedule, at most one missed run is caught up if its due time is within the past 24 hours; older missed occurrences are skipped and the next future occurrence is scheduled. There is no replay of historical runs. Backend shutdown or a computer being off means no checks can happen then. The browser may close while the local backend stays running.

Portfolio summaries read supported balances, available Surf prices and recent explorer Activity. Partial pricing or Activity is identified explicitly; no missing price is substituted with a fabricated value or total. A daily balance check needs balances only. The structured balances, prices, Activity status, and notification text are deterministic. Scheduled results can also contain a bounded language summary from the existing server-only LLM adapter. Its input contains observed, bounded display rows and excludes the account, transaction hashes, signer, and raw Activity. Provider failure yields a deterministic language fallback; it does not stop the run or change observed facts, the next run, or the notification. A scheduled successful result creates a stored notification. An unavailable Activity source is reported as unavailable, not as zero transactions.

## Review, notifications and authority

Natural-language task text goes through a bounded deterministic parser. It returns a typed candidate or missing fields; the backend validates all fields again before storage. The Agent/Home/Tasks UI shows account, Arc network, threshold or daily time, timezone, cadence and data scope before a separate **Create task** click. No Agent turn silently starts monitoring. The existing conversational LLM may phrase a scheduled summary, but has no numerical, condition, scheduling, persistence or wallet authority. The UI presents this language separately from structured observations. Task execution does not depend on the LLM provider.

Conditional or recurring Send, Pay, Swap, Bridge, approval, purchase, withdrawal, staking, deposit, mint, burn, redemption, lending, borrowing and repayment requests are classified `PREPARE_ONLY` / `TASK_WRITE_REQUIRES_USER` and do not become executable background jobs. This implementation does not schedule financial proposals. Any future proposal must still go through Planner, deterministic Policy/Risk, review and the user's wallet signature. The scheduler has no signer or transaction writer and makes no `eth_sendTransaction` call.

Notifications and run records survive a backend restart in SQLite. The task list and alert history poll the API; basic in-app delivery needs no browser notification permission. Browser/OS push while closed is not claimed. Task deletion removes its stored definition and associated history. The existing Activity popover remains a separate source.

## Development boundary and verification

The task API now requires explicit ERC-4361 wallet verification, a persistent Express session, exact-origin mutation protection, and server-side owner-scoped SQL. See [task auth and ownership](TASK_AUTH_AND_OWNERSHIP.md). A claim table, occurrence uniqueness, token-fenced lease, and notification/run uniqueness coordinate processes sharing one local SQLite file; see [task execution claims](TASK_EXECUTION_CLAIMS.md). Neither a SIWE session nor a task record contains signing authority. Public multi-host readiness remains gated by the actual deployment topology and a genuinely shared datastore.

The 2026-09-30 security continuation verified two-wallet API isolation and a 100-race, two-process same-file claim test using temporary SQLite files. It produced one scheduled execution and one committed result per occurrence, with zero duplicate notifications or SQLite busy errors. The inherited task/scheduler suite still passes 17/17, including false-to-true monitor edges, daily catch-up, restart persistence, edit/pause/resume/delete, optional language fallback, and `PREPARE_ONLY` rejection of recurring financial writes. The normal `backend/data/tasks.sqlite` was left untouched; it still contains two pre-auth rows and will be migrated to quarantined null owners when next opened by the current engine. These checks do not establish continuous delivery while the backend is off or any multi-host production guarantee.

In isolated offline browser QA, fixture Wallet A created, listed, fetched, edited, paused, resumed, ran, and deleted a monitor through the authenticated UI. Editing its threshold to USDC below 700 with a fixture balance of 600 produced exactly one visible alert. Fixture Wallet B could not see or run A's task. The browser Automation flow was not repeated in this continuation; daily scheduling, persistence, and notification behavior were rechecked by the 17 passing task/scheduler tests. No live chain read or wallet transaction occurred in this browser QA.

Public read-only Arc `eth_chainId` and dummy-address token metadata/balance reads succeeded. The 2026-09-30 browser run also observed a USDC balance through the live Arc read adapter for a watch-only public address. This proves read connectivity only; it does not prove account ownership, connected-wallet holdings, uninterrupted scheduled delivery, or a transaction. The browser used an isolated SQLite task database. Exact 600 → 490 → 480 → 510 → 495 monitor behavior, provider failure, timezone scheduling, and deterministic language fallback use injected fixture reads in the backend suite.

| Final QA evidence | Result and scope |
| --- | --- |
| Home monitor | Exact Vietnamese USDC-below-500 prompt → review → explicit creation → persisted monitor and updated Home/Agent task cards. The live observed balance was above 500, so no alert was expected then. |
| Home automation | Exact Vietnamese daily-08:00 portfolio prompt → timezone-aware review → explicit creation → stored next run. Manual Run now stored structured balances, an optional labelled language summary, and one in-app notification. Unavailable pricing produced no estimated total. |
| Alert edge and delivery | An edited threshold of 5000 turned a live observation true and created one alert. A further manual run while true created no duplicate. Another backend restart restored one active monitor with one trigger and one notification. The Tasks history and header popover showed the same alert. The exact five-value crossing sequence remains fixture evidence. |
| Restart and CRUD | Pause survived restart with no due run; resume recalculated the next time; an 08:00 → 09:00 edit survived another restart under the same ID; delete after restart removed the task and notification, and a further restart did not restore it. Automation run and notification counts stayed at one through the restarts. |
| Financial authority | The live parser API classified conditional Swap and Pay as `PREPARE_ONLY` / `TASK_WRITE_REQUIRES_USER`. The scheduler/read modules have no signer or transaction-write call. |
| Deployment boundary at the earlier QA checkpoint | The earlier single-process check found a duplicate-execution race. The subsequent auth/owner and same-file claim work is documented in [task auth and ownership](TASK_AUTH_AND_OWNERSHIP.md) and [task execution claims](TASK_EXECUTION_CLAIMS.md). The prior browser evidence did not prove the new SIWE flow. |

The [12-cell responsive matrix](qa-monitor-automation-responsive-matrix.md), browser errors, and fresh regression totals are in `PROJECT_STATE.md` and its linked QA evidence. If the local computer or backend is off, no check or delivery occurs then; restart recovery follows the policy above. A provider or Surf pricing failure stays an explicit unavailable state and never becomes a fabricated value.
