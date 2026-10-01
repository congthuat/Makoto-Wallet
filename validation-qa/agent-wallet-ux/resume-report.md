# Makoto UX continuation closeout — 2026-10-01

1. **Checkpoint recovered:** Read AGENTS.md, both current UX/state documents, all existing source diffs, new modules/tests/assets, and saved QA. Recovery hashes and A–Q classification are in resume-checkpoint.json. No work was restarted.

2. **Already modified files:** Before this continuation: frontend/package.json; Home.tsx; Agent.tsx; brain/parser.ts; migrated/toolLayer.ts; lib/wallet.ts; lib/store.tsx; lib/i18n-extra.ts; components/wallet/shared.tsx; docs/PROJECT_STATE.md. AGENT_HOME_UX.md and the new UX modules/assets/tests were already present.

3. **Already complete:** A Home reads, B original text, D handoff, E discovery, F picker, G/H/I wallet support, J explicit selection, K watch-only, L/M/N suggestions, and O responsive/scroll QA were complete. C retained system-copy localization, P final validation, and Q closeout documentation were partial. Nothing was not started.

4. **Completed in this continuation:** Finished retained Agent action/system presentation in the current locale, extended live locale regression, repeated affected Agent scroll checks and final frontend validation, refreshed hashes, and completed this 50-item report/documentation. Existing implementation was preserved.

5. **Home routing cause:** Home previously set the Agent seed and navigated unconditionally for every submitted query.

6. **English message cause:** The translated portfolio chip submitted a different English sample, “Check my portfolio”. Typed input was already preserved; the audit found no general typed-text replacement.

7. **Original-text solution:** originalText remains display/handoff truth, separate from planner and normalized intent metadata. Suggestions submit exactly their visible text through the ordinary handler. Old user messages are not rewritten.

8. **Locale authority:** Current app locale controls quick evidence, task replies/buttons, static action copy/labels, and suggestions at render time. User input and provider-authored conversation text remain unchanged.

9. **Inline Ask:** Portfolio, holdings, balances, recent activity and fresh Arc network reads answer compactly on Home through existing Brain/Planner/Tool Layer. Canonical verified store balances and totals are reused; no second valuation or synthetic data.

10. **Agent handoff:** Send/Swap/Bridge, deeper conversation, plans, clarification, Monitor and Automate retain Agent handoff. Six VI/EN action browser cases passed with original text. Existing review and wallet authority remain.

11. **Wallet architecture before:** One generic OKX-icon card called a helper preferring window.okxwallet over window.ethereum. The modal also closed after failures. Current and earlier baseline copies matched; donor code supplied no compatible picker.

12. **EIP-6963:** Native event discovery is implemented with deduplicated provider references, validated announcements, late updates, inert icon handling and explicit selection. Existing EIP-1193 consumers share selected getProvider().

13. **Package dependency:** No dependency was added. package.json only adds test:ux for suggestion/provider tests. No duplicate wallet library or lockfile edit was introduced.

14. **OKX:** Individual truthful detected/absent row; announced and legacy injection supported; selected OKX receives connection.

15. **MetaMask:** Individual truthful row; announced and legacy injection supported; official local fox fallback; selected MetaMask receives connection.

16. **Rabby:** Individual truthful row; announced and legacy injection supported; Rabby compatibility flags remain distinct from MetaMask; official local icon; selected Rabby receives connection.

17. **Additional providers:** Other actually discovered compatible providers get their own rows. A shared legacy global without separate provider references cannot identify hidden wallets. Metadata is presentation, not identity attestation.

18. **Explicit selection:** Provider identity tests pass. Selection commits only after account and Arc-chain readback; rejection, cancellation, unavailable account, wrong chain and late approval cannot replace a validated choice. Missing/ambiguous remembered wallets never silently fall back.

19. **Watch-only:** Public-address validation and read-only Policy/execution guards are preserved. Watch clears selection; reload with a legacy provider present still cannot sign or execute Send/Swap/Bridge.

20. **Ask VI:** 

   - Danh mục của tôi hiện trị giá bao nhiêu?
   - Tôi đang nắm giữ những tài sản nào?
   - Cho tôi xem các giao dịch gần đây
   - USDC, EURC và cirBTC của tôi hiện có số dư bao nhiêu?
   - Tình trạng mạng Arc hiện tại thế nào?

21. **Ask EN:** 

   - What is my portfolio worth right now?
   - What assets am I currently holding?
   - Show me my recent transactions
   - What are my current USDC, EURC and cirBTC balances?
   - What is the current Arc network status?

22. **Monitor VI:** 

   - Báo tôi khi số dư USDC xuống dưới 100
   - Báo tôi khi số dư EURC xuống dưới 50
   - Báo tôi khi số dư cirBTC xuống dưới 0.01
   - Báo tôi khi số dư USDC lên trên 1000
   - Báo tôi khi số dư EURC lên trên 200

23. **Monitor EN:** 

   - Notify me when my USDC balance falls below 100
   - Notify me when my EURC balance falls below 50
   - Notify me when my cirBTC balance falls below 0.01
   - Notify me when my USDC balance rises above 1000
   - Notify me when my EURC balance rises above 200

24. **Automate VI:** 

   - Gửi tôi tóm tắt danh mục lúc 08:00 mỗi ngày
   - Tóm tắt hoạt động ví cho tôi lúc 20:00 mỗi ngày
   - Cho tôi biết số dư USDC, EURC và cirBTC lúc 08:00 mỗi ngày
   - Gửi tôi tóm tắt danh mục lúc 20:00 mỗi ngày
   - Tóm tắt giao dịch ví hôm nay lúc 21:00 mỗi ngày

