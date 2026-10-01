# Makoto Agent LLM layer

Status: implemented as a conversational layer after the Phase 8-12 closeout. Real provider verification and the 2026-09-29 provider stability fix are complete. Phase 13 MCP work and Phase 14 memory work remain **not started**.

## Boundary

The LLM is used for natural language only:

- greetings, identity, capabilities, thanks, goodbye and general conversation;
- concise explanations and summaries of facts already read by Makoto;
- language assistance around a classified request.

The deterministic runtime remains authoritative for wallet reads, quotes, planner output, policy and risk decisions, preparation, state transitions, receipts, recovery and every wallet request. A model response cannot create a quote, claim a balance, advance a strategy, or authorize a write.

The wallet remains the signer. The LLM endpoint has no provider, signer, private key, raw transaction, `eth_sendTransaction`, arbitrary calldata or Policy/Risk access. Action and strategy requests continue through the existing local planner and review handoff. The LLM is not called to choose or execute an action.

## Request path

```text
Agent UI
  -> POST /api/agent/chat
  -> backend/routes/agent.js
  -> backend/lib/llm.js
  -> configured Responses-compatible provider
```

The browser sends only the bounded user message, locale, recent chat history and a small allowlisted context. Chat history is short term browser-session state: at most 12 recent user/assistant messages, 600 characters per item and 6,000 characters total. It is text-only and separate from Agent transaction/session state, so signer/provider objects, raw transactions, and stale review data cannot enter it. It is not permanent memory. The backend keeps the provider key and endpoint server-side. Tool context is sanitized to status/source/reason/time plus bounded balance or display rows. Account, signer, private key, raw calldata and provider objects are not forwarded.

`backend/lib/llm.js` uses the provider's `/responses` endpoint with `store: false`, a 12,000 ms timeout, a small output budget and a system instruction that treats user text and tool context as untrusted data. It permits one 150 ms backoff retry only for HTTP 5xx responses and non-timeout network errors. Authentication, permission, timeout, rate-limit, malformed-response and missing-configuration failures are not retried. Provider errors are mapped to safe status messages and provider response bodies are never returned.

## Configuration

Copy the backend example and keep these values in `backend/.env` only:

```dotenv
LLM_API_KEY=
LLM_BASE_URL=
LLM_MODEL=
LLM_TIMEOUT_MS=12000
```

The adapter is intentionally provider-boundary code with no frontend SDK or browser key. Populate `LLM_BASE_URL` with the selected provider's Responses-compatible API base (for example, an OpenAI-compatible `POST /responses` endpoint), and populate `LLM_MODEL` before a request is sent. `LLM_TIMEOUT_MS` is capped by the adapter.

If the provider is not configured, times out, rate-limits, or is unavailable, the UI uses local deterministic replies for chat and keeps canonical wallet read/preparation behavior available. Internal response sources distinguish `REAL_PROVIDER`, `LOCAL_FALLBACK`, and `DETERMINISTIC_TOOL`. Information rows still come from the connected provider; a missing LLM never becomes a fabricated balance, quote, status or receipt.

## Routing

`frontend/src/agent/chatRouter.ts` classifies each message as:

- `CHAT`: conversational topics and explanations;
- `INFORMATION`: wallet, activity and network reads;
- `INFORMATION`: current date/time reads are answered by a deterministic browser tool using the browser's Intl timezone and return ISO, local date, local time, timezone and offset values;
- `ACTION`: one Send, Swap or Bridge request;
- `STRATEGY`: sequential action requests.

`ACTION` and `STRATEGY` are handled by `planAgentRequest`, `planBrainRequest`, the Tool Layer and existing Policy/Risk and state boundaries. `INFORMATION` reads use existing deterministic read functions and pass only their observed rows to the optional language layer. `CHAT` can use the backend provider, with local EN/VI replies available when it cannot.

## Tests and QA

Focused tests cover:

- EN/VI greetings, capabilities, thanks, goodbye and safety language;
- wallet, activity and network information routing;
- complete, incomplete and sequential Send/Swap/Bridge requests;
- bounded history and browser-to-backend request shape;
- 12-message/6,000-character context bounds, text-only context separation, wallet asset follow-ups and deterministic EN/VI current-time routing;
- missing configuration, invalid input, timeout, rate limit and provider failure;
- provider 401/403/408/429/5xx and network classification, bounded retry behavior and Responses `output` parsing;
- untrusted prompt text and context sanitization, with no signer or secret leakage.

