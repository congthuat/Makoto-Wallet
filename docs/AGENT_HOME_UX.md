# Home Agent and wallet connection

Home handles a single proven deterministic portfolio, holdings, token-balance, recent-activity, or Arc-network read inline. `agent/homeRequest.ts` asks the existing Planner and Brain to classify the original input, then uses the Tool Layer. Balances and USD totals come from the same verified store observations as Portfolio; there is no second valuation implementation. Network replies require fresh Arc telemetry. Missing data produces a localized unavailable response. Demo balances are not presented as a real-wallet answer.

Send, Swap, Bridge, multi-step plans, clarification, deeper conversation, Monitor, and Automate requests hand off to Agent. The existing prepare/review, Policy, Strategy, and transaction boundaries stay authoritative. Task creation still requires the existing connected-account SIWE gate. Home suggestions are ordinary input, submitted through the same handler as typed text.

`originalText` is display truth. Planner classification and normalized intent are separate metadata. Home no longer submits a different English sample prompt when a translated chip is clicked. New user messages retain their exact submitted text; existing persisted user history is not rewritten. The current app locale controls generated quick answers, suggestions, and UI labels. Changing VI/EN re-renders quick evidence without translating the original message. Account, mode, or chain changes invalidate wallet-scoped quick evidence; public network evidence is independent.

Agent also retains canonical static copy and presentation metadata for task replies, action/clarification labels, strategy steps, observed evidence, local fallback topics, and observed time. Current locale controls their rendering; account, amount, status, timestamp, task definitions, user text, and provider-authored conversation text retain their original truth.

## Wallet discovery

`lib/walletProviders.ts` discovers [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963) announcements and compatible legacy injected providers. The picker shows individual OKX, MetaMask, and Rabby rows, plus other actually discovered providers. Absent wallets are disabled and marked **Not detected** / **Chưa phát hiện**. Announced icons are constrained to inert image sources; MetaMask and Rabby fallbacks use local assets from their official repositories.

An explicit selection controls the shared `getProvider()` used by existing wallet consumers. Connection requests accounts, checks/switches to Arc Testnet, rechecks chain and account, and commits the selected provider only after success. Rejected or cancelled connections retain the modal. Missing or ambiguous remembered providers never silently fall back to another wallet. A single legacy provider retains compatibility before picker selection. Watch-only clears provider selection, validates the public address, and preserves the existing read-only execution guards. No signer, key storage, or transaction architecture was imported from reference code.

## Suggestion capabilities

Each mode displays exactly five suggestions in VI or EN, immediately reflecting app state. Exact strings live in `lib/agentSuggestions.ts`.

| Mode | Supported suggestions |
| --- | --- |
| Ask | Portfolio value; holdings; recent transactions; USDC/EURC/cirBTC balances; Arc network |
| Monitor | USDC <100; EURC <50; cirBTC <0.01; USDC >1000; EURC >200 |
| Automate | Daily portfolio 08:00; activity 20:00; balances 08:00; portfolio 20:00; transactions 21:00 |

The current condition engine supports exact token thresholds, so balance-change and portfolio-value predicates were replaced. The current scheduler supports explicit daily HH:MM schedules, so weekly and vague morning/evening examples were replaced. Desktop chips wrap naturally; mobile chips wrap readable text without horizontal overflow.

Validation artifacts and the complete result list are in [the continuation report](../validation-qa/agent-wallet-ux/resume-report.md); the [earlier report](../validation-qa/agent-wallet-ux/report.md) is preserved. Provider tests and browser QA use isolated fixtures; they do not prove operation of a user's actual extension. No real signature or blockchain write is part of this verification. The package change adds only a test script, with no new dependency or wallet library.
