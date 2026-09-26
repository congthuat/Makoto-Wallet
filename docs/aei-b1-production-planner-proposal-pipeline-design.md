# AEI-B1 — Production Planner Proposal Pipeline

**Status:** DESIGN APPROVED / NEXT / NOT STARTED. Documentation baseline `ab0c4348b34a34279eda5eee76d5053af3243188` on `phase12h-planner-strategy-integration`, with a clean worktree and index. AEI-A is COMPLETE / CLOSED; AEI-B is IMPLEMENTED / PENDING REVIEW / BLOCKED; AEI-B2 is DESIGN APPROVED / BLOCKED BY AEI-B1; AEI-C and Phase 13 are NOT STARTED. This document specifies a production proposal path; it implements no runtime code, endpoint, UI or provider call.

## Observed production caller gap

`frontend/app/api/planner-classify/route.ts` is the only production Planner API route. It exposes 11B classification behind `PLANNER_CLASSIFIER_HTTP_ENABLED`; it neither generates a plan nor resolves parameters. `plannerPlanGenerator.ts` and `plannerParameterResolver.ts` implement validated Phase 11 boundaries, and `openaiPlannerPlanGenerator.server.ts` and `openaiPlannerParameterResolver.server.ts` provide server-only adapters. A production import/call-site audit found no caller of either boundary outside tests. `agent/planner.ts` formats responses from the separate Agent parser/tool flow; it is not a Phase 11 Planner caller. `useMakotoAgent.ts` stores an `AgentActionDraft` and account/chain context but no canonical Planner request/session/plan/goal identity. `MakotoAgentPage.tsx` displays that draft and its wallet handoff. AEI-B2 has no real production proposal to review at this baseline.

The present 11D `RESOLVED` result carries `planId` and intents but no per-field origin; `NEEDS_CLARIFICATION` carries issues, not a complete candidate set. Its text-based dynamic check is an incomplete hint and can miss downstream percentage/receipt wording. B1 must preserve this distinction and cannot present a guessed fixed amount as a proven user value. The opt-in evidence factory still rejects caller-made structured events. No digest or validated 11A intent establishes user confirmation.

## Scope and production caller

AEI-B1 establishes one proposal-only production path:

`Agent user request → host-owned request/session identity → 11B classification → 11C plan generation → 11D parameter proposal/resolution → deterministic validation and origin classification → canonical non-executable proposal → distinct Agent proposal state`

A single server orchestration entry, such as `POST /api/planner-proposal`, is the smallest repository-consistent HTTP shape. It should use the existing server-only Phase 11 adapters and validators, with one bounded attempt per stage and no quote, RPC, wallet or transaction tool. The existing classify route may remain for its current callers; B1 need not expose separate new plan and parameter endpoints. The client must make an explicit proposal request rather than routing the legacy draft through that endpoint by inference. The production caller is complete only when a real Agent user request can reach the server pipeline and a validated proposal returns to live Agent UI state; a library-only coordinator, test fixture or dormant component is insufficient.

The server validates an exact, bounded `{text, locale, sessionId}` request body before any provider call. The application browser host creates a fresh bounded session ID for its live Planner conversation and retains it in memory; the server treats the incoming ID as correlation data, not authentication. The server allocates a fresh request ID and proposal ID outside provider output. It validates the normalized Phase 11 request (`text` after the existing trim rule, plus locale), then computes `requestDigest` with the existing versioned request/session digest contract. It passes only the accepted text and locale to classification, plan generation and parameter resolution. A server-assigned request ID is returned with the proposal; the browser accepts it only for its still-current session and in-flight request generation. This correlation rule rejects late or crossed responses without claiming that client-supplied session IDs authenticate a human.

After `CLASSIFIED` ACTION/STRATEGY, the server calls `generatePlannerPlan` with the exact classification, validates the v1 plan including all goal IDs, kinds and dependencies, and computes the existing canonical plan digest. It then calls 11D using that same retained plan and accepted request. It validates status, goal coverage, kind/field compatibility, canonical values and descriptor-safe JSON shape before constructing any proposal. The server assigns a versioned resolution identity/digest over request/session, exact plan, status, all goal-ID-keyed canonical parameters and issue/origin classifications. Existing 11D has no such identity, so this is a B1 contract to implement, not a fact about current output. Provider-returned IDs, digests, origin claims or status overrides never replace server observations. Failed or malformed stages return typed non-proposal results; no guessed fallback is sent.

