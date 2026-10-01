# Phase 8–12 migration closeout — 2026-09-29

## Scope and provenance

The canonical runtime is the current Vite/React frontend and Express backend. `brain-donor-reference/` supplied reference logic only. This checkout has no Git metadata, so attribution uses the recovered file checkpoint and prior test counts. Phase 13 was not started. No `.env` content was read or changed, and no transaction, faucet request, commit, push, or deployment occurred.

**Inherited from the previous migration session:** the typed Tool Layer, shared Swap/CCTP policy, planner intent/plan/strategy schemas, guarded Agent handoff session, connected Xylo Swap and Direct CCTP controls, protocol Activity reconciliation, CCTP backend routes, and the existing live Send path. The inherited checkpoint passed 17 brain, 62 migration, and 2 backend tests after the first continuation's receipt and fee fixes. That continuation also fixed UNKNOWN reconciliation and future-dated CCTP fee rejection; see the audit amendment.

**Remaining blockers at the start of this final closeout:** Universal Bridge authority boundary; a persisted, receipt-gated runtime controller; replanning from current wallet/quote evidence and Agent reload history; connected mock/browser regression.

## Completion decision for the current architecture

| Phase | Final status | Canonical evidence and boundary |
|---|---|---|
| 8 Tool Layer | **COMPLETE for supported current protocols** | Typed reads, quotes, and bounded unsigned prepare operations for Send, Xylo Swap and Direct CCTP. Agent now calls fresh read/quote/prepare preflight for a structured first goal. Universal Bridge and Gateway are optional product adapters with explicit unavailable states. |
| 9 Policy & Risk | **COMPLETE for supported current writes** | Existing Send safety remains intact; Swap and CCTP use request binding, finite approval, simulation, expiry, fresh account/chain/balance/allowance/fee checks, and separate user review. |
| 10 Sequential Strategy | **COMPLETE for current Swap/CCTP dependent writes** | `migrated/strategyController.ts` gates approval → receipt → allowance reread → fresh quote/policy/review → independent wallet request, plus source and destination evidence. It persists recovery data without reviving signing or review authority. General arbitrary Agent goal sequences remain descriptive and do not execute. |
| 11 Intent Planner | **COMPLETE for current supported intent scope** | Validated INFORMATION/ACTION/STRATEGY output, explicit dependencies, dynamic amount refusal, and `replanAgentFromEvidence` using fresh account, chain, balance, allowance and Swap/CCTP quote/prepare observations. Only the first goal is eligible; later goals wait for product receipt and fresh review. |
| 12 Agent State Machine | **COMPLETE for current prepare-only Agent** | Existing Agent session guards plan/review/handoff. Current UI stores an account-bound historical pointer and restores only history after reload. Product controllers own submitted/pending/unknown/failed/completed states and read-only receipt recovery. Agent never signs or automatically continues. |

“Complete” above refers to the implemented Arc Send, Arc Xylo USDC/EURC Swap, and Arc→Base Sepolia Direct CCTP scope. It does not claim a general autonomous transaction executor, a live Universal Bridge, Gateway, or a real Swap/CCTP transaction. Phase 13 **review is allowed**; implementation is not authorized by this closeout.

## Final blocker work

### Universal Bridge — externally blocked