Run them with:

```bash
cd frontend && npm run test:brain
cd frontend && npm run test:agent
cd frontend && npm run test:migration
cd backend && npm test
```

Browser QA should run in demo and connected mock modes for both EN and VI. Connected mock wallet calls must remain read-only or rejected by the existing mock signer; no real write is needed to validate this layer.

## Real provider verification checkpoint

Verified 2026-09-29 using the existing adapter and backend route:

- `LLM_API_KEY` was present in the backend environment; its value and metadata were not recorded.
- Provider: OpenAI-compatible Responses API at `https://api.openai.com/v1`.
- Model: `gpt-5.6-luna`.
- `POST /api/agent/chat` returned the marker `REAL_PROVIDER_OK` for a marker prompt, proving the configured provider path rather than the local fallback.
- A clean two-turn route test (Vietnamese greeting followed by a time question with assistant history) returned HTTP 200 on both turns; the provider adapter accepted the bounded conversational history.
- The earlier observed fallback was an HTTP 503 `LLM_PROVIDER_UNAVAILABLE` response from a stale/direct backend process that had not loaded `backend/.env`; missing configuration was mislabeled as provider unavailable by the previous adapter. The fresh and direct-start routes now load the same configuration and return HTTP 200; the fallback code remains exercised for transient failures.
- Connected mock-wallet browser QA covered the Vietnamese greeting -> current-time -> capabilities -> USDC balance -> EURC follow-up sequence, English current-time routing, provider-unavailable fallback, and current deterministic rows. The time turn made no provider chat request, and wallet rows remained tool-derived during provider abort. No wallet write was requested.
- Browser network inspection showed HTTP 200 calls to the local `/api/agent/chat` proxy and no direct provider URL from the frontend.
- Timeout, 401, 403, 429, malformed and unavailable provider cases continued to use safe fallback behavior.

## Provider 503 diagnosis and stability fix

The intermittent `LLM_PROVIDER_UNAVAILABLE`/HTTP 503 report was traced to startup configuration, not to a reproduced provider outage. An older or directly started backend process did not load `backend/.env`; with missing provider configuration, the adapter returned `reason: LLM_NOT_CONFIGURED` while the previous implementation mislabeled the public code as `LLM_PROVIDER_UNAVAILABLE`. `npm run dev` already loaded the file, and `backend/server.js` now loads the same server-only values for direct `node server.js` starts without overwriting explicit process environment values.

The final non-secret provider trace was:

- Base URL: `https://api.openai.com/v1`
- Request: `POST https://api.openai.com/v1/responses`
- Model: `gpt-5.6-luna`
- Timeout: `12,000 ms` per attempt
- Key status: `LLM_API_KEY` **PRESENT**; its value and metadata were not recorded
- Response parsing: Responses API `output[].content[].text`, with `output_text` and compatible `choices` support

The adapter now maps 401 to `LLM_UNAUTHORIZED`, 403 to `LLM_FORBIDDEN`, 408 or an abort to `LLM_TIMEOUT`, 429 to `LLM_RATE_LIMITED`, provider 5xx to `LLM_PROVIDER_UNAVAILABLE`, network failure to `LLM_PROVIDER_UNREACHABLE`, malformed or empty output to `LLM_MALFORMED_RESPONSE`, and missing configuration to `LLM_NOT_CONFIGURED`. The route returns 503 only for missing configuration, 429 for rate limiting, 504 for timeout, and 502 for other provider or backend failures. No provider 5xx occurred in the live stability run; the status and retry behavior is covered by focused adapter tests.

After the fix, ten sequential `POST /api/agent/chat` requests completed `10/10` with HTTP 200, `source: REAL_PROVIDER`, and non-empty text. Measured latency was average `1,386.0 ms`, minimum `1,067 ms`, maximum `1,878 ms`. A direct adapter trace confirmed the final `/responses` URL, model, HTTP 200, and text extraction. Browser QA also verified EN and VI provider replies, deterministic current time without a chat request, bounded USDC/EURC context follow-up, connected mock read rows, and local fallback during an aborted chat request at 1440 px and 390 px in light and dark themes.
