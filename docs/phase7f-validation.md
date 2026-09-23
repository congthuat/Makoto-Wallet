# Phase 7F recovery and validation

Date: 2026-09-17. Branch: `phase7-astra-ledger-calm`.

## Recovery inventory

HEAD: `91f2ed417a07e34662dc357681ed414839479d6f` (`fix(swap): own final preflight lifecycle`). No staged files or intervening commits.

| File at recovery | Classification |
| --- | --- |
| `frontend/components/RealSwapFlow.tsx` | A — intended production presentation |
| `frontend/components/SwapPanel.tsx` | A — intended production presentation |
| `frontend/components/UniversalBridgeFlow.tsx` | A — intended production presentation |
| `frontend/components/SwapBridge.css` | A — intended production presentation, untracked |
| `frontend/scripts/phase7f-fixture.mjs` | B — reusable isolated production-JSX QA fixture, untracked |

`phase7f-edit.cjs` was absent. No C/D/E files were present in the recovery inventory. No recovered file was discarded or regenerated from scratch.

## Final inventory

Production: the four component/CSS files above.

QA: the recovered fixture, `frontend/scripts/phase7f-browser.mjs`, `frontend/lib/phase7fSwapBridge.test.ts`, `frontend/lib/compactWalletFlows.test.ts`, and `frontend/lib/finalWalletFlowPolish.test.ts`.

Documentation: this report. No dependencies added. No temporary files removed; generated browser bundles, screenshots and logs are outside the worktree under `%TEMP%/makoto-phase7f-qa` and `%TEMP%/phase7f-*`.

Existing presentation tests were updated for the authorized field order, explicitly qualified financial labels, and full visible fee components. No lifecycle assertions were removed or relaxed.

## Validation

All counts below are executed tests, with zero failures. Named regression groupings are listed explicitly because they are broader/different selections than the supplied historical group labels; the full suite includes all 915 pre-existing tests plus 20 new tests.

| Group | Pass/total | Files under `frontend/lib` (suffix `.test.ts`) |
| --- | --- | --- |
| Phase 7F | 20/20 | `phase7fSwapBridge` |
| F7 | 16/16 | `repairGateF7` |
| F6 | 8/8 | `repairGateF6` |
| F5 | 7/7 | `repairGateF5` |
| F4 | 6/6 | `repairGateF4` |
| F3 | 4/4 | `repairGateF3` |
| F2 | 9/9 | `repairGateF2` |
| F1 | 9/9 | `repairGateF1` |
| Gate A | 27/27 | `repairGateA` |
| Gate B dedicated | 7/7 | `swapTruthfulness` |
| Gate B broader | 93/93 | `swapTruthfulness`, `transactionReceipt`, `walletActivity`, `agentActions`, `transactionFlowReview` |
| Gate C | 9/9 | `repairGateC` |
| Phase 7C | 3/3 | `phase7cReviewPresentation` |
| Swap | 123/123 | `swap`, `swapRouter`, `swapPlanning`, `swapGasHotfix`, `swapFeeEnvelope`, `smartSwapPhase`, `safeSwapMax`, `approveForMax`, `swapTruthfulness` |
| Navigation/handoff | 12/12 | `swapBridgeNavigation`, `agentHandoffHydration` |
| Bridge | 37/37 | `bridgePlanning`, `circleIntegration`, `circleBrowserAdapter`, `universalBridgeReadRouting`, `cctp` |
| Safety/orchestrator/review | 51/51 | `transactionSafety`, `transactionOrchestrator`, `transactionReview` |
| Responsive | 27/27 | `responsive` |
| Accessibility/prose | 15/15 | `repairGateD`, `repairGateE` |
| Full frontend | 935/935 | `npm test` |

`npm run typecheck`: passed. `npm run lint`: zero errors, four pre-existing hook warnings in UniversalBridgeFlow, independently reproduced against HEAD. `npm run build`: passed. `git diff --check`: passed.

Browser matrix: 390, 900 and 1440px × EN/VI × light/dark, with 13 Swap states and six Bridge states. The complete matrix passed 648/648 checks. A final Bridge-only rerun passed 228/228 checks after button sizing/color polish. Both runs reported zero axe violations and zero layout/keyboard failures.

