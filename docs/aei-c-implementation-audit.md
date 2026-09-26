# AEI-C implementation audit — pending review

**Baseline:** `c58d093b488c296e748bcc6b811f645f368c4c8c` on `phase12h-planner-strategy-integration`. Interrupted work was present in four files: `frontend/lib/strategyMaterialization.ts`, its focused test, `frontend/scripts/aei-c-browser.mjs`, and the Phase 7G fixture. No intervening commit was present. All four files were preserved, inspected, completed and committed as `612c3c69d665941fefbd00e8cea6aa4dda58a73e`.

## Closed input and authority

`materializePlannerStrategy` accepts only `{ version: 1, compilation, bindingSource }`. It requires an exact AEI-B `COMPILED`, `executionEnabled: false` result, a valid unprepared Phase 10 Strategy, the AEI-A v2 binding, the exact Strategy/source relationship, and a descriptor-safe retained B1/B2 provenance snapshot. It extracts the original live B2 source reference only after snapshot validation, checks its private runtime identity, validates the v2 binding against it, and recompiles the upstream Strategy with that source. A copied JSON source, v1 binding, stale or revoked source, caller-made digests, alternate Strategy or changed request/session/plan/evidence is rejected. Browser remount revokes the old source. This is application-level authority against ordinary public-API forgery, not cryptographic authentication or defense against fully compromised same-origin code.

No production UI caller was added. The browser script uses the existing isolated B2 fixture for positive live-source and adversarial coverage. The public AEI-C boundary cannot mint B2 trust from plain data.

## Artifacts and identity

The `SEMANTIC_ONLY` envelope preserves Strategy ID/version/creation time/content digest; the exact v2 binding and binding/evidence digests; request/session/request digest; B1 proposal and Planner plan IDs/digests; content-derived revision; ordered ACTION set; and whole-set digest. Each ACTION descriptor retains its parent Strategy/binding/revision, exact step/goal IDs, action kind, mapped dependency IDs, validated v1 PlannerIntent parameters, fixed unsatisfied requirements and digest. The action set stays in Strategy step order. Dependency IDs are sorted only where their order is semantically inert. Full-length domain-separated keccak256 tuples follow the approved design. Plain-object property insertion order is inert; changed bound content changes revision or artifact digest. An order edge never supplies a runtime output value.

SEND retains Arc chain, registered asset, positive amount and recipient. SWAP retains only the Arc Xylo USDC/EURC fixed pair, amount and chain. BRIDGE retains only the Arc Testnet USDC to Base Sepolia semantic intent and recipient. cirBTC swap/bridge is rejected by upstream validators. Descriptors do not assert Direct CCTP Agent handoff, Circle App Kit canonical PREPARE, or bridge destination completion.

Every ACTION declares unsatisfied `ACCOUNT_CONTEXT`, `LIVE_READ`, `QUOTE`, `POLICY_EVALUATION`, `PREPARATION`, `EXPLICIT_REVIEW`, and `SUPPORTED_WALLET_HANDOFF`. No account is inferred. There is no read, quote, provider, RPC, policy evaluation, preparation, calldata, wallet, signer, submission, receipt, retry or resubmission path in the AEI-C module. Later AEI-D must validate this exact envelope against the retained live source and separately bind operational evidence.

## Acceptance and verification

The 50 approved acceptance conditions were checked across the deterministic live B2 browser matrix, focused hostile-input tests, upstream validators, exact source inspection and regressions. The browser matrix passed **107/107** checks: fixed SEND/SWAP/BRIDGE, two ACTIONs and their order edge, exact binding/evidence/goal mapping, canonical object order, deterministic hashes, fresh amount revision, copied/altered source and binding rejection, cross-Strategy descriptor rejection, and source revocation. The focused AEI-C unit suite passed **4/4**, covering closed input, extra authority, hostile runtime values and artifact validation. Dynamic/remaining-balance inputs remain blocked upstream; a valid replacement requires a new B1 proposal and B2 confirmation. A two-goal Strategy without an edge is invalid under the Phase 11 Planner contract and was removed from the positive fixture.

| Design criteria | Evidence |
| --- | --- |
| 1–13 | Live SEND/SWAP/BRIDGE and two-goal confirmations, exact Strategy/binding/evidence identity, goal/ACTION map, parameters and edge assertions. |
| 14–20 | Repeated artifact and hash equality; reordered object properties; fresh confirmed amount; altered recipient/chain/asset/action/edge/Strategy content rejection and artifact tampering. Valid new semantics require fresh upstream confirmation. |
| 21–30 | v1, malformed v2, enabled, unsupported, incomplete, duplicate and malformed dependency inputs rejected through the closed gate and authoritative AEI-A/B/Planner validators. |
| 31–42 | AEI-C source and artifact schema inspection: no operational imports/calls or account field; seven requirements are declarations only. |
| 43–50 | Cross-Strategy artifact and legacy/copy rejection; upstream dynamic and cirBTC exclusions; truthful Direct CCTP and App Kit limitations; complete lineage and semantic requirements carried for AEI-D. |

Sequential focused regressions passed: AEI-A/AEI-B **24/24**, B2 **5/5**, provenance **8/8**, B1 **23/23**, Phase 11 **33/33**, Strategy **62/62**. Full frontend tests **1528/1528**; typecheck **PASS**; lint **0 errors, 7 inherited warnings**; normal Next.js Turbopack production build **PASS** in an isolated source copy with local `npm ci`; root Hardhat compile **PASS** (`Nothing to compile`); diff checks **PASS**. The existing worktree `node_modules` junction was untouched. Browser tests used a local synthetic fixture; no live provider/model, RPC, wallet or transaction call occurred.

AEI-C is **IMPLEMENTED / PENDING REVIEW**, not closed. AEI-D/E/F/G and Phase 13 are **NOT STARTED**. The provider-backed Planner proposal route remains **DEPLOYMENT_GATED_BY_AUTH_AND_RATE_LIMIT**. The post-AEI-G Surf “Bản thử nghiệm 1” plan is unchanged.