**BLOCKED BY PROVIDER/SDK CAPABILITY.** The inspected donor `frontend/lib/circle/{bridge,appKit,browserAdapter}.ts` delegates to the high-level Circle App Kit `kit.bridge()`. The current [Arc App Kit bridge quickstart](https://docs.arc.network/app-kit/quickstarts/bridge-tokens-across-blockchains) exposes that combined operation and reports approval/burn steps after execution; the inspected SDK surface does not provide a step-level bounded unsigned request that Makoto can freeze, review, immediately revalidate and submit separately. Consequently `migrated/universalBridge.ts` returns `UNAVAILABLE`, and the connected product route shows a disabled action. No SDK write authority was imported. Universal Bridge is an optional product route, not a dependency of the current Tool/Policy/Strategy/Planner/Agent core.

### Strategy and receipt continuation

`migrated/strategyController.ts` adds guarded Swap/CCTP phases for review, wallet request, hash, pending, unknown, rejection, failure, approval revalidation, requoting, source confirmation, destination pending, completion and recovery. `LiveSwapControl.tsx` and `LiveCctpControl.tsx` use this controller around each wallet request. A hash alone cannot unlock the next write. Approval confirmation requires a matching transaction and sufficient allowance; the next action requires a fresh quote, simulation, policy result, review and separate click. Swap completion needs a matching output Transfer. CCTP source confirmation is distinct from Circle forwarding and Base receipt plus USDC Transfer evidence. `UNKNOWN` cannot be downgraded by a missing receipt.

Safe account-bound run data are stored locally. A reload expires reviews, converts a wallet request without a hash to `UNKNOWN`, and restores a hashed request only for read-only recovery. Forged persisted receipt phases without a hash and binding are rejected. An indeterminate wallet request without a hash remains stopped for external wallet reconciliation; no blind retry control is offered. An approval confirmed after reload can resume by rereading allowance and requoting. Account/chain/amount/quote changes require a new review.

### Replanning and Agent recovery

`replanAgentFromEvidence` observes the current EIP-1193 account/chain, token balance, allowance, live Xylo quote or CCTP fee quote, and constructs an unsigned first action or finite approval when eligible. Insufficient balance, changed account/chain, stale/unavailable quote, and provider outage are blocked or unavailable states, never fabricated zeros. The Agent displays this evidence next to simple and sequential plans but retains a prepare-only handoff. It does not submit or continue a dependent goal. `brain/agentSession.ts` persists only the account-bound session pointer; `Agent.tsx` shows recovered sessions as history and requires a fresh plan/review.

## Connected mock and browser evidence

- `connectedProtocol.test.ts` exercises no-approval Swap, finite approval, pending/unknown/confirmed/failed receipt outcomes, allowance reread, requote and independent Swap request, verified output, duplicate guard, rejection and no signing from Agent preflight. It exercises Direct CCTP future/stale fee refusal, approval need, burn source receipt, Circle attestation, destination pending/confirmed, and reload recovery. Universal Bridge stays unavailable. The EIP-1193 fixture records writes locally; it never broadcasts.
- Browser QA used isolated `agent-browser` sessions with `frontend/scripts/qa-mock-wallet.js`. Its `eth_sendTransaction` always rejects with code 4001. Connected Swap and Direct CCTP reached bounded reviews, then displayed rejection with no submitted hash or fake success. Universal Bridge displayed a disabled unavailable action. Connected Agent displayed a verified mock wallet balance read, a read-only Swap quote/preparation result, and a multi-goal plan whose second goal waits for receipt and revalidation. A simple Swap went through parameter confirmation and one-time handoff to a populated Swap form; after reload Agent showed `HANDED_OFF` as history only, without reviving a review.
- Home, Agent, Swap, Bridge, Activity, Send, Faucet and Settings loaded at 1440, 1280 and 390 pixels in all EN/VI × light/dark combinations (12 combinations, 96 page checks). No page-level horizontal overflow or missing page heading was found; Agent intentionally has no `h1`. Receive's connected address dialog opened at 390 pixels without overflow. The browser reported no uncaught page errors. Actual wallet extension behavior and a real protocol receipt were not tested.

## Validation and release boundary

| Gate | Final result |
|---|---|
| Frontend `npm run test:brain` | **17/17 pass** |
| Frontend `npm run test:migration` | **71/71 pass** |
| Backend `npm test` | **2/2 pass** |
| Frontend `npm run type-check` | **pass** |
| Frontend `npm run lint` | **pass; 0 errors, 14 inherited warnings** |
| Frontend `npm run build` | **client and SSR pass; 2 existing chunking notices** |
| Live blockchain writes in this closeout | **0** |

Connected Xylo Swap and Direct CCTP are **READY FOR USER-AUTHORIZED LIVE TEST**. A live test must separately confirm wallet extension behavior and protocol receipts, including Base destination evidence. The user's prior live Arc USDC Send remains documented in `SEND_RUNTIME_AUDIT.md`; this closeout did not alter its execution path. Universal Bridge remains **BLOCKED BY PROVIDER/SDK CAPABILITY** until a step-level unsigned API is available. Gateway, broader autonomous strategies, and Surf DB are outside this final blocker scope.

**Phase 8–12 migration: COMPLETE for current supported scope. Phase 13 review: ALLOWED. Phase 13 work: NOT STARTED.**