The browser holds a separately typed `PlannerProposal` state in the Agent message/workspace alongside the existing legacy `AgentActionDraft` state. An explicit proposal request is routed before the legacy `parseAgentRequest`/`runAgentCapability` path, so the B1 request does not trigger that path's reads, quotes or preparation; the existing legacy path remains separately available. The host checks the response's exact session/request generation and schema before display, retains the immutable proposal object, and clears/replaces it on a new request, session change or replan. It never reconstructs identity from rendered text, array position, labels, action names or wallet draft state. Historical/display storage cannot be restored as a live proposal. This is a small addition to Agent state, not a replacement for the existing parser/draft flow. Legacy drafts remain legacy and noncanonical until any later AEI-F migration; their wallet Review action does not become a Planner parameter confirmation.

## Server, client and provider trust

| Boundary | Responsibility | Limit |
| --- | --- | --- |
| Browser Agent host | Capture the actual user request; hold live session and in-flight generation; request proposal; match response to the current session; display a distinct proposal state. | No provider credential, secret, signer, RPC client or ability to mint `FIXED_USER_INPUT`. Client correlation IDs and response digests are not authentication. |
| Server proposal coordinator | Allocate request/proposal IDs; invoke Phase 11 stages in order; retain exact accepted request, classification, plan and resolution during the call; validate and canonicalize; return bounded JSON with `Cache-Control: private, no-store` or equivalent. | No Strategy compiler/binding, Phase 9, quote, preparation, wallet, receipt, submission or retry call. No provider object or API key in response. |
| Provider adapters | Return untrusted classification, plan and parameter candidates through existing server-only ports. | No authority to assign application IDs, evidence origin, policy status, proposal confirmation or transaction state. |

The existing classify route is currently guarded by an environment flag. The B1 implementation must explicitly decide route availability and abuse controls before enabling the new server entry; it must not silently treat that disabled diagnostic route as a production caller. Input bounds, provider timeouts, no-store response handling and absence of secret logging follow current server conventions. Network calls to model providers occur only in the future server implementation; this documentation task makes none.

## Canonical B1 proposal and B2 handoff

B1 produces the exact **v1 `PlannerProposalReview` semantic payload** specified in [the AEI-B2 provenance design](aei-parameter-resolution-provenance-design.md). The production contract has a closed schema and deterministic validation against separately retained server inputs:

| Field | Binding |
| --- | --- |
| `version`, `executionEnabled` | Literal `1` and `false`. No executable action is carried. |
| `proposalId` | Fresh server-owned identity for one immutable response; a new semantic proposal gets a new ID. |
| `requestId`, `sessionId`, `requestDigest` | Server-assigned request identity, browser-host session correlation and digest of exact accepted text/locale plus those IDs. |
| `planId`, `planDigest` | Exact validated 11C plan identity and canonical goal-kind/dependency graph digest. |
| `goals` | Complete ID-keyed goal set, each with `goalId`, `kind`, `dependsOn`, and its own closed, kind-specific parameter records. No array-order identity. |
| `resolutionStatus`, `resolutionDigest` | Versioned deterministic outcome and digest covering every goal/parameter status and issue or origin classification; no provider claim is promoted to user authority. |
| `proposalDigest` | Versioned, domain-separated digest over the full canonical payload except itself. Integrity against retained inputs, not authentication or user consent. |

The final B1/B2 implementation must settle exact serialization and closed enums together; unknown versions, fields or variants fail closed. Complete SEND, SWAP and BRIDGE goal parameter keys follow `PlannerIntent`/AEI-B2: SEND `asset, amount, recipient, chainId`; SWAP `fromAsset, toAsset, amount, chainId`; BRIDGE `asset, amount, recipient, sourceChainId, destinationChainId`. A record may be a **fixed candidate** (`state: FIXED_CANDIDATE`, canonical `value`, unverified origin classification), or an **unresolved** expression (`state: UNRESOLVED`, bounded reason/expression class, no authoritative numeric value). No record claims `FIXED_USER_INPUT` or deterministic default authority at B1. Defaults, when proposed, are visible candidates and require later B2 confirmation or a separately certified rule. The model includes no quote, provider client, account signer, prepared transaction, calldata, policy decision, transaction hash or receipt.

For a two-goal Swap→Send, the payload preserves both goal IDs and the Send goal's explicit `dependsOn` edge to the Swap goal. Each goal retains its own complete parameter status set. The edge specifies order only; it never means “send the Swap output.” A dynamic Send amount such as “50% of previous output”, “all received” or “amount from receipt” remains dynamic/unresolved even if the provider suggests a decimal. The existing 11D dynamic heuristics are insufficient to certify every such case: B1 must fail closed for ambiguous goal-local amount provenance, preserve an explicit dynamic classification when verified, and exclude guessed numeric fallbacks from the confirmable fixed set. B1 does not evaluate runtime outputs or synthesize a fixed downstream amount.

