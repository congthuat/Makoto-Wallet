# Makoto Agent and multi-wallet verification — 2026-10-01

Current filesystem checkpoint preserved; local workspace only.

1. **Home routing root cause:** Home submitted every non-empty request by setting the Agent seed and navigating to Agent, regardless of intent.

2. **English-switch root cause:** The portfolio chip displayed translated text but submitted the different English SAMPLE_PROMPTS.portfolio value, “Check my portfolio”. Typed input was already preserved; no general typed-message English replacement was found.

3. **Original text / normalized intent:** Requests retain exact originalText for display and handoff. Planner text and normalized intent metadata are separate. Visible suggestion text is the submitted input.

4. **Locale authority:** Current app VI/EN controls generated quick answers and suggestions. Locale switches re-render quick evidence and task replies/buttons without changing historical user text. Provider text and transaction history are not rewritten.

5. **Simple Home queries:** Portfolio value, holdings, token balances, recent activity, and fresh Arc network status answer inline using the existing Brain/Planner and Tool Layer. Canonical store balances/valuation are reused. Missing evidence remains unavailable, never synthetic.

6. **Workflow handoff:** Send, Swap, Bridge, multi-step plans, clarification, deeper conversation, Monitor, and Automate retain Agent handoff. Six VI/EN Send/Swap/Bridge browser cases preserve original input. Agent remains prepare/review only.

7. **Routing files:** Changed Home.tsx, Agent.tsx, brain/parser.ts and migrated/toolLayer.ts; added agent/homeRequest.ts and its 20 tests. Parser changes extend read vocabulary; Tool Layer adds two pure read-only snapshot adapters.

8. **Provider architecture:** A shared registry discovers EIP-6963 and legacy injected EIP-1193 providers. Explicit successful selection controls getProvider() for existing consumers. Connection checks Arc chain and account again before committing provider identity.

9. **Baseline inspected:** The current modal/wallet integration, pre-change baseline copies, and local donor provider logic were inspected. The donor supplied no compatible individual-wallet picker to restore.

10. **Baseline pieces reused:** Existing modal shell, theme styling, public-address field/validation, and OKX fallback treatment were retained. No donor signing, account state, or transaction submission architecture was imported.

11. **EIP-6963 result:** Implemented announcement/request discovery, UUID validation, provider-object deduplication, inert metadata/images, late-announcement updates, and explicit selection. Modern announced providers are never chosen by announcement order.

12. **OKX:** Supported by EIP-6963 discovery and legacy okxwallet/compatibility flags; truthful detected/absent row and provider-specific connection are covered.

13. **MetaMask:** Supported by announced/legacy identity, with an official local fallback fox asset; isolated provider tests pass.

14. **Rabby:** Supported by announced/legacy identity, preserving Rabby classification despite MetaMask compatibility flags; selected Rabby receives requests even beside an OKX global.

15. **Other injected wallets:** Compatible announced or legacy providers receive actual discovered rows. Unknown absent wallets are not advertised as installed. Announced names/rdns are presentation metadata, not proof of identity.

16. **Multiple providers:** Only the selected provider receives connection requests; prior validated selection survives rejected/cancelled attempts. Missing or ambiguous remembered providers do not fall back. A sole legacy provider retains pre-picker compatibility.

17. **Watch-only:** Existing public-address validation remains. Watch clears selection; existing read-only Policy/Send/Swap/Bridge guards remain. Watch-mode reload with a legacy provider present still cannot execute or sign.

18. **Ask VI:** 

   - Danh mục của tôi hiện trị giá bao nhiêu?
   - Tôi đang nắm giữ những tài sản nào?
   - Cho tôi xem các giao dịch gần đây
   - USDC, EURC và cirBTC của tôi hiện có số dư bao nhiêu?
   - Tình trạng mạng Arc hiện tại thế nào?