25. **Automate EN:** 

   - Send me a portfolio summary every day at 08:00
   - Summarize my wallet activity every day at 20:00
   - Show me my USDC, EURC and cirBTC balances every day at 08:00
   - Send me a portfolio summary every day at 20:00
   - Summarize today's wallet transactions every day at 21:00

26. **Replaced unsupported candidates:** Balance-change and portfolio-value monitor predicates became supported token thresholds. Weekly and vague morning/evening schedules became explicit daily HH:MM reads. All 30 localized suggestions map to supported capabilities; 20 task inputs pass the production parser and isolated engine execution.

27. **1440:** Home all modes/languages/themes, wallet no/one/multiple states, workflow handoff and scroll passed. Chips wrap naturally; no forced rows.

28. **1280:** Home all modes/languages/themes, Ask answers, immediate mode/locale changes and zero horizontal overflow passed.

29. **390:** Home and modal text wrap readably, controls remain reachable, and document/chip overflow is zero. Home/Agent/Settings scroll passed in both locales/themes.

30. **VI:** Original Vietnamese input remains exact; generated UI follows VI. Locale switching updates suggestions/system labels immediately.

31. **EN:** Original English input remains exact; generated UI follows EN. Cross-language input does not override app locale.

32. **Dark:** All requested Home and wallet modal dark cases passed in VI/EN. Existing hero grid/gradients/heading/input/focus styling retained.

33. **Light:** All requested light cases passed; local wallet icons and text remain readable.

34. **Home scroll:** Eight Home cases held Y=650 for more than 16 seconds with live Arc polling active; no jump to top.

35. **Agent scroll:** Eight populated Agent cases and an eight-case final affected Agent replay held scroll for over 16 seconds with polling active. Eight Settings cases also passed. Shell scroll-effect dependencies remain unchanged.

36. **Console:** Clean Home, workflow, wallet, scroll and final locale checks record zero console/page errors. Provider fixtures record zero forbidden signing/write methods.

37. **Files added:** Previously added: agent/homeRequest.ts and .test.ts; lib/agentSuggestions.ts and .test.ts; lib/walletProviders.ts and .test.ts; lib/walletPickerCopy.ts; components/wallet/WalletProviderIcon.tsx; public/wallets/metamask.svg and rabby.svg; tests/agent-task-locale.test.mjs; docs/AGENT_HOME_UX.md. QA artifacts were added under this directory. Frontend paths are relative to frontend/.

38. **Files modified:** The prior nine source/package files listed in item 2 are preserved. This continuation only completes Agent presentation, its live locale test, and targeted documentation/QA updates. No backend or transaction implementation file changed.

39. **Tests added:** 20 Home routing/evidence, 21 wallet-provider and 38 suggestion-capability tests. Live Agent locale regressions cover task replies and action/clarification copy while preserving historical input. Browser scripts cover 12 Home layouts/60 Ask clicks/20 task handoffs, six workflow cases, 30 wallet cases and 24 scroll cases.

40. **Exact totals:** 233/233 unique frontend suite tests: Brain 17, Agent 31, Tasks 10, Portfolio 17, migration 82, UI 17, UX 59; plus 2/2 live locale regressions, totaling 235 automated tests. Final affected Agent scroll replay passed 8/8 separately from the original 24/24 scroll matrix. No failures/skips. No backend rerun: all 27 recorded backend source/test files are unchanged.

41. **Type-check:** PASS.

42. **Lint:** PASS: zero errors, 12 inherited warnings.

43. **Client build:** PASS. Existing mixed-import and Circle /next chunk-size notices remain.

44. **SSR build:** PASS.

45. **Send unchanged:** Send page/execution and receipt modules are byte-identical to the starting checkpoint; selected wallet integration changes only the shared provider boundary.

46. **Swap unchanged:** Existing Xylo Swap execution, review and receipt modules are byte-identical.

47. **CCTP unchanged:** Official Circle adapter and CCTP execution/review/state/receipt files are byte-identical. Universal Bridge support state is preserved.

48. **Policy/Risk unchanged:** Policy/Risk, Strategy, Activity truth, receipt verification, CoinGecko prices, portfolio history, task persistence, SIWE ownership and LLM configuration files are byte-identical. All 61 selected sensitive files are unchanged.

49. **No blockchain writes:** No real signature, Send, Swap, approval, bridge or burn was requested/submitted. Tests use isolated wallet fixtures and public reads. No commit, push or deployment occurred. Existing development services remain running.

50. **Remaining blocker:** None for this scoped UX work. Actual installed extensions were not exercised; discovery/connection is fixture-verified. Modern prior sessions without a saved preference need explicit reconnect. Task creation retains the real SIWE gate; parser/engine support was fixture-verified without signing or creating a production task. Existing Universal Bridge restriction and inherited lint/build notices remain.

## Evidence

[Recovered checkpoint](resume-checkpoint.json), [prior 47-item report](report.md), [source audit](source-audit.json), [frontend validation](frontend-validation.md), [test totals](validation-totals.json), [Home results](home-browser-results.json), [workflow results](workflow-browser-results.json), [wallet results](wallet-browser-results.json), [scroll results](scroll-results.json). Final continuation evidence is linked in resume-validation.md.

[UX boundary documentation](../../docs/AGENT_HOME_UX.md), [project state](../../docs/PROJECT_STATE.md), [wallet provider audit](wallet-provider-audit.md).

MAKOTO AGENT UX AND MULTI-WALLET EXPERIENCE VERIFIED