B1's output proves only that deterministic code constructed a validated proposal for an observed request/session/plan. Even that statement depends on the live application host retaining its request context; serialized JSON and digests are not origin authentication. AEI-B2 must receive that **same immutable proposal identity and retained host source**, display its exact fields and capture a separate genuine user confirmation. It must never rebuild the proposal from visible values. AEI-B2 then creates per-field `FIXED_USER_INPUT` evidence for confirmed fixed values; AEI-B may later compile a non-executable Strategy skeleton and AEI-A v2 binds its evidence digest. B1 invokes none of those functions automatically. AEI-F later composes the complete Planner→confirmation→compiler→materialization→policy→wallet→receipt→continuation pipeline; B1 does not absorb any of that work.

## Typed failures, stale state and replanning

The implementation must define a closed result union with a proposal-success branch and typed non-proposal branches for invalid/malformed runtime request; classification failure or non-action category; provider unavailable/invalid output at each stage; invalid or unsupported plan version; plan/classification mismatch; goal/parameter mismatch; invalid or unsupported resolution; missing/unresolved/dynamic parameter; request/session mismatch; and stale/replan mismatch. Dynamic/unresolved outcomes may return a separately typed read-only proposal carrying truthful field status, but they cannot be marked complete or confirmable fixed. Provider failure never becomes a guessed amount or partial executable plan.

The client discards a late reply after input changes, another request starts, the Planner session changes or the user clears conversation. Replanning through 11E may propose a replacement graph, but B1 must validate it with the original request/session and allocate a new plan/proposal identity/digest; a new plan ID or changed goal kind/dependency invalidates the old proposal. The old proposal is removed from live confirmation eligibility. B2 must reject any subsequent attempt to reuse old confirmation against the new proposal. A recorded historical proposal is display context only.

## Implementation acceptance criteria

These are future implementation checks, not results of this documentation change.

1. A reachable production Agent caller invokes the single proposal-only Phase 11 pipeline; a classifying diagnostic route or test fixture does not satisfy this.
2. The server assigns and retains a request ID outside provider output, and the browser accepts it only for its current request generation.
3. The application session ID is retained through API, server stages, validated output and live Agent state; its JSON value alone is not authentication.
4. The request digest matches the exact accepted text/locale and request/session IDs.
5. The plan digest matches the exact validated plan ID, classification, goal IDs/kinds and dependencies.
6. Every goal ID and dependency edge survives provider, validation, API and Agent UI boundaries without positional matching.
7. Every proposed SEND/SWAP/BRIDGE parameter keeps its exact canonical goal/key/value or typed unresolved reason.
8. Resolution status, unverified origin/issue classification and a versioned resolution identity survive to the proposal.
9. Percentage/output/receipt-derived amounts stay dynamic or unresolved without a confirmable numeric fallback.
10. A provider-only fixed candidate remains unverified and never becomes `FIXED_USER_INPUT` at B1.
11. Proposal schema and digest revalidate against separately retained source; unknown fields, symbols, getters, hostile proxies, sparse arrays and bad versions fail closed.
12. Proposal has `executionEnabled: false` and no Strategy, binding, quote, preparation, policy, signer, wallet, submission, receipt or retry artifact.
13. B1 invokes no AEI-B compiler or AEI-A binding creation automatically.
14. B1 invokes no Phase 9 or Phase 10 execution path.
15. B1 invokes no wallet, signing or transaction submission path.
16. A malformed/provider-unavailable classification, plan or resolution returns a typed non-proposal failure, never guessed values.
17. Wrong request/session, crossed response, wrong goal/plan or changed digest is rejected before live UI state accepts the proposal.
18. A replan or changed goal kind/dependency creates new plan/proposal provenance and invalidates the old live proposal.
19. Agent UI can receive and truthfully present a canonical proposal as distinct from a prepared transaction.
20. Legacy Agent parser/draft/handoff behavior remains available but cannot masquerade as a canonical Planner proposal.
21. EN/VI B2 proposal review can consume the full canonical output without fabricating labels/identities or hiding required values.
22. No provider credential, server client, secret or privileged RPC object appears in response JSON or browser bundle.
23. The API/browser boundary is bounded and fail closed, with no-store handling and cancellation/stale-response checks.
24. Unit and production-call-site tests cover a complete fixed proposal and a multi-goal dynamic proposal with mocked adapters; no live provider call is required for tests.
25. A source audit finds no new transaction preparation, materialization, Phase 9, wallet, sign, submit, receipt polling, retry, resubmission or automatic continuation authority.

AEI-B1 remains DESIGN APPROVED / NEXT / NOT STARTED; AEI-B2 is DESIGN APPROVED / BLOCKED BY AEI-B1. AEI-B remains IMPLEMENTED / PENDING REVIEW / BLOCKED; AEI-C and Phase 13 are NOT STARTED. The only verification for this documentation task is `git diff --check` and an inspection that changed paths are documentation only.