19. **Ask EN:** 

   - What is my portfolio worth right now?
   - What assets am I currently holding?
   - Show me my recent transactions
   - What are my current USDC, EURC and cirBTC balances?
   - What is the current Arc network status?

20. **Monitor VI:** 

   - Báo tôi khi số dư USDC xuống dưới 100
   - Báo tôi khi số dư EURC xuống dưới 50
   - Báo tôi khi số dư cirBTC xuống dưới 0.01
   - Báo tôi khi số dư USDC lên trên 1000
   - Báo tôi khi số dư EURC lên trên 200

21. **Monitor EN:** 

   - Notify me when my USDC balance falls below 100
   - Notify me when my EURC balance falls below 50
   - Notify me when my cirBTC balance falls below 0.01
   - Notify me when my USDC balance rises above 1000
   - Notify me when my EURC balance rises above 200

22. **Automate VI:** 

   - Gửi tôi tóm tắt danh mục lúc 08:00 mỗi ngày
   - Tóm tắt hoạt động ví cho tôi lúc 20:00 mỗi ngày
   - Cho tôi biết số dư USDC, EURC và cirBTC lúc 08:00 mỗi ngày
   - Gửi tôi tóm tắt danh mục lúc 20:00 mỗi ngày
   - Tóm tắt giao dịch ví hôm nay lúc 21:00 mỗi ngày

23. **Automate EN:** 

   - Send me a portfolio summary every day at 08:00
   - Summarize my wallet activity every day at 20:00
   - Show me my USDC, EURC and cirBTC balances every day at 08:00
   - Send me a portfolio summary every day at 20:00
   - Summarize today's wallet transactions every day at 21:00

24. **Unsupported suggestions replaced:** cirBTC/USDC balance changes and portfolio-value monitoring became token thresholds. Weekly automation became a supported daily portfolio summary; vague morning/evening examples gained explicit 08:00/21:00 schedules. All 30 inputs map to supported capabilities; 20 task inputs pass the actual production parser and isolated engine execution.

25. **Desktop layout:** Five chips wrap naturally according to text length. VI may use 2+2+1; no forced row pattern or truncation. Modes show only their five suggestions.

26. **Mobile layout:** Readable 12.5px text, wrapping chips, no horizontal document/chip overflow at 390px; modal rows and watch field remain reachable.

27. **VI QA:** Home mode/input/answers, locale switching, six workflow/task routes, wallet states and scroll cases passed. Original Vietnamese input remains exact.

28. **EN QA:** Same supported reads and mode/wallet/scroll checks passed. English original input remains exact even while generated UI follows VI after a locale switch.

29. **Dark QA:** Home and wallet modal matrices passed in VI/EN; original visual system retained.

30. **Light QA:** Home and wallet modal matrices passed in VI/EN; official icon fallbacks and text remain readable.

31. **1440 QA:** Home, wallet modal, workflow handoff, and Home/Agent/Settings live-scroll checks passed.

32. **1280 QA:** Home all three modes, five Ask clicks, both languages/themes, and locale switches passed with zero horizontal overflow.

33. **390 QA:** Home, wallet modal, and Home/Agent/Settings live-scroll checks passed for both languages/themes with zero horizontal overflow.

34. **Home scroll:** Eight Home cases held Y=650 for over 16 seconds with real Arc network polling active.

35. **Agent scroll:** Eight populated Agent cases held Y=650 for over 16 seconds with polling active. Eight Settings cases also passed. The existing global scroll fix is preserved.

36. **Tests added/updated:** Added 20 Home routing/evidence tests, 21 wallet provider tests, and 38 suggestion capability tests; new test:ux script runs suggestions/providers. Browser scripts and raw JSON/screenshot evidence are retained here.

37. **Exact totals:** 233/233 unique frontend tests passed: Brain 17, Agent 31, Tasks 10, Portfolio 17, migration 82, UI 17, UX 59. No failures/skips. Home 12 layouts/60 Ask clicks/20 task handoffs; six workflow cases; wallet 30 cases; scroll 24 cases. Final locale reply regression is separately recorded. Backend source unchanged, so backend tests were not rerun.