Browser checks include overflow/clipping, axe audits, forward/reverse keyboard traversal, visible focus, hidden disclosure controls, modal focus containment/restoration, and inert Back/close/Continue controls during protected states. Screenshots were visually inspected in mobile, tablet and desktop layouts. This is automated keyboard/axe coverage, not a manual screen-reader audit.

Fixtures extract the production presentation branches and use the actual TransactionSafetyReview and WalletPanel. Wallet execution callbacks throw, and browser bundling rejects wallet/provider modules. Only public registry constants are extracted from App Kit; its executable SDK is not bundled. F1–F7 tests separately exercise the production lifecycle logic with synthetic clients.

The production app also loaded successfully in a disconnected browser smoke check. Live connected-wallet behavior was not exercised. Reown remote configuration returned HTTP 403 and the app fell back to local defaults; no configuration or wallet integration changes were made in this presentation phase.

Both production components' entire pre-render sections were compared to HEAD: hooks, approval, quote preparation, transaction construction, simulation, revalidation, submission and receipt handling are identical. The only removed pre-render function was the presentation-only compact fee formatter.

Reproduce from `frontend`:

```text
npm test
npm run typecheck
npm run lint
npm run build
node --experimental-strip-types scripts/phase7f-browser.mjs --serve
# In another terminal:
node --experimental-strip-types scripts/phase7f-browser.mjs --qa
# Optional targeted rerun:
node --experimental-strip-types scripts/phase7f-browser.mjs --qa --bridge-only
```

## Requested final checklist

1. Full HEAD: `91f2ed417a07e34662dc357681ed414839479d6f`.
2. Recovery files: five, listed and classified above.
3. Final files: ten, listed above.
4. Temporary files removed: none; one-off edit script absent.
5. Swap hierarchy: source asset/balance/amount, destination, qualified expected and minimum values, route/cost, existing Review, protected preflight/handoff/pending, distinct terminal states.
6. Bridge hierarchy: source network/USDC/amount, destination network/USDC, route/estimate, exact fees and timing context, existing Review, observed execution stages and terminal result.
7. Phase 7C TransactionSafetyReview reused: yes.
8. Duplicate Review created: NO.
9. Expected/minimum/actual truth preserved: yes; receipt-only actual and unavailable actual remain distinct from quote values.
10. F1 preserved: yes, 9/9.
11. F2 preserved: yes, 9/9.
12. F3 preserved: yes, 4/4.
13. F4 preserved: yes, 6/6.
14. F5 preserved: yes, 7/7.
15. F6 preserved: yes, 8/8.
16. F7 preserved: yes, 16/16; ownership/preflight code unchanged.
17. Gate A preserved: yes, 27/27.
18. Gate B preserved: yes, dedicated 7/7 and broader 93/93.
19. Gate C preserved: yes, 9/9.
20. EN verified: yes, rendered tests and browser matrix.
21. VI verified: yes, rendered tests and browser matrix; provider-supplied gas names retain their original text with localized context.
22. Light verified: yes.
23. Dark verified: yes.
24. 390px verified: yes.
25. 900px verified: yes.
26. 1440px verified: yes.
27. Accessibility: keyboard/focus/labels/disabled states/axe checked as described above.
28. Browser QA: complete synthetic matrix 648/648; final Bridge polish rerun 228/228.
29. Focused Phase 7F: 20/20.
30. F1–F7: all pass, individual counts above.
31. Gate A/B/C: all pass, counts above.
32. Swap regressions: 123/123; navigation/handoff 12/12.
33. Bridge regressions: 37/37.
34. Safety/orchestrator/review: 51/51.
35. Full frontend: 935/935.
36. Typecheck: passed.
37. Lint: passed with four unchanged warnings, zero errors.
38. Production build: passed.
39. `git diff --check`: passed.
40. Transaction semantics changed: NO.
41. Defect #4 modified: NO.
42. Defect #7 modified: NO.
43. Signing performed: NO.
44. Approval confirmed: NO.
45. Transaction submitted: NO.
46. Staged files: NONE.
47. Commit performed: NO.
48. Push performed: NO.
49. Merge performed: NO.
50. Deploy performed: NO.
51. Working tree: five modified tracked files and five intended untracked deliverables; all uncommitted.
52. Ready for controlled Phase 7F commit: YES; final inventory and diff check completed.
53. Recommended next action: review the complete uncommitted diff and QA evidence, then separately authorize the controlled commit. No subsequent phase started.

PHASE 7F PASSED — READY FOR CONTROLLED COMMIT