38. **Type-check:** PASS.

39. **Lint:** PASS: 0 errors, 12 inherited warnings.

40. **Build:** PASS: client and SSR. Existing Dashboard/Insights mixed-import notices and the Circle /next chunk above 500kB remain.

41. **Console:** Final Home, workflow, wallet, scroll, and locale browser runs have zero console/page errors. Early failed harness captures are retained for transparency; selectors/assertions were corrected and clean reruns passed.

42. **Send unchanged:** Existing Send page/execution/receipt verification files are byte-identical to the starting checkpoint. Shared provider selection supplies the chosen user wallet; no execution rewrite.

43. **Swap unchanged:** Existing Xylo Swap execution/review/receipt implementation is byte-identical.

44. **CCTP unchanged:** Existing official Circle CCTP adapter, route/state/review/receipt boundary is byte-identical. Universal Bridge remains disabled under its existing provider capability limitation.

45. **Policy / Strategy unchanged:** Policy, Risk and Strategy Controller files are byte-identical. Activity truth, CoinGecko pricing, portfolio history, task persistence, SIWE ownership, and LLM configuration modules are also byte-identical. All 27 backend and 61 selected sensitive files remain unchanged.

46. **No blockchain write:** No real wallet signature, approval, Send, Swap, burn, or blockchain transaction was requested/submitted. Provider/browser tests use isolated fixtures and forbid signing/write RPCs. No commit, push, or deployment occurred. Local development services remain available.

47. **Limitations:** Actual installed user extensions were not exercised; provider behavior is fixture-verified. Modern sessions with no saved provider preference require explicit wallet selection. Task browser clicks retain the real SIWE gate; task parse/run support is proven with isolated engine fixtures, without a real signature or a production task creation. Existing Universal Bridge restriction and inherited lint/build notices remain.

## Evidence

- [Home results](home-browser-results.json), [workflow results](workflow-browser-results.json), [wallet results](wallet-browser-results.json), [scroll results](scroll-results.json).
- [Frontend validation](frontend-validation.md), [test totals](validation-totals.json), [source hash audit](source-audit.json), [scroll summary](scroll-summary.md).
- Representative [mobile VI light Automate](home-390-vi-light-automation.png), [desktop VI dark picker](wallet-multi-1440-vi-dark.png), [mobile EN light picker](wallet-multi-390-en-light.png).
- Product boundary: [AGENT_HOME_UX.md](../../docs/AGENT_HOME_UX.md); status: [PROJECT_STATE.md](../../docs/PROJECT_STATE.md).
- Standards: [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963), [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193). Official fallback assets: [MetaMask](https://github.com/MetaMask/metamask-extension/blob/main/app/images/logo/metamask-fox.svg), [Rabby](https://github.com/RabbyHub/logo/blob/master/symbol.svg).

## Changed files

Existing source: frontend/package.json; src/pages/Home.tsx; src/pages/Agent.tsx; src/brain/parser.ts; src/migrated/toolLayer.ts; src/lib/wallet.ts; src/lib/store.tsx; src/lib/i18n-extra.ts; src/components/wallet/shared.tsx.

New source/tests: src/agent/homeRequest.ts and .test.ts; src/lib/agentSuggestions.ts and .test.ts; src/lib/walletProviders.ts and .test.ts; src/lib/walletPickerCopy.ts; src/components/wallet/WalletProviderIcon.tsx; public/wallets/metamask.svg and rabby.svg. Paths above are relative to frontend/. Documentation: docs/PROJECT_STATE.md and docs/AGENT_HOME_UX.md. QA artifacts are under validation-qa/agent-wallet-ux/.

MAKOTO AGENT UX AND MULTI-WALLET EXPERIENCE VERIFIED
